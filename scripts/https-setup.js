const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function configureHttps(root) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) throw new Error("Run npm run setup first.");
  let text = fs.readFileSync(envPath, "utf8");
  function set(key, value) {
    const expression = new RegExp(`^${key}=.*$`, "m");
    text = expression.test(text) ? text.replace(expression, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  set("HTTPS_PORT", "3443");
  set("APP_BASE_URL", "https://localhost:3443");
  fs.writeFileSync(envPath, text, { mode: 0o600 });
}
function activate(root) {
  const check = spawnSync("mkcert", ["-version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) throw new Error("Install mkcert first: winget install --exact --id FiloSottile.mkcert. Reopen your terminal afterward.");
  const directory = path.join(root, "certs");
  fs.mkdirSync(directory, { recursive: true });
  for (const args of [["-install"], ["-cert-file", path.join(directory, "localhost-cert.pem"),
    "-key-file", path.join(directory, "localhost-key.pem"), "localhost", "127.0.0.1", "::1"]]) {
    const result = spawnSync("mkcert", args, { stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error("Certificate setup failed. Review the mkcert output and Windows certificate-trust prompt.");
  }
  configureHttps(root);
  console.log("HTTPS configured. Restart the app and open https://localhost:3443.");
}
if (require.main === module) {
  try { activate(path.join(__dirname, "..")); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { configureHttps, activate };
