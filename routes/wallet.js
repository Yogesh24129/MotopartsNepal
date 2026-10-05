const express = require("express");
const router = express.Router();
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const esewa = require("../utils/esewa");

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.flash("error", "Please log in to access your wallet.");
    return res.redirect("/auth/login");
  }
  next();
}

// Finds the logged-in user's wallet, creating one the first time they visit
async function getOrCreateWallet(userId) {
  let wallet = await Wallet.findOne({ user: userId });
  if (!wallet) {
    const user = await User.findById(userId);
    wallet = await Wallet.create({
      user: user._id,
      ownerName: user.name,
      email: user.email,
      balance: 0,
    });
  }
  return wallet;
}

// Wallet dashboard
router.get("/", requireLogin, async (req, res, next) => {
  try {
    const wallet = await getOrCreateWallet(req.session.userId);
    const otherWallets = await Wallet.find({ _id: { $ne: wallet._id } }).sort({ ownerName: 1 });
    const transactions = await Transaction.find({
      $or: [{ fromWallet: wallet._id }, { toWallet: wallet._id }],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("fromWallet toWallet");

    res.render("wallet", { title: "My Wallet", wallet, otherWallets, transactions });
  } catch (err) {
    next(err);
  }
});

// Top up
router.post("/topup", requireLogin, async (req, res, next) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
      req.flash("error", "Enter a valid top-up amount.");
      return res.redirect("/wallet");
    }

    const wallet = await getOrCreateWallet(req.session.userId);
    wallet.balance += amount;
    await wallet.save();

    await Transaction.create({
      type: "topup",
      toWallet: wallet._id,
      amount,
      note: "Wallet top-up",
    });

    req.flash("success", `Rs. ${amount} added to your wallet.`);
    res.redirect("/wallet");
  } catch (err) {
    next(err);
  }
});
// Start an eSewa-backed top-up
router.post("/topup/esewa/start", requireLogin, async (req, res, next) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
      req.flash("error", "Enter a valid top-up amount.");
      return res.redirect("/wallet");
    }

    const wallet = await getOrCreateWallet(req.session.userId);
    const transactionUuid = `topup-${wallet._id}-${Date.now()}`;

    const pendingTxn = await Transaction.create({
      type: "topup",
      status: "pending",
      toWallet: wallet._id,
      amount,
      note: "Wallet top-up via eSewa",
      esewaTransactionUuid: transactionUuid,
    });

    const signature = esewa.generateSignature(amount, transactionUuid);
    const fields = {
      amount,
      tax_amount: 0,
      total_amount: amount,
      transaction_uuid: transactionUuid,
      product_code: esewa.PRODUCT_CODE,
      product_service_charge: 0,
      product_delivery_charge: 0,
      success_url: `${req.protocol}://${req.get("host")}/wallet/topup/esewa/callback`,
      failure_url: `${req.protocol}://${req.get("host")}/wallet/topup/esewa/failure/${pendingTxn._id}`,
      signed_field_names: "total_amount,transaction_uuid,product_code",
      signature,
    };

    res.render("esewa-redirect", { title: "Redirecting to eSewa", gatewayUrl: esewa.GATEWAY_FORM_URL, fields });
  } catch (err) {
    next(err);
  }
});

router.get("/topup/esewa/callback", requireLogin, async (req, res, next) => {
  try {
    const raw = Buffer.from(req.query.data, "base64").toString("utf-8");
    const payload = JSON.parse(raw);

    if (!esewa.verifySignature(payload)) {
      req.flash("error", "eSewa response signature did not match.");
      return res.redirect("/wallet");
    }

    const txn = await Transaction.findOne({ esewaTransactionUuid: payload.transaction_uuid });
    if (!txn) {
      req.flash("error", "Top-up record not found.");
      return res.redirect("/wallet");
    }

    const statusResult = await esewa.checkTransactionStatus(txn.amount, payload.transaction_uuid);

    if (statusResult.status === "COMPLETE" && txn.status === "pending") {
      txn.status = "completed";
      txn.esewaRefId = statusResult.ref_id;
      await txn.save();
      await Wallet.findByIdAndUpdate(txn.toWallet, { $inc: { balance: txn.amount } });
      req.flash("success", `Rs. ${txn.amount} added to your wallet via eSewa.`);
    } else {
      txn.status = "failed";
      await txn.save();
      req.flash("error", "eSewa top-up could not be confirmed.");
    }

    res.redirect("/wallet");
  } catch (err) {
    next(err);
  }
});

router.get("/topup/esewa/failure/:txnId", requireLogin, async (req, res) => {
  await Transaction.findByIdAndUpdate(req.params.txnId, { status: "failed" });
  req.flash("error", "eSewa top-up was cancelled or failed.");
  res.redirect("/wallet");
});

// Peer-to-peer transfer
router.post("/transfer", requireLogin, async (req, res, next) => {
  try {
    const { toWalletId, amount, note } = req.body;
    const transferAmount = parseFloat(amount);

    const sender = await getOrCreateWallet(req.session.userId);

    if (!toWalletId || isNaN(transferAmount) || transferAmount <= 0) {
      req.flash("error", "Enter a recipient and a valid amount.");
      return res.redirect("/wallet");
    }
    if (toWalletId === String(sender._id)) {
      req.flash("error", "You can't transfer money to yourself.");
      return res.redirect("/wallet");
    }

    const recipient = await Wallet.findById(toWalletId);
    if (!recipient) {
      req.flash("error", "Recipient account not found.");
      return res.redirect("/wallet");
    }
    if (sender.balance < transferAmount) {
      req.flash("error", "Insufficient wallet balance.");
      return res.redirect("/wallet");
    }

    sender.balance -= transferAmount;
    recipient.balance += transferAmount;
    await sender.save();
    await recipient.save();

    await Transaction.create({
      type: "transfer",
      fromWallet: sender._id,
      toWallet: recipient._id,
      amount: transferAmount,
      note: note || "",
    });

    req.flash("success", `Sent Rs. ${transferAmount} to ${recipient.ownerName}.`);
    res.redirect("/wallet");
  } catch (err) {
    next(err);
  }
});

module.exports = router;