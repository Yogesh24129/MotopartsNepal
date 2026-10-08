const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  partner: { type: mongoose.Schema.Types.ObjectId, ref: "ShippingPartner", required: true },
  channel: { type: String, enum: ["email", "whatsapp"], required: true },
  recipient: { type: String, required: true },
  subject: String,
  body: { type: String, required: true },
  orderVersion: { type: Date, required: true },
  partnerVersion: { type: Date, required: true },
  status: { type: String, enum: ["draft", "opened", "sending", "accepted", "unconfirmed"], default: "draft" },
  providerId: String,
  failure: String,
}, { timestamps: true });
schema.index({ order: 1, createdAt: -1 });
module.exports = mongoose.model("ShippingNotice", schema);
