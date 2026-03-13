use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tokio::time::sleep;

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
    fn new(name: &str, port: u16, binary: &str, args: Vec<&str>) -> Self {
        Self {
            name: name.to_string(),
            port,
            binary: binary.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
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
        sidecars.insert(
            "brain".to_string(),
            SidecarState::new("brain", 11435, "brain", vec!["serve"]),
        );
        sidecars.insert(
            "scout".to_string(),
            SidecarState::new("scout", 11436, "scout", vec!["serve"]),
        );
        sidecars.insert(
            "pulse".to_string(),
            SidecarState::new("pulse", 11437, "pulse", vec!["serve"]),
        );
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

pub async fn check_health(port: u16) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_default();
    let url = format!("http://localhost:{}/v1/health", port);
    client.get(&url).send().await.map(|r| r.status().is_success()).unwrap_or(false)
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
