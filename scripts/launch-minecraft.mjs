import { Client } from "minecraft-launcher-core";
import { Auth } from "msmc";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const payload = JSON.parse(process.argv[2] ?? "{}");
const instanceName = payload.name ?? "Aura Instance";
const versionNumber = payload.mcVersion ?? "1.21.1";
const memoryMax = payload.memoryMax ?? "4G";
const memoryMin = payload.memoryMin ?? "2G";
const root = payload.root ?? path.join(process.env.APPDATA ?? os.homedir(), "AuraLauncher", "minecraft");
const logsDir = path.join(root, "logs");

fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, "aura-launch.log");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logFile, line);
  process.stdout.write(line);
}

async function main() {
  log(`Starting Aura Minecraft launch for ${instanceName} (${versionNumber})`);
  log("Opening Microsoft login flow. Use the browser window if prompted.");

  const authManager = new Auth("select_account");
  authManager.on("load", (_asset, message) => log(`Auth: ${message}`));

  const xboxManager = await authManager.launch("raw", {
    width: 980,
    height: 720,
    suppress: true
  });

  const minecraftToken = await xboxManager.getMinecraft();
  const entitlements = await minecraftToken.entitlements();

  if (!minecraftToken.isDemo() && !entitlements.includes("game_minecraft") && !entitlements.includes("product_minecraft")) {
    log("Minecraft Java ownership was not detected for this account.");
  }

  const launcher = new Client();
  const options = {
    clientPackage: null,
    authorization: minecraftToken.mclc(),
    root,
    version: {
      number: versionNumber,
      type: "release"
    },
    memory: {
      max: memoryMax,
      min: memoryMin
    }
  };

  launcher.on("debug", (event) => log(`Debug: ${event}`));
  launcher.on("data", (event) => log(`Minecraft: ${event}`));
  launcher.on("progress", (event) => log(`Progress: ${JSON.stringify(event)}`));
  launcher.on("close", (code) => {
    log(`Minecraft process closed with code ${code}`);
    process.exit(Number.isInteger(code) ? code : 0);
  });

  log(`Launching Minecraft ${versionNumber} from ${root}`);
  await launcher.launch(options);
}

main().catch((error) => {
  log(`Launch failed: ${error?.stack ?? error}`);
  process.exit(1);
});
