const express = require("express");
const router = express.Router();
const { recordEvents } = require("../services/marketing");
const { requireAdmin } = require("../middleware/admin");

router.post("/events", async (req, res, next) => {
  try {
    await recordEvents(req, req.body.events);
    res.sendStatus(204);
  } catch (error) { next(error); }
});

router.get("/dashboard", requireAdmin, (req, res) => res.redirect("/admin/marketing"));

module.exports = router;
