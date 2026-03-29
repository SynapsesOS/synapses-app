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
async fn enable_service(name: String, state: State<'_, AppSidecarManager>) -> Result<(), String> {
    let (binary, args) = {
        let mut mgr = state.0.lock().unwrap();
        mgr.set_enabled(&name, true);
        mgr.get_binary_and_args(&name)
            .ok_or_else(|| format!("Unknown service: {}", name))?
    };

    let bin_path = find_binary(&binary)
        .ok_or_else(|| format!("Binary '{}' not found on PATH or ~/.synapses/bin", binary))?;

    let mut cmd = std::process::Command::new(&bin_path);
    for arg in &args {
        cmd.arg(arg);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let child = cmd.spawn().map_err(|e| format!("Failed to start {}: {}", name, e))?;
    let pid = child.id();
    state.0.lock().unwrap().sidecars.get_mut(&name).map(|s| s.pid = Some(pid));
    Ok(())
}

// ── Tauri commands — synapses CLI ─────────────────────────────────────────────

/// Allowed first arguments for run_synapses_cmd to prevent arbitrary command execution.
const ALLOWED_SYNAPSES_CMDS: &[&str] = &[
    "version", "--version", "status", "index", "init", "connect",
    "daemon", "start", "stop", "config", "dev", "update", "remove",
    "uninstall", "completion",
];

#[tauri::command]
async fn run_synapses_cmd(args: Vec<String>) -> Result<String, String> {
    // Validate the first argument against the allowed command whitelist.
    if let Some(cmd) = args.first() {
        if !ALLOWED_SYNAPSES_CMDS.contains(&cmd.as_str()) {
            return Err(format!("Command '{}' is not allowed", cmd));
        }
    }
    // Block dangerous flag patterns in any argument position.
    for arg in &args {
        if arg.contains("..") || arg.contains('\0') {
            return Err("Invalid argument".to_string());
        }
    }
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

/// Pre-registers a project with the daemon so that the first MCP client
/// connection succeeds immediately (no lazy-init delay). Fire-and-forget:
/// returns as soon as the request is sent; initialization continues in the
/// daemon background. Safe to call multiple times — idempotent.
#[tauri::command]
async fn preregister_project(path: String) {
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        let body = serde_json::json!({ "path": path });
        let _ = client
            .post("http://127.0.0.1:11435/api/admin/projects")
            .json(&body)
            .send()
            .await;
    });
}

/// Returns the running daemon's version (from /api/admin/health) and the
/// installed binary version (from `synapses version`), plus a mismatch flag.
/// The frontend calls this on startup to detect a stale daemon (IMP-EVAL-1).
#[tauri::command]
async fn get_daemon_version() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    let running = match client
        .get("http://127.0.0.1:11435/api/admin/health")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v["version"].as_str().map(String::from))
            .unwrap_or_else(|| "unknown".to_string()),
        _ => return Ok(serde_json::json!({ "error": "daemon not reachable" })),
    };

    let installed = match find_binary("synapses") {
        Some(bin) => match std::process::Command::new(bin).arg("version").output() {
            Ok(out) => String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_start_matches("synapses ")
                .to_string(),
            Err(_) => "unknown".to_string(),
        },
        None => "not found".to_string(),
    };

    let mismatch = running != "unknown"
        && installed != "unknown"
        && installed != "not found"
        && running != installed
        && running != "dev"
        && installed != "dev";

    Ok(serde_json::json!({
        "running": running,
        "installed": installed,
        "mismatch": mismatch,
    }))
}

/// Returns the live `indexing_progress` object from the daemon health endpoint.
/// Returns `{"state":"idle"}` if the daemon is unreachable or not indexing.
/// Designed to be polled at ~500ms while the UI is waiting for indexing to finish.
#[tauri::command]
async fn get_indexing_progress() -> serde_json::Value {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .build()
        .unwrap_or_default();
    match client
        .get("http://127.0.0.1:11435/api/admin/health")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("indexing_progress").cloned())
            .unwrap_or(serde_json::json!({ "state": "idle" })),
        _ => serde_json::json!({ "state": "idle" }),
    }
}

// ── Embedded Modelfile content ────────────────────────────────────────────────
// Single source of truth for the Tauri app. Kept in sync with
// synapses/cmd/synapses/brain_setup.go — update both if Modelfiles change.
// Uses r##"..."## raw strings so the embedded """ triple-quotes are safe.

const MODELFILE_SENTRY: &str = r##"FROM qwen3.5:2b

SYSTEM """You are the Synapses Sentry, a code entity summarizer for a code intelligence graph.

Given a code entity (name, type, package, and source code), write a 2-3 sentence technical briefing covering: what it does, its role in the system, and any important patterns or concerns.

Do not write code. Describe the entity in plain English sentences only.
Output ONLY valid JSON with no other text: {"summary": "2-3 sentence briefing", "tags": ["domain_tag1", "domain_tag2"]}

Tags should be 1-3 domain labels from: auth, http, db, cache, queue, config, util, test, cli, graph, store, parser, middleware, api, worker."""

PARAMETER temperature 0.0
PARAMETER stop <|im_end|>
PARAMETER stop <|endoftext|>
PARAMETER num_predict 256
"##;

const MODELFILE_CRITIC: &str = r##"FROM qwen3.5:2b

SYSTEM """You are the Synapses Critic, an architectural rule violation explainer.

Given an architectural rule violation (rule description, severity, source file, and what it imports/calls), explain the violation and suggest a concrete fix.

Output ONLY valid JSON with no other text: {"explanation": "why this is a violation and what risk it creates", "fix": "specific actionable fix the developer should apply"}

Example:
Input: Rule: no-cross-layer-imports. Severity: error. File: internal/api/handler.go imports internal/store/sqlite.go
Output: {"explanation": "The API handler directly imports the SQLite store implementation, bypassing the store interface. This creates tight coupling — changing the database requires modifying the API layer.", "fix": "Import the store.Store interface instead of the concrete sqlite implementation. Use dependency injection to pass the store to the handler."}

Be direct and actionable. Reference actual file names and symbols from the input."""

PARAMETER temperature 0.1
PARAMETER stop <|im_end|>
PARAMETER stop <|endoftext|>
PARAMETER num_predict 512
"##;

const MODELFILE_LIBRARIAN: &str = r##"FROM qwen3.5:2b

SYSTEM """You are the Synapses Librarian, a code architecture analyst.

Given a code graph slice (entity name, type, package, callers, callees, and relationships), analyze it for architectural patterns, risks, and insights.

Output ONLY valid JSON — no explanation, no markdown:
{"insight":"2-sentence architectural analysis","concerns":["concern1","concern2"]}

Rules:
- insight: identify the entity's role in the architecture (hub, gateway, utility, etc.) and its most important characteristic
- concerns: list 0-3 specific risks (cyclic deps, missing error handling, god object, missing abstraction, etc.)
- If no concerns, return an empty array: "concerns":[]
- Be specific — reference actual entity names and relationships, not generic advice"""

PARAMETER temperature 0.2
PARAMETER stop <|im_end|>
PARAMETER stop <|endoftext|>
PARAMETER num_predict 512
"##;

const MODELFILE_NAVIGATOR: &str = r##"FROM qwen3.5:2b

SYSTEM """You are the Synapses Navigator. You resolve multi-agent work scope conflicts.

Input: A JSON description of agents with their active scopes, and the new agent requesting a scope.

Output ONLY valid JSON — no explanation, no markdown:
{"suggestion":"how to resolve the conflict or confirmation it is safe","alternative_scope":"a suggested non-overlapping scope for the new agent, or empty string if no conflict"}

Rules:
- If the new agent's scope overlaps with an active agent's scope, describe the conflict and suggest a narrower scope
- If there is no real conflict (different packages, non-overlapping files), return: {"suggestion":"No conflict. Safe to proceed.","alternative_scope":""}
- Be specific — reference actual package names and file paths from the input
- alternative_scope should be a valid Go package path or file glob pattern"""

PARAMETER temperature 0.1
PARAMETER stop <|im_end|>
PARAMETER stop <|endoftext|>
PARAMETER num_predict 512
"##;

const MODELFILE_ARCHIVIST: &str = r##"FROM qwen3.5:2b

SYSTEM """You are the Synapses Archivist. You synthesize agent session transcripts into persistent memories.

Input: JSON with session_events (tool calls with results) and existing_memory (already saved entries).

Output ONLY valid JSON — no explanation, no markdown:
{"new_memories":[{"key":"short_snake_case_key","content":"what to remember in one sentence","entities":"EntityName1,EntityName2"}],"annotations":[{"node":"EntityName","note":"specific observation about this entity"}]}

Note: entities is a comma-separated string, NOT an array.

Rules:
- Only save architectural discoveries, non-obvious relationships, or decisions that will matter in future sessions
- If the session is trivial (single lookup, no architectural discovery, only routine tool calls), return: {"new_memories":[],"annotations":[]}
- Never duplicate entries already present in existing_memory — check keys before adding
- Keep each memory content to one concise sentence
- Only annotate entities that were meaningfully analyzed, not just mentioned in passing
- key must be short_snake_case (e.g., "auth_service_is_hub", "graph_new_entry_point")"""

PARAMETER temperature 0.3
PARAMETER stop <|im_end|>
PARAMETER stop <|endoftext|>
PARAMETER num_predict 1024
"##;

fn modelfile_for_tier(tier: &str) -> Option<&'static str> {
    match tier {
        "synapses/sentry"    => Some(MODELFILE_SENTRY),
        "synapses/critic"    => Some(MODELFILE_CRITIC),
        "synapses/librarian" => Some(MODELFILE_LIBRARIAN),
        "synapses/navigator" => Some(MODELFILE_NAVIGATOR),
        "synapses/archivist" => Some(MODELFILE_ARCHIVIST),
        _ => None,
    }
}

/// Registers a single Synapses AI tier identity via Ollama's HTTP API (POST /api/create).
/// No subprocess — calls Ollama directly with the embedded Modelfile content.
/// Zero PATH dependency: requires only Ollama running at ollama_url.
/// Emits "brain-identity-status" events:
///   { tier, status: "registering" }           — immediately on call
///   { tier, status: "done" }                  — on success
///   { tier, status: "error", message: "..." } — on failure
#[tauri::command]
async fn register_brain_identity(
    tier: String,
    ollama_url: String,
    app: AppHandle,
) -> Result<(), String> {
    let modelfile = modelfile_for_tier(&tier)
        .ok_or_else(|| format!("Unknown tier '{}' — valid tiers: synapses/sentry, synapses/critic, synapses/librarian, synapses/navigator, synapses/archivist", tier))?;

    let _ = app.emit("brain-identity-status", serde_json::json!({
        "tier": tier, "status": "registering"
    }));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/api/create", ollama_url.trim_end_matches('/')))
        .json(&serde_json::json!({
            "name":      tier,
            "modelfile": modelfile,
            "stream":    false,
        }))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("Cannot reach Ollama at {}: {}", ollama_url, e);
            let _ = app.emit("brain-identity-status", serde_json::json!({
                "tier": tier, "status": "error", "message": &msg
            }));
            msg
        })?;

    if !resp.status().is_success() {
        let http_status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        let msg = format!("Ollama /api/create returned HTTP {}: {}", http_status, body.trim());
        let _ = app.emit("brain-identity-status", serde_json::json!({
            "tier": tier, "status": "error", "message": &msg
        }));
        return Err(msg);
    }

    // Parse the response — check for an inline error field even on HTTP 200
    let body: serde_json::Value = resp.json().await
        .unwrap_or(serde_json::json!({"status": "success"}));

    if let Some(err) = body["error"].as_str() {
        let msg = err.to_string();
        let _ = app.emit("brain-identity-status", serde_json::json!({
            "tier": tier, "status": "error", "message": &msg
        }));
        return Err(format!("{}: {}", tier, msg));
    }

    let _ = app.emit("brain-identity-status", serde_json::json!({
        "tier": tier, "status": "done"
    }));
    Ok(())
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
/// All project indexes live in ~/.synapses/cache/*.db since the Phase 3–5 merge.
/// pulse.sqlite holds analytics. Returns "synapses" = sum of all cache DBs.
#[tauri::command]
fn get_data_sizes() -> HashMap<String, u64> {
    let data_dir = sidecar::synapses_data_dir();
    let mut result = HashMap::new();

    // Sum all *.db files in ~/.synapses/cache/ (one per indexed project)
    let cache_dir = data_dir.join("cache");
    let mut cache_total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("db") {
                cache_total += std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    result.insert("synapses".to_string(), cache_total);

    // pulse.sqlite holds analytics data
    let pulse_size = std::fs::metadata(data_dir.join("pulse.sqlite"))
        .map(|m| m.len())
        .unwrap_or(0);
    result.insert("pulse".to_string(), pulse_size);

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

/// Returns recent lines from the singleton daemon log file (~/.synapses/logs/daemon.log)
#[tauri::command]
fn get_log_lines(n: usize) -> Vec<String> {
    let log_path = sidecar::synapses_data_dir().join("logs").join("daemon.log");
    if let Ok(content) = std::fs::read_to_string(log_path) {
        let lines: Vec<String> = content.lines().map(String::from).collect();
        let start = if lines.len() > n { lines.len() - n } else { 0 };
        lines[start..].to_vec()
    } else {
        vec![]
    }
}

/// Returns aggregate counts of knowledge accumulated across all indexed project stores.
/// Queries each ~/.synapses/cache/*.db for plans, tasks, episodes (decisions), and dynamic_rules.
/// Returns { plans, tasks, decisions, rules } — silently skips unreadable DBs.
#[tauri::command]
fn get_knowledge_base_stats() -> HashMap<String, u64> {
    let cache_dir = sidecar::synapses_data_dir().join("cache");
    let mut plans: u64 = 0;
    let mut tasks: u64 = 0;
    let mut decisions: u64 = 0;
    let mut rules: u64 = 0;

    let entries = match std::fs::read_dir(&cache_dir) {
        Ok(e) => e,
        Err(_) => {
            let mut m = HashMap::new();
            m.insert("plans".to_string(), 0u64);
            m.insert("tasks".to_string(), 0u64);
            m.insert("decisions".to_string(), 0u64);
            m.insert("rules".to_string(), 0u64);
            return m;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("db") {
            continue;
        }
        let path_str = path.to_string_lossy().to_string();
        for (table, counter) in [
            ("plans", &mut plans),
            ("tasks", &mut tasks),
            ("episodes", &mut decisions),
            ("dynamic_rules", &mut rules),
        ] {
            if let Ok(out) = std::process::Command::new("sqlite3")
                .arg(&path_str)
                .arg(format!("SELECT COUNT(*) FROM {table};"))
                .output()
            {
                if let Ok(s) = String::from_utf8(out.stdout) {
                    if let Ok(n) = s.trim().parse::<u64>() {
                        *counter += n;
                    }
                }
            }
        }
    }

    let mut m = HashMap::new();
    m.insert("plans".to_string(), plans);
    m.insert("tasks".to_string(), tasks);
    m.insert("decisions".to_string(), decisions);
    m.insert("rules".to_string(), rules);
    m
}

/// Clears all agent memory (plans, tasks, episodes, memories, annotations)
/// across all indexed projects. Preserves the code graph (nodes, edges).
/// Uses the Go binary's built-in SQLite driver — no external sqlite3 dependency.
#[tauri::command]
async fn clear_agent_memory() -> Result<(), String> {
    let bin = sidecar::find_binary("synapses")
        .ok_or_else(|| "synapses binary not found".to_string())?;
    let out = std::process::Command::new(bin)
        .args(["index", "--clear-memory"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

/// Clears activity logs (tool_calls) across all indexed projects AND pulse.sqlite.
#[tauri::command]
async fn clear_activity_logs() -> Result<(), String> {
    // 1. Clear per-project tool_calls + memory via CLI (uses Go's built-in SQLite)
    let bin = sidecar::find_binary("synapses")
        .ok_or_else(|| "synapses binary not found".to_string())?;
    let out = std::process::Command::new(bin)
        .args(["index", "--clear-memory", "--all"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }

    // 2. Also clear the global pulse.sqlite analytics store
    // Remove the file entirely — daemon recreates schema on next start.
    let pulse_path = sidecar::synapses_data_dir().join("pulse.sqlite");
    if pulse_path.exists() {
        let _ = std::fs::remove_file(&pulse_path);
    }

    Ok(())
}

/// Clears all web cache entries by calling `synapses cache clear`
#[tauri::command]
async fn clear_web_cache() -> Result<String, String> {
    let bin = find_binary("synapses").ok_or_else(|| "synapses binary not found".to_string())?;
    let out = std::process::Command::new(bin)
        .args(["cache", "clear"])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok("Web cache cleared".to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

/// Wipes all data: resets all project indexes, removes daemon log and app settings.
#[tauri::command]
fn wipe_all_data() -> Result<(), String> {
    let bin = find_binary("synapses").ok_or_else(|| "synapses binary not found".to_string())?;
    let _ = std::process::Command::new(&bin)
        .args(["index", "--reset", "--all"])
        .output()
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(sidecar::synapses_data_dir().join("logs").join("daemon.log"));
    let _ = std::fs::remove_file(sidecar::synapses_data_dir().join("app_settings.json"));
    Ok(())
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

/// Delegates to `synapses connect --agent <editor> --path <project_path>`.
/// The synapses binary writes all agent-specific files:
///   - MCP config (agent-specific path and format)
///   - Guidance/rules file (.claude/CLAUDE.md, .cursor/rules/synapses.mdc, .windsurfrules)
///   - For Claude: .claude/settings.json (hooks + permissions)
/// Returns the stdout from the connect command.
const ALLOWED_EDITORS: &[&str] = &[
    "claude", "cursor", "windsurf", "zed", "vscode", "antigravity",
];

#[tauri::command]
fn write_mcp_config(editor: String, project_path: String) -> Result<String, String> {
    // Validate editor against whitelist
    if !ALLOWED_EDITORS.contains(&editor.as_str()) {
        return Err(format!("Invalid editor: {}", editor));
    }
    // Validate project_path: no path traversal, must be a directory
    let project = std::path::PathBuf::from(&project_path);
    if project.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("Path traversal not allowed".to_string());
    }
    if !project.is_dir() {
        return Err("Project path does not exist or is not a directory".to_string());
    }
    let bin = find_binary("synapses")
        .ok_or_else(|| "synapses binary not found".to_string())?;
    let out = std::process::Command::new(bin)
        .args(["connect", "--agent", &editor, "--path", &project_path])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

/// Checks whether the Synapses MCP entry already exists in a project's agent config.
#[tauri::command]
fn check_mcp_config(editor: String, project_path: String) -> bool {
    let project = std::path::PathBuf::from(&project_path);

    let config_path = match editor.as_str() {
        "claude"      => project.join(".mcp.json"),
        "cursor"      => project.join(".cursor").join("mcp.json"),
        "windsurf"    => project.join(".windsurf").join("mcp_config.json"),
        "zed"         => project.join(".zed").join("settings.json"),
        "vscode"      => project.join(".vscode").join("mcp.json"),
        "antigravity" => project.join(".agent").join("mcp.json"),
        _             => return false,
    };

    if !config_path.exists() { return false; }

    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let config: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };

    match editor.as_str() {
        "zed"    => config["context_servers"]["synapses"].is_object(),
        "vscode" => config["servers"]["synapses"].is_object(),
        _        => config["mcpServers"]["synapses"].is_object(), // claude, cursor, windsurf, antigravity
    }
}

/// Returns agent IDs that appear to be installed on this machine based on filesystem detection.
#[tauri::command]
fn detect_installed_agents() -> Vec<String> {
    let home = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default());
    let mut detected = Vec::new();

    // Claude Code (CLI — no .app bundle, look for ~/.claude)
    if home.join(".claude").exists() {
        detected.push("claude".to_string());
    }

    // Cursor
    let cursor_found = if cfg!(target_os = "macos") {
        std::path::Path::new("/Applications/Cursor.app").exists() || home.join(".cursor").exists()
    } else {
        home.join(".cursor").exists() || home.join(".config").join("cursor").exists()
    };
    if cursor_found { detected.push("cursor".to_string()); }

    // Windsurf
    let windsurf_found = if cfg!(target_os = "macos") {
        std::path::Path::new("/Applications/Windsurf.app").exists()
            || home.join(".codeium").join("windsurf").exists()
    } else {
        home.join(".codeium").join("windsurf").exists()
    };
    if windsurf_found { detected.push("windsurf".to_string()); }

    // Zed
    let zed_found = if cfg!(target_os = "macos") {
        std::path::Path::new("/Applications/Zed.app").exists()
            || home.join(".config").join("zed").exists()
    } else {
        home.join(".config").join("zed").exists()
    };
    if zed_found { detected.push("zed".to_string()); }

    // VS Code (covers GitHub Copilot agent mode, MCP support in VS Code 1.99+)
    let vscode_found = if cfg!(target_os = "macos") {
        std::path::Path::new("/Applications/Visual Studio Code.app").exists()
            || home.join(".vscode").exists()
    } else {
        home.join(".vscode").exists() || home.join(".config").join("Code").exists()
    };
    if vscode_found { detected.push("vscode".to_string()); }

    // Antigravity (Google's agentic IDE — stores global config in ~/.gemini/)
    let antigravity_found = if cfg!(target_os = "macos") {
        std::path::Path::new("/Applications/Antigravity.app").exists()
            || home.join(".gemini").exists()
    } else {
        home.join(".gemini").exists()
    };
    if antigravity_found { detected.push("antigravity".to_string()); }

    detected
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
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        (os, arch) => return Err(format!("Unsupported platform: {os}-{arch}")),
    };

    let bin_suffix = if cfg!(windows) { ".exe" } else { "" };
    let bundled = resource_dir.join(format!("synapses-{triple}{bin_suffix}"));
    // Skip if the file doesn't exist or is a 0-byte dev stub.
    // CI places the real binary here before `tauri build`; local dev has an empty placeholder.
    let bundled_size = std::fs::metadata(&bundled).map(|m| m.len()).unwrap_or(0);
    if bundled_size == 0 {
        return Ok(());
    }

    let bin_dir = sidecar::synapses_data_dir().join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let dest = bin_dir.join(format!("synapses{bin_suffix}"));
    let version_file = bin_dir.join(".app-extracted-version");

    // If a binary exists on PATH (brew, go install, etc.), never overwrite — the
    // user manages their own binary. Only manage the ~/.synapses/bin/ copy.
    if which::which(format!("synapses{bin_suffix}")).is_ok() {
        // PATH binary exists and it's NOT our extracted one (different path).
        let path_bin = which::which(format!("synapses{bin_suffix}")).unwrap();
        if path_bin != dest {
            return Ok(());
        }
    }

    // If developer has linked a custom binary, skip extraction to preserve their override.
    let dev_link_file = sidecar::synapses_data_dir().join("dev_link.json");
    if dev_link_file.exists() {
        if let Ok(data) = std::fs::read_to_string(&dev_link_file) {
            if data.contains(r#""linked":true"#) || data.contains(r#""linked": true"#) {
                eprintln!("synapses-app: dev link active — skipping binary extraction");
                return Ok(());
            }
        }
    }

    // If dest exists, only overwrite if we previously extracted it (version file
    // exists) AND the app version is newer than what was extracted.
    if dest.exists() {
        if let Ok(prev_version) = std::fs::read_to_string(&version_file) {
            if prev_version.trim() == APP_VERSION {
                return Ok(()); // same version, nothing to do
            }
            // App was updated — extract newer binary below
        } else {
            // No version file → binary was placed manually or by CLI. Don't touch it.
            return Ok(());
        }
    }

    // Extract bundled binary atomically: copy to temp, set permissions, then rename.
    // This prevents TOCTOU races where an attacker replaces dest between copy and chmod.
    let temp_dest = bin_dir.join(format!(".synapses-extracting-{}{}", std::process::id(), bin_suffix));
    let _ = std::fs::remove_file(&temp_dest); // clean up any stale temp file

    std::fs::copy(&bundled, &temp_dest).map_err(|e| format!("Failed to extract daemon: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&temp_dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&temp_dest, perms).map_err(|e| e.to_string())?;
    }

    // Back up the previous binary for rollback (synapses update --rollback).
    let prev_dest = bin_dir.join(format!("synapses.previous{bin_suffix}"));
    if dest.exists() {
        let _ = std::fs::copy(&dest, &prev_dest);
    }

    // Atomic rename to final destination
    std::fs::rename(&temp_dest, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&temp_dest);
        format!("Failed to place daemon binary: {e}")
    })?;
    std::fs::write(&version_file, APP_VERSION).map_err(|e| format!("Failed to write version file: {e}"))?;

    // Re-sign on macOS — rename strips the ad-hoc signature and macOS
    // kills unsigned arm64 binaries.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-", dest.to_str().unwrap_or_default()])
            .output();
    }

    Ok(())
}

// ── Daemon binary auto-update ─────────────────────────────────────────────────

/// Checks GitHub for a newer synapses daemon binary and downloads it if available.
/// This decouples daemon updates from Tauri app updates — a new daemon release
/// is picked up automatically without requiring the user to update the app.
///
/// Flow:
/// 1. Get installed daemon version (`synapses version`)
/// 2. Query GitHub API for latest synapses release tag
/// 3. If newer, download the correct platform archive
/// 4. Extract and atomically replace ~/.synapses/bin/synapses
/// 5. Emit `daemon-updated` event to frontend
///
/// Runs once on app launch. Fails silently — never blocks the app.
async fn check_daemon_binary_update(app_handle: AppHandle) {
    // 1. Get installed version
    let installed_version = match find_binary("synapses") {
        Some(bin) => match std::process::Command::new(&bin).arg("version").output() {
            Ok(out) => {
                let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                v.trim_start_matches("synapses ").to_string()
            }
            Err(_) => return,
        },
        None => return, // no binary at all — extract_bundled_daemon handles this
    };

    // Skip dev builds
    if installed_version == "dev" || installed_version.contains("dirty") {
        return;
    }

    // 2. Query GitHub for latest release
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("synapses-app")
        .build()
        .unwrap_or_default();

    let latest: serde_json::Value = match client
        .get("https://api.github.com/repos/SynapsesOS/synapses/releases/latest")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(_) => return,
        },
        _ => return,
    };

    let latest_tag = match latest["tag_name"].as_str() {
        Some(t) => t.trim_start_matches('v'),
        None => return,
    };

    // 3. Compare versions — only update if latest is strictly newer
    if !is_newer_version(latest_tag, &installed_version) {
        return;
    }

    // 4. Determine platform asset name
    let asset_name = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "synapses_darwin_arm64.tar.gz",
        ("macos", "x86_64") => "synapses_darwin_x86_64.tar.gz",
        ("linux", "x86_64") => "synapses_linux_x86_64.tar.gz",
        _ => return,
    };

    // Find the download URL from release assets
    let download_url = match latest["assets"].as_array() {
        Some(assets) => {
            let found = assets.iter().find_map(|a| {
                if a["name"].as_str() == Some(asset_name) {
                    a["browser_download_url"].as_str().map(String::from)
                } else {
                    None
                }
            });
            match found {
                Some(url) => url,
                None => return,
            }
        }
        None => return,
    };

    // 5. Download to temp directory
    let resp = match client.get(&download_url).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return,
    };
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return,
    };

    // 6. Extract binary from tarball
    let bin_dir = sidecar::synapses_data_dir().join("bin");
    std::fs::create_dir_all(&bin_dir).ok();

    let bin_suffix = if cfg!(windows) { ".exe" } else { "" };
    let dest = bin_dir.join(format!("synapses{bin_suffix}"));
    let temp_dest = bin_dir.join(format!(".synapses-update-{}{}", std::process::id(), bin_suffix));

    // Decompress and extract the "synapses" binary from the tar.gz
    let decoder = flate2::read::GzDecoder::new(&bytes[..]);
    let mut archive = tar::Archive::new(decoder);
    let mut extracted = false;
    if let Ok(entries) = archive.entries() {
        for entry in entries.flatten() {
            if let Ok(path) = entry.path() {
                if path.file_name().and_then(|n| n.to_str()) == Some(&format!("synapses{bin_suffix}")) {
                    let mut entry = entry;
                    if let Ok(mut out) = std::fs::File::create(&temp_dest) {
                        if std::io::copy(&mut entry, &mut out).is_ok() {
                            extracted = true;
                        }
                    }
                    break;
                }
            }
        }
    }

    if !extracted {
        let _ = std::fs::remove_file(&temp_dest);
        return;
    }

    // Set executable permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&temp_dest) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&temp_dest, perms);
        }
    }

    // Atomic rename
    if std::fs::rename(&temp_dest, &dest).is_err() {
        let _ = std::fs::remove_file(&temp_dest);
        return;
    }

    // Write version file so extract_bundled_daemon doesn't overwrite
    let version_file = bin_dir.join(".app-extracted-version");
    let _ = std::fs::write(&version_file, latest_tag);

    // Re-sign on macOS
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-", dest.to_str().unwrap_or_default()])
            .output();
    }

    // Emit event to frontend
    let _ = app_handle.emit("daemon-updated", serde_json::json!({
        "from": installed_version,
        "to": latest_tag,
    }));

    eprintln!("synapses-app: daemon binary updated {} → {}", installed_version, latest_tag);
}

/// Simple semver comparison: returns true if `latest` is strictly newer than `current`.
fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> (u32, u32, u32) {
        let parts: Vec<&str> = v.split('.').collect();
        (
            parts.first().and_then(|s| s.parse().ok()).unwrap_or(0),
            parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
        )
    };
    parse(latest) > parse(current)
}

// ── Anonymous usage ping ──────────────────────────────────────────────────────

/// Sends a single anonymous ping to track aggregate install/usage counts.
/// No personal data: just OS, arch, version, and event type.
/// Fails silently — never blocks the app.
async fn send_anonymous_ping() {
    let data_dir = sidecar::synapses_data_dir();
    let first_launch_marker = data_dir.join(".first_launch_sent");
    let weekly_marker = data_dir.join(".weekly_ping");

    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let version = APP_VERSION;

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build() {
        Ok(c) => c,
        Err(_) => return,
    };

    // First launch ping (only once ever)
    if !first_launch_marker.exists() {
        let url = format!(
            "https://synapsesos.com/api/ping?e=first_launch&os={os}&arch={arch}&v={version}"
        );
        if client.get(&url).send().await.is_ok() {
            let _ = std::fs::write(&first_launch_marker, "");
        }
    }

    // Weekly active ping (at most once per 7 days)
    let should_ping_weekly = if weekly_marker.exists() {
        match std::fs::metadata(&weekly_marker) {
            Ok(meta) => {
                match meta.modified() {
                    Ok(modified) => modified.elapsed().unwrap_or_default() > Duration::from_secs(7 * 24 * 3600),
                    Err(_) => true,
                }
            }
            Err(_) => true,
        }
    } else {
        true
    };

    if should_ping_weekly {
        let url = format!(
            "https://synapsesos.com/api/ping?e=weekly_active&os={os}&arch={arch}&v={version}"
        );
        if client.get(&url).send().await.is_ok() {
            let _ = std::fs::write(&weekly_marker, "");
        }
    }
}

// ── CLI symlink (Ollama-style) ────────────────────────────────────────────────

/// Creates /usr/local/bin/synapses → ~/.synapses/bin/synapses symlink so the
/// CLI is available on PATH. Skips if a different binary already exists there
/// (e.g., from brew or go install). Fails silently if /usr/local/bin is not
/// writable (no sudo required — user can add ~/.synapses/bin to PATH instead).
fn install_cli_symlink_inner(daemon_bin: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let symlink_path = std::path::PathBuf::from("/usr/local/bin/synapses");
        let daemon_canonical = daemon_bin.canonicalize()
            .unwrap_or_else(|_| daemon_bin.to_path_buf());

        // If something already exists at the symlink path, check what it is.
        if symlink_path.symlink_metadata().is_ok() {
            if let Ok(target) = std::fs::read_link(&symlink_path) {
                // Compare canonical paths to handle relative vs absolute
                let target_canonical = target.canonicalize()
                    .unwrap_or_else(|_| target.clone());
                if target_canonical == daemon_canonical {
                    return Ok(()); // Already points to our binary.
                }
            }
            // Exists but is not our symlink — don't overwrite.
            return Ok(());
        }

        // Create parent directory if needed.
        if let Some(parent) = symlink_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // Create the symlink. May fail if /usr/local/bin is not writable — that's OK.
        std::os::unix::fs::symlink(&daemon_canonical, &symlink_path)
            .map_err(|e| format!("symlink failed: {e}"))?;
    }

    #[cfg(windows)]
    {
        let _ = daemon_bin;
    }

    Ok(())
}

#[tauri::command]
fn install_cli_symlink() -> Result<String, String> {
    let bin = sidecar::synapses_data_dir().join("bin").join("synapses");
    if !bin.exists() {
        return Err("Daemon binary not found at ~/.synapses/bin/synapses".to_string());
    }
    install_cli_symlink_inner(&bin)?;
    Ok("CLI symlink created at /usr/local/bin/synapses".to_string())
}

// ── Shell PATH setup ─────────────────────────────────────────────────────────

/// Adds `~/.synapses/bin` to the user's shell rc file(s) if not already present.
/// Detects the active shell and appends the appropriate PATH export.
/// Safe to call multiple times — only appends if the line is not already there.
fn ensure_path_in_shell_rc() {
    #[cfg(unix)]
    {
        let home = match std::env::var("HOME") {
            Ok(h) => h,
            Err(_) => return,
        };
        let synapses_bin = format!("{}/.synapses/bin", home);

        // Check if already on PATH
        if let Ok(path) = std::env::var("PATH") {
            if path.split(':').any(|p| p == synapses_bin || p == "$HOME/.synapses/bin") {
                return;
            }
        }

        // Detect shell and choose rc files
        let shell = std::env::var("SHELL").unwrap_or_default();
        let mut rc_files = Vec::new();

        if shell.ends_with("/zsh") || shell.ends_with("/zsh-") {
            rc_files.push(format!("{}/.zshrc", home));
        } else if shell.ends_with("/bash") {
            // bash on macOS uses .bash_profile for login shells
            let bash_profile = format!("{}/.bash_profile", home);
            let bashrc = format!("{}/.bashrc", home);
            if std::path::Path::new(&bash_profile).exists() {
                rc_files.push(bash_profile);
            } else {
                rc_files.push(bashrc);
            }
        } else if shell.ends_with("/fish") {
            rc_files.push(format!("{}/.config/fish/config.fish", home));
        }

        // Fallback: if we couldn't detect, try common files
        if rc_files.is_empty() {
            let zshrc = format!("{}/.zshrc", home);
            if std::path::Path::new(&zshrc).exists() {
                rc_files.push(zshrc);
            } else {
                rc_files.push(format!("{}/.bashrc", home));
            }
        }

        let export_line_bash = r#"export PATH="$HOME/.synapses/bin:$PATH""#;
        let marker = "# Added by Synapses";

        for rc_file in &rc_files {
            // Read existing content and check if already added
            let content = std::fs::read_to_string(rc_file).unwrap_or_default();
            if content.contains(".synapses/bin") {
                continue; // Already configured
            }

            // Fish uses different syntax
            let line = if rc_file.ends_with("config.fish") {
                format!("\n{marker}\nfish_add_path ~/.synapses/bin\n")
            } else {
                format!("\n{marker}\n{export_line_bash}\n")
            };

            // Create parent directories if needed (for fish)
            if let Some(parent) = std::path::Path::new(rc_file).parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            // Append to rc file
            let mut file = match std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(rc_file)
            {
                Ok(f) => f,
                Err(_) => continue,
            };
            let _ = std::io::Write::write_all(&mut file, line.as_bytes());
        }
    }
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
        let bin_str = sidecar::find_binary("synapses")
            .unwrap_or_else(|| sidecar::synapses_data_dir().join("bin").join("synapses").to_string_lossy().to_string());
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

    #[cfg(target_os = "linux")]
    {
        let bin_str = sidecar::find_binary("synapses")
            .unwrap_or_else(|| sidecar::synapses_data_dir().join("bin").join("synapses").to_string_lossy().to_string());
        let log_dir = sidecar::synapses_data_dir().join("logs");
        std::fs::create_dir_all(&log_dir).ok();
        let log_str = log_dir.join("daemon.log").to_string_lossy().to_string();

        let unit = format!(
            r#"[Unit]
Description=Synapses Daemon
After=network.target

[Service]
Type=simple
ExecStart={bin_str} daemon serve
Restart=on-failure
RestartSec=5
StandardOutput=append:{log_str}
StandardError=append:{log_str}

[Install]
WantedBy=default.target
"#);

        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let systemd_dir = std::path::PathBuf::from(&home).join(".config/systemd/user");
        std::fs::create_dir_all(&systemd_dir).ok();
        let unit_path = systemd_dir.join("synapses-daemon.service");

        let existing = std::fs::read_to_string(&unit_path).unwrap_or_default();
        if existing != unit {
            std::fs::write(&unit_path, &unit).map_err(|e| e.to_string())?;
            let _ = std::process::Command::new("systemctl")
                .args(["--user", "daemon-reload"])
                .status();
            let _ = std::process::Command::new("systemctl")
                .args(["--user", "enable", "--now", "synapses-daemon"])
                .status();
        }
    }

    Ok(())
}

// ── Ollama detection ──────────────────────────────────────────────────────────

/// Checks if Ollama is reachable and returns its version + installed model names.
/// Accepts an optional URL; if omitted, reads ollama_url from ~/.synapses/brain.json,
/// falling back to http://localhost:11434. This means custom-URL users get accurate
/// status instead of always appearing offline.
#[tauri::command]
async fn check_ollama(url: Option<String>) -> Result<serde_json::Value, String> {
    let base = url.unwrap_or_else(|| {
        // Read configured URL from brain.json so custom-URL users get the right status.
        let path = sidecar::synapses_data_dir().join("brain.json");
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(u) = v["ollama_url"].as_str().filter(|s| !s.is_empty()) {
                    return u.to_string();
                }
            }
        }
        "http://localhost:11434".to_string()
    });
    let base = base.trim_end_matches('/').to_string();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    // Check version
    let version_res = client.get(format!("{}/api/version", base)).send().await;
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
    let models: Vec<String> = match client.get(format!("{}/api/tags", base)).send().await {
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

    // IMP-EVAL-1: check version mismatch once after the daemon is first healthy.
    // Reset to false after any restart so we re-check the freshly spawned binary.
    let mut version_notified = false;

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

        // Version mismatch check (IMP-EVAL-1): emit once after the daemon is healthy.
        // Resets when a restart is recorded so the freshly spawned binary is re-checked.
        if !version_notified {
            let daemon_healthy = mgr
                .lock()
                .unwrap()
                .sidecars
                .get("synapses")
                .map(|s| s.status == ServiceStatus::Healthy)
                .unwrap_or(false);

            if daemon_healthy {
                if let Ok(result) = get_daemon_version().await {
                    if result["mismatch"].as_bool().unwrap_or(false) {
                        let _ = app.emit("version-mismatch", &result);
                    }
                }
                version_notified = true;
            }
        } else {
            // Reset flag after a restart so we re-check the new binary.
            let restarted = mgr
                .lock()
                .unwrap()
                .sidecars
                .get("synapses")
                .map(|s| s.last_restart.map(|t| t.elapsed() < Duration::from_secs(15)).unwrap_or(false))
                .unwrap_or(false);
            if restarted {
                version_notified = false;
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
            get_daemon_version,
            get_indexing_progress,
            register_brain_identity,
            // App state
            get_synapses_data_dir,
            get_onboarding_done,
            set_onboarding_done,
            // Data / privacy
            get_data_sizes,
            get_knowledge_base_stats,
            open_data_dir,
            get_system_ram_gb,
            set_ollama_max_models,
            read_brain_config,
            write_brain_config,
            get_log_lines,
            clear_agent_memory,
            clear_activity_logs,
            clear_web_cache,
            wipe_all_data,
            read_app_settings,
            write_app_settings,
            write_mcp_config,
            check_mcp_config,
            detect_installed_agents,
            preregister_project,
            // Install & update
            register_launch_agent,
            check_ollama,
            pull_model,
            check_for_update,
            install_update,
            install_cli_symlink,
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
                // Create CLI symlink so `synapses` is available on PATH.
                if let Err(e) = install_cli_symlink_inner(&daemon_bin) {
                    eprintln!("synapses-app: could not create CLI symlink: {e}");
                }
                // Add ~/.synapses/bin to shell rc files so CLI works in new shells.
                ensure_path_in_shell_rc();
            }

            // Check for daemon binary updates from GitHub (runs in background, fails silently).
            let update_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                check_daemon_binary_update(update_handle).await;
            });

            // Anonymous usage ping (no personal data — just OS, arch, version, event type).
            tauri::async_runtime::spawn(async {
                send_anonymous_ping().await;
            });

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
