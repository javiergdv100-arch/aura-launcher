use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self},
    path::{Path, PathBuf},
    process::Command,
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
    Ok(seed_instances())
}

#[tauri::command]
async fn instances_create(name: String, mc_version: String, loader: String) -> Result<Instance, String> {
    if name.trim().is_empty() {
        return Err("Instance name cannot be empty".into());
    }

    Ok(Instance {
        id: format!("custom-{}", sanitize_id(&name)),
        name,
        mc_version,
        loader,
        loader_version: "latest".into(),
        source: "manual".into(),
        path: "%APPDATA%/AuraLauncher/instances/custom".into(),
        icon: "A".into(),
        banner: "aurora".into(),
        status: "ready".into(),
        last_played: None,
    })
}

#[tauri::command]
async fn instances_launch(instance_id: String) -> Result<LaunchResult, String> {
    if instance_id.trim().is_empty() {
        return Err("Instance id cannot be empty".into());
    }

    let instance = seed_instances()
        .into_iter()
        .find(|instance| instance.id == instance_id)
        .unwrap_or_else(|| Instance {
            id: instance_id.clone(),
            name: "Custom Aura Instance".into(),
            mc_version: "1.21.1".into(),
            loader: "Vanilla".into(),
            loader_version: "latest".into(),
            source: "manual".into(),
            path: "%APPDATA%/AuraLauncher/instances/custom".into(),
            icon: "A".into(),
            banner: "aurora".into(),
            status: "ready".into(),
            last_played: None,
        });

    spawn_minecraft_helper(&instance)?;

    Ok(LaunchResult {
        instance_id,
        status: "queued".into(),
        log: "Minecraft launch started. Complete the Microsoft login in the browser if prompted.".into(),
    })
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
    vec![
        Instance {
            id: "eufonia-inspired-club".into(),
            name: "Aura Club".into(),
            mc_version: "1.21.1".into(),
            loader: "NeoForge".into(),
            loader_version: "latest".into(),
            source: "aura".into(),
            path: "%APPDATA%/AuraLauncher/instances/aura-club".into(),
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
            path: "%APPDATA%/AuraLauncher/instances/modrinth-fabric-lab".into(),
            icon: "MF".into(),
            banner: "comet".into(),
            status: "updateAvailable".into(),
            last_played: Some("Yesterday".into()),
        },
    ]
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

fn spawn_minecraft_helper(instance: &Instance) -> Result<(), String> {
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Could not resolve Aura project root".to_string())?;
    let script_path = project_root.join("scripts").join("launch-minecraft.mjs");

    if !script_path.exists() {
        return Err(format!("Minecraft launcher helper not found at {}", script_path.display()));
    }

    let root = aura_minecraft_root();
    let logs_dir = root.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|error| format!("Could not create launch logs folder: {error}"))?;
    let request_path = root.join("last-launch-request.json");

    let payload = serde_json::json!({
        "id": instance.id,
        "name": instance.name,
        "mcVersion": instance.mc_version,
        "loader": instance.loader,
        "root": root,
        "memoryMax": "4G",
        "memoryMin": "2G"
    });

    fs::write(&request_path, serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not write launch request: {error}"))?;

    Command::new("powershell.exe")
        .arg("-NoExit")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(format!(
            "& node '{}' '@{}'",
            script_path.display(),
            request_path.display()
        ))
        .current_dir(project_root)
        .spawn()
        .map_err(|error| {
            format!("Could not start Minecraft helper window. Make sure Node.js is installed and available in PATH. Error: {error}")
        })?;

    Ok(())
}

fn aura_minecraft_root() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("AuraLauncher").join("minecraft");
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".aura-minecraft")
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
            instances_launch,
            addons_search,
            settings_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aura Launcher");
}
