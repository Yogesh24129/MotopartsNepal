const crypto = require("crypto");
const mongoose = require("mongoose");
const MarketingEvent = require("../models/MarketingEvent");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { httpError } = require("../utils/validation");

function marketingConfig() {
  const enabled = process.env.MARKETING_ENABLED !== "false";
  const pixelEnabled = enabled && process.env.META_PIXEL_ENABLED === "true";
  const pixelId = process.env.META_PIXEL_ID || "";
  if (pixelEnabled && !/^\d{5,30}$/.test(pixelId)) throw new Error("META_PIXEL_ID must be a numeric Pixel ID when META_PIXEL_ENABLED=true.");
  const gaEnabled = enabled && process.env.GA4_ENABLED === "true";
  const gaId = process.env.GA4_MEASUREMENT_ID || "";
  if (gaEnabled && !/^G-[A-Z0-9]{6,20}$/.test(gaId)) throw new Error("GA4_MEASUREMENT_ID must be a valid G- Measurement ID when GA4_ENABLED=true.");
  return { enabled, gaId: gaEnabled ? gaId : "", gaDebug: gaEnabled && process.env.GA4_DEBUG_MODE === "true", pixelId: pixelEnabled ? pixelId : "",
    dashboardEnabled: enabled && ((process.env.MARKETING_DASHBOARD_ENABLED ?? process.env.LAB7_DASHBOARD_ENABLED) === "true" ||
      ((process.env.MARKETING_DASHBOARD_ENABLED ?? process.env.LAB7_DASHBOARD_ENABLED) !== "false" && process.env.NODE_ENV !== "production")) };
}

function purchaseEventId(order) {
  return `purchase-${crypto.createHash("sha256").update(String(order._id)).digest("hex").slice(0, 32)}`;
}

function purchaseData(req, order) {
  if (req.session.marketingConsent !== "granted" || !req.session.marketingVisitor ||
      order.marketingVisitor !== req.session.marketingVisitor || order.paymentStatus !== "paid") return null;
  return { eventId: purchaseEventId(order), value: order.total, currency: "NPR",
    content_ids: order.items.map((item) => String(item.product)), content_type: "product",
    items: order.items.map((item) => ({ item_id: String(item.product), item_name: item.name, price: item.price, quantity: item.quantity })),
    num_items: order.items.reduce((sum, item) => sum + item.quantity, 0), test_payment: order.paymentMethod === "card" || process.env.PAYMENT_MODE === "sandbox" && order.paymentMethod === "esewa" };
}

function exposeMarketing(req, res, next) {
  const config = marketingConfig();
  res.locals.marketing = config;
  res.locals.marketingConsent = req.session.marketingConsent || "unknown";
  res.locals.marketingReturnTo = req.path;
  res.locals.marketingPage = null;
  res.locals.gaPage = null;
  res.locals.marketingProduct = null;
  res.locals.marketingPurchase = null;
  res.locals.serializeMarketing = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  next();
}

async function recordEvents(req, events) {
  if (!marketingConfig().enabled || req.session.marketingConsent !== "granted" || !req.session.marketingVisitor) {
    throw httpError(403, "Allow marketing measurement before recording events.");
  }
  if (!Array.isArray(events) || !events.length || events.length > 25) throw httpError(400, "Send between 1 and 25 events.");
  const visitor = req.session.marketingVisitor;
  const prepared = [];
  for (const event of events) {
    if (!event || typeof event.eventId !== "string" || !/^[a-f0-9-]{36}$/.test(event.eventId) ||
        !["catalog", "product", "checkout", "receipt"].includes(event.page)) throw httpError(400, "Invalid marketing event.");
    if (!["PageView", "ViewContent", "InitiateCheckout", "ProductImpression", "ProductClick", "PromotionImpression", "PromotionClick"].includes(event.type)) {
      throw httpError(400, "Unsupported event. Purchases are counted only from paid orders.");
    }
    let targetId = "";
    if (["ViewContent", "ProductImpression", "ProductClick"].includes(event.type)) {
      if (typeof event.targetId !== "string" || !mongoose.isValidObjectId(event.targetId) ||
          !await Product.exists({ _id: event.targetId })) throw httpError(400, "Unknown product.");
      targetId = event.targetId;
    } else if (["PromotionImpression", "PromotionClick"].includes(event.type)) {
      if (event.targetId !== "riding-gear") throw httpError(400, "Unknown promotion.");
      targetId = event.targetId;
    }
    if (event.type === "InitiateCheckout" && event.page !== "checkout") throw httpError(400, "Checkout event must come from checkout.");
    prepared.push({ visitor, eventId: `${visitor}:${event.eventId}`, type: event.type, page: event.page, targetId });
  }
  // Unique IDs prevent retries/beacons from counting the same browser action twice.
  for (const event of prepared) {
    try {
      await MarketingEvent.updateOne({ eventId: event.eventId }, { $setOnInsert: event }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
}

async function dashboard(visitor) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (!visitor) return { counts: {}, impressions: 0, clicks: 0, conversions: 0, revenue: 0, recent: [], ctr: 0, conversionRate: 0 };
  const filter = { visitor, createdAt: { $gte: since } };
  const [groups, events, orders] = await Promise.all([
    MarketingEvent.aggregate([{ $match: filter }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    MarketingEvent.find(filter).sort({ createdAt: -1 }).limit(40).lean(),
    Order.find({ marketingVisitor: visitor, paymentStatus: "paid", paidAt: { $gte: since } })
      .select("total paidAt paymentMethod").lean(),
  ]);
  const counts = Object.fromEntries(groups.map((group) => [group._id, group.count]));
  const impressions = (counts.ProductImpression || 0) + (counts.PromotionImpression || 0);
  const clicks = (counts.ProductClick || 0) + (counts.PromotionClick || 0);
  const conversions = orders.length;
  const recent = [...events, ...orders.map((order) => ({ type: "Purchase", targetId: "Paid order",
    createdAt: order.paidAt, value: order.total, paymentMethod: order.paymentMethod }))]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 40);
  return { counts, impressions, clicks, conversions, recent,
    revenue: Math.round(orders.reduce((sum, order) => sum + order.total, 0) * 100) / 100,
    ctr: impressions ? clicks / impressions * 100 : 0,
    conversionRate: counts.InitiateCheckout ? conversions / counts.InitiateCheckout * 100 : 0 };
}

module.exports = { marketingConfig, purchaseData, exposeMarketing, recordEvents, dashboard };
