# Bookings into Google Calendar

`Code.gs` is a Google Apps Script web app. The website's booking form posts to it; it checks how many
"Booking:" events already overlap the requested time, adds the event, and emails the restaurant and the customer.

Setup steps are at the top of `Code.gs`. When you have the Web app URL, put it in
`src/partials/head.html` on the `<body data-booking-endpoint="">` attribute, run `./build.sh`, push.

Order the site tries: Google Calendar endpoint, then Web3Forms key, then the visitor's email app.
Run `testBooking` in the script editor once to grant permissions and see a test event.

WhatsApp alerts: fill `CONFIG.whatsapp` (Dom's number + the CallMeBot API key he gets by messaging their
bot once). Free, single recipient, unofficial. If it ever gets flaky, the official route is the Meta WhatsApp
Cloud API (needs a Meta Business account and an approved message template, about 2p a message).
