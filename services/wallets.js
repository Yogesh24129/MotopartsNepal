const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { money, httpError } = require("../utils/validation");

async function getOrCreateWallet(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError(401, "Please log in again.");
  try {
    return await Wallet.findOneAndUpdate({ user: userId }, { $setOnInsert: {
      ownerName: user.name, email: user.email, balance: 0,
    } }, { upsert: true, new: true, runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Wallet.findOne({ user: userId });
  }
}

async function transfer(userId, recipientId, value, note = "") {
  const amount = money(value);
  if (!amount || !mongoose.isValidObjectId(recipientId)) throw httpError(400, "Enter a recipient and a valid amount (up to two decimal places).");
  const wallet = await getOrCreateWallet(userId);
  if (String(wallet._id) === String(recipientId)) throw httpError(400, "You can't transfer money to yourself.");
  return mongoose.connection.transaction(async (session) => {
    const recipient = await Wallet.findById(recipientId).session(session);
    if (!recipient) throw httpError(404, "Recipient account not found.");
    const sender = await Wallet.findOneAndUpdate(
      { _id: wallet._id, balance: { $gte: amount } },
      [{ $set: { balance: { $round: [{ $subtract: ["$balance", amount] }, 2] } } }],
      { session, new: true }
    );
    if (!sender) throw httpError(409, "Insufficient wallet balance.");
    await Wallet.updateOne({ _id: recipient._id },
      [{ $set: { balance: { $round: [{ $add: ["$balance", amount] }, 2] } } }], { session });
    await Transaction.create([{ type: "transfer", status: "completed", fromWallet: sender._id,
      toWallet: recipient._id, amount, note: typeof note === "string" ? note.slice(0, 200) : "" }], { session });
    return recipient;
  });
}

async function completeTopup(uuid, refId) {
  return mongoose.connection.transaction(async (session) => {
    const txn = await Transaction.findOne({ esewaTransactionUuid: uuid, type: "topup" }).session(session);
    if (!txn) throw httpError(404, "Top-up record not found.");
    if (txn.status === "completed") return { txn, changed: false };
    if (txn.status !== "pending") throw httpError(409, "This top-up is no longer pending.");
    const result = await Wallet.updateOne({ _id: txn.toWallet },
      [{ $set: { balance: { $round: [{ $add: ["$balance", txn.amount] }, 2] } } }], { session });
    if (result.matchedCount !== 1) throw httpError(404, "Wallet not found.");
    txn.status = "completed";
    txn.esewaRefId = refId;
    await txn.save({ session });
    return { txn, changed: true };
  });
}

module.exports = { getOrCreateWallet, transfer, completeTopup };
