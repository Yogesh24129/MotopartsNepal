const express = require("express");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const methodOverride = require("method-override");
const morgan = require("morgan");
const { exposeCartCount, exposeCurrentUser } = require("./middleware/cart");
const { exposeNotificationCount } = require("./middleware/notifications");
const { csrfProtection } = require("./middleware/csrf");

function createApp(options = {}) {
  const app = express();
  const production = process.env.NODE_ENV === "production";
  if (production && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production.");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  Object.assign(app.locals, { currentUser: null, cartCount: 0, notificationCount: 0, success: [], error: [], csrfToken: "" });
  if (options.logging !== false) app.use(morgan("dev"));
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));
  app.use(express.json({ limit: "20kb" }));
  app.use(methodOverride("_method"));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(session({
    secret: process.env.SESSION_SECRET || "motoparts-dev-secret",
    resave: false, saveUninitialized: false,
    store: options.store || MongoStore.create({ mongoUrl: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/motoparts_nepal?replicaSet=rs0", collectionName: "sessions" }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: "lax", secure: production },
  }));
  app.use(flash());
  app.use((req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    next();
  });
  app.use(csrfProtection);
  app.use(exposeCartCount);
  app.use(exposeCurrentUser);
  app.use(exposeNotificationCount);
  app.use("/", require("./routes/products"));
  app.use("/cart", require("./routes/cart"));
  app.use("/checkout", require("./routes/checkout"));
  app.use("/payment", require("./routes/payment"));
  app.use("/wallet", require("./routes/wallet"));
  app.use("/auth", require("./routes/auth"));
  app.use("/notifications", require("./routes/notifications"));
  app.use((req, res) => res.status(404).render("404", { title: "Page not found" }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.name === "CastError" || error.name === "ValidationError" ? 400 : 500);
    if (status >= 500) console.error(error);
    res.status(status).render("error", { title: "Something went wrong",
      message: status >= 500 && status !== 503 ? "Something went wrong. Please try again later." : error.message });
  });
  return app;
}

module.exports = { createApp };
