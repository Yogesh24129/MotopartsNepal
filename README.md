# MotoParts Nepal

A college e-commerce project for motorcycle parts in Nepal, built with Node.js,
Express, MongoDB/Mongoose and EJS. It includes a product catalog, server-side
shopping cart, guest/account checkout, payment receipts, wallets and notifications.

## Requirements and setup

Use Node.js 22.13+ or 24+ and a **MongoDB replica set or MongoDB Atlas cluster**.
Payment/inventory updates and wallet transfers use MongoDB transactions; a standalone
MongoDB server cannot support those transactions, and startup reports that requirement.

```sh
npm ci
cp .env.example .env
```

Edit `.env` with a random `SESSION_SECRET`, the MongoDB connection string and
`APP_BASE_URL` (the browser-accessible origin used for payment callbacks).
For a local MongoDB replica set, Docker users can run:

```sh
docker compose up -d --wait
npm run seed
npm start
```

Open http://localhost:3000. `npm run dev` starts the app with automatic reloads.
The product seed **replaces all products** and is intended for a development database.
If using Atlas, set its replica-set connection string in `MONGO_URI` and omit Docker.

## Payments

**Card payments are simulated.** Use dummy card details only. A future expiry and
13–16 digit card number succeed; a number ending in `0000` demonstrates a declined
payment. The app stores only the last four digits. Failed payments can be retried.

**eSewa uses a configured gateway**, rather than an app-hosted login/OTP simulation.
The example configuration targets eSewa's sandbox. Set the current sandbox signing
key from the [official eSewa ePay documentation](https://developer.esewa.com.np/pages/Epay).
Leave the signing key blank to disable eSewa while demonstrating the card flow.
Never substitute production payment credentials for a college demonstration.
Old `esewa-login`, `esewa-otp` and `wallet-login` templates are not active routes.

The app verifies signed gateway responses and independently checks the amount,
product code, transaction UUID and status with eSewa. It tracks retry UUIDs so a
delayed callback can still be reconciled. Repeated/concurrent confirmations update
inventory or wallet balance once. Unsigned failure redirects cannot change payment
or ledger state. Pending gateway status remains pending.

An order stays **paid** if external payment completes after stock sells out. Its
receipt then requests store assistance and its `fulfillmentStatus` is `stock_review`.
No inventory is deducted for that order; staff must arrange stock or a refund outside
this prototype. This app has no automatic refund or admin fulfillment workflow.

## Wallets and accounts

Wallet access requires login. Top-ups must be verified through eSewa; there is no
endpoint that credits an arbitrary balance. Transfers atomically update both wallets
and create their ledger record. Amounts must be positive, at most NPR 1,000,000 and
have no more than two decimal places. The wallet history displays transaction status.

Optional local demo accounts:

```sh
npm run seed:wallets
```

This creates `yogjung@example.com`, `rita@example.com` and `bikash@example.com` with
password `DemoWallet123!` (or `DEMO_WALLET_PASSWORD` from `.env`) and starter balances.
Rerunning preserves existing passwords and balances. It refuses production mode.

Order pages enforce account ownership; guest orders are tied to the checkout session.
Logging in rotates the session identifier while retaining the cart and guest receipts.
Logging out destroys the session. Local POST forms require a CSRF token; JSON clients
can send it in the `x-csrf-token` header.

## Optional notifications

Set `GMAIL_USER` and `GMAIL_APP_PASSWORD` for email, or the Twilio variables in
`.env.example` for WhatsApp confirmations. Blank credentials disable those channels.
Messaging runs after payment commits, and delivery failures do not undo payment.
Confirmations are attempted once per payment transition; there is no durable message
retry queue yet.

## Tests and checks

```sh
npm test
npm audit --omit=dev
```

The regression suite starts an isolated in-memory MongoDB replica set; its first run
downloads a MongoDB binary. Tests cover ownership, guest receipts, payment retries,
duplicate callbacks, concurrent stock allocation, concurrent wallet transfers,
transaction rollback, cart limits, fresh checkout prices, CSRF and wallet seeding.
Gateway responses are stubbed; tests do not send payments or external messages.
GitHub Actions runs the suite on pushes and pull requests.

## Structure

- `app.js`: application factory, sessions, CSRF and route wiring
- `server.js`: database checks and HTTP/optional local HTTPS startup
- `models/`: users, products, orders, wallets, transactions and notifications
- `services/`: atomic payment/inventory and wallet operations
- `routes/`: catalog, cart, checkout, payments, auth, wallets and notifications
- `middleware/`: cart helpers, ownership checks, CSRF and shared view data
- `utils/`: gateway signing/status verification and optional messages
- `test/`: database-backed regression tests

The displayed SHA-256 order checksum detects accidental changes to core order data.
It is not a tamper-proof audit trail: anyone able to rewrite both an order and its
checksum can recompute it. Payment status and gateway transaction IDs are separately
validated through the payment flow.

For production, use HTTPS, set `NODE_ENV=production` and a strong `SESSION_SECRET`,
and configure `TRUST_PROXY=1` only behind one trusted reverse proxy. The card route
remains a simulation; replace it with a verified provider integration before accepting
real card payments. Admin fulfillment, refunds, a durable messaging queue and account
recovery remain future work.

## Lab 7 — Digital Marketing Tools

The site integrates **Meta (Facebook) Pixel** with a local demo dashboard at
`/marketing/dashboard`. A Pixel ID is not needed for the local lab demonstration.
The footer exposes the dashboard link in development, plus allow/decline controls.
Measurement starts only after consent. Declining stops new events and clears the
current session's local marketing events and order associations.

The default `.env.example` keeps `META_PIXEL_ENABLED=false` and `META_PIXEL_ID` blank.
No Meta script or tracking image loads in this mode, and no events are sent to Meta.
The dashboard shows only this browser session, making it usable for a lab without
exposing another customer's data. Set `LAB7_DASHBOARD_ENABLED=false` for deployment;
the dashboard is off by default in production unless explicitly enabled.

| Metric / event | Trigger |
| --- | --- |
| `ProductImpression` | At least 50% of a catalog product card becomes visible; once per page load |
| `PromotionImpression` | At least 50% of the store's riding-gear promotion becomes visible; once per page load |
| `ProductClick` / `PromotionClick` | A product link or store promotion link is clicked |
| `PageView` | A consenting visitor opens the catalog, product, checkout or receipt page |
| `ViewContent` | A product detail page opens |
| `InitiateCheckout` | Checkout opens |
| `Purchase` | The server confirms an order is paid; failed payments and receipt reloads do not count |

Website impressions are not Meta ad-delivery impressions. The store promotion is a
first-party demo banner, not a paid Meta advertisement. The dashboard reports event
counts, click-through rate (`clicks / impressions`) and checkout conversion rate
(`paid orders / checkout page views`), plus order value in NPR. Simulated card orders
are clearly identified. These ratios describe this demo session, not unique-user
campaign attribution. Event documents expire after 30 days, and dashboard queries
cover the last 30 days. Purchase totals come directly from paid order records.
Browser-submitted `Purchase` events are rejected.

### Lab demonstration

1. Open the store and choose **Allow measurement** in the footer.
2. Scroll through the catalog until the promotion and product cards are visible.
3. Click **Shop riding gear** or a product image/name.
4. Add an item, open checkout, and complete a **dummy card** payment with a future
   expiry and a number that does not end in `0000`.
5. Open **Lab 7 · Marketing dashboard** in the same browser session and refresh it.
   Show impressions, clicks, one conversion, order value, rates and recent events.
6. Reload the receipt and show that conversions remain one. Try a declined payment
   to show that it does not become a conversion.
7. Choose **Decline / withdraw** and show that local history clears and tracking stops.

`window.motopartsMarketing` in browser developer tools exposes the mode and recent
browser events for debugging. The dashboard's conversions remain server-confirmed.
JavaScript and IntersectionObserver must be available for viewability measurement.
Ad blockers or failed requests can reduce browser event counts; purchases can be
confirmed even if browser tracking is blocked.

### Connect a real demo Pixel later

Create a Pixel/data source in your own Meta Events Manager, copy its numeric Pixel ID,
and configure:

```dotenv
MARKETING_ENABLED=true
META_PIXEL_ENABLED=true
META_PIXEL_ID=YOUR_NUMERIC_PIXEL_ID
```

Restart the app and explicitly allow measurement. The browser then loads the Meta
Pixel library and dispatches standard `PageView`, `ViewContent`, `InitiateCheckout`
and `Purchase` events, plus custom impression/click events. Customer names, email,
phone, addresses and card details are excluded from our event parameters. Automatic
Pixel configuration is disabled; advanced matching is not configured. Meta can still
receive page URLs and browser information as part of its own library's operation.
Sensitive account and wallet pages do not initialize the Pixel.

Use a dedicated demo Pixel and Meta's **Test Events** / **Meta Pixel Helper** to
verify receipt. A purchase uses a stable event ID and a browser storage marker to
avoid repeated dispatch on receipt reload. If browser storage is unavailable it may
be attempted again with the same ID. The local dashboard cannot confirm Meta
received an event, and this integration does not implement server-side Conversions
API delivery or a durable retry queue. Withdrawal cannot erase events already sent
to Meta. Official references: [Meta Pixel implementation](https://developers.facebook.com/docs/meta-pixel/implementation/)
and [event reference](https://developers.facebook.com/docs/meta-pixel/reference/).

## Lab 8: Search Engine Optimization and Google Analytics

Public catalog, category and product pages now render unique titles, descriptions,
keyword metadata, canonical URLs and social previews. Product images have descriptive
alt text; product pages include breadcrumbs and Product/Offer JSON-LD with current
NPR prices and stock status. No ratings are fabricated. Keyword metadata is included
for the lab, but Google ignores the keywords tag: meaningful page content, titles and
image descriptions matter. See [Google's supported metadata](https://developers.google.com/search/docs/crawling-indexing/special-tags).

`/sitemap.xml` lists the catalog, categories and products. `/robots.txt` points to the
sitemap and excludes private routes. Search results, authentication, checkout,
wallet, receipts and error pages have noindex metadata and headers. Robots rules
are crawl hints; existing authentication remains the protection for private pages.
Set `APP_BASE_URL` to the site's real HTTP(S) origin for canonical and sitemap URLs.
Production requires this value. For a staging/demo site that should stay out of
search results, use `SITE_INDEXING_ENABLED=false` (empty sitemap and noindex public
pages). A localhost demo is not publicly crawlable. After public deployment, submit
its sitemap in your own Google Search Console account and inspect a product URL.

### Connect GA4

Google transmission is disabled by default. A real GA4 property and Measurement ID
are required; the local Lab 7 dashboard does not calculate GA4 traffic or bounce rate.

1. Create a dedicated demo Google Analytics property and a Web data stream for your
   site. Copy its Measurement ID (`G-...`).
2. Disable **Enhanced measurement** in that stream for this demo. The app explicitly
   sends page views and ecommerce events; automatic history, form and site-search
   tracking could duplicate views or collect additional URL/form information.
3. Configure your local `.env` (never commit it):

   ```dotenv
   MARKETING_ENABLED=true
   GA4_ENABLED=true
   GA4_MEASUREMENT_ID=G-YOUR_REAL_ID
   GA4_DEBUG_MODE=true
   ```

4. Restart the app, allow measurement in the footer, and browse the catalog and a
   product. Use GA4 **DebugView** and **Realtime** to confirm events arrive. Complete
   a simulated card purchase to verify the ecommerce journey. Set debug mode false
   after testing; use a separate demo property for simulated orders.

The Google tag loads only after consent on catalog, product, checkout and receipt
pages. Events are `page_view`, `view_item`, `begin_checkout` and server-confirmed
`purchase`. Default automatic page views are disabled to avoid duplicates, as
[Google documents](https://developers.google.com/analytics/devguides/collection/ga4/views).
The tag provides session and engagement measurement. GA4 and Meta can be enabled
independently. Advertising consent remains denied; Google signals and advertising
personalization are disabled.

Event parameters exclude checkout contact details. Page locations are server-generated
public paths with search strings and receipt order IDs removed; referrer paths and
queries are removed. Purchase transaction IDs are stable hashes and browser storage
prevents repeated attempts on reload. Withdrawal disables further Google collection;
it does not erase data already sent to Google. Blocked scripts, unavailable browser
storage and network failures can affect delivery. Automated tests verify commands
and payloads, but cannot establish live receipt in an unconfigured GA4 account.

### Monitor traffic and bounce rate

Use **Realtime** for immediate activity, **Traffic acquisition** for sessions and
channels, and **Pages and screens** for page views. To show bounce rate, an Editor or
Administrator can customize a detail report: **Customize report → Report data →
Metrics → Add metric**, add **Bounce rate** and **Engagement rate**, then Apply and
Save. GA4 bounce rate is the percentage of sessions that were not engaged. An engaged
session lasts over 10 seconds, includes a key event, or has at least two page/screen
views. See [Google's bounce-rate guide](https://support.google.com/analytics/answer/12195621?hl=en).
Capture report screenshots after real demo traffic has been processed; do not present
local event counts as Google Analytics measurements.
