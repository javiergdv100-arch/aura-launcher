export type Provider = "modrinth" | "curseforge" | "aura" | "manual";
export type InstanceStatus = "ready" | "installing" | "updateAvailable" | "offline" | "error";
export type AddonType = "mod" | "modpack" | "resourcepack" | "shader";
export type Loader = "Vanilla" | "Forge" | "Fabric" | "Quilt" | "NeoForge";

export interface Account {
  id: string;
  gamertag: string;
  avatar: string;
  provider: string;
}

export interface Instance {
  id: string;
  name: string;
  mcVersion: string;
  loader: Loader | string;
  loaderVersion: string;
  source: Provider | string;
  path: string;
  icon: string;
  banner: "nebula" | "comet" | "aurora" | string;
  status: InstanceStatus;
  lastPlayed: string | null;
}

export interface InstanceUpdate {
  name: string;
  mcVersion: string;
  loader: Loader | string;
  loaderVersion: string;
  icon: string;
  banner: string;
}

export interface AddonSearchRequest {
  provider: Provider;
  query: string;
  projectType: AddonType;
  gameVersion?: string;
  loader?: string;
}

export interface AddonSearchResult {
  provider: Provider | string;
  projectId: string;
  name: string;
  summary: string;
  downloads: number;
  iconUrl: string;
}

export interface InstalledAddon {
  id: string;
  name: string;
  provider: Provider | "local";
  fileName: string;
  version: string;
  status: "enabled" | "disabled" | "updateAvailable" | "locked";
  required: boolean;
}

export interface DownloadJob {
  id: string;
  label: string;
  provider: Provider;
  status: "queued" | "downloading" | "paused" | "complete" | "blocked";
  progress: number;
}

export interface LauncherSettings {
  memoryMb: number;
  theme: string;
  telemetry: boolean;
  curseForgeApiKeyConfigured: boolean;
  javaManager: string;
}

export interface LaunchResult {
  instanceId: string;
  status: string;
  log: string;
}

export interface LaunchStatus {
  phase: string;
  message: string;
  progress: number;
  active: boolean;
}
