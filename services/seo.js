const SITE_NAME = "MotoParts Nepal";
const DEFAULT_DESCRIPTION = "Shop motorcycle spare parts, helmets, riding gear and accessories in Nepal. Find parts by brand, category and compatible bike model.";

function siteConfig() {
  if (process.env.NODE_ENV === "production" && !process.env.APP_BASE_URL) throw new Error("APP_BASE_URL is required for production canonical URLs.");
  const url = new URL(process.env.APP_BASE_URL || "http://localhost:3000");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_BASE_URL must be an HTTP(S) origin, without credentials, a path, query or fragment.");
  }
  return { origin: url.origin, indexing: process.env.SITE_INDEXING_ENABLED !== "false" };
}

function absolute(path) { return new URL(path, `${siteConfig().origin}/`).href; }
function serializeJsonLd(value) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
function description(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}...` : text;
}
function robots(indexable) { return indexable && siteConfig().indexing ? "index,follow" : "noindex,follow"; }
function privateSEO() {
  return { title: "", description: "Manage your MotoParts Nepal shopping account.", keywords: "",
    canonical: "", image: "", imageAlt: "", robots: "noindex,nofollow", type: "website", structuredData: null };
}
function exposeSEO(req, res, next) {
  res.locals.seo = privateSEO();
  res.locals.serializeJsonLd = serializeJsonLd;
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
}
function catalogSEO(category, searching, validCategory) {
  const selected = category && validCategory ? category : "";
  const canonical = absolute(selected ? `/?category=${encodeURIComponent(selected)}` : "/");
  const title = searching ? `Search Motorcycle Parts | ${SITE_NAME}` : selected
    ? `${selected} for Motorcycles in Nepal | ${SITE_NAME}` : `Motorcycle Spare Parts in Nepal | ${SITE_NAME}`;
  const summary = selected ? `Shop ${selected.toLowerCase()} for motorcycles in Nepal. Browse parts by brand, check compatible models and order from MotoParts Nepal.` : DEFAULT_DESCRIPTION;
  return { title, description: description(summary), canonical, keywords: ["motorcycle spare parts Nepal", "bike parts Kathmandu", selected || "helmets and riding gear"].join(", "),
    robots: robots(!searching && (!category || validCategory)), image: "", imageAlt: "", type: "website",
    structuredData: searching || (category && !validCategory) ? null : { "@context": "https://schema.org", "@type": selected ? "CollectionPage" : "WebSite",
      name: selected ? `${selected} — ${SITE_NAME}` : SITE_NAME, url: canonical, description: summary } };
}
function productSEO(product) {
  const canonical = absolute(`/product/${encodeURIComponent(product.slug)}`);
  const summary = description(`${product.name} by ${product.brand}. ${product.description || `Shop ${product.category.toLowerCase()} for motorcycles in Nepal.`}`);
  const image = absolute(product.image || "/images/placeholder-part.svg");
  return { title: `${product.name} in Nepal | ${SITE_NAME}`, description: summary,
    keywords: [product.name, product.brand, product.category, "motorcycle spare parts Nepal", ...product.compatibleModels].join(", "),
    canonical, image, imageAlt: `${product.name} by ${product.brand}`, robots: robots(true), type: "product",
    structuredData: [{ "@context": "https://schema.org", "@type": "Product", name: product.name, description: product.description || summary,
      image: [image], sku: String(product._id), brand: { "@type": "Brand", name: product.brand }, category: product.category,
      offers: { "@type": "Offer", url: canonical, priceCurrency: "NPR", price: product.price.toFixed(2),
        availability: `https://schema.org/${product.stock > 0 ? "InStock" : "OutOfStock"}` } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absolute("/") },
      { "@type": "ListItem", position: 2, name: product.category, item: absolute(`/?category=${encodeURIComponent(product.category)}`) },
      { "@type": "ListItem", position: 3, name: product.name, item: canonical },
    ] }] };
}

function gaPage(page, seo, product) {
  const routes = { catalog: "/", product: product ? `/product/${encodeURIComponent(product.slug)}` : "/product",
    checkout: "/checkout", receipt: "/purchase-complete" };
  if (!routes[page]) return null;
  return { location: absolute(routes[page]), title: page === "catalog" || page === "product" ? seo.title :
    page === "receipt" ? "Purchase status | MotoParts Nepal" : "Checkout | MotoParts Nepal" };
}
function xml(value) { return String(value).replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]); }

module.exports = { siteConfig, absolute, exposeSEO, privateSEO, serializeJsonLd, catalogSEO, productSEO, gaPage, xml };
