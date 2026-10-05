const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["topup", "transfer"], required: true },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "completed" },
    fromWallet: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", default: null },
    toWallet: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true },
    amount: { type: Number, required: true },
    note: { type: String, default: "" },
    esewaTransactionUuid: { type: String },
    esewaRefId: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);