require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Wallet = require("../models/Wallet");
const User = require("../models/User");

const examples = [
  { name: "Yogjung Thapa", email: "yogjung@example.com", balance: 5000 },
  { name: "Rita Sharma", email: "rita@example.com", balance: 2000 },
  { name: "Bikash Gurung", email: "bikash@example.com", balance: 1000 },
];

async function seedWallets() {
  if (process.env.NODE_ENV === "production") throw new Error("Fixture wallets cannot be seeded in production.");
  if (process.env.NODE_ENV !== "test" && !process.env.FIXTURE_WALLET_PASSWORD) throw new Error("Set FIXTURE_WALLET_PASSWORD before creating development fixtures.");
  const passwordHash = await bcrypt.hash(process.env.FIXTURE_WALLET_PASSWORD || (process.env.NODE_ENV === "test" ? "TestingWallet123!" : ""), 10);
  for (const example of examples) {
    const user = await User.findOneAndUpdate({ email: example.email },
      { $setOnInsert: { name: example.name, email: example.email, passwordHash } },
      { upsert: true, new: true, runValidators: true });
    await Wallet.findOneAndUpdate({ user: user._id },
      { $setOnInsert: { ownerName: user.name, email: user.email, balance: example.balance } },
      { upsert: true, runValidators: true });
  }
  console.log("Fixture wallet accounts are ready. Existing passwords and balances were preserved.");
}

if (require.main === module) {
  require("../config/db")()
    .then(seedWallets).catch((error) => { console.error("Wallet seed failed:", error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}

module.exports = { seedWallets };
