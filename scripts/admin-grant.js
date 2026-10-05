const mongoose = require("mongoose");
const User = require("../models/User");
const AdminAudit = require("../models/AdminAudit");
const connectDB = require("../config/db");
async function grant(email, revoke = false) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usage: npm run admin:grant -- your-registered-email [--revoke]");
  const user = await User.findOneAndUpdate({ email: email.trim().toLowerCase() },
    { $set: { role: revoke ? "customer" : "admin" } }, { new: true, runValidators: true });
  if (!user) throw new Error("Account not found. Register your account on the website first.");
  await AdminAudit.create({ actor: user._id, target: user._id, action: revoke ? "admin_revoked" : "admin_granted",
    summary: "Administrator role updated by the database operator." });
  console.log(revoke ? "Administrator access removed." : "Administrator access enabled. Log in and open /admin.");
}
if (require.main === module) {
  require("dotenv").config();
  connectDB().then(() => grant(process.argv[2], process.argv.includes("--revoke")))
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
module.exports = { grant };
