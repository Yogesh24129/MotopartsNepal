const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Order = require("../models/Order");
const Product = require("../models/Product");
const cartService = require("../middleware/cart");
const esewa = require("../utils/esewa");
const { notifyUser } = require("../utils/notifications");
const { sendDeliveryConfirmation } = require("../utils/email");
const { sendWhatsAppConfirmation } = require("../utils/whatsapp");
const { verifyOrderHash } = require("../utils/hash");

/* ------------------------------------------------------------------ *
 *  IMPORTANT: This file SIMULATES payment gateways for a college
 *  e-commerce lab assignment. No real money moves, no real eSewa or
 *  card network is contacted. Every "verification" happens locally.
 * ------------------------------------------------------------------ */

function generateTxnId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function loadPendingOrder(req, res, next) {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      req.flash("error", "Order not found.");
      return res.redirect("/cart");
    }
    req.order = order;
    next();
  } catch (err) {
    next(err);
  }
}

async function finalizeOrder(order, status, transactionId) {
  order.paymentStatus = status;
  order.transactionId = transactionId;
  await order.save();

  // decrement stock only on a successful payment
  if (status === "paid") {
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
    }
    await notifyUser(
      order.user,
      `Your order #${order._id.toString().slice(-6).toUpperCase()} has been placed successfully. Total: Rs. ${order.total}.`,
      { type: "order", link: `/payment/status/${order._id}` }
    );
    await sendDeliveryConfirmation(order);
    await sendWhatsAppConfirmation(order);
  } else if (status === "failed") {
    await notifyUser(
      order.user,
      `Payment failed for order #${order._id.toString().slice(-6).toUpperCase()}. Please try again.`,
      { type: "order", link: `/payment/status/${order._id}` }
    );
  }
}

/* ---------------------------- eSewa flow ---------------------------- */
// Step 2: eSewa redirects here after payment, with ?data=<base64 JSON>
router.get("/esewa/callback", async (req, res, next) => {
  try {
    const raw = Buffer.from(req.query.data, "base64").toString("utf-8");
    const payload = JSON.parse(raw);

    if (!esewa.verifySignature(payload)) {
      req.flash("error", "eSewa response signature did not match — payment rejected.");
      return res.redirect("/cart");
    }

    const orderId = payload.transaction_uuid.split("-")[0];
    const order = await Order.findById(orderId);
    if (!order) {
      req.flash("error", "Order not found for this eSewa transaction.");
      return res.redirect("/cart");
    }

    // Confirm directly with eSewa — never trust the redirect alone
    const statusResult = await esewa.checkTransactionStatus(order.total, payload.transaction_uuid);

    if (statusResult.status === "COMPLETE") {
      await finalizeOrder(order, "paid", statusResult.ref_id);
      cartService.clearCart(req);
    } else {
      await finalizeOrder(order, "failed", null);
    }

    res.redirect(`/payment/status/${order._id}`);
  } catch (err) {
    next(err);
  }
});

router.get("/esewa/failure/:orderId", loadPendingOrder, async (req, res, next) => {
  try {
    await finalizeOrder(req.order, "failed", null);
    res.redirect(`/payment/status/${req.order._id}`);
  } catch (err) {
    next(err);
  }
});

// Step 1: build a signed form and send the browser to eSewa's real UAT gateway
router.get("/esewa/:orderId", loadPendingOrder, async (req, res, next) => {
  try {
    const order = req.order;
    if (order.paymentStatus !== "pending") {
      return res.redirect(`/payment/status/${order._id}`);
    }

    // Fresh UUID each attempt — eSewa rejects reusing one with the same amount
    const transactionUuid = `${order._id}-${Date.now()}`;
    order.esewaTransactionUuid = transactionUuid;
    await order.save();

    const totalAmount = order.total;
    const signature = esewa.generateSignature(totalAmount, transactionUuid);

    const fields = {
      amount: totalAmount,
      tax_amount: 0,
      total_amount: totalAmount,
      transaction_uuid: transactionUuid,
      product_code: esewa.PRODUCT_CODE,
      product_service_charge: 0,
      product_delivery_charge: 0,
      success_url: `${req.protocol}://${req.get("host")}/payment/esewa/callback`,
      failure_url: `${req.protocol}://${req.get("host")}/payment/esewa/failure/${order._id}`,
      signed_field_names: "total_amount,transaction_uuid,product_code",
      signature,
    };

    res.render("esewa-redirect", { title: "Redirecting to eSewa", gatewayUrl: esewa.GATEWAY_FORM_URL, fields });
  } catch (err) {
    next(err);
  }
});




/* -------------------------- Credit card flow ------------------------- */

router.get("/card/:orderId", loadPendingOrder, (req, res) => {
  if (req.order.paymentStatus !== "pending") {
    return res.redirect(`/payment/status/${req.order._id}`);
  }
  res.render("card-payment", {
    title: "Card Payment (Simulated)",
    order: req.order,
  });
});

router.post("/card/:orderId/process", loadPendingOrder, async (req, res, next) => {
  try {
    const { cardName, cardNumber, expiry, cvv } = req.body;
    const digitsOnly = (cardNumber || "").replace(/\s+/g, "");

    const looksValid =
      cardName &&
      /^\d{13,16}$/.test(digitsOnly) &&
      /^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry || "") &&
      /^\d{3,4}$/.test(cvv || "");

    // Demo rule: card numbers ending in 0000 are used to demonstrate
    // a declined transaction; everything else that "looks valid" succeeds.
    const declined = digitsOnly.endsWith("0000");
    const success = looksValid && !declined;

    const status = success ? "paid" : "failed";
    const txnId = success ? generateTxnId("CARD") : null;

    req.order.cardLast4 = digitsOnly.slice(-4);
    await finalizeOrder(req.order, status, txnId);
    if (success) cartService.clearCart(req);

    res.redirect(`/payment/status/${req.order._id}`);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------- Result page ---------------------------- */
router.get("/status/:orderId", loadPendingOrder, (req, res) => {
  const order = req.order;
  const dataIntact = verifyOrderHash(order);
  res.render("payment-status", {
    title: order.paymentStatus === "paid" ? "Payment Successful" : "Payment Failed",
    order,
    dataIntact,
  });
});


module.exports = router;
