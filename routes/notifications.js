const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.flash("error", "Please log in to view notifications.");
    return res.redirect("/auth/login");
  }
  next();
}

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(50);

    // mark everything as read once the user opens the inbox
    await Notification.updateMany(
      { user: req.session.userId, read: false },
      { $set: { read: true } }
    );

    res.render("notifications", { title: "Notifications", notifications });
  } catch (err) {
    next(err);
  }
});

module.exports = router;