const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const MarketingEvent = require("../models/MarketingEvent");
const Order = require("../models/Order");
const { marketingConfig, recordEvents, dashboard } = require("../services/marketing");
const { httpError } = require("../utils/validation");

router.post("/consent", async (req, res, next) => {
  try {
    const { choice, returnTo } = req.body;
    if (!["granted", "denied"].includes(choice)) throw httpError(400, "Choose allow or decline.");
    if (!marketingConfig().enabled && choice === "granted") throw httpError(409, "Marketing measurement is disabled.");
    if (choice === "denied" && req.session.marketingVisitor) {
      const visitor = req.session.marketingVisitor;
      await MarketingEvent.deleteMany({ visitor });
      await Order.updateMany({ marketingVisitor: visitor }, { $unset: { marketingVisitor: 1 } });
      delete req.session.marketingVisitor;
    }
    if (choice === "granted") req.session.marketingVisitor ||= crypto.randomUUID();
    req.session.marketingConsent = choice;
    const destination = typeof returnTo === "string" && /^\/[a-zA-Z0-9/_-]*$/.test(returnTo) ? returnTo : "/";
    res.redirect(303, destination);
  } catch (error) { next(error); }
});

router.post("/events", async (req, res, next) => {
  try {
    await recordEvents(req, req.body.events);
    res.sendStatus(204);
  } catch (error) { next(error); }
});

router.get("/dashboard", async (req, res, next) => {
  try {
    if (!marketingConfig().dashboardEnabled) throw httpError(404, "Page not found.");
    const metrics = await dashboard(req.session.marketingVisitor);
    res.render("marketing-dashboard", { title: "Lab 7 · Digital Marketing", metrics });
  } catch (error) { next(error); }
});

module.exports = router;
