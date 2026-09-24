/* Aroma Class - site behaviour (no dependencies) */
(function () {
  "use strict";
  var d = document;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Header: solid once the page is scrolled (sentinel + IntersectionObserver, no scroll listener) */
  var header = d.querySelector(".site-header");
  var sentinel = d.querySelector("[data-scroll-sentinel]");
  if (header && sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      header.classList.toggle("scrolled", !entries[0].isIntersecting);
    }, { rootMargin: "-1px 0px 0px 0px" }).observe(sentinel);
  }

  /* Mobile menu */
  var toggle = d.querySelector(".nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var open = d.documentElement.classList.toggle("menu-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    d.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && d.documentElement.classList.contains("menu-open")) toggle.click();
    });
  }

  /* Reveal on scroll */
  var reveals = d.querySelectorAll(".reveal");
  if (reveals.length && !reduce && "IntersectionObserver" in window) {
    reveals.forEach(function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("in");
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* Opening hours: live status in Europe/London
     0 = Sunday. Times are decimal hours. Sunday closed. */
  /* MUST match CONFIG.hours in integrations/google-calendar/Code.gs */
  var HOURS = { 1: [7.5, 19], 2: [7.5, 19], 3: [7.5, 19], 4: [7.5, 19], 5: [7.5, 19], 6: [7.5, 19], 0: null };
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function londonNow() {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", weekday: "short", hour: "numeric", minute: "numeric", hour12: false
    }).formatToParts(new Date());
    var get = function (t) { var p = parts.find(function (x) { return x.type === t; }); return p ? p.value : ""; };
    var wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    var h = parseInt(get("hour"), 10) % 24, m = parseInt(get("minute"), 10);
    return { day: wd, t: h + m / 60 };
  }
  function fmt(t) {
    var h = Math.floor(t), m = Math.round((t - h) * 60);
    var suffix = h >= 12 ? "pm" : "am";
    var hh = h % 12 === 0 ? 12 : h % 12;
    return hh + (m ? ":" + (m < 10 ? "0" + m : m) : "") + suffix;
  }
  function status() {
    var now = londonNow(), today = HOURS[now.day];
    if (today && now.t >= today[0] && now.t < today[1]) {
      return { open: true, text: "Open now, closes " + fmt(today[1]) };
    }
    if (today && now.t < today[0]) {
      return { open: false, text: "Closed, opens " + fmt(today[0]) + " today" };
    }
    for (var i = 1; i <= 7; i++) {
      var dIdx = (now.day + i) % 7, hrs = HOURS[dIdx];
      if (hrs) {
        var when = i === 1 ? "tomorrow" : DAYS[dIdx];
        return { open: false, text: "Closed, opens " + fmt(hrs[0]) + " " + when };
      }
    }
    return { open: false, text: "Closed" };
  }
  var pills = d.querySelectorAll("[data-open-status]");
  if (pills.length) {
    var s = status();
    pills.forEach(function (p) {
      p.classList.add(s.open ? "open" : "closed");
      var t = p.querySelector("[data-open-text]");
      if (t) t.textContent = s.text;
    });
    var day = londonNow().day;
    d.querySelectorAll("[data-days]").forEach(function (row) {
      var days = row.getAttribute("data-days").split(",").map(Number);
      if (days.indexOf(day) !== -1) row.classList.add("today");
    });
  }

  /* Newsletter: hands off to the visitor's email app (no backend needed) */
  var form = d.querySelector("[data-newsletter]");
  if (form) {
    var input = form.querySelector("input[type=email]");
    var msg = form.querySelector(".form-msg");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        msg.textContent = "Please enter a valid email address.";
        msg.classList.add("error"); input.focus(); return;
      }
      msg.classList.remove("error");
      sendForm("Newsletter sign up", { email: v }, function (viaMail) {
        msg.textContent = viaMail ? "Opening your email app so you can send us the sign-up." : "You are on the list. First email when the specials change.";
        if (!viaMail) input.value = "";
      }, function () { msg.classList.add("error"); msg.textContent = "That did not send. Email info@aromaclassitalian.com and we will add you."; });
    });
  }

  /* Menu sub-nav: highlight the section in view */
  var sub = d.querySelector(".subnav");
  if (sub && "IntersectionObserver" in window) {
    var links = sub.querySelectorAll("a[href^='#']");
    var setActive = function (id) {
      links.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + id); });
    };
    var secIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
    }, { rootMargin: "-35% 0px -55% 0px" });
    links.forEach(function (a) {
      var sec = d.getElementById(a.getAttribute("href").slice(1));
      if (sec) secIO.observe(sec);
    });
  }

  /* Forms: send through Web3Forms when <body data-form-key> is set, otherwise hand off to the email app */
  var FORM_KEY = (d.body.getAttribute("data-form-key") || "").trim();
  function sendForm(subject, fields, onDone, onFail) {
    var body = Object.keys(fields).map(function (k) { return k + ": " + fields[k]; }).join("\n");
    if (!FORM_KEY) {
      window.location.href = "mailto:info@aromaclassitalian.com?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      onDone(true); return;
    }
    var payload = Object.assign({ access_key: FORM_KEY, subject: subject, from_name: "Aroma Class website" }, fields);
    fetch("https://api.web3forms.com/submit", {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (j) { j.success ? onDone(false) : onFail(); }).catch(onFail);
  }

  /* Booking request */
  var bf = d.querySelector("[data-booking]");
  if (bf) {
    var dateEl = bf.querySelector("[name=date]"), timeEl = bf.querySelector("[name=time]");
    var bmsg = bf.querySelector(".form-msg"), bbtn = bf.querySelector("button[type=submit]");
    var LAST_BEFORE_CLOSE = 0.5, NOTICE_MIN = 30, DAYS_AHEAD = 90, BOOK_FROM = 12;
    var CLOSED_DATES = ["2026-12-25", "2026-12-26", "2027-01-01"];
    /* Today's date in London, whatever the visitor's own time zone */
    var todayLondon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    var maxD = new Date(todayLondon + "T12:00:00"); maxD.setDate(maxD.getDate() + DAYS_AHEAD);
    dateEl.min = todayLondon;
    dateEl.max = maxD.toISOString().slice(0, 10);
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    function fillTimes() {
      var dt = dateEl.value ? new Date(dateEl.value + "T12:00:00") : null;
      var hrs = dt && !isNaN(dt) ? HOURS[dt.getDay()] : undefined;
      if (dt && CLOSED_DATES.indexOf(dateEl.value) !== -1) hrs = null;
      if (dt && (dateEl.value < dateEl.min || dateEl.value > dateEl.max)) { timeEl.innerHTML = ""; timeEl.disabled = true; timeEl.add(new Option("Pick a date in the next 90 days", "")); return; }
      var earliest = -1;
      if (dateEl.value === todayLondon) { var n = londonNow(); earliest = n.t + NOTICE_MIN / 60; }
      timeEl.innerHTML = "";
      if (!dt || isNaN(dt)) { timeEl.disabled = true; timeEl.add(new Option("Pick a date first", "")); return; }
      if (!hrs) { timeEl.disabled = true; timeEl.add(new Option(dt.getDay() === 0 ? "We are closed on Sundays" : "We are closed that day", "")); return; }
      var count = 0;
      timeEl.add(new Option("Choose", ""));
      for (var t = Math.max(hrs[0], BOOK_FROM); t <= hrs[1] - LAST_BEFORE_CLOSE + 1e-9; t += 0.25) {
        if (t < earliest) continue;
        count++;
        var h = Math.floor(t), m = Math.round((t - h) * 60);
        timeEl.add(new Option(((h % 12) || 12) + ":" + pad(m) + (h >= 12 ? "pm" : "am"), pad(h) + ":" + pad(m)));
      }
      timeEl.disabled = count === 0;
      if (count === 0) { timeEl.innerHTML = ""; timeEl.add(new Option("No times left today", "")); }
    }
    dateEl.addEventListener("change", fillTimes); fillTimes();

    /* Cloudflare Turnstile: only loads when a site key is set on <body data-turnstile-sitekey> */
    var SITEKEY = (d.body.getAttribute("data-turnstile-sitekey") || "").trim();
    var capBox = bf.querySelector("[data-captcha]"), capId = null;
    if (SITEKEY && capBox) {
      window.onTurnstileReady = function () {
        capId = window.turnstile.render(capBox, { sitekey: SITEKEY, theme: "dark", appearance: "interaction-only" });
      };
      var sc = d.createElement("script");
      sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady&render=explicit";
      sc.async = true; sc.defer = true; d.head.appendChild(sc);
    }
    var capToken = function () { return (SITEKEY && window.turnstile && capId !== null) ? (window.turnstile.getResponse(capId) || "") : ""; };
    var capReset = function () { if (SITEKEY && window.turnstile && capId !== null) window.turnstile.reset(capId); };
    bf.addEventListener("submit", function (e) {
      e.preventDefault();
      if (bf.querySelector(".hp").value) return;
      var bad = [];
      bf.querySelectorAll("[required]").forEach(function (el) {
        var ok = el.value.trim() !== "" && !(el.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()));
        el.classList.toggle("invalid", !ok); if (!ok) bad.push(el);
      });
      if (bad.length) { bmsg.classList.add("error"); bmsg.textContent = "Please fill in the highlighted fields."; bad[0].focus(); return; }
      var f = {};
      ["name", "guests", "date", "time", "email", "phone", "notes"].forEach(function (k) { f[k] = bf.querySelector("[name=" + k + "]").value.trim(); });
      f.website = bf.querySelector("[name=website]").value;
      f.turnstile = capToken();
      if (SITEKEY && !f.turnstile) { bmsg.classList.add("error"); bmsg.textContent = "One moment, checking you are not a robot. Try again in a few seconds."; return; }
      bmsg.classList.remove("error"); bmsg.textContent = "Sending your request."; bbtn.disabled = true;
      var ENDPOINT = (d.body.getAttribute("data-booking-endpoint") || "").trim();
      var onSent = function (viaMail) {
        bbtn.disabled = false;
        if (viaMail) { bmsg.textContent = "Opening your email app with the request filled in. Press send and we will confirm."; return; }
        bf.hidden = true; var done = d.querySelector(".booking-done"); done.hidden = false; done.classList.add("in"); done.scrollIntoView({ block: "center" });
      };
      var onFail = function () {
        bbtn.disabled = false; bmsg.classList.add("error");
        bmsg.textContent = "That did not send. Please email info@aromaclassitalian.com with your details.";
      };
      if (ENDPOINT) {
        /* Google Apps Script: plain-text body avoids a CORS preflight it cannot answer */
        fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(f) })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.success) { onSent(false); return; }
            if (j.full) { bbtn.disabled = false; bmsg.classList.add("error"); bmsg.textContent = "That time is full. Please pick another time."; timeEl.focus(); return; }
            capReset();
            if (j.error && j.error !== "Something went wrong") { bbtn.disabled = false; bmsg.classList.add("error"); bmsg.textContent = j.error; return; }
            onFail();
          }).catch(onFail);
        return;
      }
      sendForm("Booking request: " + f.name + ", " + f.guests + " on " + f.date + " at " + f.time, f, onSent, onFail);
    });
  }
})();
