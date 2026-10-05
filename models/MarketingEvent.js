const mongoose = require("mongoose");

const marketingEventSchema = new mongoose.Schema({
  visitor: { type: String, required: true, index: true },
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ["PageView", "ViewContent", "InitiateCheckout",
    "ProductImpression", "ProductClick", "PromotionImpression", "PromotionClick"] },
  page: { type: String, enum: ["catalog", "product", "checkout", "receipt"], required: true },
  targetId: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
});

module.exports = mongoose.model("MarketingEvent", marketingEventSchema);
