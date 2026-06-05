import type {
  Account,
  AddonSearchResult,
  DownloadJob,
  InstalledAddon,
  Instance,
  LauncherSettings,
  Provider
} from "./types";

export const mockAccount: Account = {
  id: "offline-preview",
  gamertag: "AuraPlayer",
  avatar: "AP",
  provider: "preview"
};

export const mockInstances: Instance[] = [
  {
    id: "aura-club",
    name: "Aura Club",
    mcVersion: "1.21.1",
    loader: "NeoForge",
    loaderVersion: "latest",
    source: "aura",
    path: "%APPDATA%/AuraLauncher/instances/aura-club",
    icon: "AC",
    banner: "nebula",
    status: "ready",
    lastPlayed: "Today"
  },
  {
    id: "modrinth-fabric-lab",
    name: "Modrinth Fabric Lab",
    mcVersion: "1.21.1",
    loader: "Fabric",
    loaderVersion: "0.16.x",
    source: "modrinth",
    path: "%APPDATA%/AuraLauncher/instances/modrinth-fabric-lab",
    icon: "MF",
    banner: "comet",
    status: "updateAvailable",
    lastPlayed: "Yesterday"
  },
  {
    id: "curseforge-forge-vault",
    name: "CurseForge Forge Vault",
    mcVersion: "1.20.1",
    loader: "Forge",
    loaderVersion: "47.x",
    source: "curseforge",
    path: "%APPDATA%/AuraLauncher/instances/curseforge-forge-vault",
    icon: "CF",
    banner: "aurora",
    status: "offline",
    lastPlayed: "May 31"
  }
];

export const mockJobs: DownloadJob[] = [
  {
    id: "java-21",
    label: "Java 21 runtime",
    provider: "aura",
    status: "complete",
    progress: 100
  },
  {
    id: "neoforge-metadata",
    label: "NeoForge metadata",
    provider: "aura",
    status: "downloading",
    progress: 68
  },
  {
    id: "curseforge-api",
    label: "CurseForge API key required",
    provider: "curseforge",
    status: "blocked",
    progress: 0
  }
];

export const mockSettings: LauncherSettings = {
  memoryMb: 4096,
  theme: "aura",
  telemetry: false,
  curseForgeApiKeyConfigured: false,
  javaManager: "automatic"
};

export const mockAddons: AddonSearchResult[] = [
  {
    provider: "modrinth",
    projectId: "sodium",
    name: "Sodium",
    summary: "Performance-first rendering mod for Fabric and Quilt profiles.",
    downloads: 42000000,
    iconUrl: "S"
  },
  {
    provider: "modrinth",
    projectId: "iris",
    name: "Iris Shaders",
    summary: "Shader support with modern rendering compatibility.",
    downloads: 28500000,
    iconUrl: "I"
  },
  {
    provider: "curseforge",
    projectId: "create",
    name: "Create",
    summary: "Mechanical automation mod with Forge/Fabric distributions.",
    downloads: 75000000,
    iconUrl: "C"
  },
  {
    provider: "curseforge",
    projectId: "journeymap",
    name: "JourneyMap",
    summary: "Map and waypoint addon for long-running modded worlds.",
    downloads: 235000000,
    iconUrl: "J"
  },
  {
    provider: "curseforge",
    projectId: "1538403",
    name: "Mofu's Subnauticraft",
    summary: "Forge 1.20.1 mod adding Subnautica leviathan content, starting with the reaper.",
    downloads: 5163,
    iconUrl: "MS"
  }
];

export const mockInstalledAddons: Record<string, InstalledAddon[]> = {
  "aura-club": [
    {
      id: "sodium",
      name: "Sodium",
      provider: "modrinth",
      fileName: "sodium-fabric-0.6.16+mc1.21.1.jar",
      version: "0.6.16",
      status: "enabled",
      required: false
    },
    {
      id: "iris",
      name: "Iris Shaders",
      provider: "modrinth",
      fileName: "iris-1.9.3+mc1.21.1.jar",
      version: "1.9.3",
      status: "updateAvailable",
      required: false
    },
    {
      id: "neoforge",
      name: "NeoForge Loader",
      provider: "aura",
      fileName: "neoforge-loader.jar",
      version: "latest",
      status: "locked",
      required: true
    }
  ],
  "modrinth-fabric-lab": [
    {
      id: "fabric-api",
      name: "Fabric API",
      provider: "modrinth",
      fileName: "fabric-api-0.138.3+1.21.10.jar",
      version: "0.138.3",
      status: "enabled",
      required: true
    },
    {
      id: "modmenu",
      name: "Mod Menu",
      provider: "modrinth",
      fileName: "modmenu-16.0.0.jar",
      version: "16.0.0",
      status: "enabled",
      required: false
    }
  ],
  "curseforge-forge-vault": [
    {
      id: "create",
      name: "Create",
      provider: "curseforge",
      fileName: "create-1.20.1-0.5.1.jar",
      version: "0.5.1",
      status: "enabled",
      required: false
    },
    {
      id: "journeymap",
      name: "JourneyMap",
      provider: "curseforge",
      fileName: "journeymap-1.20.1.jar",
      version: "5.10.3",
      status: "disabled",
      required: false
    }
  ]
};

export function searchMockAddons(provider: Provider, query: string): AddonSearchResult[] {
  const normalized = query.trim().toLowerCase();
  return mockAddons.filter((addon) => {
    const providerMatches = provider === addon.provider;
    const queryMatches =
      normalized.length === 0 ||
      addon.name.toLowerCase().includes(normalized) ||
      addon.summary.toLowerCase().includes(normalized);
    return providerMatches && queryMatches;
  });
}
