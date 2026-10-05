const mongoose = require("mongoose");
const { databaseUri } = require("./local-db");

async function connectDB() {
  try {
    const uri = databaseUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log(`[MongoDB] Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error("[MongoDB] Connection error:", err.message);
    throw err;
  }
}

module.exports = connectDB;
