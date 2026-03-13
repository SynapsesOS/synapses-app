mod sidecar;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::time::sleep;

use sidecar::{check_health, find_binary, kill_by_port, pid_for_port, SidecarInfo, SidecarManager, SidecarManagerInner, ServiceStatus};

// ── State types ──────────────────────────────────────────────────────────────

pub struct AppSidecarManager(SidecarManager);

// ── Tauri commands — services ─────────────────────────────────────────────────

#[tauri::command]
fn get_service_status(state: State<AppSidecarManager>) -> Vec<SidecarInfo> {
    state.0.lock().unwrap().get_all_info()
}

#[tauri::command]
async fn restart_service(name: String, state: State<'_, AppSidecarManager>) -> Result<String, String> {
    let (binary, args, port) = {
        let mgr = state.0.lock().unwrap();
        let (bin, a) = mgr.get_binary_and_args(&name)
            .ok_or_else(|| format!("Unknown service: {}", name))?;
        let port = mgr.sidecars.get(&name).map(|s| s.port).unwrap_or(0);
        (bin, a, port)
    };

    let bin_path = find_binary(&binary)
        .ok_or_else(|| format!("Binary '{}' not found on PATH or ~/.synapses/bin", binary))?;

    // Kill anything on the port — catches both tracked PID and externally started processes
    kill_by_port(port);
    // Small grace period for the port to release
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
    let files = [
        ("synapses", "synapses.db"),
        ("pulse", "pulse.db"),
        ("brain", "brain.db"),
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

/// Returns recent lines from the synapses log file
#[tauri::command]
fn get_log_lines(n: usize) -> Vec<String> {
    let log_path = sidecar::synapses_data_dir().join("logs").join("synapses.log");
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

    let synapses_entry = serde_json::json!({ "command": "synapses", "args": ["start"] });

    if editor == "zed" {
        // Zed uses "context_servers" with a different shape
        if !config["context_servers"].is_object() {
            config["context_servers"] = serde_json::json!({});
        }
        config["context_servers"]["synapses"] = serde_json::json!({
            "command": { "path": "synapses", "args": ["start"] }
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

// ── Health watcher loop ───────────────────────────────────────────────────────

/// On startup: for each sidecar port, check if something is already running.
/// If yes, adopt it (record its PID, mark healthy) so we never spawn a duplicate.
async fn adopt_running_sidecars(mgr: SidecarManager) {
    let services: Vec<(String, u16)> = {
        let m = mgr.lock().unwrap();
        m.sidecars.iter().map(|(k, s)| (k.clone(), s.port)).collect()
    };
    for (name, port) in services {
        if check_health(port).await {
            let existing_pid = pid_for_port(port);
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
        let services: Vec<(String, u16)> = {
            let m = mgr.lock().unwrap();
            m.sidecars
                .iter()
                .filter(|(_, s)| s.enabled && s.status != ServiceStatus::Disabled)
                .map(|(k, s)| (k.clone(), s.port))
                .collect()
        };

        for (name, port) in services {
            let healthy = check_health(port).await;

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
                                // Kill anything already on the port before spawning
                                kill_by_port(port);
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
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let mgr_clone = mgr.clone();
            tauri::async_runtime::spawn(async move {
                health_watch_loop(app_handle, mgr_clone).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Synapses app");
}
