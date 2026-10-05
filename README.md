# MotoParts Nepal

A motorcycle parts store with a searchable catalog, cart, account and guest checkout,
order receipts, wallets, purchase-based recommendations, consent-based analytics and
on-page SEO. Built with Node.js, Express, EJS and MongoDB.

## Clone and run on Windows

Use Windows 11 (64-bit Intel/AMD) for the bundled MongoDB 8.0 runtime. Older or
unsupported devices can use Atlas in external mode instead.
[MongoDB Windows requirements](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-windows/)

Install Git and **Node.js LTS 24 or later** (Node.js 22.13+ on the 22.x branch is also
supported). Reopen PowerShell after installation.

```powershell
git clone https://github.com/Yogesh24129/MotopartsNepal.git
cd MotopartsNepal
.\setup.cmd
.\start.cmd
```

Open **http://localhost:3000**. Keep the terminal running; Ctrl+C stops the app.
Docker, WSL and a separately installed MongoDB server are unnecessary.

`setup.cmd` installs locked dependencies, creates `.env`, generates a random session
secret and selects local database mode. Existing secrets and credentials are preserved.
`start.cmd` starts the app; if dependencies or `.env` are missing, it prepares them
first. Neither command requires PowerShell execution-policy changes. On macOS/Linux,
use `npm ci`, `npm run setup -- --local`, then `npm start`.

The first install/start needs internet to download MongoDB. Startup automatically
creates an empty catalog using the included 18-product catalog. Data is disk-backed
in `.local-data/mongo/`, excluded from Git, and survives restarts. Accounts, orders,
sessions and wallet balances are local to this device. Preserve this directory for
backups. Automatic seeding never replaces an existing catalog.

For later updates, stop the server first:

```powershell
git pull origin main
.\setup.cmd
.\start.cmd
```

## Activate HTTPS on Windows later

The server supports local HTTPS at port 3443 alongside HTTP at port 3000.

1. Install mkcert once:

   ```powershell
   winget install --exact --id FiloSottile.mkcert
   ```

2. Close and reopen PowerShell in the repository folder. Stop the running app.
3. Create and trust the local certificate:

   ```powershell
   npm run https:setup
   ```

   Accept the Windows certificate-trust/UAC prompt when requested. The script uses
   `mkcert -install`, creates `certs/localhost-cert.pem` and
   `certs/localhost-key.pem`, and sets `APP_BASE_URL=https://localhost:3443` and
   `HTTPS_PORT=3443` in `.env`.

4. Start the app:

   ```powershell
   .\start.cmd
   ```

5. Open **https://localhost:3443**. Reopen the browser if it has not picked up the
   new certificate trust. Use this address consistently so payment returns use HTTPS.

Certificates are generated on each device and excluded from Git. This local
certificate is for localhost, not a public domain. Do not share the mkcert root
private key. See [mkcert's instructions](https://github.com/FiloSottile/mkcert) and
[its Windows package](https://github.com/microsoft/winget-pkgs/tree/master/manifests/f/FiloSottile/mkcert).
To return to HTTP, set `APP_BASE_URL=http://localhost:3000` and use that address.
For public hosting, terminate HTTPS with a trusted public certificate at your host
or reverse proxy and set `APP_BASE_URL` to your actual public origin.

## Payments and checkout

Checkout supports cash on delivery, eSewa and card test processing.

- **Cash on delivery:** creates an order and reserves stock atomically. Its receipt
  confirms placement, with payment still pending until collection. It is not counted
  as paid revenue or a paid conversion.
- **eSewa:** redirects to the hosted gateway, verifies the signed return and checks
  status independently before marking an order paid. The default configuration uses
  eSewa's sandbox with its documented public UAT key and `EPAYTEST` product code.
  Use eSewa's current test-account details from the
  [official documentation](https://developer.esewa.com.np/pages/Epay). If the gateway
  changes those details, update `.env`.
- **Card:** enabled only by `PAYMENT_MODE=sandbox` outside production. It is explicitly
  marked test processing and does not charge a bank card. Use `4111 1111 1111 1111`,
  any future MM/YY expiry and CVV `123`. A number ending in `0000` fails. Only the
  last four digits are stored; use no real card information.

Sandbox card/eSewa orders can exercise receipts, recommendations and conversions.
They are test transactions, not actual sales. Use separate analytics properties when
collecting these transactions. For live payments, set `PAYMENT_MODE=live`, configure
your eSewa merchant credentials and production gateway URLs, and use HTTPS. The
simulated card route then becomes unavailable; real card charging needs a verified
provider integration.

Payment retries and duplicate callbacks do not double-charge the local ledger or
deduct stock twice. A confirmed payment stays paid if stock sells out before the
callback; its receipt requests fulfillment assistance. Administrators can reserve
stock after review, manage dispatch and delivery, and record COD collection after
delivery. Cancelling an unpaid order releases its reserved stock once. Paid orders
require a refund through the payment provider; automated refunds are not implemented.

## Accounts, wallets and notifications

Registration and login use password hashing and server-side sessions. Receipt access
is restricted to the owning account or guest checkout session. Login rotates the
session identifier while preserving the cart and guest access. Mutating forms and
JSON requests require CSRF tokens.

Wallets start with zero balance. eSewa top-ups require verified gateway completion;
transfers update both balances and their ledger together. Account details and wallet
transaction histories are protected by login. Optional developer wallet fixtures
are available with `npm run seed:wallets` after choosing `FIXTURE_WALLET_PASSWORD`;
these insert test balances and must not be used with real customer data. They are
not created automatically and cannot be seeded in production.

Blank Gmail/Twilio credentials disable email/WhatsApp confirmations. Configure your
own credentials to enable them. Notification failures do not roll back completed
payments. There is no durable message retry queue or password-recovery flow yet.

## Session analytics and external tracking

The footer provides measurement consent and a **Session analytics** link to
`/marketing/dashboard`. Signup is not required. Measurement starts after allowing it;
withdrawal stops collection and clears this session's local history. The dashboard
shows this browser session's last 30 days of impressions, clicks, paid conversions,
order value, click-through rate and checkout conversion rate. It is not a global
sales dashboard or an external ad-delivery report. The protected admin overview
at /admin provides store-wide database counts and measurement summaries.

Product/promotion impressions require at least 50% visibility and count once per page.
Repeated clicks can count separately. Paid purchases come from confirmed order
records, never from browser-submitted totals. Expired local event documents are
automatically removed after 30 days.

External transmission is disabled until explicitly configured:

```dotenv
META_PIXEL_ENABLED=false
META_PIXEL_ID=
GA4_ENABLED=false
GA4_MEASUREMENT_ID=
```

Add your own numeric Meta Pixel ID or GA4 `G-...` ID and set the relevant enabled flag
to true. The tag loads only with consent on catalog, product, checkout and receipt
pages. Customer contact/card details are excluded from app-generated event parameters.
GA4 page locations omit search strings and receipt IDs. Meta's own library may
receive browser and page information. Withdrawn consent cannot erase events already
sent to an external service.

For GA4, create a Web data stream, disable Enhanced measurement to avoid duplicate
page views and automatic form/search tracking, and use `GA4_DEBUG_MODE=true` for
DebugView verification. The app sends page views and ecommerce events explicitly.
Use Realtime for current activity and traffic/page reports for aggregate results.
As an Editor or Administrator, customize a detail report's Metrics to include
Engagement rate and Bounce rate. Bounce rate measures non-engaged sessions, not
local click counts. [Google's bounce-rate instructions](https://support.google.com/analytics/answer/12195621?hl=en)

## Search visibility and recommendations

Public catalog/category/product pages include descriptive titles, descriptions,
keywords, image alt text, canonical URLs, social metadata, product/offer JSON-LD,
breadcrumbs, `/sitemap.xml` and `/robots.txt`. Private routes and internal search
results are marked noindex. Set `SITE_INDEXING_ENABLED=false` for a private deployment.
Use your real `APP_BASE_URL` before submitting the sitemap to Google Search Console.
Google ignores the meta keywords tag; useful page content and metadata still matter.
[Google's metadata guidance](https://developers.google.com/search/docs/crawling-indexing/special-tags)

Signed-in customers receive item-based collaborative recommendations from paid order
history. Product similarity is the number of shared buyers divided by the square
root of each product's buyer counts; candidate scores sum those similarities across
the customer's purchased items. Repeat purchases count once per customer/product.
Guests and unpaid orders do not contribute. Bought, unavailable, deleted and
currently viewed products are excluded. Sparse histories show clearly labeled
discovery suggestions. Customer identities and scores are never shown.

The current engine computes similarities per request for a small catalog. Larger
deployments should precompute and refresh these similarities. Recommendations do
not guarantee bike compatibility; customers should check the product details.

## Database and public deployment

Local mode starts a loopback-only WiredTiger MongoDB replica set through
[mongodb-memory-server](https://typegoose.github.io/mongodb-memory-server/docs/guides/quick-start-guide/)
with a persistent disk directory. Change `LOCAL_MONGO_PORT` if its default 27018
conflicts with another service. The application updates its own single-member
replica-set address when that local port changes.

For a shared database, configure:

```dotenv
DB_MODE=external
MONGO_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER/motoparts_nepal?retryWrites=true&w=majority
```

Use your actual Atlas connection string and allow the application's IP in Atlas.
A replica set/Atlas cluster is required for transactions. Standalone MongoDB is
unsupported. External mode never auto-seeds. `npm run seed` populates an empty
catalog; `npm run seed -- --replace` explicitly replaces products and should be
used only on disposable data. In local mode, manual seed commands require the app
to be running.

For public deployment, use external MongoDB, `NODE_ENV=production`, a strong
`SESSION_SECRET`, live payment configuration and a public HTTPS `APP_BASE_URL`.
Enable `TRUST_PROXY=1` only behind one trusted reverse proxy. Production rejects the
managed local database and the card test route. Administrator roles are granted
through the database operator command, never public registration.

## Troubleshooting and verification

- Connection refused: start the app and wait for the printed website URL.
- Port occupied: stop the other instance, or change `PORT`/`APP_BASE_URL` together.
- Database startup waits: the first binary download needs internet. Read the terminal
  error; allow downloads and execution through applicable Windows security settings.
- Local database already running: stop the previous server before starting another.
  Do not delete the data directory to solve a lock error.
- eSewa not available: check all gateway variables, mode and current eSewa UAT settings.
- Certificate not trusted: rerun `npm run https:setup`, accept the trust prompt and
  restart your browser.

```powershell
npm test
npm audit --omit=dev
```

Tests use isolated temporary databases and stub external payments/messages. They
cover transactions, ownership, CSRF, analytics, SEO, recommendations, setup,
persistent restarts, cash-on-delivery checkout and HTTPS configuration. GitHub Actions
runs the setup command and regression suite on Windows and Linux. The Windows job
also launches the app through start.cmd and verifies the homepage responds.

## Administrator dashboard (Windows)

1. Run `setup.cmd` once, then `start.cmd`. Setup preserves an existing external
   MongoDB configuration; fresh installations use the managed local database.
2. Register your own account at `http://localhost:3000/auth/register`.
3. Keep the website terminal running. Open a second PowerShell window in the repository:
   ```powershell
   npm run admin:grant -- your-registered-email@example.com
   ```
4. Log in and open [the admin dashboard](http://localhost:3000/admin). If already
   signed in, refresh the page. For local HTTPS, use `https://localhost:3443/admin`
   after following the Windows HTTPS instructions above.
5. To remove access:
   ```powershell
   npm run admin:grant -- your-registered-email@example.com --revoke
   ```

The overview shows registered users, active products, total orders, new customers,
paid order value, average order value, payment environment breakdown, daily sales,
best-selling products, low stock, and consent-based traffic/impression/click counts.
Sandbox totals are identified separately. Older orders without an environment
are reported as unknown. Traffic documents expire after 30 days, even when selecting
a longer sales period. GA4 bounce and engagement metrics remain in your GA4 property.

Products can be added, edited, archived and restored. Stock and price edits reject
outdated forms to avoid overwriting inventory changed by checkout. Use the image
paths already stored in MongoDB, or public HTTPS image URLs. Archived products keep
their order history and disappear from shopping and recommendations.

Orders support partner assignment, dispatch, delivery, paid stock-review resolution,
unpaid cancellation with stock release, and COD collection after delivery. Online
payment orders cannot dispatch before payment confirmation and inventory reservation.
The activity log records administrator changes. Customers cannot access these routes
or grant administrator roles. There is no default administrator password.

### Shipping partner email and WhatsApp

Add a partner in **Admin → Shipping partners**, including email or an international
WhatsApp number (for example `+9779800000000`). Record the partner's WhatsApp opt-in,
then assign that partner to an order. Open the order, choose a channel, preview the
delivery manifest and recipient, and press **Send**.

Configure the local `.env`, then restart the app:

```dotenv
GMAIL_USER=your-sending-account@gmail.com
GMAIL_APP_PASSWORD=your-google-app-password
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_WHATSAPP_FROM=whatsapp:+your-approved-sender
SHIPPING_WHATSAPP_CONTENT_SID=your-approved-shipping-template-sid
```

Email requires both Gmail values. WhatsApp requires all four Twilio values and a
shipping template with `{{1}}` for the shipment subject and `{{2}}` for the delivery
manifest. Follow [Twilio's official template notification instructions](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
to provision the sender and approved template. For Twilio sandbox testing, partners
must join your sandbox. Use the separate shipping template; the customer confirmation
template is configured independently by `TWILIO_CONTENT_SID`.

A notice is claimed once before provider submission. Duplicate clicks cannot resend
it. If the order or partner changes after preview, create a fresh preview. **Accepted**
means the provider accepted the request, not that delivery was confirmed.
**Unconfirmed** or **Sending** requires checking provider records before creating
another notice; ambiguous failures are not retried automatically. Notice history
and customer delivery details are restricted to administrators. Credentials are
never committed to GitHub.
