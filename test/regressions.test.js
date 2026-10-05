const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const session = require("express-session");

process.env.ESEWA_SECRET_KEY = "test-only-secret";
process.env.ESEWA_PRODUCT_CODE = "EPAYTEST";
process.env.ESEWA_GATEWAY_URL = "https://gateway.example.test/form";
process.env.ESEWA_STATUS_URL = "https://gateway.example.test/status";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-only-session-secret";
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

test("demo wallet seeding creates users and preserves existing balances on rerun", async () => {
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
