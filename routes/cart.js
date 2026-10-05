const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const cartService = require("../middleware/cart");

// View cart
router.get("/", (req, res) => {
  const totals = cartService.getCartTotals(req);
  res.render("cart", { title: "Your Cart", ...totals });
});

// Add product to cart
router.post("/add/:productId", async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) {
      req.flash("error", "Product not found.");
      return res.redirect("back");
    }
    if (product.stock < 1) {
      req.flash("error", `${product.name} is currently out of stock.`);
      return res.redirect("back");
    }

    cartService.addItem(req, product, req.body.quantity || 1);
    req.flash("success", `${product.name} added to cart.`);

    // AJAX support: return JSON if requested, else redirect
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ ok: true, ...cartService.getCartTotals(req) });
    }
    res.redirect("/cart");
  } catch (err) {
    next(err);
  }
});

// Update quantity of an item already in the cart
router.post("/update/:productId", (req, res) => {
  cartService.updateItem(req, req.params.productId, req.body.quantity);

  if (req.xhr || req.headers.accept?.includes("json")) {
    return res.json({ ok: true, ...cartService.getCartTotals(req) });
  }
  res.redirect("/cart");
});

// Remove item from cart entirely
router.post("/remove/:productId", (req, res) => {
  cartService.removeItem(req, req.params.productId);

  if (req.xhr || req.headers.accept?.includes("json")) {
    return res.json({ ok: true, ...cartService.getCartTotals(req) });
  }
  res.redirect("/cart");
});

// Clear entire cart
router.post("/clear", (req, res) => {
  cartService.clearCart(req);
  res.redirect("/cart");
});

module.exports = router;
