const Notification = require("../models/Notification");

async function exposeNotificationCount(req, res, next) {
  if (req.session.userId) {
    try {
      res.locals.notificationCount = await Notification.countDocuments({
      user: req.session.userId,
      read: false,
      });
    } catch (error) {
      return next(error);
    }
  } else {
    res.locals.notificationCount = 0;
  }
  next();
}

module.exports = { exposeNotificationCount };