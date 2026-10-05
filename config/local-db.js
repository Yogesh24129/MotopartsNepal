const fs = require("node:fs");
const path = require("node:path");

function localMode() { return process.env.DB_MODE === "local"; }
function databaseUri() {
  if (localMode()) return `mongodb://127.0.0.1:${process.env.LOCAL_MONGO_PORT || 27018}/motoparts_nepal?replicaSet=motoparts-local`;
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI for Atlas/external MongoDB, or run npm run setup -- --local for a Docker-free demo.");
  return process.env.MONGO_URI;
}

async function startLocalDatabase({ directory = path.join(__dirname, "../.local-data/mongo"), port = Number(process.env.LOCAL_MONGO_PORT || 27018) } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("DB_MODE=local is for development only. Use MongoDB Atlas in production.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("LOCAL_MONGO_PORT must be a valid port.");
  fs.mkdirSync(directory, { recursive: true });
  // MongoDB also locks its data files; this gives duplicate app starts a clearer error.
  const lock = path.join(directory, ".app-lock");
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid local database lock. Check that the app is stopped before removing .local-data/mongo/.app-lock.");
    try { process.kill(pid, 0); throw new Error("The local database is already running. Stop the other app before starting another."); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
  let database;
  try {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    const { MongoClient } = require("mongodb");
    console.log("[MongoDB] Starting local demo database (first launch downloads MongoDB; no Docker needed)...");
    database = new MongoMemoryServer({
      binary: { version: "8.0.17" },
      instance: { port, dbPath: directory, replSet: "motoparts-local", ip: "127.0.0.1", storageEngine: "wiredTiger" },
    });
    await database.start(true); // Persistent replica-set members must retain their configured port.
    const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`);
    try {
      await client.connect();
      const admin = client.db("admin");
      try { await admin.command({ replSetGetConfig: 1 }); }
      catch (error) {
        if (error.code !== 94) throw error;
        await admin.command({ replSetInitiate: { _id: "motoparts-local", members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
      }
      const deadline = Date.now() + 30000;
      while (!(await admin.command({ hello: 1 })).isWritablePrimary) {
        if (Date.now() > deadline) throw new Error("Local MongoDB did not become ready within 30 seconds.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally { await client.close(); }
    return { uri: `mongodb://127.0.0.1:${port}/motoparts_nepal?replicaSet=motoparts-local`, async stop() {
      try { await database.stop({ doCleanup: false }); }
      finally { fs.rmSync(lock, { force: true }); }
    } };
  } catch (error) {
    if (database) await database.stop({ doCleanup: false }).catch(() => {});
    fs.rmSync(lock, { force: true });
    throw error;
  }
}

module.exports = { localMode, databaseUri, startLocalDatabase };
