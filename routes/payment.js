const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Order = require("../models/Order");
const cartService = require("../middleware/cart");
const esewa = require("../utils/esewa");
const { loadOrder, ownsOrder, paymentMethod } = require("../middleware/orderAccess");
const { finalizeOrder } = require("../services/payments");
const { notifyUser } = require("../utils/notifications");
const { sendDeliveryConfirmation } = require("../utils/email");
const { sendWhatsAppConfirmation } = require("../utils/whatsapp");
const { verifyOrderHash } = require("../utils/hash");
const { httpError } = require("../utils/validation");
const { purchaseData } = require("../services/marketing");

// External messages run after the transaction commits and cannot undo payment.
async function announce(result) {
  if (!result.changed) return;
  const { order } = result;
  const code = order._id.toString().slice(-6).toUpperCase();
  const message = order.paymentStatus === "paid"
    ? `Payment received for order #${code}. ${order.fulfillmentStatus === "stock_review" ? "Stock availability needs review." : "Your order has been placed successfully."} Total: Rs. ${order.total}.`
    : `Payment failed for order #${code}. Please try again.`;
  const actions = [() => notifyUser(order.user, message, { type: "order", link: `/payment/status/${order._id}` })];
  if (order.paymentStatus === "paid" && order.fulfillmentStatus === "allocated") {
    actions.push(() => sendDeliveryConfirmation(order), () => sendWhatsAppConfirmation(order));
  }
  const results = await Promise.allSettled(actions.map((action) => action()));
  for (const result of results) if (result.status === "rejected") console.error("[Confirmation]", result.reason.message);
}

router.get("/esewa/callback", async (req, res, next) => {
  try {
    const payload = esewa.decodeResponse(req.query.data);
    const order = await Order.findOne({ paymentMethod: "esewa", $or: [
      { esewaTransactionUuid: payload.transaction_uuid }, { esewaTransactionUuids: payload.transaction_uuid },
    ] });
    if (!order) throw httpError(404, "Order not found for this payment attempt.");
    const statusResult = await esewa.checkTransactionStatus(order.total, payload.transaction_uuid);
    esewa.validateStatus(statusResult, order.total, payload.transaction_uuid);
    // PENDING is not a failure. The buyer can return to the gateway to retry.
    if (statusResult.status === "COMPLETE") {
      const result = await finalizeOrder(order._id, "paid", statusResult.ref_id, { method: "esewa", uuid: payload.transaction_uuid });
      await announce(result);
      if (ownsOrder(req, order)) cartService.clearCart(req);
    }
    res.redirect(`/payment/status/${order._id}`);
  } catch (error) { next(error); }
});

// The unsigned cancellation redirect is only a navigation signal. It must not
// overwrite a paid order or decide whether money moved at the gateway.
router.get("/esewa/failure/:orderId", loadOrder, paymentMethod("esewa"), (req, res) => {
  if (req.order.paymentStatus !== "paid") req.flash("error", "Payment was cancelled or could not be confirmed. You can retry.");
  res.redirect(`/payment/status/${req.order._id}`);
});

router.get("/esewa/:orderId", loadOrder, paymentMethod("esewa"), async (req, res, next) => {
  try {
    if (req.order.paymentStatus === "paid") return res.redirect(`/payment/status/${req.order._id}`);
    esewa.requireConfiguration();
    if (req.order.esewaTransactionUuids.length >= 50) throw httpError(409, "Too many payment attempts. Please contact support.");
    // Preserve every signed attempt so delayed callbacks can still be reconciled.
    const uuid = `${req.order._id}-${crypto.randomUUID()}`;
    const attempts = req.order.esewaTransactionUuid ? [uuid, req.order.esewaTransactionUuid] : [uuid];
    const order = await Order.findOneAndUpdate(
      { _id: req.order._id, paymentStatus: { $ne: "paid" } },
      { $set: { esewaTransactionUuid: uuid }, $addToSet: { esewaTransactionUuids: { $each: attempts } } }, { new: true }
    );
    if (!order) return res.redirect(`/payment/status/${req.order._id}`);
    const fields = esewa.paymentFields(order.total, order.esewaTransactionUuid,
      `/payment/esewa/callback`, `/payment/esewa/failure/${order._id}`);
    res.render("esewa-redirect", { title: "Redirecting to eSewa", gatewayUrl: esewa.GATEWAY_FORM_URL, fields });
  } catch (error) { next(error); }
});

router.get("/card/:orderId", loadOrder, paymentMethod("card"), (req, res) => {
  if (req.order.paymentStatus === "paid") return res.redirect(`/payment/status/${req.order._id}`);
  res.render("card-payment", { title: "Card Payment (Simulated)", order: req.order });
});

router.post("/card/:orderId/process", loadOrder, paymentMethod("card"), async (req, res, next) => {
  try {
    if (req.order.paymentStatus === "paid") return res.redirect(`/payment/status/${req.order._id}`);
    const { cardName, cardNumber, expiry, cvv } = req.body;
    const digitsOnly = typeof cardNumber === "string" ? cardNumber.replace(/\s+/g, "") : "";
    const match = typeof expiry === "string" && expiry.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    const validExpiry = match && Date.UTC(2000 + Number(match[2]), Number(match[1]), 1) > Date.now();
    const valid = typeof cardName === "string" && cardName.trim() && /^\d{13,16}$/.test(digitsOnly) &&
      validExpiry && typeof cvv === "string" && /^\d{3,4}$/.test(cvv);
    const success = Boolean(valid && !digitsOnly.endsWith("0000"));
    const txnId = success ? `CARD-${crypto.randomUUID()}` : null;
    const result = await finalizeOrder(req.order._id, success ? "paid" : "failed", txnId,
      { method: "card", cardLast4: digitsOnly.slice(-4) });
    await announce(result);
    if (result.order.paymentStatus === "paid") cartService.clearCart(req);
    res.redirect(`/payment/status/${req.order._id}`);
  } catch (error) { next(error); }
});

router.get("/status/:orderId", loadOrder, (req, res) => {
  res.render("payment-status", { title: req.order.paymentStatus === "paid" ? "Payment Successful" :
    req.order.paymentStatus === "pending" ? "Payment Pending" : "Payment Failed", order: req.order,
    dataIntact: verifyOrderHash(req.order), marketingPage: "receipt", marketingPurchase: purchaseData(req, req.order) });
});

module.exports = router;
