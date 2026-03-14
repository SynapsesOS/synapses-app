use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Healthy,
    Degraded,
    Offline,
    Disabled,
    Starting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarInfo {
    pub name: String,
    pub port: u16,
    pub status: ServiceStatus,
    pub consecutive_failures: u8,
    pub restarts_total: u32,
    pub pid: Option<u32>,
}

#[derive(Debug)]
pub struct SidecarState {
    pub name: String,
    pub port: u16,
    pub binary: String,
    pub args: Vec<String>,
    pub health_path: String,
    /// When set, health checks go to this Unix socket file instead of a TCP port.
    pub socket_path: Option<String>,
    pub status: ServiceStatus,
    pub consecutive_failures: u8,
    pub restarts_total: u32,
    pub restarts_in_window: u8,
    pub window_start: Instant,
    pub last_restart: Option<Instant>,
    pub pid: Option<u32>,
    pub enabled: bool,
}

impl SidecarState {
    fn new(name: &str, port: u16, binary: &str, args: Vec<&str>, health_path: &str) -> Self {
        Self {
            name: name.to_string(),
            port,
            binary: binary.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
            health_path: health_path.to_string(),
            socket_path: None,
            status: ServiceStatus::Starting,
            consecutive_failures: 0,
            restarts_total: 0,
            restarts_in_window: 0,
            window_start: Instant::now(),
            last_restart: None,
            pid: None,
            enabled: true,
        }
    }

    fn to_info(&self) -> SidecarInfo {
        SidecarInfo {
            name: self.name.clone(),
            port: self.port,
            status: self.status.clone(),
            consecutive_failures: self.consecutive_failures,
            restarts_total: self.restarts_total,
            pid: self.pid,
        }
    }

    fn reset_window_if_needed(&mut self) {
        if self.window_start.elapsed() > Duration::from_secs(600) {
            self.restarts_in_window = 0;
            self.window_start = Instant::now();
        }
    }

    fn can_restart(&self) -> bool {
        self.restarts_in_window < 2
    }

    fn cooldown_remaining(&self) -> Option<Duration> {
        if let Some(last) = self.last_restart {
            let elapsed = last.elapsed();
            let required = match self.restarts_in_window {
                0 => Duration::from_secs(0),
                1 => Duration::from_secs(10),
                _ => Duration::from_secs(30),
            };
            if elapsed < required {
                return Some(required - elapsed);
            }
        }
        None
    }
}

pub type SidecarManager = Arc<Mutex<SidecarManagerInner>>;

pub struct SidecarManagerInner {
    pub sidecars: HashMap<String, SidecarState>,
}

impl SidecarManagerInner {
    pub fn new() -> Self {
        let mut sidecars = HashMap::new();
        // Singleton daemon: one process serves all projects via HTTP MCP transport.
        // Brain and pulse are now in-process within the daemon binary.
        sidecars.insert(
            "synapses".to_string(),
            SidecarState::new("synapses", 11435, "synapses", vec!["daemon", "serve"], "/api/admin/health"),
        );
        // Scout has been removed — web intelligence is built into the synapses binary
        // via the Go-native webcache module (internal/webcache). No external sidecar needed.
        Self { sidecars }
    }

    pub fn get_all_info(&self) -> Vec<SidecarInfo> {
        let mut infos: Vec<SidecarInfo> = self.sidecars.values().map(|s| s.to_info()).collect();
        infos.sort_by(|a, b| a.name.cmp(&b.name));
        infos
    }


    pub fn get_info(&self, name: &str) -> Option<SidecarInfo> {
        self.sidecars.get(name).map(|s| s.to_info())
    }

    #[allow(dead_code)]
    pub fn set_status(&mut self, name: &str, status: ServiceStatus) {
        if let Some(s) = self.sidecars.get_mut(name) {
            s.status = status;
        }
    }

    pub fn record_failure(&mut self, name: &str) -> (u8, bool) {
        if let Some(s) = self.sidecars.get_mut(name) {
            s.consecutive_failures += 1;
            if s.consecutive_failures >= 2 {
                s.status = ServiceStatus::Degraded;
            }
            let should_restart = s.consecutive_failures >= 3 && s.can_restart() && s.cooldown_remaining().is_none();
            (s.consecutive_failures, should_restart)
        } else {
            (0, false)
        }
    }

    pub fn record_success(&mut self, name: &str) {
        if let Some(s) = self.sidecars.get_mut(name) {
            s.consecutive_failures = 0;
            s.status = ServiceStatus::Healthy;
        }
    }

    pub fn record_restart(&mut self, name: &str) {
        if let Some(s) = self.sidecars.get_mut(name) {
            s.reset_window_if_needed();
            s.restarts_in_window += 1;
            s.restarts_total += 1;
            s.last_restart = Some(Instant::now());
            s.consecutive_failures = 0;
            s.status = ServiceStatus::Starting;
        }
    }

    pub fn mark_offline(&mut self, name: &str) {
        if let Some(s) = self.sidecars.get_mut(name) {
            s.status = ServiceStatus::Offline;
        }
    }

    pub fn get_binary_and_args(&self, name: &str) -> Option<(String, Vec<String>)> {
        self.sidecars.get(name).map(|s| (s.binary.clone(), s.args.clone()))
    }

    #[allow(dead_code)]
    pub fn is_enabled(&self, name: &str) -> bool {
        self.sidecars.get(name).map(|s| s.enabled).unwrap_or(false)
    }

    pub fn set_enabled(&mut self, name: &str, enabled: bool) {
        if let Some(s) = self.sidecars.get_mut(name) {
            s.enabled = enabled;
            if !enabled {
                s.status = ServiceStatus::Disabled;
            }
        }
    }
}

pub async fn check_health(port: u16, path: &str) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_default();
    let url = format!("http://localhost:{}{}", port, path);
    client.get(&url).send().await.map(|r| r.status().is_success()).unwrap_or(false)
}

/// Health check over a Unix domain socket: sends a minimal HTTP/1.0 GET
/// and checks for a 200 response. Returns false if the socket doesn't exist
/// or doesn't respond within 3 seconds.
#[cfg(unix)]
pub async fn check_unix_health(sock_path: &str, http_path: &str) -> bool {
    use tokio::net::UnixStream;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let expanded = if sock_path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        format!("{}/{}", home, &sock_path[2..])
    } else {
        sock_path.to_string()
    };

    let stream_result = tokio::time::timeout(
        Duration::from_secs(3),
        UnixStream::connect(&expanded),
    ).await;
    let mut stream: UnixStream = match stream_result {
        Ok(Ok(s)) => s,
        _ => return false,
    };

    let request = format!("GET {} HTTP/1.0\r\nHost: localhost\r\n\r\n", http_path);
    if stream.write_all(request.as_bytes()).await.is_err() {
        return false;
    }

    let mut buf = [0u8; 32];
    match tokio::time::timeout(Duration::from_secs(3), stream.read(&mut buf)).await {
        Ok(Ok(n)) if n > 0 => String::from_utf8_lossy(&buf[..n]).contains("200"),
        _ => false,
    }
}

#[cfg(not(unix))]
pub async fn check_unix_health(_sock_path: &str, _http_path: &str) -> bool {
    false
}

/// Kill whatever process is currently listening on `port`.
/// Uses lsof on macOS/Linux to find and kill by port — guarantees no duplicate.
pub fn kill_by_port(port: u16) {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // lsof -ti tcp:PORT returns the PID(s) listening on that port
        if let Ok(out) = std::process::Command::new("lsof")
            .args(["-ti", &format!("tcp:{}", port)])
            .output()
        {
            let pids = String::from_utf8_lossy(&out.stdout);
            for pid_str in pids.split_whitespace() {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    let _ = std::process::Command::new("kill")
                        .args(["-TERM", &pid.to_string()])
                        .status();
                }
            }
        }
    }
}

/// Try to find the PID of the process currently listening on `port`.
pub fn pid_for_port(port: u16) -> Option<u32> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        if let Ok(out) = std::process::Command::new("lsof")
            .args(["-ti", &format!("tcp:{}", port)])
            .output()
        {
            let pids = String::from_utf8_lossy(&out.stdout);
            return pids.split_whitespace()
                .next()
                .and_then(|s| s.trim().parse::<u32>().ok());
        }
    }
    None
}

/// Try to find the PID of the process that has `sock_path` open as a socket.
/// Uses `lsof` on macOS/Linux. Expands a leading `~/` using $HOME.
pub fn pid_for_socket(sock_path: &str) -> Option<u32> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let expanded = if sock_path.starts_with("~/") {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            format!("{}/{}", home, &sock_path[2..])
        } else {
            sock_path.to_string()
        };
        if let Ok(out) = std::process::Command::new("lsof")
            .args(["-t", &expanded])
            .output()
        {
            let pids = String::from_utf8_lossy(&out.stdout);
            return pids.split_whitespace()
                .next()
                .and_then(|s| s.trim().parse::<u32>().ok());
        }
    }
    None
}

pub fn synapses_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".synapses")
}

pub fn find_binary(name: &str) -> Option<String> {
    // Check ~/.synapses/bin first, then PATH
    let data_dir = synapses_data_dir();
    let local = data_dir.join("bin").join(name);
    if local.exists() {
        return Some(local.to_string_lossy().to_string());
    }
    // Fall back to PATH
    which::which(name).ok().map(|p| p.to_string_lossy().to_string())
}
