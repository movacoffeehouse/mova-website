// MOVA Miles · customer card page (/miles)
(function () {
  const { MOMENTS, ORDER, esc, ago, dayName, persona, drawQR, friendly, rpc, cfg } = window.MOVA;
  const app = document.getElementById("app");
  const AREA = "customer";
  let card = null;
  let view = { mode: "join", sentTo: null, error: "", busy: false, just: null, celebrate: false, confirmDelete: false };

  if (!window.MOVA.configured()) {
    app.innerHTML = `<div class="notice"><b>MOVA Miles is coming soon.</b><span>Ask at the counter and we'll tell you when it's live.</span></div>`;
    return;
  }
  const sb = window.MOVA.client(AREA);

  /* ---------- Signed out ---------- */
  function renderSignup() {
    if (view.sentTo) {
      app.innerHTML = `
        <div class="signup">
          <p class="eyebrow">Nearly there</p>
          <h1>Check your email</h1>
          <p>We've sent a sign-in link to <b>${esc(view.sentTo)}</b>. Open it on this phone to see your card. It can take a minute to arrive, so check your junk folder too.</p>
          ${view.error ? `<p class="err">${esc(view.error)}</p>` : ""}
          <div class="actions">
            <button class="btn-line" id="resend" type="button" ${view.busy ? "disabled" : ""}>Send it again</button>
            <button class="link" id="other" type="button">Use a different email</button>
          </div>
        </div>`;
      document.getElementById("resend").onclick = () => sendLink(view.lastRequest);
      document.getElementById("other").onclick = () => { view.sentTo = null; view.error = ""; renderSignup(); };
      return;
    }
    const join = view.mode === "join";
    app.innerHTML = `
      <form class="signup" id="form" novalidate>
        <p class="eyebrow">MOVA Miles</p>
        <h1>${join ? "Every coffee moves you down the line." : "Welcome back."}</h1>
        <p class="muted">${join
          ? "Three coffees, three stops. The fourth coffee is on us. We'll also work out your MOVA moment: are you an Early Mover or an Afternoon Mover?"
          : "Enter the email you joined with and we'll send you a sign-in link."}</p>
        ${join ? `<label class="field" for="name">First name<input id="name" autocomplete="given-name" maxlength="40" required></label>` : ""}
        <label class="field" for="email">Email<input id="email" type="email" autocomplete="email" inputmode="email" required></label>
        ${join ? `<label class="check" for="marketing"><input type="checkbox" id="marketing"><span>Email me about new coffees, events and offers. You can turn this off at any time.</span></label>` : ""}
        ${view.error ? `<p class="err" role="alert">${esc(view.error)}</p>` : ""}
        <button class="btn" type="submit" ${view.busy ? "disabled" : ""}>${view.busy ? "Sending…" : join ? "Join and send my link" : "Send my sign-in link"}</button>
        ${join ? `<p class="hint">By joining you agree to how we use your details in our <a href="../privacy/">privacy notice</a>.</p>` : ""}
        <button class="link" id="switch" type="button">${join ? "Already a member? Sign in" : "New here? Join MOVA Miles"}</button>
      </form>`;
    document.getElementById("switch").onclick = () => { view.mode = join ? "signin" : "join"; view.error = ""; renderSignup(); };
    document.getElementById("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim().toLowerCase();
      const name = join ? document.getElementById("name").value.trim() : "";
      if (join && !name) { view.error = "Add your first name so the team can greet you."; return renderSignup(); }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { view.error = "That email doesn't look right. Check it and try again."; return renderSignup(); }
      sendLink({ email, name, join, marketing: join && document.getElementById("marketing").checked });
    });
  }

  async function sendLink(req) {
    view.busy = true; view.error = ""; view.lastRequest = req;
    renderSignup();
    const options = { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: req.join };
    if (req.join) options.data = { first_name: req.name, marketing_opt_in: !!req.marketing };
    const { error } = await sb.auth.signInWithOtp({ email: req.email, options });
    view.busy = false;
    if (error) {
      view.error = /signups not allowed|not found/i.test(error.message)
        ? "We couldn't find a member with that email. Join MOVA Miles instead."
        : friendly(error);
    } else {
      view.sentTo = req.email;
    }
    renderSignup();
  }

  /* ---------- Signed in ---------- */
  function renderCard() {
    const c = card, size = c.card_size, p = c.progress, left = size - p;
    const stops = Array.from({ length: size }, (_, i) => {
      const s = c.stops[i], done = !!s, next = i === p;
      const just = view.just && i >= view.just.from && i < view.just.to;
      const name = done ? MOMENTS[s.moment].name : next ? "Your next coffee" : "Stop " + (i + 1);
      return `<li class="stop${done ? " done" : ""}${next ? " next" : ""}${i < p - 1 ? " seg" : ""}${just ? " just" : ""}"><span class="dot"></span><span class="name">${name}</span><span class="n">${done ? dayName(s.at) : i + 1}</span></li>`;
    }).join("");

    const headline = c.rewards_available
      ? `You've got ${c.rewards_available === 1 ? "a free coffee" : c.rewards_available + " free coffees"} waiting.`
      : left === 1 ? "One more coffee to your free one." : `${left} more coffees to your free one.`;

    const pe = persona(c.moments);
    const max = Math.max(1, ...ORDER.map((k) => c.moments[k]));
    const bars = ORDER.map((k) => `<li class="${pe.ready && k === pe.top ? "top" : ""}"><span>${MOMENTS[k].short}</span><span class="track"><span class="fill" style="width:${(c.moments[k] / max) * 100}%"></span></span><b>${c.moments[k]}</b></li>`).join("");

    const history = c.history.map((h) => `<li><span>${h.type === "stamp" ? (h.qty > 1 ? h.qty + " coffees" : "Coffee") + " · " + MOMENTS[h.moment].short : "Free coffee used"}</span><time datetime="${h.at}">${ago(h.at)}</time></li>`).join("")
      || `<li><span>No coffees yet. Your first one starts the journey.</span></li>`;

    app.innerHTML = `
      <div class="status"><p class="eyebrow">Hi ${esc(c.first_name)}</p><h1>${headline}</h1><p>${p === 0 ? "You're at the start of the line." : `${p} of ${size} stops done.`}</p></div>
      ${c.rewards_available ? `<div class="ticket${view.celebrate ? " celebrate" : ""}"><strong>${view.celebrate ? "End of the line. Free coffee unlocked." : "Free coffee ready"}</strong><span>Show your card at the till to use it. Any coffee, any size.</span></div>` : ""}
      <ol class="route" aria-label="Your card: ${p} of ${size} stops">${stops}<li class="stop end${c.rewards_available ? " ready" : ""}"><span class="dot"></span><span class="name">Free coffee</span></li></ol>
      <section class="card" aria-label="Your member card">
        <div class="card-row">
          <div class="qr" id="qr" role="img" aria-label="Your member QR code"></div>
          <div class="card-text"><span class="label">Member code</span><span class="code">${esc(c.code)}</span><p>Show this at the till each time you buy a coffee.</p></div>
        </div>
        ${cfg.walletEnabled ? `<div id="wallet-slot"></div>` : `<p class="hint">Tip: add this page to your home screen so your card is one tap away. Wallet cards are coming soon.</p>`}
      </section>
      <section class="persona" aria-label="Your MOVA moment">
        <p class="eyebrow">Your MOVA moment</p>
        <h2>${pe.ready ? MOMENTS[pe.top].persona : "New Mover"}</h2>
        <p>${pe.ready ? `${c.moments[pe.top]} of your ${pe.total} coffees were ${MOMENTS[pe.top].line}.` : "Have a few more coffees and we'll work out your favourite time of day."}</p>
        <ul class="bars">${bars}</ul>
      </section>
      <section class="activity"><h2 class="list-h">Recent</h2><ul>${history}</ul></section>
      <details class="settings" ${view.confirmDelete ? "open" : ""}>
        <summary>Your details and sign-out</summary>
        <div class="inner">
          <label class="check" for="mk"><input type="checkbox" id="mk" ${c.marketing_opt_in ? "checked" : ""}><span>Email me about new coffees, events and offers.</span></label>
          <div class="actions"><button class="btn-line btn-small" id="signout" type="button">Sign out</button><a class="link" href="../privacy/">Privacy notice</a></div>
          ${view.confirmDelete
            ? `<div class="warnbox" role="alert"><span><b>Delete your MOVA Miles account?</b> Your card, stamps and any free coffees will be gone for good.</span><div class="actions"><button class="btn btn-small" id="del-yes" type="button">Delete my account</button><button class="btn-line btn-small" id="del-no" type="button">Keep it</button></div></div>`
            : `<button class="link danger" id="del" type="button">Delete my account</button>`}
        </div>
      </details>`;

    drawQR(document.getElementById("qr"), "MOVA:" + c.code, 140);
    document.getElementById("signout").onclick = async () => { await sb.auth.signOut(); };
    document.getElementById("mk").onchange = async (e) => {
      try { card = await rpc(AREA, "set_my_details", { p_first_name: null, p_marketing_opt_in: e.target.checked }); }
      catch (err) { e.target.checked = !e.target.checked; alertInline(friendly(err)); }
    };
    if (view.confirmDelete) {
      document.getElementById("del-yes").onclick = async () => {
        try { await rpc(AREA, "delete_my_account"); await sb.auth.signOut(); }
        catch (err) { alertInline(friendly(err)); }
      };
      document.getElementById("del-no").onclick = () => { view.confirmDelete = false; renderCard(); };
    } else {
      document.getElementById("del").onclick = () => { view.confirmDelete = true; renderCard(); };
    }
    // Wallet hook: once Passcreator is set up, wallet.js fills #wallet-slot with the Add to Wallet buttons.
    if (cfg.walletEnabled && window.MOVA_WALLET) window.MOVA_WALLET.render(document.getElementById("wallet-slot"), c);
  }

  function alertInline(msg) {
    const p = document.createElement("p");
    p.className = "err"; p.setAttribute("role", "alert"); p.textContent = msg;
    app.prepend(p);
  }

  /* ---------- Data ---------- */
  async function load(first) {
    try {
      const next = first ? await rpc(AREA, "ensure_customer") : await rpc(AREA, "my_card");
      if (!next) return;
      if (card && next.total_coffees > card.total_coffees) {
        const earned = next.rewards_available > card.rewards_available;
        view.just = earned ? { from: 0, to: next.progress } : { from: card.progress, to: next.progress };
        view.celebrate = earned;
        setTimeout(() => { view.just = null; view.celebrate = false; }, 1200);
      }
      const changed = !card || JSON.stringify(next) !== JSON.stringify(card);
      card = next;
      if (changed) renderCard();
    } catch (err) {
      if (!card) app.innerHTML = `<div class="notice"><b>We couldn't load your card.</b><span>${esc(friendly(err))}</span><button class="btn" type="button" onclick="location.reload()">Try again</button></div>`;
    }
  }

  let poll = null;
  function startPolling() {
    clearInterval(poll);
    poll = setInterval(() => { if (!document.hidden && card) load(false); }, 15000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && card) load(false); });

  // The auth listener fires once on page load (with or without a session) and again on
  // sign-in/sign-out, so it is the single place that decides what to show.
  let started = false;
  let linkFailed = /error_description/.test(location.hash);
  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      if (!started) { started = true; setTimeout(() => load(true), 0); startPolling(); }
      return;
    }
    started = false; card = null; clearInterval(poll);
    view = { mode: linkFailed ? "signin" : "join", sentTo: null, error: "", busy: false, confirmDelete: false };
    if (linkFailed) {
      view.error = "That sign-in link has expired or was already used. Send yourself a new one.";
      history.replaceState(null, "", location.pathname);
      linkFailed = false;
    }
    renderSignup();
  });
})();
