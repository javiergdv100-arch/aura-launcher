use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    gamertag: String,
    avatar: String,
    provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instance {
    id: String,
    name: String,
    mc_version: String,
    loader: String,
    loader_version: String,
    source: String,
    path: String,
    icon: String,
    banner: String,
    status: String,
    last_played: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceUpdate {
    name: String,
    mc_version: String,
    loader: String,
    loader_version: String,
    icon: String,
    banner: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddonSearchRequest {
    provider: String,
    query: String,
    project_type: String,
    game_version: Option<String>,
    loader: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddonSearchResult {
    provider: String,
    project_id: String,
    name: String,
    summary: String,
    downloads: u64,
    icon_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledAddon {
    id: String,
    name: String,
    provider: String,
    file_name: String,
    version: String,
    status: String,
    required: bool,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersion {
    name: String,
    files: Vec<ModrinthFile>,
    dependencies: Vec<ModrinthDependency>,
}

#[derive(Debug, Deserialize)]
struct ModrinthFile {
    url: String,
    filename: String,
    primary: bool,
}

#[derive(Debug, Deserialize)]
struct ModrinthDependency {
    project_id: Option<String>,
    dependency_type: String,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchResponse {
    hits: Vec<ModrinthHit>,
}

#[derive(Debug, Deserialize)]
struct ModrinthHit {
    project_id: String,
    title: String,
    description: String,
    downloads: u64,
    icon_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeSearchResponse {
    data: Vec<CurseForgeMod>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeMod {
    id: u64,
    name: String,
    summary: String,
    download_count: f64,
    logo: Option<CurseForgeLogo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeFilesResponse {
    data: Vec<CurseForgeFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeFile {
    display_name: String,
    file_name: String,
    download_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeLogo {
    url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchResult {
    instance_id: String,
    status: String,
    log: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchStatus {
    phase: String,
    message: String,
    progress: u8,
    active: bool,
}

#[tauri::command]
async fn accounts_login_microsoft() -> Result<Account, String> {
    Ok(Account {
        id: "offline-preview".into(),
        gamertag: "AuraPlayer".into(),
        avatar: "AP".into(),
        provider: "preview".into(),
    })
}

#[tauri::command]
async fn instances_list() -> Result<Vec<Instance>, String> {
    load_instances()
}

#[tauri::command]
async fn instances_create(name: String, mc_version: String, loader: String) -> Result<Instance, String> {
    if name.trim().is_empty() {
        return Err("Instance name cannot be empty".into());
    }

    let mut instances = load_instances()?;
    let id = unique_instance_id(&instances, &name);
    let path = instances_root().join(&id);
    fs::create_dir_all(path.join("mods")).map_err(|error| format!("Could not create mods folder: {error}"))?;
    fs::create_dir_all(path.join("resourcepacks"))
        .map_err(|error| format!("Could not create resourcepacks folder: {error}"))?;
    fs::create_dir_all(path.join("shaderpacks"))
        .map_err(|error| format!("Could not create shaderpacks folder: {error}"))?;

    let instance = Instance {
        id,
        icon: initials(&name),
        name,
        mc_version,
        loader,
        loader_version: "latest".into(),
        source: "manual".into(),
        path: path.to_string_lossy().to_string(),
        banner: "aurora".into(),
        status: "ready".into(),
        last_played: None,
    };

    instances.insert(0, instance.clone());
    save_instances(&instances)?;
    Ok(instance)
}

#[tauri::command]
async fn instances_update(instance_id: String, update: InstanceUpdate) -> Result<Instance, String> {
    let mut instances = load_instances()?;
    let instance = instances
        .iter_mut()
        .find(|instance| instance.id == instance_id)
        .ok_or_else(|| format!("Instance not found: {instance_id}"))?;

    if update.name.trim().is_empty() {
        return Err("Instance name cannot be empty".into());
    }

    instance.name = update.name;
    instance.mc_version = update.mc_version;
    instance.loader = update.loader;
    instance.loader_version = update.loader_version;
    instance.icon = update.icon;
    instance.banner = update.banner;

    let updated = instance.clone();
    save_instances(&instances)?;
    Ok(updated)
}

#[tauri::command]
async fn instances_delete(instance_id: String, delete_files: bool) -> Result<Vec<Instance>, String> {
    let mut instances = load_instances()?;
    let index = instances
        .iter()
        .position(|instance| instance.id == instance_id)
        .ok_or_else(|| format!("Instance not found: {instance_id}"))?;
    let removed = instances.remove(index);

    if delete_files {
        let path = PathBuf::from(&removed.path);
        let root = instances_root();
        if path.starts_with(&root) && path.exists() {
            fs::remove_dir_all(&path).map_err(|error| format!("Could not delete instance files: {error}"))?;
        }
    }

    save_instances(&instances)?;
    Ok(instances)
}

#[tauri::command]
async fn instances_launch(instance_id: String) -> Result<LaunchResult, String> {
    if instance_id.trim().is_empty() {
        return Err("Instance id cannot be empty".into());
    }

    let instance = load_instances()?
        .into_iter()
        .find(|instance| instance.id == instance_id)
        .ok_or_else(|| format!("Instance not found: {instance_id}"))?;

    let login = spawn_minecraft_helper(&instance)?;

    Ok(LaunchResult {
        instance_id,
        status: "queued".into(),
        log: login.unwrap_or_else(|| {
            "Minecraft launch started. Login code is being generated; check %APPDATA%\\AuraLauncher\\minecraft\\logs\\aura-launch.log.".into()
        }),
    })
}

#[tauri::command]
async fn launch_status() -> Result<LaunchStatus, String> {
    Ok(read_launch_status())
}

#[tauri::command]
async fn addons_search(request: AddonSearchRequest) -> Result<Vec<AddonSearchResult>, String> {
    match request.provider.as_str() {
        "modrinth" => search_modrinth(&request).await,
        "curseforge" => search_curseforge(&request).await,
        provider => Err(format!("Unsupported addon provider: {provider}")),
    }
}

#[tauri::command]
async fn addons_list(instance_id: String) -> Result<Vec<InstalledAddon>, String> {
    let instance = find_instance(&instance_id)?;
    load_installed_addons(&instance)
}

#[tauri::command]
async fn addons_install(
    instance_id: String,
    addon: AddonSearchResult,
    project_type: String,
) -> Result<Vec<InstalledAddon>, String> {
    let instance = find_instance(&instance_id)?;

    if project_type == "modpack" {
        return Err("Modpack installation needs a dedicated import flow. Use mods, resourcepacks or shaders here.".into());
    }

    let mut installed = load_installed_addons(&instance)?;
    match addon.provider.as_str() {
        "modrinth" => {
            install_modrinth_project(&instance, &addon.project_id, &addon.name, &project_type, false, &mut installed, 0).await?;
        }
        "curseforge" => {
            install_curseforge_project(&instance, &addon.project_id, &addon.name, &project_type, &mut installed).await?;
        }
        provider => return Err(format!("Unsupported addon provider: {provider}")),
    }

    save_installed_addons(&instance, &installed)?;
    Ok(installed)
}

#[tauri::command]
async fn settings_get() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "memoryMb": 4096,
        "theme": "aura",
        "telemetry": false,
        "curseForgeApiKeyConfigured": curseforge_api_key().is_some(),
        "javaManager": "automatic"
    }))
}

async fn search_modrinth(request: &AddonSearchRequest) -> Result<Vec<AddonSearchResult>, String> {
    let mut url = Url::parse("https://api.modrinth.com/v2/search").map_err(|error| error.to_string())?;
    let facets = modrinth_facets(request);

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("query", request.query.trim());
        query.append_pair("limit", "20");
        query.append_pair("index", "relevance");
        if let Some(facets) = facets {
            query.append_pair("facets", &facets);
        }
    }

    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "AuraLauncher/0.1.0 (desktop)")
        .send()
        .await
        .map_err(|error| format!("Modrinth search failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Modrinth returned {}", response.status()));
    }

    let body = response
        .json::<ModrinthSearchResponse>()
        .await
        .map_err(|error| format!("Could not parse Modrinth results: {error}"))?;

    Ok(body
        .hits
        .into_iter()
        .map(|hit| AddonSearchResult {
            provider: "modrinth".into(),
            project_id: hit.project_id,
            name: hit.title,
            summary: hit.description,
            downloads: hit.downloads,
            icon_url: hit.icon_url.unwrap_or_else(|| "M".into()),
        })
        .collect())
}

async fn search_curseforge(request: &AddonSearchRequest) -> Result<Vec<AddonSearchResult>, String> {
    let api_key = curseforge_api_key().ok_or_else(|| {
        "CurseForge requires an API key. Set CURSEFORGE_API_KEY or CF_API_KEY before starting Aura Launcher.".to_string()
    })?;

    let mut url = Url::parse("https://api.curseforge.com/v1/mods/search").map_err(|error| error.to_string())?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("gameId", "432");
        query.append_pair("classId", &curseforge_class_id(&request.project_type));
        query.append_pair("searchFilter", request.query.trim());
        query.append_pair("sortField", "2");
        query.append_pair("sortOrder", "desc");
        query.append_pair("pageSize", "20");

    }

    let response = reqwest::Client::new()
        .get(url)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|error| format!("CurseForge search failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("CurseForge returned {}", response.status()));
    }

    let body = response
        .json::<CurseForgeSearchResponse>()
        .await
        .map_err(|error| format!("Could not parse CurseForge results: {error}"))?;

    Ok(body
        .data
        .into_iter()
        .map(|item| AddonSearchResult {
            provider: "curseforge".into(),
            project_id: item.id.to_string(),
            name: item.name,
            summary: item.summary,
            downloads: item.download_count.max(0.0).round() as u64,
            icon_url: item.logo.map(|logo| logo.url).unwrap_or_else(|| "CF".into()),
        })
        .collect())
}

async fn install_modrinth_project(
    instance: &Instance,
    project_id: &str,
    display_name: &str,
    project_type: &str,
    required: bool,
    installed: &mut Vec<InstalledAddon>,
    depth: usize,
) -> Result<(), String> {
    if depth > 8 || installed.iter().any(|addon| addon.id == format!("modrinth-{project_id}")) {
        return Ok(());
    }

    let versions = fetch_modrinth_versions(instance, project_id).await?;
    let version = versions
        .into_iter()
        .next()
        .ok_or_else(|| format!("No compatible Modrinth file found for {display_name}"))?;
    let file = version
        .files
        .iter()
        .find(|file| file.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| format!("Modrinth project {display_name} has no downloadable file"))?;

    let target = addon_target_dir(instance, project_type)?.join(&file.filename);
    download_to_file(&file.url, &target).await?;

    installed.push(InstalledAddon {
        id: format!("modrinth-{project_id}"),
        name: display_name.to_string(),
        provider: "modrinth".into(),
        file_name: file.filename.clone(),
        version: version.name,
        status: "enabled".into(),
        required,
    });

    for dependency in version
        .dependencies
        .into_iter()
        .filter(|dependency| dependency.dependency_type == "required")
    {
        if let Some(dependency_project_id) = dependency.project_id {
            let dependency_name = dependency_project_id.clone();
            Box::pin(install_modrinth_project(
                instance,
                &dependency_project_id,
                &dependency_name,
                project_type,
                true,
                installed,
                depth + 1,
            ))
            .await?;
        }
    }

    Ok(())
}

async fn fetch_modrinth_versions(instance: &Instance, project_id: &str) -> Result<Vec<ModrinthVersion>, String> {
    let mut url = Url::parse(&format!("https://api.modrinth.com/v2/project/{project_id}/version"))
        .map_err(|error| error.to_string())?;
    let loader = instance.loader.to_ascii_lowercase();
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("game_versions", &serde_json::json!([instance.mc_version]).to_string());
        if loader != "vanilla" {
            query.append_pair("loaders", &serde_json::json!([loader]).to_string());
        }
    }

    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "AuraLauncher/0.1.0 (desktop)")
        .send()
        .await
        .map_err(|error| format!("Modrinth version lookup failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Modrinth version lookup returned {}", response.status()));
    }

    response
        .json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|error| format!("Could not parse Modrinth versions: {error}"))
}

async fn install_curseforge_project(
    instance: &Instance,
    project_id: &str,
    display_name: &str,
    project_type: &str,
    installed: &mut Vec<InstalledAddon>,
) -> Result<(), String> {
    let api_key = curseforge_api_key().ok_or_else(|| {
        "CurseForge requires an API key. Set CURSEFORGE_API_KEY or CF_API_KEY before starting Aura Launcher.".to_string()
    })?;
    let mut url = Url::parse(&format!("https://api.curseforge.com/v1/mods/{project_id}/files"))
        .map_err(|error| error.to_string())?;

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("gameVersion", &instance.mc_version);
        query.append_pair("pageSize", "20");
    }

    let response = reqwest::Client::new()
        .get(url)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|error| format!("CurseForge file lookup failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("CurseForge file lookup returned {}", response.status()));
    }

    let body = response
        .json::<CurseForgeFilesResponse>()
        .await
        .map_err(|error| format!("Could not parse CurseForge files: {error}"))?;
    let file = body
        .data
        .into_iter()
        .find(|file| file.download_url.is_some())
        .ok_or_else(|| format!("CurseForge file for {display_name} is not downloadable through the API"))?;
    let url = file.download_url.clone().unwrap_or_default();
    let target = addon_target_dir(instance, project_type)?.join(&file.file_name);
    download_to_file(&url, &target).await?;

    installed.retain(|addon| addon.id != format!("curseforge-{project_id}"));
    installed.insert(
        0,
        InstalledAddon {
            id: format!("curseforge-{project_id}"),
            name: display_name.to_string(),
            provider: "curseforge".into(),
            file_name: file.file_name,
            version: file.display_name,
            status: "enabled".into(),
            required: false,
        },
    );

    Ok(())
}

async fn download_to_file(url: &str, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not create addon folder: {error}"))?;
    }

    let bytes = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "AuraLauncher/0.1.0 (desktop)")
        .send()
        .await
        .map_err(|error| format!("Addon download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Could not read addon download: {error}"))?;

    fs::write(target, bytes).map_err(|error| format!("Could not save addon file: {error}"))
}

fn addon_target_dir(instance: &Instance, project_type: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(&instance.path);
    let dir = match project_type {
        "resourcepack" => base.join("resourcepacks"),
        "shader" => base.join("shaderpacks"),
        "mod" => base.join("mods"),
        other => return Err(format!("Unsupported addon type: {other}")),
    };

    fs::create_dir_all(&dir).map_err(|error| format!("Could not create addon folder: {error}"))?;
    Ok(dir)
}

fn find_instance(instance_id: &str) -> Result<Instance, String> {
    load_instances()?
        .into_iter()
        .find(|instance| instance.id == instance_id)
        .ok_or_else(|| format!("Instance not found: {instance_id}"))
}

fn installed_addons_path(instance: &Instance) -> PathBuf {
    PathBuf::from(&instance.path).join("aura-installed-addons.json")
}

fn load_installed_addons(instance: &Instance) -> Result<Vec<InstalledAddon>, String> {
    let path = installed_addons_path(instance);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let bytes = fs::read(&path).map_err(|error| format!("Could not read installed addons: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Could not parse installed addons: {error}"))
}

fn save_installed_addons(instance: &Instance, addons: &[InstalledAddon]) -> Result<(), String> {
    let path = installed_addons_path(instance);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not create instance folder: {error}"))?;
    }

    fs::write(
        path,
        serde_json::to_vec_pretty(addons).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not save installed addons: {error}"))
}

fn curseforge_api_key() -> Option<String> {
    std::env::var("CURSEFORGE_API_KEY")
        .or_else(|_| std::env::var("CF_API_KEY"))
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn curseforge_class_id(project_type: &str) -> String {
    match project_type {
        "modpack" => "4471",
        "resourcepack" => "12",
        "shader" => "6552",
        _ => "6",
    }
    .into()
}

fn modrinth_facets(request: &AddonSearchRequest) -> Option<String> {
    let facets = vec![vec![format!("project_type:{}", request.project_type)]];
    serde_json::to_string(&facets).ok()
}

fn seed_instances() -> Vec<Instance> {
    let root = instances_root();
    let instances = vec![
        Instance {
            id: "eufonia-inspired-club".into(),
            name: "Aura Club".into(),
            mc_version: "1.21.1".into(),
            loader: "NeoForge".into(),
            loader_version: "latest".into(),
            source: "aura".into(),
            path: root.join("eufonia-inspired-club").to_string_lossy().to_string(),
            icon: "AC".into(),
            banner: "nebula".into(),
            status: "ready".into(),
            last_played: Some("Today".into()),
        },
        Instance {
            id: "modrinth-fabric".into(),
            name: "Modrinth Fabric Lab".into(),
            mc_version: "1.21.1".into(),
            loader: "Fabric".into(),
            loader_version: "0.16.x".into(),
            source: "modrinth".into(),
            path: root.join("modrinth-fabric").to_string_lossy().to_string(),
            icon: "MF".into(),
            banner: "comet".into(),
            status: "updateAvailable".into(),
            last_played: Some("Yesterday".into()),
        },
    ];

    for instance in &instances {
        let path = PathBuf::from(&instance.path);
        let _ = fs::create_dir_all(path.join("mods"));
        let _ = fs::create_dir_all(path.join("resourcepacks"));
        let _ = fs::create_dir_all(path.join("shaderpacks"));
    }

    instances
}

fn load_instances() -> Result<Vec<Instance>, String> {
    let path = instances_config_path();
    if !path.exists() {
        let instances = seed_instances();
        save_instances(&instances)?;
        return Ok(instances);
    }

    let bytes = fs::read(&path).map_err(|error| format!("Could not read instances: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Could not parse instances: {error}"))
}

fn save_instances(instances: &[Instance]) -> Result<(), String> {
    let path = instances_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Could not create Aura data folder: {error}"))?;
    }

    fs::write(
        &path,
        serde_json::to_vec_pretty(instances).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not save instances: {error}"))
}

fn unique_instance_id(instances: &[Instance], name: &str) -> String {
    let base = format!("custom-{}", sanitize_id(name)).trim_end_matches('-').to_string();
    let base = if base == "custom-" { "custom-instance".into() } else { base };
    let mut candidate = base.clone();
    let mut suffix = 2;

    while instances.iter().any(|instance| instance.id == candidate) {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }

    candidate
}

fn initials(name: &str) -> String {
    let value: String = name
        .split_whitespace()
        .filter_map(|part| part.chars().next())
        .take(2)
        .collect();

    if value.is_empty() {
        "A".into()
    } else {
        value.to_ascii_uppercase()
    }
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .filter_map(|char| {
            if char.is_ascii_alphanumeric() {
                Some(char.to_ascii_lowercase())
            } else if char.is_whitespace() || char == '-' || char == '_' {
                Some('-')
            } else {
                None
            }
        })
        .collect()
}

fn spawn_minecraft_helper(instance: &Instance) -> Result<Option<String>, String> {
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Could not resolve Aura project root".to_string())?;
    let script_path = project_root.join("scripts").join("launch-minecraft.mjs");

    if !script_path.exists() {
        return Err(format!("Minecraft launcher helper not found at {}", script_path.display()));
    }

    let shared_root = aura_minecraft_root();
    let root = PathBuf::from(&instance.path);
    fs::create_dir_all(root.join("mods")).map_err(|error| format!("Could not create instance mods folder: {error}"))?;
    fs::create_dir_all(root.join("resourcepacks"))
        .map_err(|error| format!("Could not create instance resourcepacks folder: {error}"))?;
    fs::create_dir_all(root.join("shaderpacks"))
        .map_err(|error| format!("Could not create instance shaderpacks folder: {error}"))?;

    let logs_dir = shared_root.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|error| format!("Could not create launch logs folder: {error}"))?;
    let request_path = shared_root.join("last-launch-request.json");
    let log_path = logs_dir.join("aura-launch.log");
    let log_start = fs::metadata(&log_path).map(|metadata| metadata.len()).unwrap_or(0);

    let payload = serde_json::json!({
        "id": instance.id,
        "name": instance.name,
        "mcVersion": instance.mc_version,
        "loader": instance.loader,
        "loaderVersion": instance.loader_version,
        "root": root,
        "sharedRoot": shared_root,
        "memoryMax": "4G",
        "memoryMin": "2G"
    });

    fs::write(&request_path, serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not write launch request: {error}"))?;

    stop_existing_minecraft_helpers();

    Command::new("node")
        .arg(script_path)
        .arg(format!("@{}", request_path.display()))
        .current_dir(project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            format!("Could not start Minecraft helper. Make sure Node.js is installed and available in PATH. Error: {error}")
        })?;

    Ok(wait_for_login_code(&log_path, log_start))
}

fn stop_existing_minecraft_helpers() {
    let _ = Command::new("powershell.exe")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*launch-minecraft.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn wait_for_login_code(log_path: &Path, start_offset: u64) -> Option<String> {
    let deadline = Instant::now() + Duration::from_secs(12);

    while Instant::now() < deadline {
        if let Ok(mut file) = File::open(log_path) {
            let _ = file.seek(SeekFrom::Start(start_offset));
            let mut content = String::new();
            let _ = file.read_to_string(&mut content);

            if let Some(code) = extract_latest_code(&content) {
                return Some(format!(
                    "Microsoft login required. Go to https://www.microsoft.com/link and enter code: {code}"
                ));
            }
        }

        thread::sleep(Duration::from_millis(350));
    }

    None
}

fn extract_latest_code(content: &str) -> Option<String> {
    content
        .lines()
        .filter_map(|line| line.split("Code: ").nth(1))
        .last()
        .map(|code| code.trim().to_string())
        .filter(|code| !code.is_empty())
}

fn read_launch_status() -> LaunchStatus {
    let log_path = aura_minecraft_root().join("logs").join("aura-launch.log");
    let content = fs::read_to_string(log_path).unwrap_or_default();
    parse_launch_status(&content)
}

fn parse_launch_status(content: &str) -> LaunchStatus {
    let mut status = LaunchStatus {
        phase: "idle".into(),
        message: "Ready".into(),
        progress: 0,
        active: false,
    };

    for line in content.lines().rev().take(180) {
        if line.contains("Launch failed:") {
            return LaunchStatus {
                phase: "error".into(),
                message: strip_log_prefix(line).replace("Launch failed: ", ""),
                progress: 100,
                active: false,
            };
        }

        if line.contains("Minecraft process closed with code") {
            return LaunchStatus {
                phase: "closed".into(),
                message: strip_log_prefix(line),
                progress: 100,
                active: false,
            };
        }

        if line.contains("Datafixer Bootstrap") || line.contains("Setting user:") {
            return LaunchStatus {
                phase: "running".into(),
                message: "Minecraft is running".into(),
                progress: 100,
                active: false,
            };
        }

        if line.contains("Launching with arguments") {
            status = LaunchStatus {
                phase: "launching".into(),
                message: "Starting Minecraft window".into(),
                progress: 96,
                active: true,
            };
            break;
        }

        if line.contains("Downloaded assets") {
            status = LaunchStatus {
                phase: "minecraft".into(),
                message: "Minecraft assets ready".into(),
                progress: 88,
                active: true,
            };
            break;
        }

        if let Some(progress) = parse_mclc_progress(line) {
            return progress;
        }

        if line.contains("NeoForge ready:")
            || line.contains("Forge ready:")
            || line.contains("Fabric ready:")
            || line.contains("Quilt ready:")
        {
            status = LaunchStatus {
                phase: "loader".into(),
                message: strip_log_prefix(line),
                progress: 52,
                active: true,
            };
            break;
        }

        if line.contains("Preparing ") && line.contains(" loader ") {
            status = LaunchStatus {
                phase: "loader".into(),
                message: strip_log_prefix(line),
                progress: 34,
                active: true,
            };
            break;
        }

        if line.contains("Extracting Java 21 runtime") {
            status = LaunchStatus {
                phase: "java".into(),
                message: "Extracting Java 21 runtime".into(),
                progress: 22,
                active: true,
            };
            break;
        }

        if line.contains("Downloading Eclipse Temurin JRE 21") {
            status = LaunchStatus {
                phase: "java".into(),
                message: "Downloading Java 21 runtime".into(),
                progress: 14,
                active: true,
            };
            break;
        }

        if line.contains("Using Java runtime:") {
            status = LaunchStatus {
                phase: "java".into(),
                message: "Java runtime ready".into(),
                progress: 28,
                active: true,
            };
            break;
        }

        if let Some(code) = line.split("Code: ").nth(1) {
            status = LaunchStatus {
                phase: "auth".into(),
                message: format!("Microsoft login code: {}", code.trim()),
                progress: 8,
                active: true,
            };
            break;
        }

        if line.contains("Authenticating with Microsoft") {
            status = LaunchStatus {
                phase: "auth".into(),
                message: "Authenticating with Microsoft".into(),
                progress: 6,
                active: true,
            };
            break;
        }

        if line.contains("Starting Aura Minecraft launch") {
            status = LaunchStatus {
                phase: "starting".into(),
                message: strip_log_prefix(line),
                progress: 3,
                active: true,
            };
            break;
        }
    }

    status
}

fn parse_mclc_progress(line: &str) -> Option<LaunchStatus> {
    let json = line.split("Progress: ").nth(1)?;
    let value = serde_json::from_str::<serde_json::Value>(json).ok()?;
    let task = value.get("task")?.as_u64()?;
    let total = value.get("total")?.as_u64()?.max(1);
    let progress = (task.saturating_mul(100) / total).min(100) as u8;
    let progress = match value.get("type").and_then(|value| value.as_str()).unwrap_or("") {
        "assets" => 58 + ((progress as u16 * 30) / 100) as u8,
        "libraries" => 48 + ((progress as u16 * 22) / 100) as u8,
        "version" => 40 + ((progress as u16 * 10) / 100) as u8,
        other if !other.is_empty() => 42 + ((progress as u16 * 45) / 100) as u8,
        _ => 42 + ((progress as u16 * 45) / 100) as u8,
    };

    Some(LaunchStatus {
        phase: "minecraft".into(),
        message: format!(
            "Downloading {} {}/{}",
            value.get("type").and_then(|value| value.as_str()).unwrap_or("files"),
            task,
            total
        ),
        progress,
        active: true,
    })
}

fn strip_log_prefix(line: &str) -> String {
    line.split("] ").nth(1).unwrap_or(line).trim().to_string()
}

fn aura_minecraft_root() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("AuraLauncher").join("minecraft");
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".aura-minecraft")
}

fn aura_data_root() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("AuraLauncher");
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".aura")
}

fn instances_root() -> PathBuf {
    aura_data_root().join("instances")
}

fn instances_config_path() -> PathBuf {
    aura_data_root().join("instances.json")
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            accounts_login_microsoft,
            instances_list,
            instances_create,
            instances_update,
            instances_delete,
            instances_launch,
            launch_status,
            addons_list,
            addons_install,
            addons_search,
            settings_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aura Launcher");
}
