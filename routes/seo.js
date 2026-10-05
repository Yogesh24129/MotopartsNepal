const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { siteConfig, absolute, xml } = require("../services/seo");

router.get("/robots.txt", (req, res) => {
  const { indexing } = siteConfig();
  const rules = indexing ? ["Allow: /", "Disallow: /admin", "Disallow: /auth/", "Disallow: /wallet", "Disallow: /cart", "Disallow: /checkout",
    "Disallow: /payment/", "Disallow: /notifications", "Disallow: /marketing/", "Disallow: /*?*q="] : ["Disallow: /"];
  res.type("text/plain").send(["User-agent: *", ...rules, `Sitemap: ${absolute("/sitemap.xml")}`, ""].join("\n"));
});

router.get("/sitemap.xml", async (req, res, next) => {
  try {
    const { indexing } = siteConfig();
    const products = indexing ? await Product.find({ active: { $ne: false } }).select("slug category updatedAt").sort({ slug: 1 }).lean() : [];
    const entries = indexing ? [`<url><loc>${xml(absolute("/"))}</loc></url>`] : [];
    const categories = [...new Set(products.map((product) => product.category))].sort();
    for (const category of categories) entries.push(`<url><loc>${xml(absolute(`/?category=${encodeURIComponent(category)}`))}</loc></url>`);
    for (const product of products) entries.push(`<url><loc>${xml(absolute(`/product/${encodeURIComponent(product.slug)}`))}</loc><lastmod>${new Date(product.updatedAt).toISOString()}</lastmod></url>`);
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>`);
  } catch (error) { next(error); }
});

module.exports = router;
