const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const MarketingEvent = require("../models/MarketingEvent");
const AdminAudit = require("../models/AdminAudit");
const { httpError, money, quantity } = require("../utils/validation");
const categories = Product.schema.path("category").enumValues;
function text(value, max, required = false) {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw httpError(400, "Check the required fields and their length.");
  return value.trim();
}
function productFields(body) {
  const price = money(body.price), stock = quantity(body.stock, true);
  if (price === null || stock === null || stock > 1000000) throw httpError(400, "Enter a positive price and a whole stock quantity.");
  const slug = text(body.slug, 120, true).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !categories.includes(body.category)) throw httpError(400, "Check the product slug and category.");
  const image = text(body.image || "/images/placeholder-part.svg", 1000, true);
  if (!/^\/images\/[a-zA-Z0-9_./-]+$/.test(image) && !/^https:\/\/[^\s]+$/.test(image)) throw httpError(400, "Use an /images/ path or an HTTPS image URL.");
  if (image.includes("..")) throw httpError(400, "Invalid image path.");
  return { name: text(body.name, 150, true), slug, brand: text(body.brand, 100, true), category: body.category,
    price, stock, image, description: text(body.description || "", 5000),
    compatibleModels: text(body.compatibleModels || "", 2000).split(",").map(v => v.trim()).filter(Boolean) };
}
function audit(actor, action, target, summary, session) {
  return AdminAudit.create([{ actor, action, target, summary }], session ? { session } : {});
}
async function metrics(days) {
  const since = new Date(Date.now() - days * 86400000);
  const [users, products, orders, lowStock, recent, paid, events, visitors, daily, top, newUsers] = await Promise.all([
    User.countDocuments(), Product.countDocuments({ active: { $ne: false } }), Order.countDocuments(),
    Product.find({ active: { $ne: false }, stock: { $lte: 5 } }).sort({ stock: 1 }).limit(10).lean(),
    Order.find().sort({ createdAt: -1 }).limit(8).lean(),
    Order.aggregate([{ $match: { paymentStatus: "paid", paidAt: { $gte: since } } },
      { $group: { _id: "$paymentEnvironment", total: { $sum: "$total" }, count: { $sum: 1 } } }]),
    MarketingEvent.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    MarketingEvent.distinct("visitor", { createdAt: { $gte: since } }),
    Order.aggregate([{ $match: { paymentStatus: "paid", paidAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { date: "$paidAt", format: "%Y-%m-%d", timezone: "Asia/Kathmandu" } }, total: { $sum: "$total" }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: { paymentStatus: "paid", paidAt: { $gte: since } } }, { $unwind: "$items" },
      { $group: { _id: "$items.product", name: { $first: "$items.name" }, quantity: { $sum: "$items.quantity" }, total: { $sum: { $multiply: ["$items.price", "$items.quantity"] } } } }, { $sort: { quantity: -1 } }, { $limit: 5 }]),
    User.countDocuments({ createdAt: { $gte: since } }),
  ]);
  return { users, products, orders, lowStock, recent, paid, events: Object.fromEntries(events.map(e => [e._id, e.count])), visitors: visitors.length, daily, top, newUsers, days };
}
async function updateOrder(id, body, actor) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);
      if (!order) throw httpError(404, "Order not found.");
      if (String(order.updatedAt.toISOString()) !== body.version) throw httpError(409, "Order changed. Reload before updating.");
      if (body.action === "allocate") {
        if (order.paymentStatus !== "paid" || order.fulfillmentStatus !== "stock_review" || order.shippingStatus === "cancelled") throw httpError(409, "Only paid orders awaiting stock review can reserve inventory.");
        for (const item of order.items) {
          const result = await Product.updateOne({ _id: item.product, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } }, { session });
          if (result.modifiedCount !== 1) throw httpError(409, "Stock is still insufficient. Update inventory first.");
        }
        order.fulfillmentStatus = "allocated";
      } else if (body.action === "cancel") {
        if (order.shippingStatus !== "processing" || order.paymentStatus === "paid") throw httpError(409, "Only unpaid orders awaiting dispatch can be cancelled. Paid orders need a provider refund.");
        if (order.fulfillmentStatus === "allocated") {
          for (const item of order.items) await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }, { session });
        }
        order.shippingStatus = "cancelled"; order.fulfillmentStatus = "unfulfilled";
      } else if (body.action === "paid") {
        if (order.paymentMethod !== "cod" || order.shippingStatus !== "delivered" || order.paymentStatus === "paid") throw httpError(409, "Record COD collection only once after delivery.");
        order.paymentStatus = "paid"; order.paidAt = new Date(); order.transactionId = "COD-" + order._id;
      } else {
        if (order.shippingStatus === "cancelled" || order.shippingStatus === "delivered") throw httpError(409, "This shipment is already closed.");
        if (body.partner) {
          const Partner = require("../models/ShippingPartner");
          if (!await Partner.exists({ _id: body.partner, active: true }).session(session)) throw httpError(400, "Choose an active shipping partner.");
          if (String(order.shippingPartner) !== body.partner) order.finalizedAt = undefined;
          order.shippingPartner = body.partner;
        }
        if (body.action === "finalize") {
          if (!order.shippingPartner || order.fulfillmentStatus !== "allocated" ||
              (order.paymentMethod !== "cod" && order.paymentStatus !== "paid")) throw httpError(409, "Assign a partner and reserve stock with confirmed payment or COD before finalizing.");
          const Partner = require("../models/ShippingPartner");
          if (!await Partner.exists({ _id: order.shippingPartner, active: true }).session(session)) throw httpError(409, "Choose an active shipping partner.");
          order.finalizedAt = new Date();
        }
        if (body.status && body.status !== order.shippingStatus) {
          const allowed = { processing: "dispatched", dispatched: "delivered" };
          if (allowed[order.shippingStatus || "processing"] !== body.status || !order.shippingPartner || order.fulfillmentStatus !== "allocated" ||
            (order.paymentMethod !== "cod" && order.paymentStatus !== "paid")) throw httpError(409, "Shipment must have reserved stock, confirmed payment or COD, and a partner before dispatch.");
          order.shippingStatus = body.status;
        }
      }
      await order.save({ session });
      await audit(actor, "order_updated", order._id, "Order " + order._id + ": " + order.shippingStatus + ", payment " + order.paymentStatus, session);
    });
  } finally { await session.endSession(); }
}
module.exports = { categories, text, productFields, audit, metrics, updateOrder };
