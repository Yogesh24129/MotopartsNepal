const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");
const crypto = require("crypto");
const { httpError } = require("../utils/validation");
const cartService = require("../middleware/cart");
const { generateOrderHash } = require("../utils/hash");

// Checkout page - delivery details + payment method choice
router.get("/", (req, res) => {
  const totals = cartService.getCartTotals(req);
  if (totals.items.length === 0) {
    req.flash("error", "Your cart is empty.");
    return res.redirect("/cart");
  }
  res.render("checkout", { title: "Checkout", ...totals, marketingPage: "checkout",
    marketingCheckout: { value: totals.total, currency: "NPR", num_items: totals.itemCount } });
});

// Create the order (status: pending) then send the customer to the
// chosen payment gateway.
router.post("/", async (req, res, next) => {
  try {
    const totals = cartService.getCartTotals(req);
    if (totals.items.length === 0) {
      req.flash("error", "Your cart is empty.");
      return res.redirect("/cart");
    }

    // Resolve current prices and stock from the database, never from a stale cart.
    const products = await Product.find({ _id: { $in: totals.items.map((item) => item.productId) } });
    const byId = new Map(products.map((product) => [String(product._id), product]));
    for (const item of totals.items) {
      const product = byId.get(item.productId);
      if (!product || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || product.stock < item.quantity) {
        req.flash("error", `${item.name} is no longer available in that quantity. Please update your cart.`);
        return res.redirect("/cart");
      }
      Object.assign(item, { price: product.price, name: product.name, image: product.image, stock: product.stock });
    }
    Object.assign(totals, cartService.getCartTotals(req));
    const { fullName, phone, email, address, city, paymentMethod } = req.body;

    if ([fullName, phone, address, city, email].some((value) => typeof value !== "string" || !value.trim() || value.length > 200)) {
      req.flash("error", "Please fill in all required delivery details.");
      return res.redirect("/checkout");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^(?:\+?977)?9\d{9}$/.test(phone.replace(/[\s-]/g, ""))) {
      throw httpError(400, "Enter a valid email and Nepali phone number.");
    }
    if (!["esewa", "card"].includes(paymentMethod)) {
      req.flash("error", "Please choose a payment method.");
      return res.redirect("/checkout");
    }

    req.session.checkoutOwner ||= crypto.randomUUID();
    const order = new Order({
      user: req.session.userId || undefined,
      guestOwner: req.session.userId ? undefined : req.session.checkoutOwner,
      marketingVisitor: process.env.MARKETING_ENABLED !== "false" && req.session.marketingConsent === "granted" ? req.session.marketingVisitor : undefined,
      items: totals.items.map((item) => ({
        product: item.productId, name: item.name, price: item.price,
        quantity: item.quantity, image: item.image,
      })),
      customer: { fullName, phone, email, address, city },
      subtotal: totals.subtotal, shippingFee: totals.shippingFee, total: totals.total,
      paymentMethod, paymentStatus: "pending",
    });
    order.integrityHash = generateOrderHash(order);
    await order.save();

    if (paymentMethod === "esewa") {
      return res.redirect(`/payment/esewa/${order._id}`);
    }
    return res.redirect(`/payment/card/${order._id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
