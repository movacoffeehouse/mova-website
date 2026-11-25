// MOVA Miles · owner admin (/admin): members, coffees by moment, and staff PINs.
(function () {
  const { MOMENTS, ORDER, esc, ago, friendly, rpc } = window.MOVA;
  const app = document.getElementById("app");
  const bar = document.getElementById("bar");
  const AREA = "admin";
  let data = null, staff = [], search = "", msg = { text: "", error: false }, editing = null;

  if (!window.MOVA.configured()) {
    app.innerHTML = `<div class="notice"><b>MOVA Miles isn't connected yet.</b><span>Add the Supabase details to assets/js/config.js (see SETUP.md).</span></div>`;
    return;
  }
  const sb = window.MOVA.client(AREA);
  const $ = (id) => document.getElementById(id);

  function renderLogin(text) {
    bar.innerHTML = `<span class="who">MOVA Miles admin</span>`;
    app.innerHTML = `
      <form class="narrow" id="login" style="padding:0" novalidate>
        <h1 style="font-family:var(--display);font-weight:500;font-size:40px">Owner sign-in</h1>
        <label class="field" for="email">Email<input id="email" type="email" autocomplete="username" required></label>
        <label class="field" for="password">Password<input id="password" type="password" autocomplete="current-password" required></label>
        ${text ? `<p class="err" role="alert">${esc(text)}</p>` : ""}
        <button class="btn" type="submit">Sign in</button>
      </form>`;
    $("login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
      if (error) renderLogin(friendly(error));
    });
  }

  async function load() {
    try {
      [data, staff] = await Promise.all([rpc(AREA, "admin_overview"), rpc(AREA, "admin_staff")]);
      render();
    } catch (err) {
      app.innerHTML = `<div class="notice"><b>${esc(friendly(err))}</b><button class="btn-line" id="out" type="button">Sign out</button></div>`;
      $("out").onclick = () => sb.auth.signOut();
    }
  }

  function render() {
    bar.innerHTML = `<a class="link" href="../staff/">Open the till</a><button class="link" id="out" type="button">Sign out</button>`;
    $("out").onclick = () => sb.auth.signOut();
    const d = data;
    const max = Math.max(1, ...ORDER.map((k) => d.moments[k]));
    const q = search.trim().toLowerCase();
    const rows = d.customers.filter((c) => !q || (c.first_name + " " + c.email + " " + c.code).toLowerCase().includes(q));

    app.innerHTML = `
      ${msg.text ? `<div class="${msg.error ? "warnbox" : "toast"}" role="status">${esc(msg.text)}</div>` : ""}
      <div class="stats">
        <div class="stat"><b>${d.members}</b><span>members (${d.members_this_week} this week)</span></div>
        <div class="stat"><b>${d.coffees_today}</b><span>stamped coffees today</span></div>
        <div class="stat"><b>${d.coffees_this_week}</b><span>stamped coffees this week</span></div>
        <div class="stat"><b>${d.free_coffees_used}</b><span>free coffees used</span></div>
        <div class="stat"><b>${d.marketing_opt_ins}</b><span>happy to get emails</span></div>
      </div>

      <section class="panel" aria-label="Coffees by moment of the day">
        <h2>Coffees by moment of the day</h2>
        <ul class="bars">${ORDER.map((k) => `<li><span>${MOMENTS[k].short}</span><span class="track"><span class="fill" style="width:${(d.moments[k] / max) * 100}%;background:var(--accent)"></span></span><b>${d.moments[k]}</b></li>`).join("")}</ul>
      </section>

      <section class="panel" aria-label="Staff">
        <h2>Staff and PINs</h2>
        <form class="row-form" id="add-staff" novalidate>
          <label class="field" for="s-name">Name<input id="s-name" maxlength="40" required></label>
          <label class="field" for="s-pin">PIN (4–6 digits)<input id="s-pin" inputmode="numeric" maxlength="6" autocomplete="off" required></label>
          <button class="btn" type="submit">Add barista</button>
        </form>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th></th></tr></thead><tbody>
          ${staff.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.active ? "Active" : "Removed"}</td><td>
            ${editing === s.id
              ? `<form class="row-form" data-pin="${s.id}" novalidate><label class="sr" for="pin-${s.id}">New PIN</label><input id="pin-${s.id}" inputmode="numeric" maxlength="6" placeholder="New PIN" style="width:120px;border:1.5px solid var(--line);border-radius:8px;padding:8px"><button class="btn btn-small" type="submit">Save PIN</button><button class="link" data-cancel type="button">Cancel</button></form>`
              : `<div class="actions"><button class="link" data-edit="${s.id}" type="button">Change PIN</button><button class="link" data-toggle="${s.id}" data-active="${s.active}" type="button">${s.active ? "Remove from till" : "Bring back"}</button></div>`}
          </td></tr>`).join("") || `<tr><td colspan="3" class="muted">No staff yet. Add your first barista above.</td></tr>`}
        </tbody></table></div>
      </section>

      <section class="panel" aria-label="Members">
        <div class="actions" style="justify-content:space-between">
          <h2>Members</h2>
          <div class="actions">
            <label class="sr" for="search">Search members</label>
            <input id="search" placeholder="Search name, email or code" value="${esc(search)}" style="border:1.5px solid var(--line);border-radius:999px;padding:8px 14px;min-width:0">
            <button class="btn-line btn-small" id="csv" type="button">Download CSV</button>
          </div>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Code</th><th>Coffees</th><th>Card</th><th>Free ready</th><th>Mover type</th><th>Last visit</th><th>Emails OK</th></tr></thead><tbody>
          ${rows.map((c) => `<tr><td>${esc(c.first_name)}</td><td>${esc(c.email)}</td><td style="font-family:var(--mono)">${esc(c.code)}</td><td class="num">${c.coffees}</td><td class="num">${c.progress}/8</td><td class="num">${c.rewards_available}</td><td>${c.top_moment ? MOMENTS[c.top_moment].persona : "–"}</td><td>${c.last_visit ? ago(c.last_visit) : "–"}</td><td>${c.marketing_opt_in ? "Yes" : "No"}</td></tr>`).join("")
            || `<tr><td colspan="9" class="muted">${q ? "No members match that search." : "No members yet."}</td></tr>`}
        </tbody></table></div>
      </section>`;

    $("search").oninput = (e) => { search = e.target.value; const pos = e.target.selectionStart; render(); const s = $("search"); s.focus(); s.setSelectionRange(pos, pos); };
    $("csv").onclick = () => downloadCSV(rows);
    $("add-staff").addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveStaff(null, $("s-name").value, $("s-pin").value, true, "Barista added. They can sign in on the till now.");
    });
    app.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { editing = b.dataset.edit; render(); $("pin-" + editing).focus(); }));
    app.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => { editing = null; render(); }));
    app.querySelectorAll("form[data-pin]").forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveStaff(f.dataset.pin, null, $("pin-" + f.dataset.pin).value, null, "PIN changed.");
    }));
    app.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = () =>
      saveStaff(b.dataset.toggle, null, null, b.dataset.active !== "true", b.dataset.active === "true" ? "Removed from the till." : "Back on the till.")));
  }

  async function saveStaff(id, name, pin, active, done) {
    if (!id && !String(name || "").trim()) { msg = { text: "Add the barista's name.", error: true }; return render(); }
    if (pin !== null && !/^[0-9]{4,6}$/.test(pin || "")) { msg = { text: "PINs must be 4 to 6 digits.", error: true }; return render(); }
    try {
      await rpc(AREA, "admin_save_staff", { p_id: id, p_name: name, p_pin: pin, p_active: active });
      msg = { text: done, error: false }; editing = null;
      staff = await rpc(AREA, "admin_staff");
    } catch (err) { msg = { text: friendly(err), error: true }; }
    render();
  }

  function downloadCSV(rows) {
    const head = ["first_name", "email", "code", "coffees", "card_progress", "free_coffees_ready", "mover_type", "last_visit", "marketing_opt_in", "joined"];
    const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [head.join(",")].concat(rows.map((c) => [c.first_name, c.email, c.code, c.coffees, c.progress, c.rewards_available,
      c.top_moment ? MOMENTS[c.top_moment].persona : "", c.last_visit || "", c.marketing_opt_in ? "yes" : "no", c.created_at].map(cell).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "mova-miles-members.csv" });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  let signedIn = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (session && !signedIn) { signedIn = true; setTimeout(load, 0); }
    if (!session) { signedIn = false; data = null; renderLogin(); }
  });
})();
