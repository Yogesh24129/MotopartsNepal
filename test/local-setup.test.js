const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const mongoose = require("mongoose");
const { setup } = require("../scripts/setup");
const { startLocalDatabase, databaseUri } = require("../config/local-db");
const { seedProducts } = require("../seed/seed");
const Product = require("../models/Product");

test("Docker-free setup creates a secret and preserves existing credentials on rerun", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "motoparts-setup-"));
  try {
    fs.copyFileSync(path.join(__dirname, "../.env.example"), path.join(root, ".env.example"));
    setup(root, true);
    const first = fs.readFileSync(path.join(root, ".env"), "utf8");
    assert.match(first, /^SESSION_SECRET=[a-f0-9]{64}$/m);
    assert.match(first, /^DB_MODE=local$/m);
    setup(root, true);
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), first);
    fs.writeFileSync(path.join(root, ".env"), "DB_MODE=external\nMONGO_URI=mongodb+srv://existing\nSESSION_SECRET=my-existing-secret\nGA4_ENABLED=true\n");
    setup(root, true);
    const preserved = fs.readFileSync(path.join(root, ".env"), "utf8");
    assert.match(preserved, /MONGO_URI=mongodb\+srv:\/\/existing/);
    assert.match(preserved, /SESSION_SECRET=my-existing-secret/);
    assert.match(preserved, /GA4_ENABLED=true/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("local MongoDB preserves catalog and transaction data across restarts without Docker", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "motoparts-db-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  let database;
  try {
    database = await startLocalDatabase({ directory: root, port });
    await mongoose.connect(database.uri);
    await Product.init();
    await seedProducts();
    const count = await Product.countDocuments();
    assert.ok(count > 0);
    await assert.rejects(startLocalDatabase({ directory: root, port }), /already running/);
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Product.updateOne({}, { $set: { stock: 7 } }, { session });
    });
    await session.endSession();
    const saved = await Product.findOne({ stock: 7 });
    await mongoose.disconnect();
    await database.stop();
    const nextPort = net.createServer();
    await new Promise((resolve) => nextPort.listen(0, "127.0.0.1", resolve));
    const changedPort = nextPort.address().port;
    await new Promise((resolve) => nextPort.close(resolve));
    database = await startLocalDatabase({ directory: root, port: changedPort });
    await mongoose.connect(database.uri);
    await seedProducts();
    assert.equal(await Product.countDocuments(), count);
    assert.equal((await Product.findById(saved._id)).stock, 7);
  } finally {
    await mongoose.disconnect();
    if (database) await database.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("external mode requires a URI and production refuses managed local MongoDB", async () => {
  const mode = process.env.DB_MODE, uri = process.env.MONGO_URI, environment = process.env.NODE_ENV;
  try {
    process.env.DB_MODE = "external";
    delete process.env.MONGO_URI;
    assert.throws(databaseUri, /Set MONGO_URI/);
    process.env.NODE_ENV = "production";
    await assert.rejects(startLocalDatabase(), /development only/);
  } finally {
    for (const [key, value] of Object.entries({ DB_MODE: mode, MONGO_URI: uri, NODE_ENV: environment })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("HTTPS configuration preserves credentials while setting the correct Windows localhost origin", () => {
  const { configureHttps } = require("../scripts/https-setup");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "motoparts-https-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), "SESSION_SECRET=existing-secret\nDB_MODE=local\nAPP_BASE_URL=http://localhost:3000\n");
    configureHttps(root);
    const text = fs.readFileSync(path.join(root, ".env"), "utf8");
    assert.match(text, /^APP_BASE_URL=https:\/\/localhost:3443$/m);
    assert.match(text, /^HTTPS_PORT=3443$/m);
    assert.match(text, /^SESSION_SECRET=existing-secret$/m);
    configureHttps(root);
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), text);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
