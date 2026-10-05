# MotoParts Nepal

An e-commerce site for motorcycle spare parts in Nepal, built as a college
e-commerce lab project. Stack: **Node.js + Express + MongoDB (Mongoose) + EJS**.

## What's implemented, mapped to your lab requirements

### Lab 1 — Dynamic shopping cart
- The cart is stored **server-side**, in `req.session.cart`, and that session
  is itself persisted to MongoDB via `connect-mongo` (see `server.js`). This
  is a real server-side cart, not just JavaScript in the browser.
- Cart logic lives in `middleware/cart.js` (`addItem`, `updateItem`,
  `removeItem`, `clearCart`, `getCartTotals`).
- Routes in `routes/cart.js`:
  - `POST /cart/add/:productId` — add a product (respects stock limits)
  - `POST /cart/update/:productId` — update quantity
  - `POST /cart/remove/:productId` — remove an item
  - `POST /cart/clear` — empty the cart
  - `GET /cart` — view cart with live subtotal/shipping/total
- Stock is checked before adding, and decremented for real once an order is
  successfully paid (see `routes/payment.js` → `finalizeOrder`).

### Lab 2 — Dummy payment gateway (eSewa) + credit card flow
Both are fully **simulated** — clearly labeled as such on-screen — since no
real payment credentials are involved in a lab assignment.

- **eSewa simulation** (`routes/payment.js`, views `esewa-login.ejs` →
  `esewa-otp.ejs` → `payment-status.ejs`): mimics eSewa's real login + OTP
  confirmation flow. Demo OTP is always `123456` so the flow is repeatable
  for a live demo/viva.
- **Credit card flow** (`card-payment.ejs`): a card form with client-side
  formatting (spacing, expiry mask) and server-side validation. A card
  number ending in `0000` is a built-in "declined transaction" demo case;
  anything else that passes basic format checks succeeds.
- Every attempt creates an `Order` document with a `paymentStatus` of
  `pending` → `paid`/`failed`, and a generated transaction ID, so you can
  show the DB record during your demo.

## Project structure
```
motoparts-nepal/
├── server.js              # app entry point, session/middleware wiring
├── config/db.js            # MongoDB connection
├── models/                 # Product.js, Order.js (Mongoose schemas)
├── middleware/cart.js       # server-side cart logic (Lab 1 core)
├── routes/
│   ├── products.js         # home + product detail
│   ├── cart.js              # add/update/remove/clear (Lab 1)
│   ├── checkout.js          # delivery details + order creation
│   └── payment.js           # eSewa + card simulation (Lab 2)
├── views/                   # EJS templates
├── public/css/style.css     # styling
└── seed/seed.js             # sample motorcycle parts for Nepal market
```

## Setup

1. **Install MongoDB** locally, or create a free cluster on
   [MongoDB Atlas](https://www.mongodb.com/atlas) and get a connection string.

2. **Install dependencies** (run this on your own machine):
   ```bash
   cd motoparts-nepal
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # then edit .env and set MONGO_URI to your local or Atlas connection string
   ```

4. **Seed sample products**:
   ```bash
   npm run seed
   ```

5. **Run the app**:
   ```bash
   npm start
   # or, for auto-reload during development:
   npm run dev
   ```

6. Open **http://localhost:3000**

## Demo script for your lab/viva

1. Browse the home page, filter by category (e.g. "Brakes"), open a product.
2. Add 2–3 different parts to the cart, then go to `/cart` and demonstrate:
   - updating quantity of an item
   - removing an item
   - the subtotal/shipping/total recalculating live
3. Go to checkout, fill in delivery details, choose **eSewa**:
   - log in with any ID/password (it's simulated)
   - enter OTP `123456` → payment succeeds → receipt page with a generated
     transaction ID
4. Start a new order and choose **Credit/Debit Card**:
   - use a normal-looking card number → success
   - use a card number ending in `0000` (e.g. `4111 1111 1111 0000`) →
     demonstrates a **declined** transaction, showing your failure-handling path
5. Open MongoDB (Compass or `mongosh`) and show the `orders` collection with
   `paymentStatus: "paid"`/`"failed"` and the `transactionId` field, plus the
   `sessions` collection proving the cart is server-side.

## Notes for your report
- Passwords/OTPs entered in the simulated eSewa flow are **never stored** —
  only the outcome (paid/failed) and a generated transaction ID are saved.
- Card numbers are never stored in full — only the last 4 digits
  (`cardLast4`), which is standard PCI-conscious practice even in production
  systems.
- Shipping is a flat rate (`SHIPPING_FEE` in `middleware/cart.js`) — you can
  extend this into a per-city rate table if you want to go further.
