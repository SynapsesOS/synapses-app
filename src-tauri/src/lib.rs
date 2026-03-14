mod sidecar;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tokio::time::sleep;

use sidecar::{check_health, check_unix_health, find_binary, kill_by_port, pid_for_port, pid_for_socket, SidecarInfo, SidecarManager, SidecarManagerInner, ServiceStatus};

const DAEMON_HEALTH_PATH: &str = "/api/admin/health";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

// ── State types ──────────────────────────────────────────────────────────────

pub struct AppSidecarManager(SidecarManager);

// ── Tauri commands — services ─────────────────────────────────────────────────

#[tauri::command]
fn get_service_status(state: State<AppSidecarManager>) -> Vec<SidecarInfo> {
    state.0.lock().unwrap().get_all_info()
}

#[tauri::command]
async fn restart_service(name: String, state: State<'_, AppSidecarManager>) -> Result<String, String> {
    let (binary, args, port, tracked_pid) = {
        let mgr = state.0.lock().unwrap();
        let (bin, a) = mgr.get_binary_and_args(&name)
            .ok_or_else(|| format!("Unknown service: {}", name))?;
        let port = mgr.sidecars.get(&name).map(|s| s.port).unwrap_or(0);
        let pid = mgr.sidecars.get(&name).and_then(|s| s.pid);
        (bin, a, port, pid)
    };

    let bin_path = find_binary(&binary)
        .ok_or_else(|| format!("Binary '{}' not found on PATH or ~/.synapses/bin", binary))?;

    // Socket-based services (port=0) are killed by stored PID;
    // TCP services are killed by port to catch any stray process.
    if port == 0 {
        if let Some(pid) = tracked_pid {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status();
        }
    } else {
        kill_by_port(port);
    }
    // Small grace period for the process to release the port/socket
    std::thread::sleep(std::time::Duration::from_millis(300));

    let mut cmd = std::process::Command::new(&bin_path);
    for arg in &args {
        cmd.arg(arg);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let child = cmd.spawn().map_err(|e| format!("Failed to start {}: {}", name, e))?;
    let pid = child.id();

    {
        let mut mgr = state.0.lock().unwrap();
        mgr.record_restart(&name);
        if let Some(s) = mgr.sidecars.get_mut(&name) {
            s.pid = Some(pid);
        }
    }

    Ok(format!("{} restarted (pid {})", name, pid))
}

#[tauri::command]
async fn stop_service(name: String, state: State<'_, AppSidecarManager>) -> Result<(), String> {
    let mgr = state.0.lock().unwrap();
    if let Some(info) = mgr.get_info(&name) {
        if let Some(pid) = info.pid {
            std::process::Command::new("kill")
                .arg(pid.to_string())
                .status()
                .map_err(|e| e.to_string())?;
        }
    }
    drop(mgr);
    state.0.lock().unwrap().set_enabled(&name, false);
    Ok(())
}

#[tauri::command]
fn enable_service(name: String, state: State<AppSidecarManager>) {
    state.0.lock().unwrap().set_enabled(&name, true);
}

// ── Tauri commands — synapses CLI ─────────────────────────────────────────────

#[tauri::command]
async fn run_synapses_cmd(args: Vec<String>) -> Result<String, String> {
    let bin = find_binary("synapses")
        .ok_or_else(|| "synapses binary not found".to_string())?;
    let out = std::process::Command::new(bin)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() {
        Ok(stdout)
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

// ── Tauri commands — app state ────────────────────────────────────────────────

#[tauri::command]
fn get_synapses_data_dir() -> String {
    sidecar::synapses_data_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn get_onboarding_done() -> bool {
    let path = sidecar::synapses_data_dir().join("app_onboarding_done");
    path.exists()
}

#[tauri::command]
fn set_onboarding_done() {
    let path = sidecar::synapses_data_dir().join("app_onboarding_done");
    let _ = std::fs::create_dir_all(path.parent().unwrap());
    let _ = std::fs::write(path, "1");
}

// ── Tauri commands — data / privacy ──────────────────────────────────────────

/// Returns file sizes (bytes) of key data files in ~/.synapses/
#[tauri::command]
fn get_data_sizes() -> HashMap<String, u64> {
    let data_dir = sidecar::synapses_data_dir();
    // brain.db and pulse.db no longer exist — brain and pulse are in-process
    // within the singleton daemon binary since the Phase 3–5 architecture merge.
    let files = [
        ("synapses", "synapses.db"),
        ("scout", "scout.db"),
    ];
    let mut result = HashMap::new();
    for (key, filename) in &files {
        let path = data_dir.join(filename);
        result.insert(
            key.to_string(),
            std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        );
    }
    result
}

/// Opens ~/.synapses in the system file manager
#[tauri::command]
fn open_data_dir() -> Result<(), String> {
    let data_dir = sidecar::synapses_data_dir();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Returns total system RAM in GB
#[tauri::command]
fn get_system_ram_gb() -> u64 {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
        {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(bytes) = s.trim().parse::<u64>() {
                    return bytes / (1024 * 1024 * 1024);
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
            for line in content.lines() {
                if line.starts_with("MemTotal:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<u64>() {
                            return kb / (1024 * 1024);
                        }
                    }
                }
            }
        }
    }
    0
}

/// Set OLLAMA_MAX_LOADED_MODELS via launchctl (macOS) or write env file (Linux)
#[tauri::command]
async fn set_ollama_max_models(count: u8) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("launchctl")
            .args(["setenv", "OLLAMA_MAX_LOADED_MODELS", &count.to_string()])
            .status()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // Write to ~/.synapses/ollama.env for reference; user must configure systemd manually
        let path = sidecar::synapses_data_dir().join("ollama.env");
        let content = format!("OLLAMA_MAX_LOADED_MODELS={}\n", count);
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads ~/.synapses/brain.json
#[tauri::command]
fn read_brain_config() -> Result<String, String> {
    let path = sidecar::synapses_data_dir().join("brain.json");
    std::fs::read_to_string(&path).map_err(|e| format!("brain.json not found: {}", e))
}

/// Writes ~/.synapses/brain.json (validates JSON first)
#[tauri::command]
fn write_brain_config(content: String) -> Result<(), String> {
    // Validate JSON before writing
    let _: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    let path = sidecar::synapses_data_dir().join("brain.json");
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Returns recent lines from the singleton daemon log file (~/.synapses/daemon.log)
#[tauri::command]
fn get_log_lines(n: usize) -> Vec<String> {
    let log_path = sidecar::synapses_data_dir().join("daemon.log");
    if let Ok(content) = std::fs::read_to_string(log_path) {
        let lines: Vec<String> = content.lines().map(String::from).collect();
        let start = if lines.len() > n { lines.len() - n } else { 0 };
        lines[start..].to_vec()
    } else {
        vec![]
    }
}

/// Reads ~/.synapses/app_settings.json for app-level preferences
#[tauri::command]
fn read_app_settings() -> HashMap<String, serde_json::Value> {
    let path = sidecar::synapses_data_dir().join("app_settings.json");
    if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

/// Writes the synapses MCP entry into the given editor's config file.
/// Merges into existing config rather than overwriting.
/// Returns the path written to.
#[tauri::command]
fn write_mcp_config(editor: String) -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let home = std::path::PathBuf::from(home);

    let config_path = match editor.as_str() {
        "claude"    => home.join(".claude").join("settings.json"),
        "cursor"    => home.join(".cursor").join("mcp.json"),
        "windsurf"  => home.join(".codeium").join("windsurf").join("mcp_config.json"),
        "zed"       => home.join(".config").join("zed").join("settings.json"),
        _           => return Err(format!("Unknown editor: {}", editor)),
    };

    // Read existing config or start fresh
    let mut config: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Create parent dirs if needed
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // HTTP MCP transport: daemon runs at 127.0.0.1:11435 and serves /mcp.
    let synapses_entry = serde_json::json!({
        "transport": "http",
        "url": "http://127.0.0.1:11435/mcp"
    });

    if editor == "zed" {
        // Zed uses "context_servers" with settings.url for HTTP servers
        if !config["context_servers"].is_object() {
            config["context_servers"] = serde_json::json!({});
        }
        config["context_servers"]["synapses"] = serde_json::json!({
            "settings": { "url": "http://127.0.0.1:11435/mcp" }
        });
    } else {
        if !config["mcpServers"].is_object() {
            config["mcpServers"] = serde_json::json!({});
        }
        config["mcpServers"]["synapses"] = synapses_entry;
    }

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, content).map_err(|e| e.to_string())?;
    Ok(config_path.to_string_lossy().to_string())
}

/// Writes ~/.synapses/app_settings.json
#[tauri::command]
fn write_app_settings(settings: HashMap<String, serde_json::Value>) -> Result<(), String> {
    let path = sidecar::synapses_data_dir().join("app_settings.json");
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ── Bundled daemon extraction ─────────────────────────────────────────────────

/// Extracts the platform-specific synapses binary from the app bundle's Resources/
/// into ~/.synapses/bin/synapses on first launch (or when the app version changes).
/// Called silently before any UI appears.
fn extract_bundled_daemon(app: &AppHandle) -> Result<(), String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    let triple = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64")  => "x86_64-apple-darwin",
        ("linux", "x86_64")  => "x86_64-unknown-linux-gnu",
        (os, arch) => return Err(format!("Unsupported platform: {os}-{arch}")),
    };

    let bundled = resource_dir.join(format!("synapses-{triple}"));
    // Skip if the file doesn't exist or is a 0-byte dev stub.
    // CI places the real binary here before `tauri build`; local dev has an empty placeholder.
    let bundled_size = std::fs::metadata(&bundled).map(|m| m.len()).unwrap_or(0);
    if bundled_size == 0 {
        return Ok(());
    }

    let bin_dir = sidecar::synapses_data_dir().join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let dest = bin_dir.join("synapses");
    let version_marker = bin_dir.join("synapses.app_version");

    // Re-extract if binary is missing or was bundled with a different app version.
    let current_marker = std::fs::read_to_string(&version_marker).unwrap_or_default();
    if dest.exists() && current_marker.trim() == APP_VERSION {
        return Ok(());
    }

    std::fs::copy(&bundled, &dest).map_err(|e| format!("Failed to extract daemon: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
    }

    std::fs::write(&version_marker, APP_VERSION).ok();
    Ok(())
}

// ── LaunchAgent registration (macOS) ─────────────────────────────────────────

/// Registers a launchd LaunchAgent so the daemon starts automatically on login.
/// Writes ~/.synapses/com.synapsesos.daemon.plist and loads it.
/// Safe to call multiple times — only writes+loads if the plist changed.
#[tauri::command]
fn register_launch_agent() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let bin = sidecar::synapses_data_dir().join("bin").join("synapses");
        let bin_str = bin.to_string_lossy();
        let log_dir = sidecar::synapses_data_dir().join("logs");
        std::fs::create_dir_all(&log_dir).ok();
        let log_str = log_dir.join("daemon.log").to_string_lossy().to_string();

        let plist = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.synapsesos.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>{bin_str}</string>
        <string>daemon</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{log_str}</string>
    <key>StandardErrorPath</key>
    <string>{log_str}</string>
</dict>
</plist>
"#);

        let agents_dir = std::path::PathBuf::from(&home).join("Library/LaunchAgents");
        std::fs::create_dir_all(&agents_dir).ok();
        let plist_path = agents_dir.join("com.synapsesos.daemon.plist");

        // Only reload if the content changed.
        let existing = std::fs::read_to_string(&plist_path).unwrap_or_default();
        if existing != plist {
            std::fs::write(&plist_path, &plist).map_err(|e| e.to_string())?;
            // Bootout old job (macOS 12+ replacement for `launchctl unload`).
            // Ignore errors — the job simply may not be loaded yet on first run.
            let uid = unsafe { libc::getuid() };
            let _ = std::process::Command::new("launchctl")
                .args(["bootout", &format!("user/{uid}"), &plist_path.to_string_lossy()])
                .status();
            std::process::Command::new("launchctl")
                .args(["bootstrap", &format!("user/{uid}"), &plist_path.to_string_lossy()])
                .status()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Ollama detection ──────────────────────────────────────────────────────────

/// Checks if Ollama is reachable and returns its version + installed model names.
/// Ollama runs on its default port 11434; synapses daemon is on 11435.
#[tauri::command]
async fn check_ollama() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    // Check version
    let version_res = client.get("http://localhost:11434/api/version").send().await;
    let version = match version_res {
        Ok(r) if r.status().is_success() => {
            r.json::<serde_json::Value>().await
                .ok()
                .and_then(|v| v["version"].as_str().map(String::from))
                .unwrap_or_else(|| "unknown".to_string())
        }
        _ => return Ok(serde_json::json!({ "running": false })),
    };

    // List installed models
    let models: Vec<String> = match client.get("http://localhost:11434/api/tags").send().await {
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(v) => v["models"].as_array()
                .map(|arr| arr.iter()
                    .filter_map(|m| m["name"].as_str().map(String::from))
                    .collect())
                .unwrap_or_default(),
            Err(_) => vec![],
        },
        Err(_) => vec![],
    };

    Ok(serde_json::json!({
        "running": true,
        "version": version,
        "models": models,
    }))
}

/// Pulls an Ollama model, emitting progress events to the frontend.
/// Events: "ollama-pull-progress" with payload { model, status, completed, total }
/// Final event: "ollama-pull-done" with payload { model, success, error? }
#[tauri::command]
async fn pull_model(model: String, app: AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .unwrap_or_default();

    let body = serde_json::json!({ "model": model, "stream": true });
    let response = client
        .post("http://localhost:11434/api/pull")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let msg = format!("Ollama returned {}", response.status());
        let _ = app.emit("ollama-pull-done", serde_json::json!({ "model": model, "success": false, "error": msg }));
        return Err(msg);
    }

    let mut stream = response.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // Ollama streams newline-delimited JSON
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf = buf[nl + 1..].to_string();
            if line.is_empty() { continue; }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                let _ = app.emit("ollama-pull-progress", serde_json::json!({
                    "model": model,
                    "status": val["status"],
                    "completed": val["completed"],
                    "total": val["total"],
                }));
            }
        }
    }

    let _ = app.emit("ollama-pull-done", serde_json::json!({ "model": model, "success": true }));
    Ok(())
}

// ── Scout download ────────────────────────────────────────────────────────────

/// Downloads the Scout binary for the current platform from GitHub Releases
/// and installs it to ~/.synapses/bin/scout.
/// Emits "scout-download-progress" (0–100) and "scout-download-done" { success, error? }.
#[tauri::command]
async fn download_scout(app: AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;

    let triple = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64")  => "darwin-amd64",
        ("linux", "x86_64")  => "linux-amd64",
        (os, arch) => return Err(format!("Unsupported platform: {os}-{arch}")),
    };

    let url = format!(
        "https://github.com/SynapsesOS/synapses-scout/releases/latest/download/scout-{triple}"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .unwrap_or_default();

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let msg = format!("Download failed: {}", response.status());
        let _ = app.emit("scout-download-done", serde_json::json!({ "success": false, "error": msg }));
        return Err(msg);
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    let bin_dir = sidecar::synapses_data_dir().join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let dest = bin_dir.join("scout");
    let tmp = bin_dir.join("scout.tmp");

    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    use std::io::Write;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded * 100 / total) as u8;
            let _ = app.emit("scout-download-progress", pct);
        }
    }
    drop(file);

    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
    }

    let _ = app.emit("scout-download-done", serde_json::json!({ "success": true }));
    Ok(())
}

// ── App update check ──────────────────────────────────────────────────────────

/// Checks GitHub Releases for a new version of the Synapses app.
/// Returns { available: bool, version?: string, notes?: string }
#[tauri::command]
async fn check_for_update(app: AppHandle) -> Result<serde_json::Value, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "current": update.current_version,
        })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Ok(serde_json::json!({ "available": false, "error": e.to_string() })),
    }
}

/// Downloads and installs the pending app update. Call after check_for_update returns available=true.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Health watcher loop ───────────────────────────────────────────────────────

/// On startup: for each sidecar port, check if something is already running.
/// If yes, adopt it (record its PID, mark healthy) so we never spawn a duplicate.
async fn is_service_healthy(port: u16, health_path: &str, socket_path: &Option<String>) -> bool {
    if let Some(sock) = socket_path {
        check_unix_health(sock, health_path).await
    } else {
        check_health(port, health_path).await
    }
}

async fn adopt_running_sidecars(mgr: SidecarManager) {
    let services: Vec<(String, u16, String, Option<String>)> = {
        let m = mgr.lock().unwrap();
        m.sidecars.iter().map(|(k, s)| (k.clone(), s.port, s.health_path.clone(), s.socket_path.clone())).collect()
    };
    for (name, port, health_path, socket_path) in services {
        if is_service_healthy(port, &health_path, &socket_path).await {
            // Detect PID: socket-based services use lsof on the socket file;
            // TCP services use lsof on the port.
            let existing_pid = if let Some(ref sock) = socket_path {
                pid_for_socket(sock)
            } else {
                pid_for_port(port)
            };
            let mut m = mgr.lock().unwrap();
            m.record_success(&name);
            if let Some(s) = m.sidecars.get_mut(&name) {
                s.pid = existing_pid;
            }
        }
    }
}

async fn health_watch_loop(app: AppHandle, mgr: SidecarManager) {
    // First: adopt any sidecars already running before doing anything
    adopt_running_sidecars(mgr.clone()).await;
    sleep(Duration::from_secs(3)).await;

    loop {
        let services: Vec<(String, u16, String, Option<String>)> = {
            let m = mgr.lock().unwrap();
            m.sidecars
                .iter()
                .filter(|(_, s)| s.enabled && s.status != ServiceStatus::Disabled)
                .map(|(k, s)| (k.clone(), s.port, s.health_path.clone(), s.socket_path.clone()))
                .collect()
        };

        for (name, port, health_path, socket_path) in services {
            let healthy = is_service_healthy(port, &health_path, &socket_path).await;

            if healthy {
                mgr.lock().unwrap().record_success(&name);
            } else {
                let (_failures, should_restart) = mgr.lock().unwrap().record_failure(&name);

                if should_restart {
                    let can = mgr.lock().unwrap()
                        .sidecars.get(&name)
                        .map(|s| s.restarts_in_window < 2)
                        .unwrap_or(false);

                    if can {
                        let binary_info = {
                            let m = mgr.lock().unwrap();
                            m.get_binary_and_args(&name)
                        };

                        if let Some((binary, args)) = binary_info {
                            if let Some(bin_path) = find_binary(&binary) {
                                // Kill old process before spawning.
                                // Socket-based services (port=0) are killed by stored PID;
                                // TCP services are killed by port to catch any stray process.
                                if port == 0 {
                                    let old_pid = mgr.lock().unwrap()
                                        .sidecars.get(&name)
                                        .and_then(|s| s.pid);
                                    if let Some(pid) = old_pid {
                                        let _ = std::process::Command::new("kill")
                                            .args(["-TERM", &pid.to_string()])
                                            .status();
                                    }
                                } else {
                                    kill_by_port(port);
                                }
                                std::thread::sleep(std::time::Duration::from_millis(300));

                                let mut cmd = std::process::Command::new(&bin_path);
                                for arg in &args {
                                    cmd.arg(arg);
                                }
                                cmd.stdin(std::process::Stdio::null())
                                    .stdout(std::process::Stdio::null())
                                    .stderr(std::process::Stdio::null());

                                if let Ok(child) = cmd.spawn() {
                                    let pid = child.id();
                                    let mut m = mgr.lock().unwrap();
                                    m.record_restart(&name);
                                    if let Some(s) = m.sidecars.get_mut(&name) {
                                        s.pid = Some(pid);
                                    }
                                    let _ = app.emit("service-restarted", &name);
                                }
                            }
                        }
                    } else {
                        mgr.lock().unwrap().mark_offline(&name);
                        let _ = app.emit("service-offline", &name);
                    }
                }
            }
        }

        let status = mgr.lock().unwrap().get_all_info();
        let _ = app.emit("service-status", &status);

        sleep(Duration::from_secs(10)).await;
    }
}

/// Ensures the singleton daemon is running. Called on app launch before the health loop.
/// If daemon is already healthy, returns immediately. Otherwise spawns it.
async fn ensure_daemon_started(app: AppHandle, mgr: SidecarManager) {
    if check_health(11435, DAEMON_HEALTH_PATH).await {
        // Already running — adopt it.
        let existing_pid = pid_for_port(11435);
        let mut m = mgr.lock().unwrap();
        m.record_success("synapses");
        if let Some(s) = m.sidecars.get_mut("synapses") {
            s.pid = existing_pid;
        }
        return;
    }

    let bin_path = match find_binary("synapses") {
        Some(p) => p,
        None => {
            eprintln!("synapses-app: cannot find 'synapses' binary — daemon not started");
            mgr.lock().unwrap().mark_offline("synapses");
            let _ = app.emit("service-binary-missing", "synapses");
            return;
        }
    };

    // Redirect daemon output to ~/.synapses/logs/daemon.log so startup crashes are visible.
    let log_path = sidecar::synapses_data_dir().join("logs").join("daemon.log");
    let _ = std::fs::create_dir_all(log_path.parent().unwrap());
    let log_file = std::fs::OpenOptions::new()
        .create(true).append(true).open(&log_path)
        .ok()
        .map(std::process::Stdio::from);

    let child = std::process::Command::new(&bin_path)
        .args(["daemon", "serve"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(log_file.unwrap_or(std::process::Stdio::null()))
        .spawn();

    match child {
        Ok(c) => {
            let pid = c.id();
            // Poll until healthy (up to 30s).
            for _ in 0..60 {
                sleep(Duration::from_millis(500)).await;
                if check_health(11435, DAEMON_HEALTH_PATH).await {
                    let mut m = mgr.lock().unwrap();
                    m.record_success("synapses");
                    if let Some(s) = m.sidecars.get_mut("synapses") {
                        s.pid = Some(pid);
                    }
                    return;
                }
            }
            eprintln!("synapses-app: daemon started (pid {}) but health check timed out", pid);
            mgr.lock().unwrap().mark_offline("synapses");
            let _ = app.emit("service-start-timeout", "synapses");
        }
        Err(e) => {
            eprintln!("synapses-app: failed to start daemon: {}", e);
            mgr.lock().unwrap().mark_offline("synapses");
            let _ = app.emit("service-start-failed", "synapses");
        }
    }
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mgr: SidecarManager = Arc::new(Mutex::new(SidecarManagerInner::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppSidecarManager(mgr.clone()))
        .invoke_handler(tauri::generate_handler![
            // Services
            get_service_status,
            restart_service,
            stop_service,
            enable_service,
            // CLI
            run_synapses_cmd,
            // App state
            get_synapses_data_dir,
            get_onboarding_done,
            set_onboarding_done,
            // Data / privacy
            get_data_sizes,
            open_data_dir,
            get_system_ram_gb,
            set_ollama_max_models,
            read_brain_config,
            write_brain_config,
            get_log_lines,
            read_app_settings,
            write_app_settings,
            write_mcp_config,
            // Install & update
            register_launch_agent,
            check_ollama,
            pull_model,
            download_scout,
            check_for_update,
            install_update,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Extract bundled synapses binary to ~/.synapses/bin/ silently before any UI.
            if let Err(e) = extract_bundled_daemon(&app_handle) {
                eprintln!("synapses-app: could not extract bundled daemon: {e}");
            }

            // Register LaunchAgent so daemon survives app restarts (macOS).
            // Skip in dev: binary doesn't exist (0-byte stub was skipped above).
            let daemon_bin = sidecar::synapses_data_dir().join("bin").join("synapses");
            if daemon_bin.exists() && std::fs::metadata(&daemon_bin).map(|m| m.len()).unwrap_or(0) > 0 {
                if let Err(e) = register_launch_agent() {
                    eprintln!("synapses-app: could not register launch agent: {e}");
                }
            }

            let mgr_clone = mgr.clone();
            tauri::async_runtime::spawn(async move {
                // Ensure singleton daemon is running before starting health watch.
                ensure_daemon_started(app_handle.clone(), mgr_clone.clone()).await;
                health_watch_loop(app_handle, mgr_clone).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Synapses app");
}
