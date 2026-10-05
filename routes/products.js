const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { recommendations } = require("../services/recommendations");
const { catalogSEO, productSEO, gaPage } = require("../services/seo");

// Home page - product listing with optional category/search filter
router.get("/", async (req, res, next) => {
  try {
    const { category, q } = req.query;
    const filter = { active: { $ne: false } };
    if ((category && (typeof category !== "string" || category.length > 50)) ||
        (q && (typeof q !== "string" || q.length > 100))) return res.status(400).render("error", {
      title: "Invalid search", message: "Enter a shorter search or category.",
    });
    if (category) filter.category = category;
    if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const products = await Product.find(filter).sort({ createdAt: -1 });
    const categories = await Product.distinct("category", { active: { $ne: false } });

    const seo = catalogSEO(category, Boolean(q), categories.includes(category));
    res.set("X-Robots-Tag", seo.robots);
    if (res.locals.currentUser) res.set("Cache-Control", "private, no-store");
    res.render("index", {
      seo, gaPage: gaPage("catalog", seo),
      title: "MotoParts Nepal — Genuine Motorcycle Parts",
      products,
      recommendations: await recommendations(res.locals.currentUser?._id),
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
    const product = await Product.findOne({ slug: req.params.slug, active: { $ne: false } });
    if (!product) {
      return res.status(404).render("404", { title: "Part not found" });
    }
    const seo = productSEO(product);
    res.set("X-Robots-Tag", seo.robots);
    if (res.locals.currentUser) res.set("Cache-Control", "private, no-store");
    res.render("product", { seo, gaPage: gaPage("product", seo, product), title: product.name, product, marketingPage: "product",
      recommendations: await recommendations(res.locals.currentUser?._id, { excludeId: product._id }),
      marketingProduct: { id: String(product._id), name: product.name, value: product.price, currency: "NPR" } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
