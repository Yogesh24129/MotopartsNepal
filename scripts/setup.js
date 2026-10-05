const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function setup(root, forceLocal = false) {
  require("./check-node");
  if (process.exitCode) throw new Error("Unsupported Node.js version.");
  const envPath = path.join(root, ".env");
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(path.join(root, ".env.example"), "utf8");
  function set(key, value) {
    const expression = new RegExp(`^${key}=.*$`, "m");
    text = expression.test(text) ? text.replace(expression, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  if (!/^SESSION_SECRET=(?!replace-with-a-long-random-secret\s*$).+/m.test(text)) set("SESSION_SECRET", crypto.randomBytes(32).toString("hex"));
  if (forceLocal) {
    if (/^NODE_ENV=production\s*$/m.test(text)) throw new Error("Local setup cannot run with NODE_ENV=production.");
    set("DB_MODE", "local");
    // Preserve external credentials; local mode ignores MONGO_URI.
  }
  if (!/^PAYMENT_MODE=/m.test(text) && !/^NODE_ENV=production\s*$/m.test(text)) set("PAYMENT_MODE", "sandbox");
  if (/^PAYMENT_MODE=sandbox\s*$/m.test(text) && /^ESEWA_PRODUCT_CODE=EPAYTEST\s*$/m.test(text) &&
      /^ESEWA_GATEWAY_URL=https:\/\/rc-epay\.esewa\.com\.np\//m.test(text) && /^ESEWA_SECRET_KEY=\s*$/m.test(text)) {
    set("ESEWA_SECRET_KEY", "8gBm/:&EnhH.1/q");
  }
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log("Setup complete. Run npm start. Local mode automatically seeds an empty catalog and preserves existing data.");
}
if (require.main === module) {
  try { setup(path.join(__dirname, ".."), process.argv.includes("--local")); }
  catch (error) { console.error("Setup failed:", error.message); process.exitCode = 1; }
}
module.exports = { setup };
