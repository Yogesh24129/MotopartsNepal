const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const session = require("express-session");

process.env.NODE_ENV = "test";
process.env.PAYMENT_MODE = "sandbox";
process.env.ESEWA_SECRET_KEY = "test-only-secret";
process.env.ESEWA_PRODUCT_CODE = "EPAYTEST";
process.env.ESEWA_GATEWAY_URL = "https://gateway.example.test/form";
process.env.ESEWA_STATUS_URL = "https://gateway.example.test/status";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-only-session-secret";
process.env.MARKETING_ENABLED = "true";
process.env.META_PIXEL_ENABLED = "false";
process.env.META_PIXEL_ID = "";
process.env.GA4_ENABLED = "false";
process.env.GA4_MEASUREMENT_ID = "";
process.env.SITE_INDEXING_ENABLED = "true";
process.env.LAB7_DASHBOARD_ENABLED = "true";
process.env.GMAIL_USER = "";
process.env.GMAIL_APP_PASSWORD = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { createApp } = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const MarketingEvent = require("../models/MarketingEvent");
const ShippingPartner = require("../models/ShippingPartner");
const ShippingNotice = require("../models/ShippingNotice");
const AdminAudit = require("../models/AdminAudit");
const adminService = require("../services/admin");
const shippingDelivery = require("../services/shipping-notices");
const { generateOrderHash } = require("../utils/hash");
const { finalizeOrder } = require("../services/payments");
const { transfer, completeTopup, getOrCreateWallet } = require("../services/wallets");
const { money } = require("../utils/validation");
const esewa = require("../utils/esewa");
const { seedWallets } = require("../seed/seedWallets");
let replica, app, store;

before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.17" } });
  await mongoose.connect(replica.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  store = new session.MemoryStore();
  app = createApp({ store, logging: false });
});
after(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  store.clear();
});

function token(response) {
  const match = response.text.match(/name="_csrf" value="([a-f0-9]+)"/);
  assert.ok(match, "page provides a CSRF token");
  return match[1];
}
async function account(email = "buyer@example.com") {
  const agent = request.agent(app);
  const page = await agent.get("/auth/register").expect(200);
  await agent.post("/auth/register").type("form").send({ _csrf: token(page), name: "Buyer", email,
    password: "Testing123!", confirmPassword: "Testing123!" }).expect(302);
  const user = await User.findOne({ email });
  assert.ok(user);
  return { agent, user };
}
async function product(stock = 10) {
  return Product.create({ name: "Brake Pad", slug: "brake-pad", brand: "Test", category: "Brakes", price: 100, stock });
}
async function orderFor(user, part, method = "card", quantity = 2) {
  const order = new Order({ user: user._id, items: [{ product: part._id, name: part.name, price: part.price, quantity }],
    customer: { fullName: "Buyer", phone: "9800000000", email: user.email, address: "Street 1", city: "Kathmandu" },
    subtotal: part.price * quantity, shippingFee: 150, total: part.price * quantity + 150, paymentMethod: method });
  order.integrityHash = generateOrderHash(order);
  await order.save();
  return order;
}
async function cardPost(agent, order, cardNumber = "4111111111111111") {
  const page = await agent.get(`/payment/card/${order._id}`).expect(200);
  return agent.post(`/payment/card/${order._id}/process`).type("form").send({ _csrf: token(page),
    cardName: "Buyer", cardNumber, expiry: "12/99", cvv: "123" });
}
function signedPayload(uuid, amount) {
  const payload = { transaction_code: "TEST-REF", status: "COMPLETE", total_amount: amount,
    transaction_uuid: uuid, product_code: "EPAYTEST",
    signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  const message = payload.signed_field_names.split(",").map((field) => `${field}=${payload[field]}`).join(",");
  payload.signature = crypto.createHmac("sha256", process.env.ESEWA_SECRET_KEY).update(message).digest("base64");
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
function gatewayStatus(uuid, amount) {
  return { transaction_uuid: uuid, product_code: "EPAYTEST", total_amount: amount, status: "COMPLETE", ref_id: "TEST-REF" };
}

test("cart update caps stock, rejects fractional quantities, and checkout refreshes prices", async () => {
  const { agent } = await account();
  const part = await product(2);
  let page = await agent.get(`/product/${part.slug}`).expect(200);
  await agent.post(`/cart/add/${part._id}`).type("form").send({ _csrf: token(page), quantity: 1 }).expect(302);
  page = await agent.get("/cart").expect(200);
  const csrf = token(page);
  const response = await agent.post(`/cart/update/${part._id}`).set("Accept", "application/json")
    .send({ _csrf: csrf, quantity: 99 }).expect(200);
  assert.equal(response.body.items[0].quantity, 2);
  await agent.post(`/cart/update/${part._id}`).send({ _csrf: csrf, quantity: "1.5" }).expect(400);
  await Product.updateOne({ _id: part._id }, { price: 125 });
  await agent.post("/checkout").type("form").send({ _csrf: csrf, fullName: "Buyer", phone: "9800000000",
    email: "buyer@example.com", address: "Street 1", city: "Kathmandu", paymentMethod: "card" }).expect(302);
  const order = await Order.findOne();
  assert.equal(order.items[0].price, 125);
  assert.equal(order.total, 400);
  assert.equal(order.integrityHash, generateOrderHash(order));
});

test("checkout rejects stock that disappeared after cart addition", async () => {
  const { agent } = await account();
  const part = await product(1);
  const page = await agent.get(`/product/${part.slug}`);
  const csrf = token(page);
  for (const form of page.text.matchAll(/<form\b[^>]*method="POST"[^>]*>([\s\S]*?)<\/form>/g)) {
    assert.match(form[1], /name="_csrf"/, "every local POST form includes its token");
  }
  await agent.post(`/cart/add/${part._id}`).send({ _csrf: csrf, quantity: 1 }).expect(302);
  await Product.updateOne({ _id: part._id }, { stock: 0 });
  const response = await agent.post("/checkout").send({ _csrf: csrf });
  assert.equal(response.headers.location, "/cart");
  assert.equal(await Order.countDocuments(), 0);
});

test("order receipts and payment processing require the owner and correct method", async () => {
  const buyer = await account();
  const other = await account("other@example.com");
  const part = await product();
  const order = await orderFor(buyer.user, part, "esewa");
  await other.agent.get(`/payment/status/${order._id}`).expect(404);
  await other.agent.get(`/payment/esewa/${order._id}`).expect(404);
  const page = await buyer.agent.get("/wallet");
  await buyer.agent.post(`/payment/card/${order._id}/process`).send({ _csrf: token(page),
    cardName: "Buyer", cardNumber: "4111111111111111", expiry: "12/99", cvv: "123" }).expect(400);
  assert.equal((await Order.findById(order._id)).paymentStatus, "pending");
});

test("guest receipts stay private and remain accessible after registration", async () => {
  const agent = request.agent(app);
  const stranger = request.agent(app);
  const part = await product();
  const page = await agent.get(`/product/${part.slug}`);
  const csrf = token(page);
  for (const form of page.text.matchAll(/<form\b[^>]*method="POST"[^>]*>([\s\S]*?)<\/form>/g)) {
    assert.match(form[1], /name="_csrf"/, "every local POST form includes its token");
  }
  await agent.post(`/cart/add/${part._id}`).send({ _csrf: csrf, quantity: 1 }).expect(302);
  const response = await agent.post("/checkout").send({ _csrf: csrf, fullName: "Guest", phone: "9800000000",
    email: "guest@example.com", address: "Street 1", city: "Kathmandu", paymentMethod: "card" }).expect(302);
  const order = await Order.findOne();
  assert.ok(order.guestOwner);
  await agent.get(response.headers.location).expect(200);
  await stranger.get(`/payment/status/${order._id}`).expect(404);
  await agent.post("/auth/register").send({ _csrf: csrf, name: "Guest", email: "guest@example.com",
    password: "Testing123!", confirmPassword: "Testing123!" }).expect(302);
  await agent.get(`/payment/status/${order._id}`).expect(200);
});

test("card failures can be retried and paid orders cannot be processed twice", async () => {
  const { agent, user } = await account();
  const part = await product();
  const order = await orderFor(user, part);
  await cardPost(agent, order, "4111111111110000");
  assert.equal((await Order.findById(order._id)).paymentStatus, "failed");
  const retry = await agent.get(`/payment/card/${order._id}`).expect(200);
  const data = { _csrf: token(retry), cardName: "Buyer", cardNumber: "4111111111111111", expiry: "12/99", cvv: "123" };
  const results = await Promise.all([agent.post(`/payment/card/${order._id}/process`).send(data),
    agent.post(`/payment/card/${order._id}/process`).send(data)]);
  assert.ok(results.every((result) => result.status === 302));
  assert.equal((await Product.findById(part._id)).stock, 8);
  assert.equal((await Order.findById(order._id)).paymentStatus, "paid");
  await agent.get(`/payment/esewa/failure/${order._id}`).expect(400);
  assert.equal((await Order.findById(order._id)).paymentStatus, "paid");
});

test("simultaneous paid orders cannot drive stock negative", async () => {
  const { user } = await account();
  const part = await product(2);
  const a = await orderFor(user, part), b = await orderFor(user, part);
  await Promise.all([finalizeOrder(a._id, "paid", "A", { method: "card" }), finalizeOrder(b._id, "paid", "B", { method: "card" })]);
  assert.equal((await Product.findById(part._id)).stock, 0);
  const orders = await Order.find();
  assert.equal(orders.filter((order) => order.fulfillmentStatus === "allocated").length, 1);
  assert.equal(orders.filter((order) => order.fulfillmentStatus === "stock_review").length, 1);
  assert.ok(orders.every((order) => order.paymentStatus === "paid"));
});

test("tampered order totals are rejected before payment or stock changes", async () => {
  const { user } = await account();
  const part = await product();
  const order = await orderFor(user, part);
  await Order.updateOne({ _id: order._id }, { total: 1 });
  await assert.rejects(finalizeOrder(order._id, "paid", "CARD", { method: "card" }), /Order details changed/);
  assert.equal((await Product.findById(part._id)).stock, 10);
  assert.equal((await Order.findById(order._id)).paymentStatus, "pending");
});

test("signed eSewa callbacks reconcile delayed attempts exactly once; failure redirects preserve paid state", async () => {
  const { agent, user } = await account();
  const part = await product();
  const order = await orderFor(user, part, "esewa");
  await agent.get(`/payment/esewa/${order._id}`).expect(200);
  const first = (await Order.findById(order._id)).esewaTransactionUuid;
  await agent.get(`/payment/esewa/${order._id}`).expect(200);
  assert.notEqual((await Order.findById(order._id)).esewaTransactionUuid, first);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => gatewayStatus(first, order.total) });
  try {
    const data = signedPayload(first, order.total);
    await request(app).get("/payment/esewa/callback").query({ data }).expect(302);
    await request(app).get("/payment/esewa/callback").query({ data }).expect(302);
    await agent.get(`/payment/esewa/failure/${order._id}`).expect(302);
    assert.equal((await Order.findById(order._id)).paymentStatus, "paid");
    assert.equal((await Product.findById(part._id)).stock, 8);
  } finally { global.fetch = originalFetch; }
});

test("invalid gateway signatures, amount mismatches, and malformed callbacks cannot pay an order", async () => {
  const { user } = await account();
  const part = await product();
  const order = await orderFor(user, part, "esewa");
  order.esewaTransactionUuid = "known-attempt";
  await order.save();
  await request(app).get("/payment/esewa/callback").query({ data: "garbage" }).expect(400);
  const payload = JSON.parse(Buffer.from(signedPayload("known-attempt", order.total), "base64"));
  payload.total_amount = 1;
  await request(app).get("/payment/esewa/callback").query({ data: Buffer.from(JSON.stringify(payload)).toString("base64") }).expect(400);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => gatewayStatus("known-attempt", 1) });
  try {
    await request(app).get("/payment/esewa/callback").query({ data: signedPayload("known-attempt", order.total) }).expect(400);
    assert.equal((await Order.findById(order._id)).paymentStatus, "pending");
  } finally { global.fetch = originalFetch; }
  const incomplete = { signed_field_names: "product_code", product_code: "EPAYTEST", signature: "fake" };
  assert.equal(esewa.verifySignature(incomplete), false);
});

test("simultaneous top-up confirmations credit once and preserve completed ledger state", async () => {
  const { user } = await account();
  const wallet = await getOrCreateWallet(user._id);
  const txn = await Transaction.create({ type: "topup", status: "pending", toWallet: wallet._id,
    amount: 25.25, esewaTransactionUuid: "topup-attempt" });
  const results = await Promise.all([completeTopup("topup-attempt", "REF"), completeTopup("topup-attempt", "REF")]);
  assert.equal(results.filter((result) => result.changed).length, 1);
  assert.equal((await Wallet.findById(wallet._id)).balance, 25.25);
  assert.equal((await Transaction.findById(txn._id)).status, "completed");
});

test("wallet callbacks work without a login session and repeated callbacks remain completed", async () => {
  const { user } = await account();
  const wallet = await getOrCreateWallet(user._id);
  const txn = await Transaction.create({ type: "topup", status: "pending", toWallet: wallet._id,
    amount: 30, esewaTransactionUuid: "topup-callback" });
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => gatewayStatus("topup-callback", 30) });
  try {
    for (let i = 0; i < 2; i++) await request(app).get("/wallet/topup/esewa/callback")
      .query({ data: signedPayload("topup-callback", 30) }).expect(302);
    assert.equal((await Wallet.findById(wallet._id)).balance, 30);
    assert.equal((await Transaction.findById(txn._id)).status, "completed");
  } finally { global.fetch = originalFetch; }
});

test("concurrent wallet transfers cannot spend the same balance twice", async () => {
  const a = await account(), b = await account("recipient@example.com");
  const sender = await getOrCreateWallet(a.user._id), recipient = await getOrCreateWallet(b.user._id);
  await Wallet.updateOne({ _id: sender._id }, { balance: 100 });
  const results = await Promise.allSettled([transfer(a.user._id, recipient._id, 80), transfer(a.user._id, recipient._id, 80)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await Wallet.findById(sender._id)).balance, 20);
  assert.equal((await Wallet.findById(recipient._id)).balance, 80);
  assert.equal(await Transaction.countDocuments({ type: "transfer" }), 1);
});

test("failed ledger insert rolls back both wallet balances", async () => {
  const a = await account(), b = await account("recipient@example.com");
  const sender = await getOrCreateWallet(a.user._id), recipient = await getOrCreateWallet(b.user._id);
  await Wallet.updateOne({ _id: sender._id }, { balance: 100 });
  const originalCreate = Transaction.create;
  Transaction.create = async () => { throw new Error("Injected ledger failure"); };
  try { await assert.rejects(transfer(a.user._id, recipient._id, 40), /Injected ledger failure/); }
  finally { Transaction.create = originalCreate; }
  assert.equal((await Wallet.findById(sender._id)).balance, 100);
  assert.equal((await Wallet.findById(recipient._id)).balance, 0);
});

test("direct top-up route is removed; cancellation cannot access another user's transaction", async () => {
  const a = await account(), b = await account("other@example.com");
  const wallet = await getOrCreateWallet(a.user._id);
  const txn = await Transaction.create({ type: "topup", toWallet: wallet._id, amount: 10, status: "completed" });
  const page = await a.agent.get("/wallet");
  await a.agent.post("/wallet/topup").send({ _csrf: token(page), amount: 100000 }).expect(404);
  await b.agent.get(`/wallet/topup/esewa/failure/${txn._id}`).expect(404);
  await a.agent.get(`/wallet/topup/esewa/failure/${txn._id}`).expect(302);
  assert.equal((await Transaction.findById(txn._id)).status, "completed");
  assert.equal((await Wallet.findById(wallet._id)).balance, 0);
});

test("CSRF protects form actions and login rotates the session", async () => {
  const agent = request.agent(app);
  const page = await agent.get("/auth/register");
  const initialCookie = page.headers["set-cookie"][0].split(";")[0];
  await agent.post("/auth/register").send({ name: "Buyer", email: "buyer@example.com", password: "Testing123!" }).expect(403);
  await agent.post("/auth/register").send({ _csrf: "é".repeat(64) }).expect(403);
  const response = await agent.post("/auth/register").send({ _csrf: token(page), name: "Buyer",
    email: "buyer@example.com", password: "Testing123!", confirmPassword: "Testing123!" }).expect(302);
  assert.notEqual(response.headers["set-cookie"][0].split(";")[0], initialCookie);
  const walletPage = await agent.get("/wallet");
  await agent.post("/auth/logout").send({ _csrf: token(walletPage) }).expect(302);
  const loggedOut = await agent.get("/wallet").expect(302);
  assert.equal(loggedOut.headers.location, "/auth/login");
});

test("money inputs reject non-finite, partially numeric and fractional-cent amounts", () => {
  for (const value of [Infinity, "Infinity", "5junk", "", -1, "1.001", {}, "1000001"]) assert.equal(money(value), null);
  assert.equal(money("25.25"), 25.25);
  assert.equal(money(0.1 + 0.2), 0.3);
});

test("fixture wallet seeding creates users and preserves existing balances on rerun", async () => {
  await seedWallets();
  assert.equal(await User.countDocuments(), 3);
  const wallet = await Wallet.findOne({ email: "rita@example.com" });
  assert.ok(wallet.user);
  await Wallet.updateOne({ _id: wallet._id }, { balance: 42 });
  await seedWallets();
  assert.equal(await Wallet.countDocuments(), 3);
  assert.equal((await Wallet.findById(wallet._id)).balance, 42);
});

test("search treats regular-expression characters as literal text", async () => {
  await product();
  const response = await request(app).get("/").query({ q: "(a+)+$" }).expect(200);
  assert.doesNotMatch(response.text, /href="\/product\/brake-pad"/);
  await request(app).get("/").query({ q: "x".repeat(101) }).expect(400);
});

test("stock-review receipts explain the paid order needs fulfillment assistance", async () => {
  const { agent, user } = await account();
  const part = await product(0);
  const order = await orderFor(user, part);
  await finalizeOrder(order._id, "paid", "PAID", { method: "card" });
  const response = await agent.get(`/payment/status/${order._id}`).expect(200);
  assert.match(response.text, /Payment received/);
  assert.match(response.text, /refund/);
  assert.equal((await Product.findById(part._id)).stock, 0);
});

test("pending gateway verification preserves pending order state", async () => {
  const { user } = await account();
  const part = await product();
  const order = await orderFor(user, part, "esewa");
  order.esewaTransactionUuid = "pending-attempt";
  await order.save();
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ ...gatewayStatus("pending-attempt", order.total), status: "PENDING", ref_id: null }) });
  try {
    await request(app).get("/payment/esewa/callback").query({ data: signedPayload("pending-attempt", order.total) }).expect(302);
    assert.equal((await Order.findById(order._id)).paymentStatus, "pending");
    assert.equal((await Product.findById(part._id)).stock, 10);
  } finally { global.fetch = originalFetch; }
});

async function consent(agent, choice = "granted") {
  const page = await agent.get("/").expect(200);
  await agent.post("/marketing/consent").send({ _csrf: token(page), choice, returnTo: "/" }).expect(303);
  return token(await agent.get("/"));
}
function marketingConfigFrom(response) {
  const match = response.text.match(/<script type="application\/json" id="marketing-config">([\s\S]*?)<\/script>/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

test("Session analytics defaults to local-only measurement and rejects events before consent", async () => {
  const agent = request.agent(app);
  const page = await agent.get("/");
  const config = marketingConfigFrom(page);
  assert.equal(config.pixelId, "");
  assert.equal(config.consent, "unknown");
  await agent.post("/marketing/events").set("x-csrf-token", token(page))
    .send({ events: [{ type: "PageView", page: "catalog", eventId: crypto.randomUUID() }] }).expect(403);
  assert.equal(await MarketingEvent.countDocuments(), 0);
  const dashboard = await agent.get("/marketing/dashboard").expect(200);
  assert.match(dashboard.text, /Local measurement/);
});

test("Session analytics records visible-product and promotion events, deduplicates IDs, and scopes dashboards to the session", async () => {
  const a = request.agent(app), b = request.agent(app);
  const part = await product();
  const csrf = await consent(a);
  const events = [
    { eventId: crypto.randomUUID(), type: "PageView", page: "catalog" },
    { eventId: crypto.randomUUID(), type: "ProductImpression", page: "catalog", targetId: String(part._id) },
    { eventId: crypto.randomUUID(), type: "ProductClick", page: "catalog", targetId: String(part._id) },
    { eventId: crypto.randomUUID(), type: "PromotionImpression", page: "catalog", targetId: "riding-gear" },
    { eventId: crypto.randomUUID(), type: "PromotionClick", page: "catalog", targetId: "riding-gear" },
  ];
  await Promise.all([a.post("/marketing/events").set("x-csrf-token", csrf).send({ events }).expect(204),
    a.post("/marketing/events").set("x-csrf-token", csrf).send({ events }).expect(204)]);
  assert.equal(await MarketingEvent.countDocuments(), 5);
  const { dashboard } = require("../services/marketing");
  const visitor = (await MarketingEvent.findOne()).visitor;
  const metrics = await dashboard(visitor);
  assert.equal(metrics.impressions, 2);
  assert.equal(metrics.clicks, 2);
  assert.equal(metrics.ctr, 100);
  await consent(b);
  const otherDashboard = await b.get("/marketing/dashboard").expect(200);
  assert.match(otherDashboard.text, /No events yet/);
  assert.doesNotMatch(otherDashboard.text, new RegExp(String(part._id)));
});

test("Session analytics rejects browser-forged purchases and unknown or oversized event batches", async () => {
  const agent = request.agent(app), csrf = await consent(agent);
  for (const event of [
    { eventId: crypto.randomUUID(), type: "Purchase", page: "receipt", value: 9999 },
    { eventId: crypto.randomUUID(), type: "ProductClick", page: "catalog", targetId: "not-a-product" },
    { eventId: crypto.randomUUID(), type: "PromotionClick", page: "catalog", targetId: "unknown" },
  ]) await agent.post("/marketing/events").set("x-csrf-token", csrf).send({ events: [event] }).expect(400);
  await agent.post("/marketing/events").set("x-csrf-token", csrf).send({ events: Array.from({ length: 26 }, () =>
    ({ eventId: crypto.randomUUID(), type: "PageView", page: "catalog" })) }).expect(400);
  assert.equal(await MarketingEvent.countDocuments(), 0);
});

test("Session analytics counts paid purchases once across retries and receipt reloads, using server amounts", async () => {
  const agent = request.agent(app);
  const part = await product();
  const csrf = await consent(agent);
  await agent.post("/marketing/events").set("x-csrf-token", csrf).send({ events: [
    { eventId: crypto.randomUUID(), type: "InitiateCheckout", page: "checkout" },
  ] }).expect(204);
  await agent.post(`/cart/add/${part._id}`).send({ _csrf: csrf, quantity: 2 }).expect(302);
  await agent.post("/checkout").send({ _csrf: csrf, fullName: "Private Buyer", phone: "9800000000",
    email: "private@example.com", address: "Private Street", city: "Kathmandu", paymentMethod: "card" }).expect(302);
  const order = await Order.findOne();
  assert.ok(order.marketingVisitor);
  await cardPost(agent, order, "4111111111110000");
  const { dashboard } = require("../services/marketing");
  assert.equal((await dashboard(order.marketingVisitor)).conversions, 0);
  await cardPost(agent, order);
  const paid = await Order.findById(order._id);
  const paidAt = paid.paidAt.getTime();
  await finalizeOrder(order._id, "paid", "REPLAY", { method: "card" });
  assert.equal((await Order.findById(order._id)).paidAt.getTime(), paidAt);
  for (let i = 0; i < 2; i++) {
    const page = await agent.get(`/payment/status/${order._id}`).expect(200);
    const config = marketingConfigFrom(page);
    assert.equal(config.purchase.value, 350);
    assert.equal(config.purchase.currency, "NPR");
    const serialized = JSON.stringify(config);
    for (const privateValue of ["Private Buyer", "Private Street", "private@example.com", "9800000000"]) {
      assert.ok(!serialized.includes(privateValue));
    }
  }
  const metrics = await dashboard(order.marketingVisitor);
  assert.equal(metrics.conversions, 1);
  assert.equal(metrics.revenue, 350);
  assert.equal(metrics.conversionRate, 100);
  assert.equal(await MarketingEvent.countDocuments({ type: "Purchase" }), 0);
});

test("withdrawing marketing consent deletes local events and unlinks orders, and blocks future events", async () => {
  const { agent, user } = await account();
  const csrf = await consent(agent);
  await agent.post("/marketing/events").set("x-csrf-token", csrf).send({ events: [
    { eventId: crypto.randomUUID(), type: "PageView", page: "catalog" },
  ] }).expect(204);
  const visitor = (await MarketingEvent.findOne()).visitor;
  const order = await orderFor(user, await product());
  await Order.updateOne({ _id: order._id }, { marketingVisitor: visitor });
  await consent(agent, "denied");
  assert.equal(await MarketingEvent.countDocuments(), 0);
  assert.equal((await Order.findById(order._id)).marketingVisitor, undefined);
  const page = await agent.get("/");
  await agent.post("/marketing/events").set("x-csrf-token", token(page)).send({ events: [
    { eventId: crypto.randomUUID(), type: "PageView", page: "catalog" },
  ] }).expect(403);
  assert.equal(marketingConfigFrom(page).consent, "denied");
});

test("consent survives session rotation at registration without leaking into another session", async () => {
  const agent = request.agent(app);
  const csrf = await consent(agent);
  await agent.post("/auth/register").send({ _csrf: csrf, name: "Buyer", email: "buyer@example.com",
    password: "Testing123!", confirmPassword: "Testing123!" }).expect(302);
  assert.equal(marketingConfigFrom(await agent.get("/")).consent, "granted");
  assert.equal(marketingConfigFrom(await request(app).get("/")).consent, "unknown");
});

test("Session analytics validates Pixel IDs, supports disabling measurement, and prevents consent open redirects", async () => {
  const agent = request.agent(app), csrf = await consent(agent);
  const response = await agent.post("/marketing/consent").send({ _csrf: csrf, choice: "granted",
    returnTo: "//example.com" }).expect(303);
  assert.equal(response.headers.location, "/");
  const { marketingConfig } = require("../services/marketing");
  try {
    process.env.META_PIXEL_ENABLED = "true";
    process.env.META_PIXEL_ID = "<script>";
    assert.throws(marketingConfig, /numeric Pixel ID/);
    process.env.META_PIXEL_ID = "123456789012345";
    assert.equal(marketingConfig().pixelId, "123456789012345");
    process.env.MARKETING_ENABLED = "false";
    assert.equal(marketingConfig().pixelId, "");
    await agent.post("/marketing/events").set("x-csrf-token", csrf).send({ events: [
      { eventId: crypto.randomUUID(), type: "PageView", page: "catalog" },
    ] }).expect(403);
    await agent.get("/marketing/dashboard").expect(404);
  } finally {
    process.env.META_PIXEL_ENABLED = "false";
    process.env.META_PIXEL_ID = "";
process.env.GA4_ENABLED = "false";
process.env.GA4_MEASUREMENT_ID = "";
process.env.SITE_INDEXING_ENABLED = "true";
    process.env.MARKETING_ENABLED = "true";
  }
});

test("Session analytics purchase journey wires rendered browser events through to paid-order dashboard metrics", async (t) => {
  const { JSDOM } = require("jsdom");
  const fs = require("node:fs"), path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../public/js/marketing.js"), "utf8");
  const agent = request.agent(app), part = await product();
  const csrf = await consent(agent);
  async function visit(page, interact = () => {}) {
    const dom = new JSDOM(page.text, { url: "http://localhost:3000/", runScripts: "outside-only", pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const pending = [];
    let observer;
    dom.window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {} unobserve() {} disconnect() {}
    };
    dom.window.fetch = (url, options) => {
      const result = agent.post(url).set(options.headers).send(JSON.parse(options.body)).then((response) => {
        assert.equal(response.status, 204);
        return { status: response.status, ok: true };
      });
      pending.push(result);
      return result;
    };
    dom.window.document.addEventListener("click", (event) => event.preventDefault());
    dom.window.eval(source);
    interact(dom.window, observer);
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    await Promise.all(pending);
  }
  await visit(await agent.get("/"), (window, observer) => {
    for (const target of window.document.querySelectorAll("[data-marketing-impression]")) {
      observer.callback([{ target, isIntersecting: true, intersectionRatio: 0.75 }]);
    }
    window.document.querySelector('[data-marketing-click="ProductClick"]').dispatchEvent(new window.MouseEvent("click", {
      bubbles: true, cancelable: true, button: 0,
    }));
  });
  await visit(await agent.get(`/product/${part.slug}`));
  await agent.post(`/cart/add/${part._id}`).send({ _csrf: csrf, quantity: 1 }).expect(302);
  await visit(await agent.get("/checkout"));
  await agent.post("/checkout").send({ _csrf: csrf, fullName: "Demo Buyer", phone: "9800000000", email: "demo@example.com",
    address: "Demo Street", city: "Kathmandu", paymentMethod: "card" }).expect(302);
  const order = await Order.findOne();
  await cardPost(agent, order);
  await visit(await agent.get(`/payment/status/${order._id}`));
  const { dashboard } = require("../services/marketing");
  const metrics = await dashboard(order.marketingVisitor);
  assert.equal(metrics.impressions, 2);
  assert.equal(metrics.clicks, 1);
  assert.equal(metrics.conversions, 1);
  assert.equal(metrics.revenue, 250);
  assert.equal(metrics.counts.PageView, 4);
  assert.equal(metrics.counts.ViewContent, 1);
  assert.equal(metrics.counts.InitiateCheckout, 1);
  assert.equal(metrics.ctr, 50);
  await agent.get("/marketing/dashboard").expect(200);
});

test("SEO renders trusted canonicals, public product schema and descriptive alt text", async () => {
  const part = await product();
  const home = await request(app).get("/").set("Host", "evil.example").expect(200);
  const { JSDOM } = require("jsdom");
  const document = new JSDOM(home.text).window.document;
  assert.equal(document.querySelector('link[rel="canonical"]').href, "http://localhost:3000/");
  assert.match(document.title, /Motorcycle Spare Parts in Nepal/);
  assert.equal(home.headers["x-robots-tag"], "index,follow");
  const page = await request(app).get(`/product/${part.slug}`).expect(200);
  const productDocument = new JSDOM(page.text).window.document;
  const schema = JSON.parse(productDocument.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(schema[0].offers.price, "100.00");
  assert.equal(schema[0].offers.availability, "https://schema.org/InStock");
  assert.equal(productDocument.querySelector('meta[property="og:image:alt"]').content, "Brake Pad by Test");
  assert.match(page.text, /alt="Brake Pad by Test"/);
  const category = await request(app).get("/?category=Brakes").expect(200);
  assert.match(category.text, /http:\/\/localhost:3000\/\?category=Brakes/);
});

test("search and private pages are excluded while sitemap lists only public URLs", async () => {
  await product();
  const search = await request(app).get("/?q=private-search").expect(200);
  assert.equal(search.headers["x-robots-tag"], "noindex,follow");
  const login = await request(app).get("/auth/login").expect(200);
  assert.match(login.headers["x-robots-tag"], /noindex/);
  assert.ok(!login.text.includes('type="application/ld+json"'));
  const sitemap = await request(app).get("/sitemap.xml").expect(200);
  const { JSDOM } = require("jsdom");
  const xml = new JSDOM(sitemap.text, { contentType: "application/xml" }).window.document;
  const locations = Array.from(xml.querySelectorAll("loc"), (node) => node.textContent);
  assert.deepEqual(locations, ["http://localhost:3000/", "http://localhost:3000/?category=Brakes", "http://localhost:3000/product/brake-pad"]);
  const robots = await request(app).get("/robots.txt").expect(200);
  assert.match(robots.text, /Sitemap: http:\/\/localhost:3000\/sitemap.xml/);
  process.env.SITE_INDEXING_ENABLED = "false";
  try {
    assert.equal((await request(app).get("/")).headers["x-robots-tag"], "noindex,follow");
    assert.ok(!(await request(app).get("/sitemap.xml")).text.includes("<url>"));
  } finally { process.env.SITE_INDEXING_ENABLED = "true"; }
});

test("SEO JSON safely escapes script terminators and analytics configuration validates IDs", () => {
  const { serializeJsonLd, gaPage, siteConfig } = require("../services/seo");
  const { marketingConfig } = require("../services/marketing");
  const data = { name: '</script><script>alert(1)</script>' };
  assert.ok(!serializeJsonLd(data).includes("<"));
  assert.deepEqual(JSON.parse(serializeJsonLd(data)), data);
  assert.equal(gaPage("receipt").location, "http://localhost:3000/purchase-complete");
  process.env.GA4_ENABLED = "true";
  try {
    assert.throws(marketingConfig, /Measurement ID/);
    process.env.GA4_MEASUREMENT_ID = "G-TEST123456";
    assert.equal(marketingConfig().gaId, "G-TEST123456");
    process.env.APP_BASE_URL = "https://example.com/private";
    assert.throws(siteConfig, /origin/);
  } finally {
    process.env.GA4_ENABLED = "false";
    process.env.GA4_MEASUREMENT_ID = "";
    process.env.APP_BASE_URL = "http://localhost:3000";
  }
});

test("Recommendations collaborative filtering ranks shared purchases and excludes unavailable or owned parts", async () => {
  const { recommendations, rankCandidates } = require("../services/recommendations");
  const { agent, user } = await account();
  const seed = await product();
  async function part(slug, stock = 10) {
    return Product.create({ name: slug, slug, brand: "Test", category: "Brakes", price: 100, stock });
  }
  const strong = await part("strong-match"), weak = await part("weak-match"), unrelated = await part("unrelated");
  const unavailable = await part("sold-out", 0), deleted = await part("deleted");
  const neighbor = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
  async function paid(buyer, parts, status = "paid") {
    return Order.create({ user: buyer, items: parts.map((p) => ({ product: p._id, name: p.name, quantity: 1, price: p.price })),
      customer: { fullName: "Private buyer", phone: "9800000000", address: "Private street", city: "Kathmandu" },
      subtotal: 100, total: 100, shippingFee: 0, paymentMethod: "card", paymentStatus: status });
  }
  await paid(user._id, [seed]);
  await paid(neighbor, [seed, strong, weak, unavailable, deleted]);
  await paid(neighbor, [seed, strong]); // Repeated purchases count as one interaction.
  await paid(other, [weak, unrelated]);
  await paid(user._id, [unrelated], "failed");
  await paid(new mongoose.Types.ObjectId(), [seed, unrelated], "pending");
  await paid(undefined, [seed, unrelated]); // Guests are not treated as one shared user.
  await Product.deleteOne({ _id: deleted._id });
  const result = await recommendations(user._id);
  assert.equal(result.mode, "collaborative");
  assert.deepEqual(result.products.map((p) => p.slug), ["strong-match", "weak-match"]);
  assert.ok(result.products.every((p) => !('customer' in p) && !('score' in p)));
  const excluded = await recommendations(user._id, { excludeId: strong._id });
  assert.deepEqual(excluded.products.map((p) => p.slug), ["weak-match"]);
  const page = await agent.get("/").expect(200);
  const { JSDOM } = require("jsdom");
  const section = new JSDOM(page.text).window.document.querySelector(".recommendations");
  assert.match(section.textContent, /Recommended for you/);
  assert.equal(section.querySelectorAll("article").length, 2);
  assert.ok(!section.textContent.includes("Private street"));
  const detail = await agent.get("/product/strong-match").expect(200);
  const detailSection = new JSDOM(detail.text).window.document.querySelector(".recommendations");
  assert.ok(!detailSection.querySelector('a[href="/product/strong-match"]'));
  const scores = rankCandidates([{ _id: "a", products: ["x", "y", "y"] }, { _id: "b", products: ["x"] }], new Set(["x"]));
  assert.equal(scores.get("y"), 1 / Math.sqrt(2));
});

test("Recommendations cold start is labeled discovery and guests receive no personal recommendations", async () => {
  const { recommendations } = require("../services/recommendations");
  const { agent, user } = await account();
  const seed = await product();
  const cold = await recommendations(user._id);
  assert.equal(cold.mode, "discovery");
  assert.equal(cold.products.length, 1);
  assert.deepEqual(await recommendations(null), { mode: "hidden", products: [] });
  const { JSDOM } = require("jsdom");
  const guest = await request(app).get("/").expect(200);
  assert.equal(new JSDOM(guest.text).window.document.querySelector(".recommendations"), null);
  const page = await agent.get("/").expect(200);
  assert.match(new JSDOM(page.text).window.document.querySelector(".recommendations").textContent, /Discover more parts/);
  const order = await orderFor(user, seed);
  order.paymentStatus = "paid";
  await order.save();
  assert.deepEqual((await recommendations(user._id)).products, []);
});

test("cash on delivery reserves stock and confirms the order without counting a paid conversion", async () => {
  const { agent, user } = await account();
  const part = await product(2);
  const home = await agent.get("/").expect(200);
  await agent.post("/cart/add/" + part._id).type("form").send({ _csrf: token(home), quantity: 2 }).expect(302);
  const checkout = await agent.get("/checkout").expect(200);
  const result = await agent.post("/checkout").type("form").send({ _csrf: token(checkout),
    fullName: "Buyer", phone: "9800000000", email: "buyer@example.com", address: "Street 1", city: "Kathmandu",
    paymentMethod: "cod" }).expect(302);
  const order = await Order.findOne({ user: user._id });
  assert.equal(order.paymentStatus, "pending");
  assert.equal(order.fulfillmentStatus, "allocated");
  assert.equal((await Product.findById(part._id)).stock, 0);
  const receipt = await agent.get(result.headers.location).expect(200);
  assert.match(receipt.text, /Order confirmed/);
  assert.ok(!receipt.text.includes("Retry Payment"));
  assert.ok(!receipt.text.includes("Order hash (SHA-256)"));
  assert.equal(marketingConfigFrom(receipt).purchase, null);
  assert.equal((await agent.get("/cart")).text.includes("Your cart is empty"), true);
  // Later recording of a collected COD payment must not deduct the reserved stock again.
  await finalizeOrder(order._id, "paid", "COLLECTED", { method: "cod" });
  assert.equal((await Product.findById(part._id)).stock, 0);
});

test("concurrent cash-on-delivery orders allocate the last item once", async () => {
  const first = await account("one@example.com"), second = await account("two@example.com");
  const part = await product(1);
  const payloads = [];
  for (const { agent } of [first, second]) {
    const home = await agent.get("/");
    await agent.post("/cart/add/" + part._id).type("form").send({ _csrf: token(home), quantity: 1 });
    const checkout = await agent.get("/checkout");
    payloads.push({ _csrf: token(checkout), fullName: "Buyer", phone: "9800000000", email: "buyer@example.com",
      address: "Street 1", city: "Kathmandu", paymentMethod: "cod" });
  }
  await Promise.all([first.agent.post("/checkout").type("form").send(payloads[0]),
    second.agent.post("/checkout").type("form").send(payloads[1])]);
  assert.equal(await Order.countDocuments({ paymentMethod: "cod" }), 1);
  assert.equal((await Product.findById(part._id)).stock, 0);
});

test("live mode blocks simulated card processing and renders normal store wording", async () => {
  const { agent, user } = await account();
  const part = await product();
  const order = await orderFor(user, part);
  const mode = process.env.PAYMENT_MODE;
  try {
    process.env.PAYMENT_MODE = "live";
    await agent.get("/payment/card/" + order._id).expect(404);
    const home = await agent.get("/");
    await agent.post("/cart/add/" + part._id).type("form").send({ _csrf: token(home), quantity: 1 });
    const checkout = await agent.get("/checkout").expect(200);
    assert.ok(!checkout.text.includes('value="card"'));
    const result = await agent.post("/checkout").type("form").send({ _csrf: token(checkout), fullName: "Buyer",
      phone: "9800000000", email: "buyer@example.com", address: "Street 1", city: "Kathmandu", paymentMethod: "card" });
    assert.equal(result.status, 302);
    assert.equal(await Order.countDocuments(), 1);
    const dashboard = await agent.get("/marketing/dashboard").expect(200);
    assert.ok(!/Lab\s+\d|College|local demo|dummy card/i.test(home.text + dashboard.text));
    assert.match(home.text, /Session analytics/);
  } finally { process.env.PAYMENT_MODE = mode; }
});


async function administrator() {
  const result = await account("admin@example.com");
  await User.updateOne({ _id: result.user._id }, { $set: { role: "admin" } });
  return result;
}
test("admin access uses the current database role and never accepts public role escalation", async () => {
  await request(app).get("/admin").expect(302);
  const { agent, user } = await account();
  await agent.get("/admin").expect(403);
  await User.updateOne({ _id: user._id }, { $set: { role: "admin" } });
  const page = await agent.get("/admin").expect(200);
  assert.match(page.text, /STORE PERFORMANCE/);
  assert.match(page.headers["cache-control"], /no-store/);
  assert.match(page.text, /noindex,nofollow/);
  await User.updateOne({ _id: user._id }, { $set: { role: "customer" } });
  await agent.get("/admin/products").expect(403);
  const other = request.agent(app), registration = await other.get("/auth/register");
  await other.post("/auth/register").type("form").send({ _csrf: token(registration), name: "Other", email: "other@example.com", password: "Testing123!", confirmPassword: "Testing123!", role: "admin" }).expect(302);
  assert.equal((await User.findOne({ email: "other@example.com" })).role, "customer");
});
test("admin pages render and protect product edits against stale stock and archive from shopping", async () => {
  const { agent } = await administrator(), part = await product();
  for (const path of ["/admin", "/admin/products", "/admin/products/new", "/admin/users", "/admin/orders", "/admin/partners", "/admin/activity"]) await agent.get(path).expect(200);
  const page = await agent.get("/admin/products/" + part._id).expect(200);
  const fields = { _csrf: token(page), version: part.updatedAt.toISOString(), name: "Updated brake", slug: "brake-pad", brand: "Test", category: "Brakes", price: "125", stock: "8", image: "/images/products/brakes.jpg", description: "Replacement", compatibleModels: "TVS Sport, Apache" };
  await Product.updateOne({ _id: part._id }, { $inc: { stock: -1 } });
  await agent.post("/admin/products/" + part._id).type("form").send(fields).expect(409);
  assert.equal((await Product.findById(part._id)).stock, 9);
  fields.version = (await Product.findById(part._id)).updatedAt.toISOString();
  await agent.post("/admin/products/" + part._id).type("form").send(fields).expect(302);
  const updated = await Product.findById(part._id);
  assert.equal(updated.price, 125);
  await agent.post("/admin/products/" + part._id + "/archive").type("form").send({ _csrf: token(page), version: updated.updatedAt.toISOString(), active: "false" }).expect(302);
  await request(app).get("/product/" + part.slug).expect(404);
  const home = await request(app).get("/");
  assert.doesNotMatch(home.text, /Updated brake/);
  assert.ok(await AdminAudit.countDocuments({ action: "product_updated" }));
});
test("admin validation rejects unsafe images, invalid stock and unsupported category", () => {
  const fields = { name:"Part", slug:"part", brand:"Test", category:"Brakes", price:"100", stock:"2", image:"/images/products/a.jpg" };
  assert.equal(adminService.productFields(fields).stock, 2);
  for (const invalid of [{ image:"javascript:alert(1)" }, { stock:"1.5" }, { category:"Unknown" }, { slug:"../admin" }]) assert.throws(() => adminService.productFields({ ...fields, ...invalid }));
});
test("COD cancellation restores inventory once and prevents subsequent payment", async () => {
  const { agent, user } = await administrator(), part = await product(8), order = await orderFor(user, part, "cod");
  order.fulfillmentStatus = "allocated"; await order.save();
  const page = await agent.get("/admin/orders/" + order._id).expect(200);
  const body = { _csrf: token(page), action:"cancel", version:order.updatedAt.toISOString() };
  await agent.post("/admin/orders/" + order._id).type("form").send(body).expect(302);
  assert.equal((await Product.findById(part._id)).stock,10);
  await agent.post("/admin/orders/" + order._id).type("form").send(body).expect(409);
  assert.equal((await Product.findById(part._id)).stock,10);
  await assert.rejects(finalizeOrder(order._id, "paid", "late"), /cancelled/);
});
test("dispatch validates reservation and COD collection preserves reserved stock", async () => {
  const { agent, user } = await administrator(), part = await product(8), order = await orderFor(user, part, "cod");
  const partner = await ShippingPartner.create({ name:"Courier", email:"courier@example.com" });
  await assert.rejects(adminService.updateOrder(order._id, { version:order.updatedAt.toISOString(), partner:String(partner._id), status:"dispatched" }, user._id), /reserved stock/);
  order.fulfillmentStatus="allocated"; await order.save();
  await adminService.updateOrder(order._id, { version:order.updatedAt.toISOString(), partner:String(partner._id), status:"dispatched" }, user._id);
  let current = await Order.findById(order._id);
  await assert.rejects(adminService.updateOrder(order._id, { version:current.updatedAt.toISOString(), action:"paid" }, user._id), /after delivery/);
  await adminService.updateOrder(order._id, { version:current.updatedAt.toISOString(), status:"delivered" }, user._id);
  current = await Order.findById(order._id);
  await adminService.updateOrder(order._id, { version:current.updatedAt.toISOString(), action:"paid" }, user._id);
  assert.equal((await Order.findById(order._id)).paymentStatus,"paid");
  assert.equal((await Product.findById(part._id)).stock,8);
});
test("admin metrics aggregate all customers and separate sandbox payment value", async () => {
  const { user } = await administrator(), part = await product(), order = await orderFor(user, part);
  order.paymentStatus="paid"; order.paidAt=new Date(); order.paymentEnvironment="sandbox"; await order.save();
  await account("second@example.com");
  await MarketingEvent.create({ visitor:"consenting-one", eventId:"admin-metric-one", type:"PageView", page:"catalog" });
  const stats=await adminService.metrics(30);
  assert.equal(stats.users,2); assert.equal(stats.products,1); assert.equal(stats.visitors,1); assert.equal(stats.events.PageView,1);
  assert.equal(stats.paid[0]._id,"sandbox"); assert.equal(stats.paid[0].total,order.total); assert.equal(stats.top[0].quantity,2);
});
async function shippingDraft() {
  const { agent, user } = await administrator(), part=await product(), order=await orderFor(user,part,"cod");
  const partner=await ShippingPartner.create({ name:"Courier", email:"courier@example.com", whatsapp:"+9779800000000", whatsappOptIn:true });
  order.fulfillmentStatus="allocated"; order.shippingPartner=partner._id; await order.save();
  const page=await agent.get("/admin/orders/"+order._id).expect(200);
  const preview=await agent.post("/admin/orders/"+order._id+"/notices/preview").type("form").send({ _csrf:token(page), channel:"email", recipient:"attacker@example.com" }).expect(302);
  const notice=await ShippingNotice.findOne();
  assert.equal(notice.recipient,partner.email);
  return { agent,user,order,partner,notice,csrf:token(page),url:preview.headers.location };
}
test("shipping notices require provider setup and reject modified previews", async () => {
  const { agent,notice,partner,csrf,url }=await shippingDraft();
  const page=await agent.get(url).expect(200); assert.match(page.text,/Provider setup is required/);
  await agent.post(url+"/send").type("form").send({ _csrf:csrf }).expect(503);
  assert.equal((await ShippingNotice.findById(notice._id)).status,"draft");
  await ShippingPartner.updateOne({ _id:partner._id }, { $set:{ email:"new@example.com" } });
  await agent.post(url+"/send").type("form").send({ _csrf:csrf }).expect(409);
});
test("shipping provider acceptance is idempotent and failure never reports delivered", async () => {
  const { agent,notice,csrf,url }=await shippingDraft();
  const previousConfigured=shippingDelivery.configured, previousDeliver=shippingDelivery.deliver;
  let calls=0;
  try {
    shippingDelivery.configured=()=>true;
    shippingDelivery.deliver=async ()=> { calls++; await new Promise(resolve=>setTimeout(resolve,30)); return "mock-provider-reference"; };
    const results=await Promise.all([agent.post(url+"/send").type("form").send({ _csrf:csrf }),agent.post(url+"/send").type("form").send({ _csrf:csrf })]);
    assert.deepEqual(results.map(result=>result.status).sort(),[302,409]); assert.equal(calls,1);
    assert.equal((await ShippingNotice.findById(notice._id)).status,"accepted");
    const accepted=await agent.get(url); assert.match(accepted.text,/does not confirm delivery/);
    const preview=await agent.post("/admin/orders/"+notice.order+"/notices/preview").type("form").send({ _csrf:csrf,channel:"email" }).expect(302);
    shippingDelivery.deliver=async ()=>{ throw new Error("private-provider-error"); };
    await agent.post(preview.headers.location+"/send").type("form").send({ _csrf:csrf }).expect(302);
    const failed=await agent.get(preview.headers.location);
    assert.match(failed.text,/unconfirmed/); assert.doesNotMatch(failed.text,/private-provider-error/);
  } finally { shippingDelivery.configured=previousConfigured; shippingDelivery.deliver=previousDeliver; }
});

test("operator command grants and revokes only an existing registered account", async () => {
  const { grant } = require("../scripts/admin-grant");
  const { user, agent } = await account();
  await assert.rejects(grant("missing@example.com"), /Account not found/);
  await grant(user.email);
  await agent.get("/admin").expect(200);
  await grant(user.email,true);
  await agent.get("/admin").expect(403);
  assert.equal(await AdminAudit.countDocuments(),2);
});
test("paid stock-review reservation rolls back shortages and allocates once", async () => {
  const { user }=await administrator(), part=await product(1), order=await orderFor(user,part);
  order.paymentStatus="paid"; order.paidAt=new Date(); order.fulfillmentStatus="stock_review"; await order.save();
  await assert.rejects(adminService.updateOrder(order._id,{ version:order.updatedAt.toISOString(),action:"allocate" },user._id),/insufficient/);
  assert.equal((await Product.findById(part._id)).stock,1);
  await Product.updateOne({ _id:part._id }, { $set:{ stock:3 } });
  await adminService.updateOrder(order._id,{ version:order.updatedAt.toISOString(),action:"allocate" },user._id);
  assert.equal((await Product.findById(part._id)).stock,1);
  const current=await Order.findById(order._id);
  await assert.rejects(adminService.updateOrder(order._id,{ version:current.updatedAt.toISOString(),action:"allocate" },user._id),/stock review/);
});
test("late external confirmation of a cancelled order stays paid for refund review without stock allocation", async () => {
  const { user }=await account(), part=await product(), order=await orderFor(user,part,"esewa");
  order.shippingStatus="cancelled"; await order.save();
  await finalizeOrder(order._id,"paid","confirmed-external");
  const current=await Order.findById(order._id);
  assert.equal(current.paymentStatus,"paid"); assert.equal(current.fulfillmentStatus,"stock_review");
  assert.equal(current.shippingStatus,"cancelled"); assert.equal((await Product.findById(part._id)).stock,10);
});
test("admin mutations require CSRF and archived products cannot be added to the cart", async () => {
  const { agent }=await administrator(), part=await product();
  await agent.post("/admin/products/"+part._id+"/archive").type("form").send({ active:"false",version:part.updatedAt.toISOString() }).expect(403);
  assert.equal((await Product.findById(part._id)).active,true);
  await Product.updateOne({ _id:part._id }, { $set:{ active:false } });
  const page=await agent.get("/");
  await agent.post("/cart/add/"+part._id).type("form").send({ _csrf:token(page),quantity:"1" }).expect(302);
  const cart = await agent.get("/cart").expect(200);
  assert.doesNotMatch(cart.text, /Brake Pad/);
});
