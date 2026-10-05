const crypto = require("crypto");
const { httpError } = require("../utils/validation");

function csrfProtection(req, res, next) {
  req.session.csrfToken ||= crypto.randomBytes(32).toString("hex");
  res.locals.csrfToken = req.session.csrfToken;
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const token = req.body?._csrf || req.get("x-csrf-token");
  if (typeof token !== "string" || Buffer.byteLength(token) !== Buffer.byteLength(req.session.csrfToken) ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrfToken))) {
    return next(httpError(403, "Your form expired. Reload the page and try again."));
  }
  next();
}

module.exports = { csrfProtection };
