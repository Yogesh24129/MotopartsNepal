require("dotenv").config();
const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");

const wallets = [
  { ownerName: "Yogjung Thapa", email: "yogjung@example.com", balance: 5000 },
  { ownerName: "Rita Sharma", email: "rita@example.com", balance: 2000 },
  { ownerName: "Bikash Gurung", email: "bikash@example.com", balance: 1000 },
];

async function seedWallets() {
  await mongoose.connect(process.env.MONGO_URI);
  await Wallet.deleteMany({});
  await Wallet.insertMany(wallets);
  console.log(`Seeded ${wallets.length} wallets.`);
  process.exit(0);
}

seedWallets();