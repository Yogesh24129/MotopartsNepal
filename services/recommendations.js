const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");

// Binary user–item interactions: repeat orders and quantities do not inflate affinity.
function rankCandidates(baskets, purchased) {
  const buyers = new Map();
  for (const basket of baskets) {
    for (const id of new Set(basket.products.map(String))) {
      if (!buyers.has(id)) buyers.set(id, new Set());
      buyers.get(id).add(String(basket._id));
    }
  }
  const scores = new Map();
  for (const [candidate, candidateBuyers] of buyers) {
    if (purchased.has(candidate)) continue;
    let score = 0;
    for (const seed of purchased) {
      const seedBuyers = buyers.get(seed);
      if (!seedBuyers) continue;
      let common = 0;
      for (const buyer of seedBuyers) if (candidateBuyers.has(buyer)) common++;
      score += common / Math.sqrt(seedBuyers.size * candidateBuyers.size);
    }
    if (score > 0) scores.set(candidate, score);
  }
  return scores;
}

async function recommendations(userId, { excludeId, limit = 4 } = {}) {
  if (!userId || !mongoose.isValidObjectId(userId)) return { mode: "hidden", products: [] };
  const own = await Order.distinct("items.product", { user: userId, paymentStatus: "paid" });
  const purchased = new Set(own.filter(Boolean).map(String));
  const excluded = [...purchased, ...(excludeId ? [String(excludeId)] : [])];
  let ranked = [];
  if (purchased.size) {
    // Select only anonymous account IDs and product IDs, never order/contact data.
    const baskets = await Order.aggregate([
      { $match: { paymentStatus: "paid", user: { $type: "objectId" } } },
      { $unwind: "$items" },
      { $match: { "items.product": { $type: "objectId" } } },
      { $group: { _id: "$user", products: { $addToSet: "$items.product" } } },
    ]);
    const scores = rankCandidates(baskets, purchased);
    const candidates = await Product.find({ _id: { $in: [...scores.keys()], $nin: excluded }, active: { $ne: false }, stock: { $gt: 0 } })
      .select("name slug brand price image stock").lean();
    ranked = candidates.sort((a, b) => scores.get(String(b._id)) - scores.get(String(a._id)) ||
      String(a._id).localeCompare(String(b._id))).slice(0, limit);
  }
  if (ranked.length) return { mode: "collaborative", products: ranked };
  // Cold start and sparse overlap: label these as browsing suggestions, not personalized CF.
  const products = await Product.find({ _id: { $nin: excluded }, active: { $ne: false }, stock: { $gt: 0 } })
    .select("name slug brand price image stock").sort({ createdAt: -1, _id: 1 }).limit(limit).lean();
  return { mode: "discovery", products };
}

module.exports = { recommendations, rankCandidates };
