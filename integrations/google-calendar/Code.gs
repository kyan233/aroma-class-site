/**
 * Aroma Class bookings -> Google Calendar
 * Receives the website booking form, checks capacity, adds a calendar event,
 * emails the restaurant and the customer.
 *
 * Setup (5 minutes, from the restaurant's Google account):
 *  1. calendar.google.com: create a calendar called "Aroma Class bookings" (or use the main one).
 *  2. script.google.com > New project > delete the sample code > paste this file > save.
 *  3. Project Settings (gear icon): set Time zone to (GMT+00:00) London.
 *  4. Edit CONFIG below if needed.
 *  5. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone > Deploy.
 *     Approve the permissions (Calendar + send email as you).
 *  6. Copy the Web app URL and send it to Kyan. It goes into <body data-booking-endpoint="...">.
 * Any change to this file needs Deploy > Manage deployments > edit > New version.
 */
var CONFIG = {
  calendarName: "Aroma Class bookings", // falls back to the main calendar if not found
  restaurantEmail: "info@aromaclassitalian.com",
  maxTablesPerSlot: 6,   // bookings allowed to overlap at the same time
  slotMinutes: 90,       // how long a table is held in the calendar
  autoConfirm: true,     // true: customer is told it is booked. false: told it is a request.
  timezone: "Europe/London"
};

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents || "{}");
    var required = ["name", "email", "phone", "guests", "date", "time"];
    for (var i = 0; i < required.length; i++) {
      if (!p[required[i]]) return out({ success: false, error: "Missing " + required[i] });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return out({ success: false, error: "Invalid email" });
    if (String(p.website || "").length) return out({ success: true }); // honeypot: pretend, do nothing

    var start = new Date(p.date + "T" + p.time + ":00");
    if (isNaN(start.getTime())) return out({ success: false, error: "Invalid date or time" });
    if (start.getTime() < Date.now() - 5 * 60000) return out({ success: false, error: "That time has passed" });
    var end = new Date(start.getTime() + CONFIG.slotMinutes * 60000);

    var cal = getCalendar();
    var clash = cal.getEvents(start, end).filter(function (ev) { return ev.getTitle().indexOf("Booking:") === 0; }).length;
    if (clash >= CONFIG.maxTablesPerSlot) return out({ success: false, full: true, error: "That time is full" });

    var guests = String(p.guests), name = String(p.name).slice(0, 80);
    var notes = String(p.notes || "").slice(0, 500);
    var details = [
      "Guests: " + guests, "Phone: " + p.phone, "Email: " + p.email,
      "Notes: " + (notes || "none"), "Booked via the website"
    ].join("\n");
    var ev = cal.createEvent("Booking: " + name + " x" + guests, start, end, { description: details });

    var when = Utilities.formatDate(start, CONFIG.timezone, "EEEE d MMMM 'at' h:mma").replace("AM", "am").replace("PM", "pm");
    MailApp.sendEmail({
      to: CONFIG.restaurantEmail, replyTo: p.email, name: "Aroma Class website",
      subject: "New booking: " + name + ", " + guests + " on " + when,
      body: details + "\n\nIt is in the " + cal.getName() + " calendar. Reply to this email to reach the customer."
    });
    var greeting = "Hi " + name.split(" ")[0] + ",\n\n";
    var line = CONFIG.autoConfirm
      ? "Your table for " + guests + " at Aroma Class is booked for " + when + "."
      : "We have your request for a table for " + guests + " on " + when + ". We will confirm shortly.";
    MailApp.sendEmail({
      to: p.email, replyTo: CONFIG.restaurantEmail, name: "Aroma Class",
      subject: CONFIG.autoConfirm ? "Your table at Aroma Class" : "Your booking request at Aroma Class",
      body: greeting + line + "\n\nAroma Class, Dukes Court, Duke Street, Woking GU21 5BH.\n" +
            "If your plans change, reply to this email.\n\nSee you soon."
    });
    return out({ success: true, confirmed: CONFIG.autoConfirm, eventId: ev.getId() });
  } catch (err) {
    return out({ success: false, error: String(err) });
  }
}

function doGet() { return out({ ok: true, service: "Aroma Class bookings" }); }

function getCalendar() {
  var found = CalendarApp.getCalendarsByName(CONFIG.calendarName);
  return found.length ? found[0] : CalendarApp.getDefaultCalendar();
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run this once from the editor to check permissions and see a test event appear. */
function testBooking() {
  var tomorrow = new Date(Date.now() + 86400000);
  var res = doPost({ postData: { contents: JSON.stringify({
    name: "Test Booking", email: Session.getActiveUser().getEmail(), phone: "07000 000000",
    guests: "2", date: Utilities.formatDate(tomorrow, CONFIG.timezone, "yyyy-MM-dd"), time: "13:00", notes: "test from the script editor"
  }) } });
  Logger.log(res.getContent());
}
