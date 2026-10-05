const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");

// Registration page
router.get("/register", (req, res) => {
  res.render("register", { title: "Create Account" });
});

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password) {
      req.flash("error", "Please fill in all fields.");
      return res.redirect("/auth/register");
    }
    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect("/auth/register");
    }
    if (password.length < 6) {
      req.flash("error", "Password must be at least 6 characters.");
      return res.redirect("/auth/register");
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      req.flash("error", "An account with that email already exists.");
      return res.redirect("/auth/register");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    req.session.userId = user._id;
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
    const user = await User.findOne({ email: (email || "").toLowerCase() });

    if (!user) {
      req.flash("error", "Invalid email or password.");
      return res.redirect("/auth/login");
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      req.flash("error", "Invalid email or password.");
      return res.redirect("/auth/login");
    }

    req.session.userId = user._id;
    req.flash("success", `Welcome back, ${user.name}!`);
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

// Logout
router.post("/logout", (req, res) => {
  req.session.userId = null;
  res.redirect("/");
});

module.exports = router;