# Aroma Class website (remake)

Static remake of aromaclassitalian.com (Wix) as plain HTML/CSS/JS, styled after berenjak.com:
dark burgundy theme from the brand logo, wide uppercase display type, serif body, real photos.

## Run
Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8123

## Edit
Pages live in `src/pages/*.html` (content only). Header and footer live in `src/partials/`.
After editing anything in `src/`, rebuild the root HTML files:

    ./build.sh

Styles: `assets/css/site.css`. Behaviour: `assets/js/site.js` (mobile menu, scroll reveals,
live "open now" status, newsletter mailto hand-off, menu section highlighting).

## Pages
- `index.html` home
- `menu.html` full menu (transcribed from the A3 menu image on the Wix site)
- `specials.html` this week's specials and pizzas
- `opening-hours.html` hours, live status, map, directions
- `work-with-us.html` recruitment

## Before going live
- Phone number: none on the current site. Add it to the footer, hours page and the JSON-LD in `src/partials/head.html`.
- Sunday: assumed closed (the current site lists Mon to Sat only). Confirm.
- Newsletter form hands off to the visitor's email app. Swap for Mailchimp/Formspree if a real list is wanted.
- Fonts load from Google Fonts. Self-host Archivo and EB Garamond for production.
- Photos are the four from the Wix site. Better hero and food photography would lift the whole thing.
- `og:image` is a relative path. Make it absolute once the domain is known.
- Deploy: same GitHub Pages recipe as `~/lockout-landing` (push repo, set Pages to root, add CNAME).
