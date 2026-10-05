const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// Home page - product listing with optional category/search filter
router.get("/", async (req, res, next) => {
  try {
    const { category, q } = req.query;
    const filter = {};
    if ((category && (typeof category !== "string" || category.length > 50)) ||
        (q && (typeof q !== "string" || q.length > 100))) return res.status(400).render("error", {
      title: "Invalid search", message: "Enter a shorter search or category.",
    });
    if (category) filter.category = category;
    if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const products = await Product.find(filter).sort({ createdAt: -1 });
    const categories = await Product.distinct("category");

    res.render("index", {
      title: "MotoParts Nepal — Genuine Motorcycle Parts",
      products,
      marketingPage: "catalog",
      categories,
      activeCategory: category || "",
      query: q || "",
    });
  } catch (err) {
    next(err);
  }
});

// Single product detail page
router.get("/product/:slug", async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) {
      return res.status(404).render("404", { title: "Part not found" });
    }
    res.render("product", { title: product.name, product, marketingPage: "product",
      marketingProduct: { id: String(product._id), value: product.price, currency: "NPR" } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
