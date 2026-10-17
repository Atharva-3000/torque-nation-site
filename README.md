# Torque Nation: website + workshop admin

Premium superbike and 450cc+ workshop in Ratlam. One Node.js app with:

- **Public website**: Home, Services, Pricing, Our work (portfolio), Contact / booking, plus a living design system at `/design-system`.
- **Admin panel** at `/admin`: GST invoices and estimates (print / save as PDF, WhatsApp share), rate card, brand logos, portfolio with photos, booking requests from the website, bike-model → price-class list, parts list, business settings.

One npm package (`@libsql/client`, the SQLite/Turso driver), no build step. Needs **Node.js 22**.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first start the app creates the admin account and writes the login to `data/first-run-credentials.txt`. Sign in at `/admin`, change the password under **Business settings**, then delete that file.

Forgot the password?

```bash
npm run reset-password -- admin "a-new-long-password"
```

## Before going live: checklist

1. **Business settings**: real phone, WhatsApp number (digits with 91), address, Google Maps link, hours, Instagram, GSTIN, UPI and bank details, invoice terms.
2. **Rate card**: every price is an *indicative placeholder*. Set your real labour rates per class. Empty = "On quote". Untick "On site" to hide a job from the website but keep it for invoices.
3. **Parts list**: confirm HSN codes and GST rates with your CA (defaults are 18%).
4. **Brands we fit**: upload official logo files (SVG or transparent PNG) from each brand or distributor. Switch on only brands you actually stock. Motul, Motorex, K&N, Crank1, HEL, Liqui Moly, Brembo, Evotech, SW-Motech and RCB are on by default. NGK, D.I.D, EBC, Akrapovič, SC-Project and Pirelli are seeded but hidden.
5. **Bike models**: check the class for each model, and add any you see often.
6. **Portfolio**: add real jobs with real photos (before / during / after).

## How pricing works

Every bike model maps to a class: **A** (450–700cc), **B** (middleweight 700–1000cc), **C** (superbike / litre-class). The rate card stores a labour price per class. When you create an invoice and pick the bike, its class is set automatically, and services added from the rate card use that class's price. Changing the class reprices those lines.

The public `/pricing` page reads the same rate card, so the website and the invoices always agree.

## Invoices & estimates

- Numbering: `TN/26-27/0001` (invoices) and `TN-EST/26-27/0001` (estimates), restarting each Indian financial year. Prefixes are set in settings.
- GST: CGST + SGST by default, IGST when "Inter-state" is ticked. With GST on but no GSTIN set, documents print as "Invoice" rather than "Tax Invoice".
- Estimate → **Convert to invoice** copies everything into a new invoice.
- Typing a phone number that has been billed before fills in the returning customer and their bike.
- **Print / PDF** opens an A4 sheet. Use the browser's print dialog and choose "Save as PDF".
- Prefer **Void** over delete for invoices already issued, so numbering has no gaps.

## Deploying

**Vercel (current setup).** Vercel's disk is wiped whenever it starts a fresh copy of the app, so all data (invoices, enquiries, logins, uploaded photos) lives in a **Turso** database:

1. Vercel → project → **Storage** → connect a Turso database. This sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
2. Settings → Environment Variables: `ADMIN_USER` and `ADMIN_PASSWORD` create the first admin. They are only used while the database has no users; after that, change the password in the admin.
3. Redeploy.

Forgot the live password? Copy the two `TURSO_*` values from Vercel and run:

```bash
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." npm run reset-password -- admin "a-new-long-password"
```

**VPS / Railway / Render.** Without the `TURSO_*` variables the app uses a SQLite file in `DATA_DIR`, so it needs a persistent disk:

```bash
npm install
PORT=3000 DATA_DIR=/var/lib/torque-nation npm start
```

- Put it behind HTTPS (Caddy or nginx). `npm start` sets `NODE_ENV=production`, which marks the login cookie `Secure`.
- **Back up the database** (Turso has point-in-time restore; on a VPS, back up `DATA_DIR`). It holds every invoice.

## Project layout

```
server.js              HTTP server, routes, JSON API
lib/db.js              Database (Turso or local SQLite), schema, first-run seed, uploads, helpers
lib/seed-data.js       Starting rate card, bike list, parts, brands, settings
lib/render.js          Page templating + invoice print renderer
lib/auth.js            scrypt password hashing, login throttle
views/                 Page templates (layout, partials, pages, admin shells)
public/css/tokens.css  Design tokens: the single source of truth
public/css/components.css, site.css, admin.css, invoice.css
public/js/calc.js      Invoice maths, shared by server + admin (paise, GST, words)
public/js/site.js      Public site behaviour (menu, bike finder, booking form)
public/js/admin.js     Admin panel
DESIGN-SYSTEM.md       Brand, colour, type, components, rules
```

## Security notes

- Passwords are hashed with scrypt. Sessions use an HttpOnly, SameSite=Strict cookie and expire after 7 days. Changing the password signs out other sessions.
- Login is throttled (8 tries / 15 min per IP). The public booking form has a honeypot and throttle.
- Admin write requests require a custom header, which cross-site forms can't send.
- Uploaded SVGs containing scripts are rejected.
