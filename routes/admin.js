const express = require("express");
const crypto = require("crypto");
const Product = require("../models/Product");
const User = require("../models/User");
const Order = require("../models/Order");
const Partner = require("../models/ShippingPartner");
const Notice = require("../models/ShippingNotice");
const Audit = require("../models/AdminAudit");
const { requireAdmin } = require("../middleware/admin");
const { httpError } = require("../utils/validation");
const service = require("../services/admin");
const delivery = require("../services/shipping-notices");
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.use(requireAdmin);
router.use((req, res, next) => { res.locals.adminSection = req.path.split("/")[1] || "overview"; res.locals.npr = value => "NPR " + Number(value || 0).toLocaleString("en-NP", { maximumFractionDigits: 2 }); res.locals.date = value => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Kathmandu" }) : "—"; next(); });
function render(res, view, data) { res.render("admin/" + view, { title: "Administration", ...data }); }
function pagination(req) { return Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1)); }
function search(req) { const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100).trim() : ""; return { q, regex: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }; }
router.get("/", wrap(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  render(res, "overview", { data: await service.metrics(days) });
}));
router.get("/marketing", wrap(async (req, res) => {
  const { marketingConfig, dashboard } = require("../services/marketing");
  render(res, "marketing", { title: "Marketing measurement", metrics: await dashboard(), measurement: marketingConfig() });
}));
router.get("/products", wrap(async (req, res) => {
  const page = pagination(req), { q, regex } = search(req);
  const filter = q ? { $or: [{ name: regex }, { brand: regex }, { slug: regex }] } : {};
  const [rows, count] = await Promise.all([Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), Product.countDocuments(filter)]);
  render(res, "products", { rows, page, count, q });
}));
router.get("/products/new", (req, res) => render(res, "product", { product: null, categories: service.categories }));
router.get("/products/:id", wrap(async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) throw httpError(404, "Product not found.");
  render(res, "product", { product, categories: service.categories });
}));
router.post("/products", wrap(async (req, res) => {
  const product = await Product.create(service.productFields(req.body));
  await service.audit(res.locals.currentUser._id, "product_created", product._id, "Created " + product.name);
  res.redirect("/admin/products/" + product._id);
}));
router.post("/products/:id", wrap(async (req, res) => {
  const fields = service.productFields(req.body);
  if (!req.body.version || !Number.isFinite(Date.parse(req.body.version))) throw httpError(400, "Reload the product before saving.");
  const product = await Product.findOneAndUpdate({ _id: req.params.id, updatedAt: new Date(req.body.version) }, { $set: fields }, { new: true, runValidators: true });
  if (!product) throw httpError(409, "Product or stock changed. Reload before saving.");
  await service.audit(res.locals.currentUser._id, "product_updated", product._id, "Updated " + product.name);
  req.flash("success", "Product saved."); res.redirect("/admin/products/" + product._id);
}));
router.post("/products/:id/archive", wrap(async (req, res) => {
  const product = await Product.findOneAndUpdate({ _id: req.params.id, updatedAt: new Date(req.body.version) }, { $set: { active: req.body.active === "true" } }, { new: true });
  if (!product) throw httpError(409, "Product changed. Reload before updating.");
  await service.audit(res.locals.currentUser._id, "product_availability", product._id, product.active ? "Product restored" : "Product archived");
  res.redirect("/admin/products/" + product._id);
}));
router.get("/users", wrap(async (req, res) => {
  const page = pagination(req), { q, regex } = search(req), filter = q ? { $or: [{ name: regex }, { email: regex }] } : {};
  render(res, "users", { rows: await User.find(filter).select("name email role createdAt").sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), count: await User.countDocuments(filter), page, q });
}));
router.get("/orders", wrap(async (req, res) => {
  const page = pagination(req);
  const filter = req.query.status === "processing" ? { $or: [{ shippingStatus: "processing" }, { shippingStatus: { $exists: false } }] } : ["dispatched", "delivered", "cancelled"].includes(req.query.status) ? { shippingStatus: req.query.status } : {};
  render(res, "orders", { rows: await Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), count: await Order.countDocuments(filter), page, q: "", status: req.query.status || "" });
}));
router.get("/orders/:id", wrap(async (req, res) => {
  const order = await Order.findById(req.params.id).populate("shippingPartner").lean();
  if (!order) throw httpError(404, "Order not found.");
  render(res, "order", { order, partners: await Partner.find({ active: true }).lean(), notices: await Notice.find({ order: order._id }).sort({ createdAt: -1 }).limit(20).lean(), configured: delivery.configured });
}));
router.post("/orders/:id", wrap(async (req, res) => { await service.updateOrder(req.params.id, req.body, res.locals.currentUser._id); res.redirect("/admin/orders/" + req.params.id); }));
router.get("/partners", wrap(async (req, res) => render(res, "partners", { rows: await Partner.find().sort({ name: 1 }).lean(), configured: delivery.configured })));
router.post("/partners", wrap(async (req, res) => {
  const email = service.text(req.body.email || "", 200).toLowerCase(), whatsapp = service.text(req.body.whatsapp || "", 20);
  if ((!email && !whatsapp) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (whatsapp && !/^\+[1-9]\d{7,14}$/.test(whatsapp))) throw httpError(400, "Enter a valid email or WhatsApp number with its country code.");
  const fields = { name: service.text(req.body.name, 100, true), contactName: service.text(req.body.contactName || "", 100), email, whatsapp, whatsappOptIn: req.body.whatsappOptIn === "on", active: req.body.active === "on" };
  const partner = req.body.id ? await Partner.findOneAndUpdate({ _id: req.body.id, updatedAt: new Date(req.body.version) }, { $set: fields }, { new: true, runValidators: true }) : await Partner.create(fields);
  if (!partner) throw httpError(409, "Partner changed. Reload before saving.");
  await service.audit(res.locals.currentUser._id, "partner_updated", partner._id, "Saved shipping partner " + partner.name);
  res.redirect("/admin/partners");
}));
async function shipment(id) {
  const order = await Order.findById(id).populate("shippingPartner");
  if (!order) throw httpError(404, "Order not found.");
  if (!order.finalizedAt || !order.shippingPartner || !order.shippingPartner.active || order.shippingStatus === "cancelled" || order.fulfillmentStatus !== "allocated" || (order.paymentMethod !== "cod" && order.paymentStatus !== "paid")) throw httpError(409, "Finalize the order with an active partner, reserved stock and payment or COD first.");
  return order;
}
router.post("/orders/:id/notices/preview", wrap(async (req, res) => {
  const order = await shipment(req.params.id), partner = order.shippingPartner, channel = req.body.channel;
  if (!["email", "whatsapp"].includes(channel)) throw httpError(400, "Choose email or WhatsApp.");
  const recipient = channel === "email" ? partner.email : partner.whatsapp;
  if (!recipient || (channel === "whatsapp" && !partner.whatsappOptIn)) throw httpError(400, "Partner contact or WhatsApp opt-in is missing.");
  const subject = "Shipment #" + order._id.toString().slice(-6).toUpperCase();
  const body = [subject, "Partner: " + partner.name, "Customer: " + order.customer.fullName, "Phone: " + order.customer.phone,
    "Delivery: " + order.customer.address + ", " + order.customer.city,
    ...order.items.map(item => item.name + " × " + item.quantity),
    "Collect: NPR " + (order.paymentMethod === "cod" && order.paymentStatus !== "paid" ? order.total.toFixed(2) : "0.00")].join("\n");
  const notice = await Notice.create({ requestId: crypto.randomUUID(), createdBy: res.locals.currentUser._id, order: order._id, partner: partner._id, channel, recipient, subject, body, orderVersion: order.updatedAt, partnerVersion: partner.updatedAt });
  res.redirect("/admin/notices/" + notice._id);
}));
router.get("/notices/:id", wrap(async (req, res) => {
  const notice = await Notice.findOne({ _id: req.params.id, createdBy: res.locals.currentUser._id }).lean();
  if (!notice) throw httpError(404, "Notice not found.");
  render(res, "notice", { notice, ready: delivery.configured(notice.channel) });
}));
router.post("/notices/:id/send", wrap(async (req, res) => {
  const notice = await Notice.findOne({ _id: req.params.id, createdBy: res.locals.currentUser._id });
  if (!notice) throw httpError(404, "Notice not found.");
  if (notice.status !== "draft") throw httpError(409, "This notice was already submitted. Check provider records before creating another.");
  const order = await shipment(notice.order), partner = order.shippingPartner;
  if (!partner._id.equals(notice.partner) || +order.updatedAt !== +notice.orderVersion || +partner.updatedAt !== +notice.partnerVersion) throw httpError(409, "Shipment or recipient changed. Create a fresh preview.");
  if (notice.channel === "whatsapp") {
    if (!partner.whatsappOptIn) throw httpError(409, "Partner WhatsApp opt-in is missing.");
    const url = delivery.whatsappUrl(notice.recipient, notice.body);
    const opened = await Notice.findOneAndUpdate({ _id: notice._id, status: "draft" }, { $set: { status: "opened" } });
    if (!opened) throw httpError(409, "This WhatsApp draft was already opened.");
    await service.audit(res.locals.currentUser._id, "shipping_notice", notice._id, "WhatsApp draft opened; sending is not confirmed.");
    return res.redirect(303, url);
  }
  if (!delivery.configured(notice.channel)) throw httpError(503, "Notification provider is not configured. See README shipping setup.");
  const claimed = await Notice.findOneAndUpdate({ _id: notice._id, status: "draft" }, { $set: { status: "sending" } }, { new: true });
  if (!claimed) throw httpError(409, "Notice already submitted.");
  try { claimed.providerId = await delivery.deliver(claimed); claimed.status = "accepted"; }
  catch (_) { claimed.status = "unconfirmed"; claimed.failure = "Provider acceptance could not be confirmed. Check provider records before retrying."; }
  await claimed.save();
  await service.audit(res.locals.currentUser._id, "shipping_notice", claimed._id, claimed.channel + " notice: " + claimed.status);
  res.redirect("/admin/notices/" + claimed._id);
}));
router.get("/activity", wrap(async (req, res) => render(res, "activity", { rows: await Audit.find().populate("actor", "name email").sort({ createdAt: -1 }).limit(100).lean() })));
router.use((error, req, res, next) => next(error.code === 11000 ? httpError(409, "This product slug is already in use. Choose another slug.") : error));
module.exports = router;
