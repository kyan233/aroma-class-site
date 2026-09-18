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
  var HOURS = { 1: [7.5, 18], 2: [7.5, 18], 3: [7.5, 18], 4: [7.5, 18], 5: [7.5, 18], 6: [7.5, 17], 0: null };
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
      msg.textContent = "Opening your email app so you can send us the sign-up.";
      var body = "Please add " + v + " to the Aroma Class newsletter.";
      window.location.href = "mailto:info@aromaclassitalian.com?subject=" +
        encodeURIComponent("Newsletter sign up") + "&body=" + encodeURIComponent(body);
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
})();
