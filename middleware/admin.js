const { httpError } = require("../utils/validation");
function requireAdmin(req, res, next) {
  res.set("Cache-Control", "private, no-store");
  if (!res.locals.currentUser) return res.redirect("/auth/login");
  if (res.locals.currentUser.role !== "admin") return next(httpError(403, "Administrator access is required."));
  next();
}
module.exports = { requireAdmin };
