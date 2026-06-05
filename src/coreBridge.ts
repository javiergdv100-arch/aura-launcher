import type {
  Account,
  AddonSearchRequest,
  AddonSearchResult,
  AddonType,
  InstalledAddon,
  Instance,
  InstanceUpdate,
  LaunchResult,
  LauncherSettings,
  Loader
} from "./types";
import { mockAccount, mockInstances, mockSettings, searchMockAddons } from "./mockData";

type CommandName =
  | "accounts_login_microsoft"
  | "instances_list"
  | "instances_create"
  | "instances_update"
  | "instances_delete"
  | "instances_launch"
  | "addons_list"
  | "addons_install"
  | "addons_search"
  | "settings_get";

async function invokeNative<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri runtime is not available in browser preview.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function searchModrinthBrowser(request: AddonSearchRequest): Promise<AddonSearchResult[]> {
  const url = new URL("https://api.modrinth.com/v2/search");
  const facets: string[][] = [[`project_type:${request.projectType}`]];

  url.searchParams.set("query", request.query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("index", "relevance");
  url.searchParams.set("facets", JSON.stringify(facets));

  const response = await fetch(url, {
    headers: {
      "User-Agent": "AuraLauncher/0.1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Modrinth returned ${response.status}`);
  }

  const body = (await response.json()) as {
    hits: Array<{
      project_id: string;
      title: string;
      description: string;
      downloads: number;
      icon_url?: string | null;
    }>;
  };

  return body.hits.map((hit) => ({
    provider: "modrinth",
    projectId: hit.project_id,
    name: hit.title,
    summary: hit.description,
    downloads: hit.downloads,
    iconUrl: hit.icon_url ?? "M"
  }));
}

export const coreBridge = {
  async loginMicrosoft(): Promise<Account> {
    try {
      return await invokeNative<Account>("accounts_login_microsoft");
    } catch {
      return mockAccount;
    }
  },

  async listInstances(): Promise<Instance[]> {
    try {
      return await invokeNative<Instance[]>("instances_list");
    } catch {
      return mockInstances;
    }
  },

  async createInstance(name: string, mcVersion: string, loader: Loader): Promise<Instance> {
    try {
      return await invokeNative<Instance>("instances_create", {
        name,
        mcVersion,
        loader
      });
    } catch {
      return {
        id: `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name,
        mcVersion,
        loader,
        loaderVersion: "latest",
        source: "manual",
        path: "%APPDATA%/AuraLauncher/instances/custom",
        icon: name.slice(0, 2).toUpperCase(),
        banner: "aurora",
        status: "ready",
        lastPlayed: null
      };
    }
  },

  async launchInstance(instanceId: string): Promise<LaunchResult> {
    try {
      return await invokeNative<LaunchResult>("instances_launch", { instanceId });
    } catch {
      return {
        instanceId,
        status: "queued",
        log: "Browser preview: native Minecraft process launching is available through Tauri."
      };
    }
  },

  async updateInstance(instanceId: string, update: InstanceUpdate): Promise<Instance> {
    try {
      return await invokeNative<Instance>("instances_update", { instanceId, update });
    } catch {
      return {
        id: instanceId,
        source: "manual",
        path: "%APPDATA%/AuraLauncher/instances/custom",
        status: "ready",
        lastPlayed: null,
        ...update
      };
    }
  },

  async deleteInstance(instanceId: string, deleteFiles = false): Promise<Instance[]> {
    try {
      return await invokeNative<Instance[]>("instances_delete", { instanceId, deleteFiles });
    } catch {
      return mockInstances.filter((instance) => instance.id !== instanceId);
    }
  },

  async searchAddons(request: AddonSearchRequest): Promise<AddonSearchResult[]> {
    if (isTauriRuntime()) {
      return await invokeNative<AddonSearchResult[]>("addons_search", { request });
    }

    if (request.provider === "modrinth") {
      return searchModrinthBrowser(request);
    }

    try {
      return searchMockAddons(request.provider, request.query);
    } catch {
      throw new Error("CurseForge search needs the desktop app and a configured CurseForge API key.");
    }
  },

  async listInstalledAddons(instanceId: string): Promise<InstalledAddon[]> {
    try {
      return await invokeNative<InstalledAddon[]>("addons_list", { instanceId });
    } catch {
      return mockInstalledFallback(instanceId);
    }
  },

  async installAddon(instanceId: string, addon: AddonSearchResult, projectType: AddonType): Promise<InstalledAddon[]> {
    try {
      return await invokeNative<InstalledAddon[]>("addons_install", { instanceId, addon, projectType });
    } catch {
      const provider = addon.provider === "curseforge" ? "curseforge" : "modrinth";
      return [
        {
          id: `${addon.provider}-${addon.projectId}`,
          name: addon.name,
          provider,
          fileName: `${addon.projectId}.jar`,
          version: "latest",
          status: "enabled",
          required: false
        }
      ];
    }
  },

  async getSettings(): Promise<LauncherSettings> {
    try {
      return await invokeNative<LauncherSettings>("settings_get");
    } catch {
      return mockSettings;
    }
  }
};

function mockInstalledFallback(instanceId: string): InstalledAddon[] {
  return mockInstances.some((instance) => instance.id === instanceId) ? [] : [];
}
