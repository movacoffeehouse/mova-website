// Shared helpers for the MOVA Miles pages (customer card, till and owner admin).
(function () {
  const cfg = window.MOVA_CONFIG || {};

  const MOMENTS = {
    commute:   { name: "Morning commute",      short: "Commute",     range: "8:00–9:30",  persona: "Early Mover",       line: "on the morning commute" },
    mid:       { name: "Mid-morning break",    short: "Mid-morning", range: "9:30–11:30", persona: "Mid-Morning Mover", line: "on a mid-morning break" },
    lunch:     { name: "Lunch break",          short: "Lunch",       range: "11:30–1:30", persona: "Lunchtime Mover",   line: "on a lunch break" },
    afternoon: { name: "Afternoon pick-me-up", short: "Afternoon",   range: "1:30–4:00",  persona: "Afternoon Mover",   line: "in the afternoon" },
  };
  const ORDER = ["commute", "mid", "lunch", "afternoon"];

  const ERRORS = {
    wrong_pin: "That PIN didn't match. Try again.",
    not_found: "No member with that code. Check the six characters under their QR code.",
    no_reward: "This customer has no free coffee to use yet.",
    not_shop_account: "This login isn't set up as a shop account. Ask the owner to add it.",
    owner_only: "Only the owner login can do that.",
    too_old_to_undo: "That's more than 30 minutes old. Ask the owner to undo it from their login.",
    bad_quantity: "Choose between 1 and 6 coffees.",
    pin_must_be_4_to_6_digits: "PINs must be 4 to 6 digits.",
    pin_required: "Give the new staff member a PIN.",
    not_signed_in: "You've been signed out. Sign in again.",
    bad_discount: "Discounts must be between 0% and 100%.",
  };

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/YOUR-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey));
  }

  // Each area keeps its own login, so a till tablet and a customer's card never clash.
  const clients = {};
  function client(area) {
    if (!clients[area]) {
      clients[area] = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: area === "customer", storageKey: "mova-" + area },
      });
    }
    return clients[area];
  }

  async function rpc(area, fn, args) {
    const { data, error } = await client(area).rpc(fn, args || {});
    if (error) throw error;
    return data;
  }

  function friendly(err) {
    const msg = (err && (err.message || err.error_description)) || String(err || "");
    for (const k in ERRORS) if (msg.includes(k)) return ERRORS[k];
    if (/fetch|network/i.test(msg)) return "Can't reach the server. Check the internet connection and try again.";
    if (/rate limit/i.test(msg)) return "We've sent a lot of sign-in emails in the last hour. Please try again a bit later, or ask us at the counter.";
    if (/invalid login/i.test(msg)) return "That email and password don't match.";
    return "Something went wrong (" + msg + "). Try again.";
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MIN = 60000, DAY = 86400000;
  function ago(t) {
    const d = Date.now() - new Date(t).getTime();
    if (d < MIN) return "just now";
    if (d < 60 * MIN) return Math.round(d / MIN) + " min ago";
    if (d < DAY) return Math.round(d / (60 * MIN)) + " hr ago";
    const n = Math.round(d / DAY);
    return n === 1 ? "yesterday" : n + " days ago";
  }
  const dayName = (t) => new Date(t).toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/London" });
  const timeHM = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

  // The Mover type is the moment with the most coffees, once someone has at least 3 there.
  function persona(moments) {
    const m = moments || {};
    const total = ORDER.reduce((s, k) => s + (m[k] || 0), 0);
    const top = ORDER.reduce((a, k) => ((m[k] || 0) > (m[a] || 0) ? k : a), ORDER[0]);
    return { total, top, ready: (m[top] || 0) >= 3 };
  }

  function drawQR(box, text, size) {
    if (!box) return;
    box.innerHTML = "";
    if (typeof QRCode === "undefined") { box.innerHTML = '<span class="code">' + esc(text.replace(/^MOVA:/, "")) + "</span>"; return; }
    new QRCode(box, { text, width: size, height: size, colorDark: "#2A2421", colorLight: "#FAF4EC", correctLevel: QRCode.CorrectLevel.M });
  }

  window.MOVA = { cfg, MOMENTS, ORDER, configured, client, rpc, friendly, esc, ago, dayName, timeHM, persona, drawQR };
})();
