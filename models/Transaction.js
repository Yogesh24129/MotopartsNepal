const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["topup", "transfer"], required: true },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "completed" },
    fromWallet: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", default: null },
    toWallet: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true },
    amount: { type: Number, required: true, min: 0.01 },
    note: { type: String, default: "" },
    esewaTransactionUuid: { type: String, unique: true, sparse: true },
    esewaRefId: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);