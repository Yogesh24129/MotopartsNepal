const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  contactName: { type: String, trim: true, maxlength: 100, default: "" },
  email: { type: String, trim: true, lowercase: true, default: "" },
  whatsapp: { type: String, trim: true, default: "" },
  whatsappOptIn: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
}, { timestamps: true });
module.exports = mongoose.model("ShippingPartner", schema);
