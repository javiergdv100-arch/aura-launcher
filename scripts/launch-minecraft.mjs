import { Client } from "minecraft-launcher-core";
import prismarineAuth from "prismarine-auth";
import { execFileSync, spawnSync } from "node:child_process";
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

function redactSecrets(message) {
  return String(message)
    .replace(/(--accessToken\s+)\S+/g, "$1<redacted>")
    .replace(/(--xuid\s+)\S+/g, "$1<redacted>");
}

function parseJavaMajor(versionOutput) {
  const match = String(versionOutput).match(/version "(?:(\d+)\.)?(\d+)/);
  if (!match) {
    return 0;
  }

  return Number(match[1] ?? match[2]);
}

function readJavaMajor(javaPath) {
  const result = spawnSync(javaPath, ["-version"], { encoding: "utf8" });
  return parseJavaMajor(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function findJavaExecutables(baseDir) {
  if (!baseDir || !fs.existsSync(baseDir)) {
    return [];
  }

  const found = [];
  const stack = [baseDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === "java.exe") {
        found.push(fullPath);
      }
    }
  }

  return found;
}

function resolveJavaPath() {
  const explicit = payload.javaPath ?? process.env.AURA_JAVA_PATH;
  const managedRuntimeDir = path.join(root, "runtimes", "java-21");
  const candidates = [
    explicit,
    ...findJavaExecutables(managedRuntimeDir),
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", "java.exe") : undefined,
    ...findJavaExecutables(path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Eclipse Adoptium")),
    ...findJavaExecutables(path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Java"))
  ].filter(Boolean);

  const ranked = candidates
    .map((candidate) => ({ path: candidate, major: readJavaMajor(candidate) }))
    .filter((candidate) => candidate.major >= 21)
    .sort((a, b) => b.major - a.major);

  return ranked[0]?.path;
}

function installManagedJava21() {
  if (process.platform !== "win32") {
    throw new Error("Automatic Java install is currently implemented for Windows only.");
  }

  const runtimeRoot = path.join(root, "runtimes");
  const runtimeDir = path.join(runtimeRoot, "java-21");
  const zipPath = path.join(runtimeRoot, "temurin-21-jre.zip");
  const downloadUrl = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk";

  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  log("Java 21 was not found. Downloading Eclipse Temurin JRE 21 for Aura.");
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${zipPath}'`
  ], { stdio: "inherit" });

  log("Extracting Java 21 runtime.");
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${runtimeDir}' -Force`
  ], { stdio: "inherit" });

  fs.rmSync(zipPath, { force: true });

  const javaPath = findJavaExecutables(runtimeDir)
    .map((candidate) => ({ path: candidate, major: readJavaMajor(candidate) }))
    .filter((candidate) => candidate.major >= 21)
    .sort((a, b) => b.major - a.major)[0]?.path;

  if (!javaPath) {
    throw new Error("Java 21 download finished, but Aura could not find java.exe inside it.");
  }

  return javaPath;
}

function ensureJavaPath() {
  return resolveJavaPath() ?? installManagedJava21();
}

async function main() {
  log(`Starting Aura Minecraft launch for ${instanceName} (${versionNumber})`);
  log("Authenticating with Microsoft using device-code login.");

  fs.mkdirSync(cacheDir, { recursive: true });

  const authOptions = {
    flow: "live",
    authTitle: Titles.MinecraftNintendoSwitch,
    deviceType: "Nintendo"
  };

  const codeCallback = (code) => {
    log("");
    log("=== MICROSOFT LOGIN REQUIRED ===");
    log(code.message);
    log(`Code: ${code.user_code}`);
    log(`URL: ${code.verification_uri}`);
    log("Keep this window open. Minecraft will launch after login completes.");
    log("================================");
    log("");
  };

  const fetchToken = (options) => {
    const authflow = new Authflow("aura-launcher-player", cacheDir, options, codeCallback);
    return authflow.getMinecraftJavaToken({
      fetchProfile: true,
      fetchEntitlements: true
    });
  };

  let minecraftToken;
  try {
    minecraftToken = await fetchToken(authOptions);
  } catch (error) {
    const message = String(error?.stack ?? error);
    if (!message.includes("403 Forbidden")) {
      throw error;
    }

    log("Cached Microsoft/Xbox auth failed with 403. Retrying with a fresh device login.");
    minecraftToken = await fetchToken({ ...authOptions, forceRefresh: true });
  }

  const licenses = minecraftToken.entitlements?.items?.map((item) => item.name) ?? [];
  if (!licenses.includes("game_minecraft") && !licenses.includes("product_minecraft")) {
    log("Minecraft Java ownership was not detected. If launch fails, confirm this account owns Minecraft Java Edition.");
  }

  const launcher = new Client();
  const javaPath = ensureJavaPath();
  if (javaPath) {
    log(`Using Java runtime: ${javaPath}`);
  } else {
    log("Java 21 runtime was not auto-detected. Falling back to PATH java.");
  }

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
    },
    javaPath
  };

  launcher.on("debug", (event) => log(`Debug: ${redactSecrets(event)}`));
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
