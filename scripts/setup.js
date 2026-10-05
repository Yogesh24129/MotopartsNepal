const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function setup(root, forceLocal = false) {
  const envPath = path.join(root, ".env");
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(path.join(root, ".env.example"), "utf8");
  function set(key, value) {
    const expression = new RegExp(`^${key}=.*$`, "m");
    text = expression.test(text) ? text.replace(expression, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  if (!/^SESSION_SECRET=(?!replace-with-a-long-random-secret\s*$).+/m.test(text)) set("SESSION_SECRET", crypto.randomBytes(32).toString("hex"));
  if (forceLocal) {
    if (/^NODE_ENV=production\s*$/m.test(text)) throw new Error("Local demo setup cannot run with NODE_ENV=production.");
    set("DB_MODE", "local");
    // Preserve external credentials; local mode ignores MONGO_URI.
  }
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log("Setup complete. Run npm start. Local mode automatically seeds an empty catalog and preserves existing data.");
}
if (require.main === module) {
  try { setup(path.join(__dirname, ".."), process.argv.includes("--local")); }
  catch (error) { console.error("Setup failed:", error.message); process.exitCode = 1; }
}
module.exports = { setup };
