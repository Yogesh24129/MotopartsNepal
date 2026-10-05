require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const methodOverride = require("method-override");
const morgan = require("morgan");

const connectDB = require("./config/db");
const { exposeCartCount, exposeCurrentUser } = require("./middleware/cart");

const productRoutes = require("./routes/products");
const cartRoutes = require("./routes/cart");
const checkoutRoutes = require("./routes/checkout");
const paymentRoutes = require("./routes/payment");
const walletRoutes = require("./routes/wallet");
const authRoutes = require("./routes/auth");
const notificationRoutes = require("./routes/notifications");
const { exposeNotificationCount } = require("./middleware/notifications");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/motoparts_nepal";

connectDB();

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Core middleware
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

// Server-side session, persisted in MongoDB -> this is what makes the
// shopping cart genuinely "server-side" rather than just client-side JS.
app.use(
  session({
    secret: process.env.SESSION_SECRET || "motoparts-dev-secret",
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: "sessions" }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 days
  })
);

app.use(flash());

// Make flash messages + cart count available in every EJS view
app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});
app.use(exposeCartCount);
app.use(exposeCurrentUser);
app.use(exposeNotificationCount);

// Routes
app.use("/", productRoutes);
app.use("/cart", cartRoutes);
app.use("/checkout", checkoutRoutes);
app.use("/payment", paymentRoutes);
app.use("/wallet", walletRoutes);
app.use("/auth", authRoutes);
app.use("/notifications", notificationRoutes);

// 404
app.use((req, res) => {
  res.status(404).render("404", { title: "Page not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", {
    title: "Something went wrong",
    message: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`MotoParts Nepal running at http://localhost:${PORT}`);
});

// HTTPS — uses the self-signed certificate in /certs (see WHATSAPP-SETUP.md /
// README for how to trust it in your browser). Runs alongside HTTP above.
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const keyPath = path.join(__dirname, "certs", "localhost-key.pem");
const certPath = path.join(__dirname, "certs", "localhost-cert.pem");

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
  https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
    console.log(`MotoParts Nepal (HTTPS) running at https://localhost:${HTTPS_PORT}`);
  });
} else {
  console.log("[HTTPS] Certificate files not found in /certs — HTTPS server not started.");
}
