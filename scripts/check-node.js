const [major, minor] = process.versions.node.split(".").map(Number);
if (!(major >= 24 || major === 22 && minor >= 13)) {
  console.error("MotoParts requires Node.js 22.13+ (22.x) or 24+. Install a supported Node.js LTS release, then reopen your terminal.");
  process.exitCode = 1;
}
