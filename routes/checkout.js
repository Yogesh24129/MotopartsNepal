const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const cartService = require("../middleware/cart");
const { generateOrderHash } = require("../utils/hash");

// Checkout page - delivery details + payment method choice
router.get("/", (req, res) => {
  const totals = cartService.getCartTotals(req);
  if (totals.items.length === 0) {
    req.flash("error", "Your cart is empty.");
    return res.redirect("/cart");
  }
  res.render("checkout", { title: "Checkout", ...totals });
});

// Create the order (status: pending) then send the customer to the
// chosen simulated payment gateway.
router.post("/", async (req, res, next) => {
  try {
    const totals = cartService.getCartTotals(req);
    if (totals.items.length === 0) {
      req.flash("error", "Your cart is empty.");
      return res.redirect("/cart");
    }

    const { fullName, phone, email, address, city, paymentMethod } = req.body;

    if (!fullName || !phone || !address || !city || !email) {
      req.flash("error", "Please fill in all required delivery details.");
      return res.redirect("/checkout");
    }
    if (!["esewa", "card"].includes(paymentMethod)) {
      req.flash("error", "Please choose a payment method.");
      return res.redirect("/checkout");
    }

  const order = new Order({
  user: req.session.userId || undefined,
  items: totals.items.map((i) => ({
    product: i.productId,
    name: i.name,
    price: i.price,
    quantity: i.quantity,
    image: i.image,
  })),
  customer: { fullName, phone, email, address, city },
  subtotal: totals.subtotal,
  shippingFee: totals.shippingFee,
  total: totals.total,
  paymentMethod,
  paymentStatus: "pending",
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
