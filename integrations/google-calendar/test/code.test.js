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
    UrlFetchApp: { fetch: u => fetches.push(u) },
    Utilities: { formatDate: fmt },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: t => ({ setMimeType() { return this; }, getContent: () => t }) },
    Session: { getActiveUser: () => ({ getEmail: () => "me@example.com" }) },
    Logger: { log() {} }, console: { error() {} }
  };
  const fn = new Function(...Object.keys(env), src + "\nreturn { doPost, validate, clean };");
  return { api: fn(...Object.values(env)), events, mails, fetches, props };
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
  assert.strictEqual(post(e, good({ time: "17:30" })).success, false);
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
  const e = makeEnv(); const times = ["09:00", "11:00", "13:00", "15:00"];
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
console.log(`\n${passed} passed`);
