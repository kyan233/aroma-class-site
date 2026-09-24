/**
 * Aroma Class bookings -> Google Calendar (hardened, v2)
 * Receives the website booking form, validates it, checks capacity, adds a calendar event,
 * emails the restaurant and the customer, and optionally WhatsApps the owner.
 *
 * Setup:
 *  1. calendar.google.com: create a calendar called "Aroma Class bookings".
 *  2. script.google.com > project > paste this file > save.
 *  3. Project Settings: Time zone (GMT+00:00) London.
 *  4. Secrets go in Project Settings > Script Properties, NEVER in this file (it is in a public repo):
 *       WHATSAPP_PHONE   e.g. +447700900123
 *       WHATSAPP_APIKEY  the CallMeBot key
 *  5. Deploy > Manage deployments > pencil > Version: New version > Deploy (keeps the same URL).
 */
var CONFIG = {
  calendarName: "Aroma Class bookings",
  restaurantEmail: "info@aromaclassitalian.com",
  maxTablesPerSlot: 6,
  slotMinutes: 90,
  autoConfirm: true,
  timezone: "Europe/London",
  maxGuests: 8,            // bigger groups are told to email
  maxDaysAhead: 90,
  // Opening hours per weekday (0 = Sunday), in hours. MUST match HOURS in assets/js/site.js.
  hours: { 0: null, 1: [7.5, 19], 2: [7.5, 19], 3: [7.5, 19], 4: [7.5, 19], 5: [7.5, 19], 6: [7.5, 19] },
  bookFrom: 12,                  // tables bookable from 12:00, even though we open earlier
  lastBookingBeforeCloseMin: 30, // last table starts 6:30pm, 30 min before close
  slotStepMin: 15,               // bookings only on :00 :15 :30 :45
  minNoticeMin: 30,              // no bookings starting in the next 30 minutes
  // Extra closed days (bank holidays, private events), as "yyyy-MM-dd".
  closedDates: ["2026-12-25", "2026-12-26", "2027-01-01"],
  // Abuse limits
  maxPerContactPerDay: 3,  // same email or phone
  maxPerDay: 60            // all bookings; protects the Gmail send quota (~100/day)
};

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = parse(e);
    if (!p) return fail("Invalid request");
    if (String(p.website || "").length) return out({ success: true }); // honeypot: pretend, do nothing

    var b = validate(p);
    if (b.error) return fail(b.error);

    if (!lock.tryLock(10000)) return fail("Busy, please try again");

    var limit = checkLimits(b);
    if (limit) return fail(limit);

    var cal = getCalendar();
    var end = b.end; // never later than closing time
    var taken = cal.getEvents(b.start, end).filter(function (ev) {
      return ev.getTitle().indexOf("Booking:") === 0;
    }).length;
    if (taken >= CONFIG.maxTablesPerSlot) return out({ success: false, full: true, error: "That time is full" });

    var details = [
      "Guests: " + b.guests, "Phone: " + b.phone, "Email: " + b.email,
      "Notes: " + (b.notes || "none"), "Booked via the website"
    ].join("\n");
    cal.createEvent("Booking: " + b.name + " x" + b.guests, b.start, end, { description: details });
    recordLimits(b);
    lock.releaseLock();

    var when = Utilities.formatDate(b.start, CONFIG.timezone, "EEEE d MMMM 'at' h:mma")
      .replace("AM", "am").replace("PM", "pm");
    safe(function () {
      MailApp.sendEmail({
        to: CONFIG.restaurantEmail, replyTo: b.email, name: "Aroma Class website",
        subject: "New booking: " + b.name + ", " + b.guests + " on " + when,
        body: details + "\n\nIt is in the " + cal.getName() + " calendar. Reply to reach the customer."
      });
    });
    // Customer email carries no free text from the form except the first name (links stripped).
    safe(function () {
      MailApp.sendEmail({
        to: b.email, replyTo: CONFIG.restaurantEmail, name: "Aroma Class",
        subject: CONFIG.autoConfirm ? "Your table at Aroma Class" : "Your booking request at Aroma Class",
        body: "Hi " + b.firstName + ",\n\n" +
          (CONFIG.autoConfirm
            ? "Your table for " + b.guests + " at Aroma Class is booked for " + when + "."
            : "We have your request for a table for " + b.guests + " on " + when + ". We will confirm shortly.") +
          "\n\nAroma Class, Dukes Court, Duke Street, Woking GU21 5BH.\nIf your plans change, reply to this email.\n\nSee you soon."
      });
    });
    notifyWhatsApp("New booking\n" + b.name + " x" + b.guests + "\n" + when + "\nPhone " + b.phone +
      (b.notes ? "\nNotes: " + b.notes : "") + "\nEmail " + b.email);
    return out({ success: true, confirmed: CONFIG.autoConfirm });
  } catch (err) {
    console.error("doPost failed: " + (err && err.stack || err)); // details stay in the script logs
    return fail("Something went wrong");
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function parse(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 5000) return null;
    var p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? p : null;
  } catch (err) { return null; }
}

/** Plain text only: no control characters, no links, no HTML, trimmed and capped. */
function clean(v, max) {
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/(https?:\/\/|www\.)\S*/gi, "")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function validate(p) {
  var name = clean(p.name, 60);
  if (name.length < 2 || !/[a-z]/i.test(name)) return { error: "Please enter your name" };
  var email = String(p.email || "").trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email)) return { error: "Please enter a valid email" };
  var phone = String(p.phone || "").replace(/[^\d+]/g, "");
  if (!/^\+?\d{9,15}$/.test(phone)) return { error: "Please enter a valid phone number" };
  var guests = parseInt(p.guests, 10);
  if (String(p.guests) === "9+") return { error: "For 9 or more, please email us" };
  if (!(guests >= 1 && guests <= CONFIG.maxGuests)) return { error: "Please choose the number of guests" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date)) || !/^\d{2}:\d{2}$/.test(String(p.time))) return { error: "Please pick a date and time" };

  var hm = p.time.split(":"), hh = parseInt(hm[0], 10), mm = parseInt(hm[1], 10);
  if (hh > 23 || mm > 59 || mm % CONFIG.slotStepMin !== 0) return { error: "Please pick a time from the list" };
  // Parse as London wall-clock time regardless of the script's own time zone setting.
  var start = Utilities.parseDate(p.date + " " + p.time, CONFIG.timezone, "yyyy-MM-dd HH:mm");
  if (!start || isNaN(start.getTime())) return { error: "Please pick a date and time" };
  // Reject impossible dates like 2026-02-31 that roll over to another day.
  if (Utilities.formatDate(start, CONFIG.timezone, "yyyy-MM-dd HH:mm") !== p.date + " " + p.time) return { error: "Please pick a date and time" };
  if (CONFIG.closedDates.indexOf(p.date) !== -1) return { error: "We are closed that day" };
  var now = Date.now();
  if (start.getTime() < now + CONFIG.minNoticeMin * 60000) return { error: "Please pick a time at least " + CONFIG.minNoticeMin + " minutes from now" };
  if (start.getTime() > now + CONFIG.maxDaysAhead * 86400000) return { error: "We take bookings up to " + CONFIG.maxDaysAhead + " days ahead" };

  var day = parseInt(Utilities.formatDate(start, CONFIG.timezone, "u"), 10) % 7; // u: 1=Mon..7=Sun
  var hrs = CONFIG.hours[day];
  var t = hh + mm / 60;
  if (!hrs) return { error: "We are closed that day" };
  if (t < Math.max(hrs[0], CONFIG.bookFrom) || t > hrs[1] - CONFIG.lastBookingBeforeCloseMin / 60) return { error: "We take bookings from 12pm to 6:30pm" };
  var closeAt = Utilities.parseDate(p.date + " " + fmtHM(hrs[1]), CONFIG.timezone, "yyyy-MM-dd HH:mm");
  var end = new Date(Math.min(start.getTime() + CONFIG.slotMinutes * 60000, closeAt.getTime()));

  return {
    name: name, firstName: name.split(" ")[0], email: email, phone: phone, guests: guests,
    notes: clean(p.notes, 300), start: start, end: end
  };
}

function checkLimits(b) {
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), CONFIG.timezone, "yyyyMMdd");
  var total = parseInt(props.getProperty("n_" + day) || "0", 10);
  if (total >= CONFIG.maxPerDay) return "We cannot take more online bookings today. Please email us.";
  var cache = CacheService.getScriptCache();
  var keys = ["c_" + b.email, "c_" + b.phone];
  for (var i = 0; i < keys.length; i++) {
    if (parseInt(cache.get(keys[i]) || "0", 10) >= CONFIG.maxPerContactPerDay) {
      return "You have made several bookings today. Please email us to change one.";
    }
  }
  return null;
}

function recordLimits(b) {
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), CONFIG.timezone, "yyyyMMdd");
  props.setProperty("n_" + day, String(parseInt(props.getProperty("n_" + day) || "0", 10) + 1));
  var cache = CacheService.getScriptCache();
  ["c_" + b.email, "c_" + b.phone].forEach(function (k) {
    cache.put(k, String(parseInt(cache.get(k) || "0", 10) + 1), 21600); // 6 hours, the cache maximum
  });
}

/** WhatsApp alert via CallMeBot. Secrets come from Script Properties. Never blocks the booking. */
function notifyWhatsApp(text) {
  var props = PropertiesService.getScriptProperties();
  var phone = props.getProperty("WHATSAPP_PHONE"), key = props.getProperty("WHATSAPP_APIKEY");
  if (!phone || !key) return;
  safe(function () {
    UrlFetchApp.fetch("https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(phone) +
      "&apikey=" + encodeURIComponent(key) + "&text=" + encodeURIComponent(text), { muteHttpExceptions: true });
  });
}

function fmtHM(h) { var H = Math.floor(h), M = Math.round((h - H) * 60); return (H < 10 ? "0" : "") + H + ":" + (M < 10 ? "0" : "") + M; }
function safe(fn) { try { fn(); } catch (err) { console.error(String(err && err.stack || err)); } }
function fail(msg) { return out({ success: false, error: msg }); }
function doGet() { return out({ ok: true, service: "Aroma Class bookings" }); }

function getCalendar() {
  var found = CalendarApp.getCalendarsByName(CONFIG.calendarName);
  if (!found.length) throw new Error("Calendar '" + CONFIG.calendarName + "' not found");
  return found[0];
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: books a table for 2 tomorrow at 1pm in your own name. */
function testBooking() {
  var t = new Date(Date.now() + 86400000);
  if (Utilities.formatDate(t, CONFIG.timezone, "u") === "7") t = new Date(t.getTime() + 86400000);
  var res = doPost({ postData: { contents: JSON.stringify({
    name: "Test Booking", email: Session.getActiveUser().getEmail(), phone: "07000000000",
    guests: "2", date: Utilities.formatDate(t, CONFIG.timezone, "yyyy-MM-dd"), time: "13:00", notes: "test"
  }) } });
  Logger.log(res.getContent());
}
