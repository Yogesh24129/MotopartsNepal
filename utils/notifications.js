const Notification = require("../models/Notification");

// Safe to call even for guest checkouts — does nothing if there's no logged-in user
async function notifyUser(userId, message, options = {}) {
  if (!userId) return;
  await Notification.create({
    user: userId,
    message,
    type: options.type || "order",
    link: options.link || "/",
  });
}

module.exports = { notifyUser };