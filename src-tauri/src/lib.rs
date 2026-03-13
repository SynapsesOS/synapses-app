mod sidecar;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::time::sleep;

use sidecar::{check_health, find_binary, SidecarInfo, SidecarManager, SidecarManagerInner, ServiceStatus};

// ── State types ──────────────────────────────────────────────────────────────

pub struct AppSidecarManager(SidecarManager);

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_service_status(state: State<AppSidecarManager>) -> Vec<SidecarInfo> {
    state.0.lock().unwrap().get_all_info()
}

#[tauri::command]
async fn restart_service(name: String, state: State<'_, AppSidecarManager>) -> Result<String, String> {
    let (binary, args) = {
        let mgr = state.0.lock().unwrap();
        mgr.get_binary_and_args(&name)
            .ok_or_else(|| format!("Unknown service: {}", name))?
    };

    let bin_path = find_binary(&binary)
        .ok_or_else(|| format!("Binary '{}' not found on PATH or ~/.synapses/bin", binary))?;

    // Kill existing process if any PID is known (best-effort)
    {
        let mgr = state.0.lock().unwrap();
        if let Some(info) = mgr.get_info(&name) {
            if let Some(pid) = info.pid {
                let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
            }
        }
    }

    // Spawn new process
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

// ── Health watcher loop ───────────────────────────────────────────────────────

async fn health_watch_loop(app: AppHandle, mgr: SidecarManager) {
    // Wait a bit on startup to let services come up
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
                    // Check if we've exceeded restart limit
                    let can = mgr.lock().unwrap()
                        .sidecars.get(&name)
                        .map(|s| s.restarts_in_window < 2)
                        .unwrap_or(false);

                    if can {
                        // Try to restart
                        let binary_info = {
                            let m = mgr.lock().unwrap();
                            m.get_binary_and_args(&name)
                        };

                        if let Some((binary, args)) = binary_info {
                            if let Some(bin_path) = find_binary(&binary) {
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
                                    // Notify frontend
                                    let _ = app.emit("service-restarted", &name);
                                }
                            }
                        }
                    } else {
                        // Too many restarts — give up, mark offline
                        mgr.lock().unwrap().mark_offline(&name);
                        let _ = app.emit("service-offline", &name);
                    }
                }
            }
        }

        // Emit current status snapshot to frontend
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
            get_service_status,
            restart_service,
            stop_service,
            enable_service,
            run_synapses_cmd,
            get_synapses_data_dir,
            get_onboarding_done,
            set_onboarding_done,
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
