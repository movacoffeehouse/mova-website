// MOVA Coffee homepage: live open/closed status, "right now" card and "you are here" on the day route.
// Times are worked out in UK time, so they're right wherever the visitor's phone is set.
(function () {
  const OPEN = 8 * 60, CLOSE = 16 * 60;   // 8:00–16:00, Monday to Saturday
  const MOMENTS = [
    { key: "commute",   from: 480, to: 570, title: "Morning commute",      time: "08:00–09:30", text: "A flat white to go and a croissant for the walk. We're quick at the counter." },
    { key: "mid",       from: 570, to: 690, title: "Mid-morning break",    time: "09:30–11:30", text: "School run done. Sit down with a cappuccino and an almond croissant." },
    { key: "lunch",     from: 690, to: 810, title: "Lunch break",          time: "11:30–13:30", text: "Sandwiches made this morning. Ask for yours hot-pressed." },
    { key: "afternoon", from: 810, to: 960, title: "Afternoon pick-me-up", time: "13:30–16:00", text: "Second coffee of the day? A mocha and a brown butter choc chip cookie will do it." },
  ];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function londonNow() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day, mins: Number(get("hour")) * 60 + Number(get("minute")) };
  }
  const isOpenDay = (d) => d >= 1 && d <= 6;
  const fmt = (m) => { const h = Math.floor(m / 60), mm = m % 60; return (h > 12 ? h - 12 : h) + (mm ? ":" + String(mm).padStart(2, "0") : "") + (h >= 12 ? "pm" : "am"); };

  function nextOpening(day, mins) {
    if (isOpenDay(day) && mins < OPEN) return "today at " + fmt(OPEN);
    let d = (day + 1) % 7, n = 1;
    while (!isOpenDay(d)) { d = (d + 1) % 7; n++; }
    return (n === 1 ? "tomorrow" : DAYS[d]) + " at " + fmt(OPEN);
  }

  function update() {
    const { day, mins } = londonNow();
    const open = isOpenDay(day) && mins >= OPEN && mins < CLOSE;

    // Status bar
    const live = document.getElementById("live"), liveText = document.getElementById("live-text");
    live.classList.toggle("closed", !open);
    liveText.textContent = open
      ? `Open now · until ${fmt(CLOSE)}`
      : `Closed now · opening ${nextOpening(day, mins)}`;

    // Hours: highlight today
    document.querySelectorAll("#hours [data-days]").forEach((row) => row.classList.toggle("today", row.dataset.days.split(",").includes(String(day))));

    // "Right now" card and the day route
    const current = open ? MOMENTS.find((m) => mins >= m.from && mins < m.to) : null;
    const shown = current || MOMENTS[0];
    document.getElementById("now-label").textContent = current ? "Right now at MOVA" : "First thing " + nextOpening(day, mins).replace(/ at .*/, "");
    document.getElementById("now-title").textContent = shown.title;
    document.getElementById("now-time").textContent = shown.time;
    document.getElementById("now-text").textContent = shown.text;

    const stops = document.querySelectorAll("#route .stop");
    const idx = current ? MOMENTS.indexOf(current) : -1;
    stops.forEach((s, i) => {
      s.classList.toggle("past", idx > -1 && i < idx);
      s.classList.toggle("here", i === idx);
      let tag = s.querySelector(".here-tag");
      if (i === idx && !tag) { tag = document.createElement("span"); tag.className = "here-tag"; tag.textContent = "You are here"; s.appendChild(tag); }
      if (i !== idx && tag) tag.remove();
    });
    // Fill the line up to the current stop (desktop line runs across the four columns).
    const route = document.getElementById("route");
    route.style.setProperty("--progress", idx > 0 ? stops[idx].offsetLeft + 12 + "px" : "0px");
  }

  // Hide the small header logo while the big one is on screen, so the logo never shows twice.
  const big = document.querySelector(".hero-logo"), hdr = document.querySelector(".hdr");
  if (big && hdr && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => hdr.classList.toggle("logo-hidden", e.isIntersecting), { rootMargin: "-120px 0px 0px 0px" }).observe(big);
  }

  update();
  setInterval(update, 60000);
  window.addEventListener("resize", update);
})();
