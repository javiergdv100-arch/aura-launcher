import { Client } from "minecraft-launcher-core";
import prismarineAuth from "prismarine-auth";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { Authflow, Titles } = prismarineAuth;

const rawArg = process.argv[2] ?? "{}";
const payload = rawArg.startsWith("@")
  ? JSON.parse(fs.readFileSync(rawArg.slice(1), "utf8"))
  : JSON.parse(rawArg);
const instanceName = payload.name ?? "Aura Instance";
const versionNumber = payload.mcVersion ?? "1.21.1";
const memoryMax = payload.memoryMax ?? "4G";
const memoryMin = payload.memoryMin ?? "2G";
const root = payload.root ?? path.join(process.env.APPDATA ?? os.homedir(), "AuraLauncher", "minecraft");
const logsDir = path.join(root, "logs");
const cacheDir = path.join(root, "auth-cache");

fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, "aura-launch.log");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logFile, line);
  process.stdout.write(line);
}

async function main() {
  log(`Starting Aura Minecraft launch for ${instanceName} (${versionNumber})`);
  log("Authenticating with Microsoft using device-code login.");

  fs.mkdirSync(cacheDir, { recursive: true });

  const authflow = new Authflow(
    "aura-launcher-player",
    cacheDir,
    {
      flow: "live",
      authTitle: Titles.MinecraftJava
    },
    (code) => {
      log("");
      log("=== MICROSOFT LOGIN REQUIRED ===");
      log(code.message);
      log(`Code: ${code.user_code}`);
      log(`URL: ${code.verification_uri}`);
      log("Keep this window open. Minecraft will launch after login completes.");
      log("================================");
      log("");
    }
  );

  const minecraftToken = await authflow.getMinecraftJavaToken({
    fetchProfile: true,
    fetchEntitlements: true
  });

  const licenses = minecraftToken.entitlements?.items?.map((item) => item.name) ?? [];
  if (!licenses.includes("game_minecraft") && !licenses.includes("product_minecraft")) {
    log("Minecraft Java ownership was not detected. If launch fails, confirm this account owns Minecraft Java Edition.");
  }

  const launcher = new Client();
  const options = {
    clientPackage: null,
    authorization: {
      access_token: minecraftToken.token,
      client_token: minecraftToken.profile.id,
      uuid: minecraftToken.profile.id,
      name: minecraftToken.profile.name,
      user_properties: "{}",
      meta: {
        type: "msa",
        demo: false
      }
    },
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
