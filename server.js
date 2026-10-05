require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const { createApp } = require("./app");
const { localMode, startLocalDatabase } = require("./config/local-db");
const { seedProducts } = require("./seed/seed");
let localDatabase;
const servers = [];
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await mongoose.disconnect();
  if (localDatabase) await localDatabase.stop();
}
process.once("SIGINT", () => { stop().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { stop().finally(() => process.exit(0)); });

async function start() {
  if (localMode()) localDatabase = await startLocalDatabase();
  await connectDB();
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== "isdbgrid") {
    throw new Error("MongoDB must be a replica set or Atlas cluster to support payment and wallet transactions. See README.md.");
  }
  const app = createApp();
  // Create collections and unique indexes before processing transactions.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  if (localMode()) await seedProducts();
  const port = process.env.PORT || 3000;
  const httpServer = app.listen(port, () => console.log(`MotoParts Nepal running at http://localhost:${port}`));
  servers.push(httpServer);
  httpServer.on("error", (error) => { console.error("HTTP startup failed:", error.message); stop().finally(() => process.exit(1)); });
  const keyPath = path.join(__dirname, "certs", "localhost-key.pem");
  const certPath = path.join(__dirname, "certs", "localhost-cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsPort = process.env.HTTPS_PORT || 3443;
    const httpsServer = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
      .listen(httpsPort, () => console.log(`MotoParts Nepal HTTPS running at https://localhost:${httpsPort}`));
    servers.push(httpsServer);
    httpsServer.on("error", (error) => { console.error("HTTPS startup failed:", error.message); stop().finally(() => process.exit(1)); });
  }
}

start().catch(async (error) => {
  console.error("Startup failed:", error.message);
  await stop();
  process.exitCode = 1;
});
