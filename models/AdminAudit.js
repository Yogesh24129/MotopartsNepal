const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  summary: { type: String, required: true, maxlength: 300 },
}, { timestamps: true });
module.exports = mongoose.model("AdminAudit", schema);
