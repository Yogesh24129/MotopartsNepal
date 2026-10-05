require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const { createApp } = require("./app");

async function start() {
  await connectDB();
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== "isdbgrid") {
    throw new Error("MongoDB must be a replica set or Atlas cluster to support payment and wallet transactions. See README.md.");
  }
  const app = createApp();
  // Create collections and unique indexes before processing transactions.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`MotoParts Nepal running at http://localhost:${port}`));
  const keyPath = path.join(__dirname, "certs", "localhost-key.pem");
  const certPath = path.join(__dirname, "certs", "localhost-cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsPort = process.env.HTTPS_PORT || 3443;
    https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
      .listen(httpsPort, () => console.log(`MotoParts Nepal HTTPS running at https://localhost:${httpsPort}`));
  }
}

start().catch(async (error) => {
  console.error("Startup failed:", error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
});
