// Runs Code.gs against mocked Apps Script services. Usage: node integrations/google-calendar/test/code.test.js
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");

function makeEnv() {
  const events = [], mails = [], fetches = [], props = {}, cache = {};
  const fmt = (d, tz, p) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
    if (p === "u") return String(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(parts.weekday) + 1);
    if (p === "yyyyMMdd") return parts.year + parts.month + parts.day;
    if (p === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
    if (p === "yyyy-MM-dd HH:mm") return `${parts.year}-${parts.month}-${parts.day} ${parts.hour.padStart(2,"0").replace("24","00")}:${parts.minute}`;
    return d.toISOString();
  };
  const cal = {
    getName: () => "Aroma Class bookings",
    getEvents: (s, e) => events.filter(ev => ev.start < e && ev.end > s).map(ev => ({ getTitle: () => ev.title })),
    createEvent: (title, start, end, o) => { events.push({ title, start, end, desc: o.description }); return { getId: () => "id" + events.length }; }
  };
  const env = {
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    CalendarApp: { getCalendarsByName: () => [cal] },
    MailApp: { sendEmail: m => mails.push(m) },
    UrlFetchApp: { fetch: (u, o) => { fetches.push(u); const v = env.__verify || { success: true, hostname: "kyan233.github.io" }; return { getContentText: () => JSON.stringify(typeof v === "function" ? v(o) : v) }; } },
    Utilities: { formatDate: fmt, parseDate: (str, tz) => {
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str); if (!m) return null;
      const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      const off = d => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).formatToParts(d).map(x=>[x.type,x.value])); return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute) - d.getTime(); };
      let t = guess - off(new Date(guess)); t = guess - off(new Date(t)); return new Date(t);
    } },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t }) },
    Session: { getActiveUser: () => ({ getEmail: () => "me@example.com" }) },
    Logger: { log() {} }, console: { error() {} }
  };
  const fn = new Function(...Object.keys(env), src + "\nreturn { doPost, doGet, validate, clean };");
  const out = { api: null, events, mails, fetches, props, setVerify: v => { env.__verify = v; } };
  out.api = fn(...Object.values(env)); return out;
}

// next weekday (Mon-Fri) at least 2 days ahead, as yyyy-mm-dd in London
function nextWeekday() {
  const d = new Date(Date.now() + 2 * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function nextSunday() { const d = new Date(Date.now() + 2 * 86400000); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
const good = (o = {}) => Object.assign({ name: "Sarah Hughes", email: "sarah@example.com", phone: "07700 900123", guests: "4", date: nextWeekday(), time: "13:00", notes: "birthday" }, o);
const post = (env, body) => JSON.parse(env.api.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).getContent());

let passed = 0; const t = (name, f) => { f(); passed++; console.log("ok  " + name); };

t("valid booking creates event and two emails", () => {
  const e = makeEnv(); const r = post(e, good());
  assert.strictEqual(r.success, true); assert.strictEqual(e.events.length, 1); assert.strictEqual(e.mails.length, 2);
  assert.ok(e.events[0].title.startsWith("Booking: Sarah Hughes x4"));
});
t("honeypot filled: pretends success, does nothing", () => {
  const e = makeEnv(); const r = post(e, good({ website: "spam" }));
  assert.strictEqual(r.success, true); assert.strictEqual(e.events.length, 0); assert.strictEqual(e.mails.length, 0);
});
t("garbage body rejected, no internals leaked", () => {
  const e = makeEnv(); const r = post(e, "{not json");
  assert.strictEqual(r.success, false); assert.strictEqual(r.error, "Invalid request");
});
t("oversized body rejected", () => { const e = makeEnv(); assert.strictEqual(post(e, good({ notes: "x".repeat(6000) })).success, false); });
t("links and html stripped from name and notes", () => {
  const e = makeEnv(); post(e, good({ name: "Bob <b>visit</b> https://evil.example/x", notes: "go to www.evil.example now" }));
  const all = JSON.stringify(e.events) + JSON.stringify(e.mails);
  assert.ok(!/evil|<b>/.test(all), all);
});
t("customer email has no notes text", () => {
  const e = makeEnv(); post(e, good({ notes: "SECRETNOTE" }));
  const cust = e.mails.find(m => m.to === "sarah@example.com"); assert.ok(!cust.body.includes("SECRETNOTE"));
});
t("newline in name cannot inject into subject", () => {
  const e = makeEnv(); post(e, good({ name: "Sam\r\nBcc: x@evil.example" }));
  assert.ok(!/[\r\n]/.test(e.mails[0].subject));
});
t("bad email, phone, guests rejected", () => {
  const e = makeEnv();
  assert.strictEqual(post(e, good({ email: "nope" })).success, false);
  assert.strictEqual(post(e, good({ phone: "123" })).success, false);
  assert.strictEqual(post(e, good({ guests: "50" })).success, false);
  assert.strictEqual(post(e, good({ guests: "9+" })).success, false);
  assert.strictEqual(e.events.length, 0);
});
t("Sunday, out of hours, past and far future rejected", () => {
  const e = makeEnv();
  assert.strictEqual(post(e, good({ date: nextSunday() })).success, false);
  assert.strictEqual(post(e, good({ time: "03:00" })).success, false);
  assert.strictEqual(post(e, good({ time: "18:45" })).success, false);
  assert.strictEqual(post(e, good({ time: "09:00" })).success, false);
  assert.strictEqual(post(e, good({ date: "2020-01-01" })).success, false);
  assert.strictEqual(post(e, good({ date: "2030-01-01" })).success, false);
  assert.strictEqual(e.events.length, 0);
});
t("slot fills at 6 tables", () => {
  const e = makeEnv();
  for (let i = 0; i < 6; i++) assert.strictEqual(post(e, good({ email: `a${i}@example.com`, phone: `0770090010${i}` })).success, true);
  const r = post(e, good({ email: "z@example.com", phone: "07700900199" }));
  assert.strictEqual(r.full, true); assert.strictEqual(e.events.length, 6);
});
t("same contact capped at 3 per day", () => {
  const e = makeEnv(); const times = ["12:00", "14:00", "16:00", "17:30"];
  const rs = times.map(time => post(e, good({ time })));
  assert.deepStrictEqual(rs.map(r => r.success), [true, true, true, false]);
});
t("daily total cap protects email quota", () => {
  const e = makeEnv(); const day = Object.keys(e.props); // pre-fill counter
  const k = "n_" + new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()).replace(/-/g, "");
  e.props[k] = "60";
  assert.strictEqual(post(e, good()).success, false); assert.strictEqual(e.mails.length, 0);
});
t("WhatsApp only fires when both secrets are set in Script Properties", () => {
  const e = makeEnv(); post(e, good()); assert.strictEqual(e.fetches.length, 0);
  const e2 = makeEnv(); e2.props.WHATSAPP_PHONE = "+447700900123"; e2.props.WHATSAPP_APIKEY = "123456";
  post(e2, good()); assert.strictEqual(e2.fetches.length, 1); assert.ok(e2.fetches[0].includes("Sarah%20Hughes"));
});

// ---------- opening-hours boundary suite ----------
const HOURS = { 0: null, 1: [7.5, 19], 2: [7.5, 19], 3: [7.5, 19], 4: [7.5, 19], 5: [7.5, 19], 6: [7.5, 19] }; const BOOK_FROM = 12;
const londonParts = d => Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hourCycle:"h23",hour:"2-digit",minute:"2-digit"}).formatToParts(d).map(x=>[x.type,x.value]));
function daysFrom(n, count) { const out = []; for (let i = n; i < n + count; i++) { const d = new Date(Date.now() + i * 86400000); out.push(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London"}).format(d)); } return out; }

t("every 15-min slot on 7 consecutive days: accepted only inside hours, event never past closing", () => {
  let accepted = 0, rejected = 0;
  for (const date of daysFrom(3, 7)) {
    const dow = new Date(date + "T12:00:00Z").getUTCDay(), hrs = HOURS[dow];
    for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) {
      const time = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"), tt = h + m / 60;
      const shouldAccept = !!hrs && tt >= Math.max(hrs[0], BOOK_FROM) && tt <= hrs[1] - 0.5;
      const e = makeEnv(); const r = post(e, good({ date, time }));
      assert.strictEqual(r.success, shouldAccept, `${date} (dow ${dow}) ${time}: expected ${shouldAccept}, got ${JSON.stringify(r)}`);
      if (r.success) {
        accepted++;
        const ev = e.events[0], s = londonParts(ev.start), en = londonParts(ev.end);
        const startH = +s.hour + +s.minute / 60, endH = +en.hour + +en.minute / 60;
        assert.ok(Math.abs(startH - tt) < 1e-9, "start stored in London time: " + date + " " + time + " -> " + s.hour + ":" + s.minute);
        assert.ok(endH <= hrs[1] + 1e-9, `event runs past close: ${date} ${time} ends ${en.hour}:${en.minute}`);
        assert.ok(endH > startH, "end after start");
      } else rejected++;
    }
  }
  console.log(`    (${accepted} accepted, ${rejected} rejected across 672 slots)`);
});
t("off-grid, impossible and malformed times rejected", () => {
  const date = daysFrom(3, 7).find(d => new Date(d + "T12:00:00Z").getUTCDay() === 2);
  for (const time of ["13:07", "13:10", "25:00", "12:60", "9:00", "13:00:00", ""]) {
    assert.strictEqual(post(makeEnv(), good({ date, time })).success, false, time);
  }
  for (const d of ["2026-02-31", "2026-13-01", "26-09-29", "tomorrow"]) assert.strictEqual(post(makeEnv(), good({ date: d })).success, false, d);
});
t("closed dates (Christmas) rejected even inside normal hours", () => {
  const r = post(makeEnv(), good({ date: "2026-12-25", time: "12:00" })); assert.strictEqual(r.success, false);
});
t("clocks-change week (26 Oct 2026) stays in London hours", () => {
  const e = makeEnv(); const r = post(e, good({ date: "2026-10-26", time: "12:00" })); assert.strictEqual(r.success, true, JSON.stringify(r));
  const p = londonParts(e.events[0].start); assert.strictEqual(p.hour + ":" + p.minute, "12:00");
  assert.strictEqual(post(makeEnv(), good({ date: "2026-10-26", time: "11:45" })).success, false);
});
t("booking under 30 minutes from now rejected", () => {
  const now = new Date(Date.now() + 10 * 60000);
  const date = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London"}).format(now), p = londonParts(now);
  const time = p.hour + ":" + String(Math.floor(+p.minute / 15) * 15).padStart(2, "0");
  assert.strictEqual(post(makeEnv(), good({ date, time })).success, false);
});
// ---------- Turnstile ----------
t("no Turnstile secret set: bookings work without a token (safe rollout)", () => {
  const e = makeEnv(); assert.strictEqual(post(e, good()).success, true);
});
t("secret set, no token: rejected, nothing booked", () => {
  const e = makeEnv(); e.props.TURNSTILE_SECRET = "s"; const r = post(e, good());
  assert.strictEqual(r.success, false); assert.strictEqual(e.events.length, 0); assert.strictEqual(e.mails.length, 0);
});
t("secret set, token Cloudflare rejects: rejected", () => {
  const e = makeEnv(); e.props.TURNSTILE_SECRET = "s"; e.setVerify({ success: false });
  assert.strictEqual(post(e, good({ turnstile: "bad" })).success, false); assert.strictEqual(e.events.length, 0);
});
t("secret set, valid token from another website: rejected", () => {
  const e = makeEnv(); e.props.TURNSTILE_SECRET = "s"; e.setVerify({ success: true, hostname: "evil.example" });
  assert.strictEqual(post(e, good({ turnstile: "tok" })).success, false);
});
t("secret set, valid token from our site: booked, secret sent to Cloudflare not the browser", () => {
  const e = makeEnv(); e.props.TURNSTILE_SECRET = "s3cr3t"; let seen = null; e.setVerify(o => { seen = o.payload; return { success: true, hostname: "kyan233.github.io" }; });
  const r = post(e, good({ turnstile: "tok" }));
  assert.strictEqual(r.success, true); assert.strictEqual(seen.secret, "s3cr3t"); assert.strictEqual(seen.response, "tok");
  assert.ok(!JSON.stringify(r).includes("s3cr3t"));
});
t("Cloudflare unreachable: fails closed", () => {
  const e = makeEnv(); e.props.TURNSTILE_SECRET = "s"; e.setVerify(() => { throw new Error("down"); });
  assert.strictEqual(post(e, good({ turnstile: "tok" })).success, false);
});
// ---------- booking reference ----------
t("same reference sent twice books once, second reply still says success", () => {
  const e = makeEnv(); const ref = "a1b2c3d4e5f6a7b8c9d0e1f2";
  const r1 = post(e, good({ ref })), r2 = post(e, good({ ref }));
  assert.strictEqual(r1.success, true); assert.strictEqual(r2.success, true);
  assert.strictEqual(e.events.length, 1); assert.strictEqual(e.mails.length, 2);
});
t("GET ?ref reports whether a booking went through", () => {
  const e = makeEnv(); const ref = "ffeeddccbbaa99887766554433";
  const q = r => JSON.parse(e.api.doGet({ parameter: { ref: r } }).getContent());
  assert.strictEqual(q(ref).found, false); post(e, good({ ref })); assert.strictEqual(q(ref).found, true);
  assert.strictEqual(q("not a ref!").found, undefined);
});
t("rejected booking does not mark its reference as booked", () => {
  const e = makeEnv(); const ref = "0011223344556677889900aa";
  post(e, good({ ref, time: "09:00" }));
  assert.strictEqual(JSON.parse(e.api.doGet({ parameter: { ref } }).getContent()).found, false);
});
console.log(`\n${passed} passed`);
