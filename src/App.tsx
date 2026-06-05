import {
  AlertTriangle,
  Check,
  CirclePlay,
  Download,
  Edit3,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Gamepad2,
  HardDrive,
  KeyRound,
  Library,
  ListRestart,
  Menu,
  MoreHorizontal,
  PackagePlus,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Save,
  Trash2,
  User,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { coreBridge } from "./coreBridge";
import { mockInstalledAddons, mockJobs } from "./mockData";
import type {
  Account,
  AddonSearchResult,
  AddonType,
  DownloadJob,
  Instance,
  InstalledAddon,
  LaunchStatus,
  Loader,
  Provider
} from "./types";

type DrawerTab = "instances" | "addons" | "downloads";
type AddSource = Provider | "local" | "quick";

const loaders: Loader[] = ["Vanilla", "Forge", "Fabric", "Quilt", "NeoForge"];
const versions = ["1.21.1", "1.20.1", "1.19.2", "1.18.2", "1.16.5"];
const idleActivity: LaunchStatus = {
  phase: "idle",
  message: "Ready",
  progress: 0,
  active: false
};

function formatDownloads(downloads: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(downloads);
}

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState("");
  const [installedByInstance, setInstalledByInstance] = useState(mockInstalledAddons);
  const [jobs, setJobs] = useState<DownloadJob[]>(mockJobs);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("instances");
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [source, setSource] = useState<AddSource>("modrinth");
  const [addonType, setAddonType] = useState<AddonType>("mod");
  const [query, setQuery] = useState("");
  const [addons, setAddons] = useState<AddonSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [launchLog, setLaunchLog] = useState("Ready");
  const [isLaunching, setIsLaunching] = useState(false);
  const [activity, setActivity] = useState<LaunchStatus>(idleActivity);
  const [isCreating, setIsCreating] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [newName, setNewName] = useState("New Aura Instance");
  const [newVersion, setNewVersion] = useState("1.21.1");
  const [newLoader, setNewLoader] = useState<Loader>("NeoForge");

  useEffect(() => {
    async function boot() {
      const [loadedAccount, loadedInstances] = await Promise.all([
        coreBridge.loginMicrosoft(),
        coreBridge.listInstances()
      ]);
      setAccount(loadedAccount);
      setInstances(loadedInstances);
      setActiveInstanceId(loadedInstances[0]?.id ?? "");
    }

    void boot();
  }, []);

  const activeInstance = useMemo(
    () => instances.find((instance) => instance.id === activeInstanceId) ?? instances[0],
    [activeInstanceId, instances]
  );

  const installedAddons: InstalledAddon[] = activeInstance
    ? installedByInstance[activeInstance.id] ?? []
    : [];

  useEffect(() => {
    if (!addPanelOpen || source === "local" || source === "quick") {
      return;
    }

    if (query.trim().length < 2) {
      setAddons([]);
      setSearchError("");
      setIsSearching(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void runSearch();
    }, 320);

    return () => window.clearTimeout(timeoutId);
  }, [addPanelOpen, source, addonType, query, activeInstance?.id]);

  useEffect(() => {
    if (!activeInstance) return;

    let cancelled = false;
    async function loadInstalled() {
      const installed = await coreBridge.listInstalledAddons(activeInstance.id);
      if (!cancelled) {
        setInstalledByInstance((current) => ({ ...current, [activeInstance.id]: installed }));
      }
    }

    void loadInstalled();
    return () => {
      cancelled = true;
    };
  }, [activeInstance?.id]);

  useEffect(() => {
    if (!activity.active || activity.phase === "addons") return;

    const intervalId = window.setInterval(() => {
      void coreBridge.getLaunchStatus().then((status) => {
        if (status.phase === "idle") return;
        setActivity(status);
        setLaunchLog(status.message);
      });
    }, 750);

    return () => window.clearInterval(intervalId);
  }, [activity.active]);

  async function handleSearch(event?: FormEvent) {
    event?.preventDefault();
    await runSearch();
  }

  async function runSearch() {
    if (source === "local" || source === "quick") {
      setAddons([]);
      return;
    }

    setIsSearching(true);
    setSearchError("");

    try {
      const results = await coreBridge.searchAddons({
        provider: source,
        query,
        projectType: addonType,
        gameVersion: activeInstance?.mcVersion,
        loader: activeInstance?.loader
      });
      setAddons(results);
    } catch (error) {
      setAddons([]);
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleLaunch(instance = activeInstance) {
    if (!instance || isLaunching) return;

    setIsLaunching(true);
    setLaunchLog(`Preparing ${instance.name}...`);
    setActivity({
      phase: "starting",
      message: `Preparing ${instance.name}...`,
      progress: 4,
      active: true
    });

    try {
      const result = await coreBridge.launchInstance(instance.id);
      setLaunchLog(result.log);
      setActivity((current) => ({
        phase: current.phase === "idle" ? "queued" : current.phase,
        message: result.log,
        progress: Math.max(current.progress, 8),
        active: true
      }));
      setJobs((current) => [
        {
          id: `launch-${Date.now()}`,
          label: `Launch ${instance.name}`,
          provider: instance.source === "curseforge" ? "curseforge" : instance.source === "modrinth" ? "modrinth" : "aura",
          status: result.status === "queued" ? "queued" : "downloading",
          progress: 8
        },
        ...current.slice(0, 4)
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLaunchLog(message);
      setActivity({
        phase: "error",
        message,
        progress: 100,
        active: false
      });
    } finally {
      setIsLaunching(false);
    }
  }

  async function handleInstallAddon(addon: AddonSearchResult) {
    if (!activeInstance) return;

    const provider = addon.provider === "curseforge" ? "curseforge" : "modrinth";
    setActivity({
      phase: "addons",
      message: `Installing ${addon.name}...`,
      progress: 18,
      active: true
    });
    setJobs((current) => [
      {
        id: `addon-${addon.projectId}-${Date.now()}`,
        label: `Install ${addon.name}`,
        provider,
        status: "queued",
        progress: 12
      },
      ...current.slice(0, 5)
    ]);

    try {
      const installed = await coreBridge.installAddon(activeInstance.id, addon, addonType);
      setInstalledByInstance((current) => ({ ...current, [activeInstance.id]: installed }));
      setActivity({
        phase: "addons",
        message: `Installed ${addon.name}`,
        progress: 100,
        active: false
      });
      setJobs((current) => [
        {
          id: `addon-complete-${addon.projectId}-${Date.now()}`,
          label: `Installed ${addon.name}`,
          provider,
          status: "complete",
          progress: 100
        },
        ...current.slice(0, 5)
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActivity({
        phase: "error",
        message,
        progress: 100,
        active: false
      });
      setJobs((current) => [
        {
          id: `addon-failed-${addon.projectId}-${Date.now()}`,
          label: message,
          provider,
          status: "blocked",
          progress: 100
        },
        ...current.slice(0, 5)
      ]);
    }
  }

  async function handleCreateInstance(event: FormEvent) {
    event.preventDefault();
    const created = await coreBridge.createInstance(newName, newVersion, newLoader);
    setInstances((current) => [created, ...current]);
    setActiveInstanceId(created.id);
    setDrawerTab("addons");
    setDrawerOpen(true);
    setIsCreating(false);
  }

  async function handleUpdateInstance(event: FormEvent) {
    event.preventDefault();
    if (!editingInstance) return;

    const updated = await coreBridge.updateInstance(editingInstance.id, {
      name: editingInstance.name,
      mcVersion: editingInstance.mcVersion,
      loader: editingInstance.loader,
      loaderVersion: editingInstance.loaderVersion,
      icon: editingInstance.icon,
      banner: editingInstance.banner
    });

    setInstances((current) => current.map((instance) => (instance.id === updated.id ? updated : instance)));
    setEditingInstance(null);
  }

  async function handleDeleteInstance(instance: Instance) {
    const remaining = await coreBridge.deleteInstance(instance.id, deleteFiles);
    setInstances(remaining);
    if (activeInstanceId === instance.id) {
      setActiveInstanceId(remaining[0]?.id ?? "");
    }
    setInstalledByInstance((current) => {
      const next = { ...current };
      delete next[instance.id];
      return next;
    });
    setEditingInstance(null);
    setDeleteFiles(false);
  }

  function openManager(tab: DrawerTab) {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }

  function chooseSource(nextSource: AddSource) {
    setSource(nextSource);
    setAddons([]);
    setSearchError("");
  }

  function chooseAddonType(nextType: AddonType) {
    setAddonType(nextType);
    setAddons([]);
    setSearchError("");
  }

  return (
    <main className={`launcher-shell hero-${activeInstance?.banner ?? "nebula"}`}>
      <aside className="dock" aria-label="Launcher navigation">
        <button className="dock-button brand" onClick={() => openManager("instances")} title="Open manager">
          <Menu size={24} />
        </button>

        <div className="dock-instances">
          {instances.map((instance) => (
            <button
              key={instance.id}
              className={`dock-instance ${instance.id === activeInstance?.id ? "active" : ""}`}
              onClick={() => {
                setActiveInstanceId(instance.id);
                openManager("addons");
              }}
              title={instance.name}
            >
              {instance.icon}
            </button>
          ))}
        </div>

        <button className="dock-button" onClick={() => openManager("addons")} title="Instance addons">
          <Library size={21} />
        </button>
        <button className="dock-button" onClick={() => openManager("downloads")} title="Downloads">
          <Download size={21} />
        </button>
        <button className="dock-button" onClick={() => activeInstance && setEditingInstance(activeInstance)} title="Instance settings">
          <Settings size={21} />
        </button>
        <button className="dock-button account" title={account?.gamertag ?? "Account"}>
          <User size={19} />
        </button>
      </aside>

      <section className="stage" aria-label="Selected Minecraft instance">
        <header className="topbar">
          <div className="studio-mark">
            <span className="mark-symbol">A</span>
            <div>
              <strong>Aura Launcher</strong>
              <span>Desktop instance launcher</span>
            </div>
          </div>

          <button className="manager-button" onClick={() => openManager("instances")}>
            <FolderOpen size={18} />
            <span>Manage</span>
          </button>
        </header>

        {activeInstance && (
          <div className="play-center">
            <div className="instance-meta">
              <span>{activeInstance.source}</span>
              <span>{activeInstance.loader}</span>
              <span>{activeInstance.mcVersion}</span>
            </div>

            <h1>{activeInstance.name}</h1>

            <div className="status-row">
              <StatusPill status={activeInstance.status} />
              <span>{activeInstance.lastPlayed ? `Last played ${activeInstance.lastPlayed}` : "Never played"}</span>
            </div>

            <button className="play-button" onClick={() => void handleLaunch()} disabled={isLaunching}>
              <CirclePlay size={26} />
              <span>{isLaunching ? "Preparing..." : "Play"}</span>
            </button>

            <div className={`play-progress ${activity.phase !== "idle" ? "visible" : ""}`}>
              <div className="play-progress-top">
                <span>{activity.message}</span>
                <strong>{Math.round(activity.progress)}%</strong>
              </div>
              <div className="play-progress-track">
                <div style={{ width: `${Math.min(100, Math.max(0, activity.progress))}%` }} />
              </div>
            </div>

            <div className="quick-actions">
              <button onClick={() => openManager("addons")}>
                <PackagePlus size={17} />
                <span>Mods</span>
              </button>
              <button onClick={() => setIsCreating(true)}>
                <Plus size={17} />
                <span>New instance</span>
              </button>
            </div>

            <p className="launch-log">{launchLog}</p>
          </div>
        )}
      </section>

      <section className={`glass-drawer ${drawerOpen ? "open" : ""}`} aria-hidden={!drawerOpen}>
        <header className="drawer-header">
          <div>
            <span>Instance manager</span>
            <strong>{activeInstance?.name ?? "No instance selected"}</strong>
          </div>
          <button className="icon-button" onClick={() => setDrawerOpen(false)} title="Close">
            <X size={20} />
          </button>
        </header>

        <nav className="drawer-tabs" aria-label="Manager tabs">
          <button className={drawerTab === "instances" ? "active" : ""} onClick={() => setDrawerTab("instances")}>
            Instances
          </button>
          <button className={drawerTab === "addons" ? "active" : ""} onClick={() => setDrawerTab("addons")}>
            Addons
          </button>
          <button className={drawerTab === "downloads" ? "active" : ""} onClick={() => setDrawerTab("downloads")}>
            Downloads
          </button>
        </nav>

        <div className="drawer-body">
          {drawerTab === "instances" && (
            <section className="instance-grid">
              <button className="create-instance-card" onClick={() => setIsCreating(true)}>
                <Plus size={24} />
                <strong>Create instance</strong>
                <span>Vanilla, Forge, Fabric, Quilt or NeoForge</span>
              </button>

              {instances.map((instance) => (
                <article
                  className={`instance-card ${instance.id === activeInstance?.id ? "selected" : ""}`}
                  key={instance.id}
                >
                  <button className="instance-main" onClick={() => setActiveInstanceId(instance.id)}>
                    <span className="instance-card-icon">{instance.icon}</span>
                    <span>
                      <strong>{instance.name}</strong>
                      <small>
                        {instance.mcVersion} / {instance.loader}
                      </small>
                    </span>
                  </button>
                  <div className="instance-card-actions">
                    <button onClick={() => void handleLaunch(instance)} title={`Play ${instance.name}`}>
                      <Play size={17} />
                    </button>
                    <button
                      onClick={() => {
                        setActiveInstanceId(instance.id);
                        setDrawerTab("addons");
                      }}
                      title={`Manage ${instance.name}`}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    <button onClick={() => setEditingInstance(instance)} title={`Edit ${instance.name}`}>
                      <Edit3 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {drawerTab === "addons" && (
            <section className="addons-view">
              <div className="section-bar">
                <div>
                  <span>Installed mods</span>
                  <strong>{installedAddons.length} addons in this instance</strong>
                </div>
                <button className="primary-small" onClick={() => setAddPanelOpen((value) => !value)}>
                  <PackagePlus size={18} />
                  <span>Add Addons</span>
                </button>
              </div>

              {addPanelOpen && (
                <div className="add-panel">
                  <div className="source-grid" role="group" aria-label="Addon source">
                    <SourceButton
                      active={source === "modrinth"}
                      label="Modrinth"
                      detail="Public API, live results"
                      onClick={() => chooseSource("modrinth")}
                    />
                    <SourceButton
                      active={source === "curseforge"}
                      label="CurseForge"
                      detail="Aura API key required"
                      onClick={() => chooseSource("curseforge")}
                    />
                    <SourceButton
                      active={source === "local"}
                      label="Local file"
                      detail="Drop or pick .jar files"
                      onClick={() => chooseSource("local")}
                    />
                    <SourceButton
                      active={source === "quick"}
                      label="Quick ID"
                      detail="Paste an install id"
                      onClick={() => chooseSource("quick")}
                    />
                  </div>

                  {source === "local" && (
                    <div className="manual-box">
                      <FilePlus2 size={22} />
                      <div>
                        <strong>Manual import prepared</strong>
                        <span>The native core will copy validated .jar files into the instance mods folder.</span>
                      </div>
                    </div>
                  )}

                  {source === "quick" && (
                    <form className="search-box" onSubmit={handleSearch}>
                      <KeyRound size={18} />
                      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="#configured" />
                      <button type="submit">Resolve</button>
                    </form>
                  )}

                  {(source === "modrinth" || source === "curseforge") && (
                    <>
                      <div className="type-row">
                        {(["mod", "modpack", "resourcepack", "shader"] as AddonType[]).map((type) => (
                          <button key={type} className={addonType === type ? "active" : ""} onClick={() => chooseAddonType(type)}>
                            {type}
                          </button>
                        ))}
                      </div>

                      <form className="search-box" onSubmit={handleSearch}>
                        <Search size={18} />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder={`Search ${source}`}
                        />
                        <button type="submit">{isSearching ? "..." : "Go"}</button>
                      </form>

                      <div className="search-results">
                        {searchError && (
                          <div className="manual-box warning">
                            <AlertTriangle size={22} />
                            <div>
                              <strong>{source === "curseforge" ? "CurseForge is not configured" : "Search failed"}</strong>
                              <span>{searchError}</span>
                            </div>
                          </div>
                        )}
                        {query.trim().length > 1 && !isSearching && !searchError && addons.length === 0 && (
                          <div className="manual-box">
                            <Search size={22} />
                            <div>
                              <strong>No compatible results</strong>
                              <span>Try another source or a different project name.</span>
                            </div>
                          </div>
                        )}
                        {addons.map((addon) => (
                          <article className="addon-card" key={`${addon.provider}-${addon.projectId}`}>
                            <AddonIcon addon={addon} />
                            <div>
                              <strong>{addon.name}</strong>
                              <span>{addon.summary}</span>
                              <small>
                                {addon.provider} / {formatDownloads(addon.downloads)} downloads
                              </small>
                            </div>
                            <button onClick={() => void handleInstallAddon(addon)} title={`Install ${addon.name}`}>
                              <Plus size={18} />
                            </button>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="installed-list">
                {installedAddons.map((addon) => (
                  <article className="installed-addon" key={addon.id}>
                    <div>
                      <strong>{addon.name}</strong>
                      <span>{addon.fileName}</span>
                    </div>
                    <div className="addon-actions">
                      <span className={`addon-status ${addon.status}`}>{addon.status}</span>
                      <button title={`Open ${addon.name} page`}>
                        <ExternalLink size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {drawerTab === "downloads" && (
            <section className="downloads-view">
              <div className="section-bar">
                <div>
                  <span>Queue</span>
                  <strong>Downloads and launch tasks</strong>
                </div>
                <button className="primary-small">
                  <ListRestart size={17} />
                  <span>Retry failed</span>
                </button>
              </div>

              <div className="download-list">
                {jobs.map((job) => (
                  <article className="job" key={job.id}>
                    <div className="job-top">
                      <span>{job.label}</span>
                      <JobIcon status={job.status} />
                    </div>
                    <div className="progress-track">
                      <div style={{ width: `${job.progress}%` }} />
                    </div>
                    <small>
                      {job.provider} / {job.status}
                    </small>
                  </article>
                ))}
              </div>

              <div className="core-strip">
                <InfoTile icon={<HardDrive size={18} />} label="Storage" value="Instance folders" />
                <InfoTile icon={<KeyRound size={18} />} label="CurseForge" value="API key pending" />
              </div>
            </section>
          )}
        </div>
      </section>

      {drawerOpen && <button className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-label="Close manager" />}

      {isCreating && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" onSubmit={handleCreateInstance}>
            <div className="section-bar">
              <div>
                <span>New instance</span>
                <strong>Create Minecraft profile</strong>
              </div>
              <Gamepad2 size={22} />
            </div>

            <label>
              Name
              <input value={newName} onChange={(event) => setNewName(event.target.value)} />
            </label>

            <label>
              Minecraft version
              <select value={newVersion} onChange={(event) => setNewVersion(event.target.value)}>
                {versions.map((version) => (
                  <option key={version}>{version}</option>
                ))}
              </select>
            </label>

            <label>
              Loader
              <select value={newLoader} onChange={(event) => setNewLoader(event.target.value as Loader)}>
                {loaders.map((loader) => (
                  <option key={loader}>{loader}</option>
                ))}
              </select>
            </label>

            <div className="modal-actions">
              <button type="button" onClick={() => setIsCreating(false)}>
                Cancel
              </button>
              <button type="submit">Create</button>
            </div>
          </form>
        </div>
      )}

      {editingInstance && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal instance-settings-modal" onSubmit={handleUpdateInstance}>
            <div className="section-bar">
              <div>
                <span>Instance settings</span>
                <strong>{editingInstance.name}</strong>
              </div>
              <Settings size={22} />
            </div>

            <label>
              Name
              <input
                value={editingInstance.name}
                onChange={(event) => setEditingInstance({ ...editingInstance, name: event.target.value })}
              />
            </label>

            <div className="form-grid">
              <label>
                Minecraft version
                <select
                  value={editingInstance.mcVersion}
                  onChange={(event) => setEditingInstance({ ...editingInstance, mcVersion: event.target.value })}
                >
                  {versions.map((version) => (
                    <option key={version}>{version}</option>
                  ))}
                </select>
              </label>

              <label>
                Loader
                <select
                  value={editingInstance.loader}
                  onChange={(event) => setEditingInstance({ ...editingInstance, loader: event.target.value as Loader })}
                >
                  {loaders.map((loader) => (
                    <option key={loader}>{loader}</option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Loader version
              <input
                value={editingInstance.loaderVersion}
                onChange={(event) => setEditingInstance({ ...editingInstance, loaderVersion: event.target.value })}
                placeholder="latest"
              />
            </label>

            <div className="form-grid">
              <label>
                Icon
                <input
                  maxLength={3}
                  value={editingInstance.icon}
                  onChange={(event) => setEditingInstance({ ...editingInstance, icon: event.target.value.toUpperCase() })}
                />
              </label>

              <label>
                Banner
                <select
                  value={editingInstance.banner}
                  onChange={(event) => setEditingInstance({ ...editingInstance, banner: event.target.value })}
                >
                  <option value="nebula">nebula</option>
                  <option value="comet">comet</option>
                  <option value="aurora">aurora</option>
                </select>
              </label>
            </div>

            <div className="instance-path-box">
              <span>Folder</span>
              <strong>{editingInstance.path}</strong>
            </div>

            <label className="check-row">
              <input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} />
              Delete instance files too
            </label>

            <div className="modal-actions split-actions">
              <button type="button" className="danger-button" onClick={() => void handleDeleteInstance(editingInstance)}>
                <Trash2 size={16} />
                Delete
              </button>
              <span />
              <button type="button" onClick={() => setEditingInstance(null)}>
                Cancel
              </button>
              <button type="submit">
                <Save size={16} />
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function StatusPill({ status }: { status: Instance["status"] }) {
  const label = {
    ready: "Ready",
    installing: "Installing",
    updateAvailable: "Update available",
    offline: "Offline ready",
    error: "Needs attention"
  }[status];

  return <span className={`status-pill ${status}`}>{label}</span>;
}

function SourceButton({
  active,
  label,
  detail,
  onClick
}: {
  active: boolean;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className={`source-button ${active ? "active" : ""}`} onClick={onClick}>
      <strong>{label}</strong>
      <span>{detail}</span>
    </button>
  );
}

function AddonIcon({ addon }: { addon: AddonSearchResult }) {
  if (addon.iconUrl.startsWith("http")) {
    return <img className="addon-icon" src={addon.iconUrl} alt="" />;
  }

  return <div className="addon-icon">{addon.iconUrl.slice(0, 2).toUpperCase()}</div>;
}

function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="info-tile">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function JobIcon({ status }: { status: DownloadJob["status"] }) {
  if (status === "complete") return <Check size={16} />;
  if (status === "blocked") return <AlertTriangle size={16} />;
  return <Download size={16} />;
}

export default App;
