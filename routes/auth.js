const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function establishLogin(req, user) {
  const { cart, checkoutOwner, marketingConsent, marketingVisitor } = req.session;
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.cart = cart;
  req.session.checkoutOwner = checkoutOwner;
  req.session.marketingConsent = marketingConsent;
  req.session.marketingVisitor = marketingVisitor;
  req.session.userId = String(user._id);
}

// Registration page
router.get("/register", (req, res) => {
  res.render("register", { title: "Create Account" });
});

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if ([name, email, password].some((value) => typeof value !== "string" || !value.trim())) {
      req.flash("error", "Please fill in all fields.");
      return res.redirect("/auth/register");
    }
    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect("/auth/register");
    }
    if (password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {
      req.flash("error", "Password must be at least 6 characters and at most 72 bytes.");
      return res.redirect("/auth/register");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      req.flash("error", "Enter a valid email address.");
      return res.redirect("/auth/register");
    }
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      req.flash("error", "An account with that email already exists.");
      return res.redirect("/auth/register");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    await establishLogin(req, user);
    req.flash("success", `Welcome, ${user.name}!`);
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

// Login page
router.get("/login", (req, res) => {
  res.render("login", { title: "Log In" });
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== "string" || typeof password !== "string") {
      req.flash("error", "Invalid email or password.");
      return res.redirect("/auth/login");
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      req.flash("error", "Invalid email or password.");
      return res.redirect("/auth/login");
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      req.flash("error", "Invalid email or password.");
      return res.redirect("/auth/login");
    }

    await establishLogin(req, user);
    req.flash("success", `Welcome back, ${user.name}!`);
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

// Logout
router.post("/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

module.exports = router;