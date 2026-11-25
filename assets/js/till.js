// MOVA Miles · staff till (/staff)
// The tablet stays signed in to the shop login. Each barista picks their name and enters
// their PIN at the start of a shift; every stamp is recorded against them.
(function () {
  const { MOMENTS, esc, ago, timeHM, persona, friendly, rpc } = window.MOVA;
  const app = document.getElementById("app");
  const bar = document.getElementById("bar");
  const AREA = "till";
  const IDLE_CLEAR_MS = 60000;   // hide the customer's details after a minute of no activity
  const CAMERA_HINT = "Point a scanner at the customer's QR code, or turn on the camera.";

  let shop = null;               // {role, shop}
  let barista = null;            // {id, name, pin}, kept in memory only
  let customer = null;           // card JSON for the customer on screen
  let ui = { qty: 1, confirm: null, toast: "", error: "", busy: false, pickFor: null, pinError: "" };
  let today = [];
  let idleTimer = null, camera = null, facing = "environment", lastScan = { code: "", t: 0 };

  if (!window.MOVA.configured()) {
    app.innerHTML = `<div class="notice"><b>MOVA Miles isn't connected yet.</b><span>Add the Supabase details to assets/js/config.js (see SETUP.md).</span></div>`;
    return;
  }
  const sb = window.MOVA.client(AREA);
  const $ = (id) => document.getElementById(id);

  /* ---------- Shop login ---------- */
  function renderLogin(msg) {
    bar.innerHTML = `<span class="who">Till · MOVA Miles</span>`;
    app.innerHTML = `
      <form class="narrow" id="login" style="padding:0" novalidate>
        <h1 style="font-family:var(--display);font-weight:500;font-size:40px">Sign in to the till</h1>
        <p class="muted">Use the shop login. You only need to do this once on each tablet.</p>
        <label class="field" for="email">Shop email<input id="email" type="email" autocomplete="username" required></label>
        <label class="field" for="password">Password<input id="password" type="password" autocomplete="current-password" required></label>
        ${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}
        <button class="btn" type="submit">Sign in</button>
      </form>`;
    $("login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
      if (error) renderLogin(friendly(error));
    });
  }

  async function afterSignIn() {
    try { shop = await rpc(AREA, "till_whoami"); }
    catch (err) {
      app.innerHTML = `<div class="notice"><b>${esc(friendly(err))}</b><button class="btn-line" id="out" type="button">Sign out</button></div>`;
      $("out").onclick = () => sb.auth.signOut();
      return;
    }
    renderPickBarista();
  }

  /* ---------- Barista sign-in ---------- */
  async function renderPickBarista() {
    stopCamera(); barista = null; customer = null; clearTimeout(idleTimer);
    renderBar();
    if (ui.pickFor) {
      const s = ui.pickFor;
      app.innerHTML = `
        <form class="narrow" id="pinform" style="padding:0" novalidate>
          <h1 style="font-family:var(--display);font-weight:500;font-size:40px">Hi ${esc(s.name)}</h1>
          <label class="field" for="pin">Your PIN<input id="pin" class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" required></label>
          ${ui.pinError ? `<p class="err" role="alert">${esc(ui.pinError)}</p>` : ""}
          <button class="btn" type="submit">Start shift</button>
          <button class="link" id="back" type="button">Not ${esc(s.name)}?</button>
        </form>`;
      $("pin").focus();
      $("back").onclick = () => { ui.pickFor = null; ui.pinError = ""; renderPickBarista(); };
      $("pinform").addEventListener("submit", async (e) => {
        e.preventDefault();
        const pin = $("pin").value;
        try {
          if (await rpc(AREA, "till_check_pin", { p_staff: s.id, p_pin: pin })) {
            barista = { id: s.id, name: s.name, pin }; ui.pickFor = null; ui.pinError = "";
            renderTill(); refreshLog();
          } else { ui.pinError = "That PIN didn't match. Try again."; renderPickBarista(); }
        } catch (err) { ui.pinError = friendly(err); renderPickBarista(); }
      });
      return;
    }
    let staff = [], loadError = "";
    try { staff = await rpc(AREA, "till_staff"); } catch (err) { loadError = friendly(err); }
    app.innerHTML = `
      <h1 style="font-family:var(--display);font-weight:500;font-size:40px">Who's on the till?</h1>
      ${ui.pinError ? `<p class="err" role="alert">${esc(ui.pinError)}</p>` : ""}
      ${loadError ? `<p class="err" role="alert">${esc(loadError)}</p>` : staff.length
        ? `<div class="staff-pick">${staff.map((s) => `<button type="button" data-id="${s.id}" data-name="${esc(s.name)}">${esc(s.name)}</button>`).join("")}</div>`
        : `<div class="notice">No staff yet. The owner adds baristas and their PINs on the admin page (/admin).</div>`}`;
    app.querySelectorAll(".staff-pick button").forEach((b) => (b.onclick = () => { ui.pickFor = { id: b.dataset.id, name: b.dataset.name }; ui.pinError = ""; renderPickBarista(); }));
  }

  function renderBar() {
    bar.innerHTML = `
      <span class="who">${esc(shop ? shop.shop : "")}${barista ? " · " + esc(barista.name) : ""}</span>
      ${barista ? `<button class="btn-line btn-small" id="switch" type="button">Switch barista</button>` : ""}
      <button class="link" id="lock" type="button">Sign out of till</button>`;
    if (barista) $("switch").onclick = () => { ui.pickFor = null; renderPickBarista(); };
    $("lock").onclick = () => { stopCamera(); sb.auth.signOut(); };
  }

  /* ---------- Main till (built once per shift; parts update in place) ---------- */
  function renderTill() {
    renderBar();
    app.innerHTML = `
      <div id="toast-slot"></div>
      <div class="till">
        <section class="panel" aria-label="Scan">
          <h2>Scan the customer's card</h2>
          <div class="camera" id="camera"><span>${CAMERA_HINT}</span></div>
          <div class="actions" id="camctl"></div>
          <form class="find" id="find" novalidate>
            <label class="sr" for="code">Member code</label>
            <input id="code" placeholder="Member code" autocomplete="off" autocapitalize="characters" spellcheck="false">
            <button class="btn" type="submit">Find</button>
          </form>
          <p class="hint">A USB or Bluetooth scanner types into this box for you. Phone won't scan? Type the code under their QR.</p>
        </section>
        <section class="panel" id="detail" aria-live="polite" aria-label="Customer"></section>
      </div>
      <section class="panel" aria-label="Today's stamps">
        <h2>Today at the till</h2>
        <div class="table-wrap" id="log"></div>
      </section>`;
    $("find").addEventListener("submit", (e) => { e.preventDefault(); lookup($("code").value); });
    renderCamControls(); update(); renderLog();
  }

  function update() { renderToast(); renderDetail(); focusCode(); }
  function renderToast() { const t = $("toast-slot"); if (t) t.innerHTML = ui.toast ? `<div class="toast" role="status">${ui.toast}</div>` : ""; }
  function focusCode() { const c = $("code"); if (c && !ui.confirm) c.focus({ preventScroll: true }); }

  function renderDetail() {
    const el = $("detail");
    if (!el) return;
    if (!customer) {
      el.innerHTML = ui.error ? `<p class="err" role="alert">${esc(ui.error)}</p>` : `<div class="empty">Scan a customer to add stamps or use a free coffee.</div>`;
      return;
    }
    const c = customer, size = c.card_size, pe = persona(c.moments);
    const dots = Array.from({ length: size }, (_, i) => `<i class="${i < c.progress ? "on" : ""}"></i>`).join("") + `<i class="end${c.rewards_available ? " on" : ""}"></i>`;
    const willEarn = Math.floor((c.progress + ui.qty) / size);
    el.innerHTML = `
      <div class="cust-head"><strong>${esc(c.first_name)}</strong><span class="code">${esc(c.code)}</span></div>
      <span class="mover">${pe.ready ? `<b>${MOMENTS[pe.top].persona}</b> · usually ${MOMENTS[pe.top].range}` : "<b>New Mover</b> · not enough visits yet"}</span>
      <div class="mini" aria-label="${c.progress} of ${size} stamps">${dots}</div>
      <div class="facts">
        <span><b>${c.progress}/${size}</b> stamps</span>
        <span><b>${c.rewards_available}</b> free ${c.rewards_available === 1 ? "coffee" : "coffees"} ready</span>
        <span>Last stamp: <b>${c.last_stamp_at ? ago(c.last_stamp_at) : "never"}</b></span>
      </div>
      ${ui.error ? `<p class="err" role="alert">${esc(ui.error)}</p>` : ""}
      ${ui.confirm ? `<div class="warnbox" role="alert"><span><b>Stamped ${ago(ui.confirm)}.</b> Is this a new order?</span><div class="actions"><button class="btn" id="yes" type="button">Yes, new order</button><button class="btn-line" id="no" type="button">Cancel</button></div></div>` : ""}
      <div class="actions">
        <div class="stepper" role="group" aria-label="Coffees in this order">
          <button type="button" id="minus" aria-label="One fewer coffee">−</button>
          <output aria-live="polite">${ui.qty}</output>
          <button type="button" id="plus" aria-label="One more coffee">+</button>
        </div>
        <button class="btn" id="stamp" type="button" ${ui.busy ? "disabled" : ""}>Add ${ui.qty} ${ui.qty === 1 ? "stamp" : "stamps"}</button>
      </div>
      ${willEarn ? `<p class="hint">This order completes the card and earns ${esc(c.first_name)} a free coffee.</p>` : ""}
      <div class="actions">
        <button class="btn-line" id="redeem" type="button" ${c.rewards_available && !ui.busy ? "" : "disabled"}>Use free coffee</button>
        <button class="link" id="next" type="button">Next customer</button>
      </div>`;
    $("minus").onclick = () => { ui.qty = Math.max(1, ui.qty - 1); ui.confirm = null; renderDetail(); };
    $("plus").onclick = () => { ui.qty = Math.min(6, ui.qty + 1); ui.confirm = null; renderDetail(); };
    $("stamp").onclick = () => addStamps(false);
    $("redeem").onclick = redeem;
    $("next").onclick = clearCustomer;
    if (ui.confirm) {
      $("yes").onclick = () => addStamps(true);
      $("no").onclick = () => { ui.confirm = null; update(); };
    }
    armIdle();
  }

  function renderLog() {
    const el = $("log");
    if (!el) return;
    if (!today.length) { el.innerHTML = `<p class="muted">Nothing yet today.</p>`; return; }
    const canUndo = (r) => !r.voided_at && (shop.role === "owner" || Date.now() - new Date(r.at).getTime() < 30 * 60000);
    el.innerHTML = `<table><thead><tr><th>Time</th><th>Customer</th><th>What</th><th>Moment</th><th>Staff</th><th></th></tr></thead><tbody>${
      today.map((r) => `<tr class="${r.voided_at ? "void" : ""}"><td class="num">${timeHM(r.at)}</td><td>${esc(r.customer)}</td><td>${r.kind === "stamp" ? "+" + r.qty + (r.qty === 1 ? " stamp" : " stamps") : "Free coffee used"}${r.voided_at ? " (undone)" : ""}</td><td>${r.moment ? MOMENTS[r.moment].short : "–"}</td><td>${esc(r.staff || "")}</td><td>${canUndo(r) ? `<button class="link" data-kind="${r.kind}" data-id="${r.id}" type="button">Undo</button>` : ""}</td></tr>`).join("")
    }</tbody></table>`;
    el.querySelectorAll("button[data-id]").forEach((b) => (b.onclick = () => undo(b.dataset.kind, Number(b.dataset.id))));
  }

  /* ---------- Actions ---------- */
  async function lookup(raw) {
    const code = String(raw || "").trim();
    if ($("code")) $("code").value = "";
    if (!code) return;
    ui = { ...ui, qty: 1, confirm: null, toast: "", error: "" };
    try { customer = await rpc(AREA, "till_lookup", { p_code: code }); }
    catch (err) { customer = null; ui.error = friendly(err); }
    update();
  }

  async function addStamps(force) {
    if (!customer || ui.busy) return;
    ui.busy = true; ui.error = ""; renderDetail();
    try {
      const r = await rpc(AREA, "till_add_stamps", { p_code: customer.code, p_qty: ui.qty, p_staff: barista.id, p_pin: barista.pin, p_force: force });
      if (r.status === "confirm") { ui.confirm = r.last_stamp_at; }
      else {
        const n = ui.qty;
        customer = r.card; ui.confirm = null; ui.qty = 1;
        ui.toast = `Added ${n} ${n === 1 ? "stamp" : "stamps"} for ${esc(customer.first_name)} · ${MOMENTS[r.moment].name}.` +
          (r.rewards_earned ? ` Card complete: ${r.rewards_earned === 1 ? "a free coffee" : r.rewards_earned + " free coffees"} earned.` : ` ${customer.card_size - customer.progress} to go.`);
        refreshLog();
      }
    } catch (err) { if (handleError(err)) { ui.busy = false; return; } }
    ui.busy = false;
    update();
  }

  async function redeem() {
    if (!customer || ui.busy) return;
    ui.busy = true; renderDetail();
    try {
      const r = await rpc(AREA, "till_redeem", { p_code: customer.code, p_staff: barista.id, p_pin: barista.pin });
      customer = r.card; ui.toast = `Free coffee used for ${esc(customer.first_name)}.`;
      refreshLog();
    } catch (err) { if (handleError(err)) { ui.busy = false; return; } }
    ui.busy = false;
    update();
  }

  async function undo(kind, id) {
    try {
      await rpc(AREA, "till_void", { p_kind: kind, p_id: id, p_staff: barista.id, p_pin: barista.pin });
      ui.toast = kind === "stamp" ? "Stamp undone." : "Free coffee undone. The customer has it back.";
      if (customer) customer = await rpc(AREA, "till_lookup", { p_code: customer.code });
      refreshLog();
    } catch (err) { if (handleError(err)) return; }
    update();
  }

  // Returns true when the barista has been sent back to sign in (their PIN was changed or removed).
  function handleError(err) {
    if (/wrong_pin/.test((err && err.message) || "")) {
      ui.pickFor = null; ui.pinError = "Your PIN has changed or you were removed. Sign in again.";
      renderPickBarista();
      return true;
    }
    ui.error = friendly(err);
    return false;
  }

  function clearCustomer() {
    customer = null; ui = { ...ui, qty: 1, confirm: null, toast: "", error: "" };
    clearTimeout(idleTimer);
    update();
  }
  function armIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (customer && !ui.busy) clearCustomer(); }, IDLE_CLEAR_MS); }

  async function refreshLog() {
    try { today = await rpc(AREA, "till_today"); } catch (e) { /* keep the last list */ }
    renderLog();
  }

  /* ---------- Camera ---------- */
  function renderCamControls() {
    const el = $("camctl");
    if (!el) return;
    el.innerHTML = `<button class="btn-line btn-small" id="cam" type="button">${camera ? "Turn camera off" : "Use camera"}</button>
      ${camera ? `<button class="link" id="flip" type="button">Switch camera</button>` : ""}`;
    $("cam").onclick = () => { camera ? stopCamera() : startCamera(); };
    if (camera) $("flip").onclick = async () => { facing = facing === "environment" ? "user" : "environment"; await stopCamera(); startCamera(); };
  }

  function startCamera() {
    const box = $("camera");
    if (!box || typeof Html5Qrcode === "undefined") return;
    box.innerHTML = "";
    camera = new Html5Qrcode("camera", { verbose: false });
    renderCamControls();
    camera.start({ facingMode: facing }, { fps: 10, qrbox: { width: 220, height: 220 } }, (text) => {
      const now = Date.now();
      if (text === lastScan.code && now - lastScan.t < 5000) return;   // ignore the same card held in view
      lastScan = { code: text, t: now };
      lookup(text);
    }).catch(() => {
      camera = null; renderCamControls();
      box.innerHTML = `<span>The camera didn't start. Allow camera access for this site in the browser settings, or use a scanner or the code box.</span>`;
    });
  }

  async function stopCamera() {
    const c = camera; camera = null;
    if (c) { try { await c.stop(); c.clear(); } catch (e) { /* already stopped */ } }
    const box = $("camera"); if (box) box.innerHTML = `<span>${CAMERA_HINT}</span>`;
    renderCamControls();
  }

  /* ---------- Start ---------- */
  setInterval(() => { if (barista && !document.hidden) refreshLog(); }, 60000);
  let signedIn = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (session && !signedIn) { signedIn = true; setTimeout(afterSignIn, 0); }
    if (!session) { signedIn = false; shop = null; barista = null; customer = null; renderLogin(); }
  });
})();
