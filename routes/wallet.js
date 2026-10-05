const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const esewa = require("../utils/esewa");
const { getOrCreateWallet, transfer, completeTopup } = require("../services/wallets");
const { money, httpError } = require("../utils/validation");

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.flash("error", "Please log in to access your wallet.");
    return res.redirect("/auth/login");
  }
  next();
}

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const wallet = await getOrCreateWallet(req.session.userId);
    const otherWallets = await Wallet.find({ _id: { $ne: wallet._id } }).select("ownerName email").sort({ ownerName: 1 });
    const transactions = await Transaction.find({ $or: [{ fromWallet: wallet._id }, { toWallet: wallet._id }] })
      .sort({ createdAt: -1 }).limit(20).populate("fromWallet toWallet");
    res.render("wallet", { title: "My Wallet", wallet, otherWallets, transactions });
  } catch (error) { next(error); }
});

// Every top-up must go through gateway verification; no direct balance-credit route.
router.post("/topup/esewa/start", requireLogin, async (req, res, next) => {
  try {
    esewa.requireConfiguration();
    const amount = money(req.body.amount);
    if (!amount) throw httpError(400, "Enter a valid amount (up to two decimal places).");
    const wallet = await getOrCreateWallet(req.session.userId);
    const uuid = `topup-${wallet._id}-${crypto.randomUUID()}`;
    const txn = await Transaction.create({ type: "topup", status: "pending", toWallet: wallet._id, amount,
      note: "Wallet top-up via eSewa", esewaTransactionUuid: uuid });
    const fields = esewa.paymentFields(amount, uuid, "/wallet/topup/esewa/callback", `/wallet/topup/esewa/failure/${txn._id}`);
    res.render("esewa-redirect", { title: "Redirecting to eSewa", gatewayUrl: esewa.GATEWAY_FORM_URL, fields });
  } catch (error) { next(error); }
});

// Verification does not depend on a browser session surviving the gateway.
router.get("/topup/esewa/callback", async (req, res, next) => {
  try {
    const payload = esewa.decodeResponse(req.query.data);
    const txn = await Transaction.findOne({ type: "topup", esewaTransactionUuid: payload.transaction_uuid });
    if (!txn) throw httpError(404, "Top-up record not found.");
    const statusResult = await esewa.checkTransactionStatus(txn.amount, payload.transaction_uuid);
    esewa.validateStatus(statusResult, txn.amount, payload.transaction_uuid);
    if (statusResult.status === "COMPLETE") {
      await completeTopup(payload.transaction_uuid, statusResult.ref_id);
      req.flash("success", "Your wallet top-up has been confirmed.");
    } else req.flash("error", "Your top-up is awaiting confirmation. Please check again before starting another payment.");
    res.redirect("/wallet");
  } catch (error) { next(error); }
});

router.get("/topup/esewa/failure/:txnId", requireLogin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.txnId)) throw httpError(404, "Top-up record not found.");
    const wallet = await getOrCreateWallet(req.session.userId);
    const txn = await Transaction.findOne({ _id: req.params.txnId, toWallet: wallet._id, type: "topup" });
    if (!txn) throw httpError(404, "Top-up record not found.");
    if (txn.status !== "completed") req.flash("error", "Top-up was cancelled or could not be confirmed.");
    res.redirect("/wallet");
  } catch (error) { next(error); }
});

router.post("/transfer", requireLogin, async (req, res, next) => {
  try {
    const recipient = await transfer(req.session.userId, req.body.toWalletId, req.body.amount, req.body.note);
    req.flash("success", `Sent Rs. ${money(req.body.amount)} to ${recipient.ownerName}.`);
    res.redirect("/wallet");
  } catch (error) { next(error); }
});

module.exports = router;
