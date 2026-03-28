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
            } else {
                s.status = ServiceStatus::Starting;
                s.consecutive_failures = 0;
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
    // Security: prefer the app-extracted binary (known-good) over PATH.
    // PATH can be hijacked by placing a malicious binary in ~/bin/ or ./.
    // Only fall back to PATH for users who explicitly installed via brew/go.
    let data_dir = synapses_data_dir();
    let local = data_dir.join("bin").join(name);
    if local.exists() && local.metadata().map(|m| m.len()).unwrap_or(0) > 0 {
        return Some(local.to_string_lossy().to_string());
    }
    // Fall back to PATH (brew install, go install, etc.)
    if let Ok(p) = which::which(name) {
        return Some(p.to_string_lossy().to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// Build a SidecarState directly (mirrors SidecarState::new but accessible
    /// from tests because `new` is private).
    fn make_state(name: &str, port: u16) -> SidecarState {
        SidecarState {
            name: name.to_string(),
            port,
            binary: name.to_string(),
            args: vec!["daemon".to_string(), "serve".to_string()],
            health_path: "/health".to_string(),
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

    // -------------------------------------------------------------------------
    // ServiceStatus PartialEq
    // -------------------------------------------------------------------------

    #[test]
    fn service_status_partial_eq() {
        assert_eq!(ServiceStatus::Healthy, ServiceStatus::Healthy);
        assert_eq!(ServiceStatus::Degraded, ServiceStatus::Degraded);
        assert_eq!(ServiceStatus::Offline, ServiceStatus::Offline);
        assert_eq!(ServiceStatus::Disabled, ServiceStatus::Disabled);
        assert_eq!(ServiceStatus::Starting, ServiceStatus::Starting);

        assert_ne!(ServiceStatus::Healthy, ServiceStatus::Degraded);
        assert_ne!(ServiceStatus::Offline, ServiceStatus::Starting);
        assert_ne!(ServiceStatus::Disabled, ServiceStatus::Healthy);
    }

    // -------------------------------------------------------------------------
    // SidecarState::new (via SidecarManagerInner which calls the private fn)
    // -------------------------------------------------------------------------

    #[test]
    fn sidecar_state_new_default_fields() {
        // We exercise the private `new` path indirectly via SidecarManagerInner,
        // which is the only caller. We inspect the registered "synapses" entry.
        let mgr = SidecarManagerInner::new();
        let s = mgr.sidecars.get("synapses").expect("synapses must be registered");

        assert_eq!(s.name, "synapses");
        assert_eq!(s.port, 11435);
        assert_eq!(s.binary, "synapses");
        assert_eq!(s.args, vec!["daemon", "serve"]);
        assert_eq!(s.health_path, "/api/admin/health");
        assert!(s.socket_path.is_none());
        assert_eq!(s.status, ServiceStatus::Starting);
        assert_eq!(s.consecutive_failures, 0);
        assert_eq!(s.restarts_total, 0);
        assert_eq!(s.restarts_in_window, 0);
        assert!(s.last_restart.is_none());
        assert!(s.pid.is_none());
        assert!(s.enabled);
    }

    // -------------------------------------------------------------------------
    // SidecarState::to_info
    // -------------------------------------------------------------------------

    #[test]
    fn sidecar_state_to_info_matches_fields() {
        let mut s = make_state("test-svc", 9999);
        s.status = ServiceStatus::Healthy;
        s.consecutive_failures = 3;
        s.restarts_total = 7;
        s.pid = Some(42);

        let info = s.to_info();

        assert_eq!(info.name, "test-svc");
        assert_eq!(info.port, 9999);
        assert_eq!(info.status, ServiceStatus::Healthy);
        assert_eq!(info.consecutive_failures, 3);
        assert_eq!(info.restarts_total, 7);
        assert_eq!(info.pid, Some(42));
    }

    // -------------------------------------------------------------------------
    // SidecarState::reset_window_if_needed
    // -------------------------------------------------------------------------

    #[test]
    fn reset_window_if_needed_no_reset_when_recent() {
        let mut s = make_state("svc", 1000);
        s.restarts_in_window = 2;
        // window_start is just now — elapsed is negligible, no reset should happen
        s.reset_window_if_needed();
        assert_eq!(s.restarts_in_window, 2, "should not reset when window is recent");
    }

    #[test]
    fn reset_window_if_needed_resets_when_old() {
        let mut s = make_state("svc", 1000);
        s.restarts_in_window = 2;
        // Simulate 700 seconds elapsed by backdating window_start
        s.window_start = Instant::now() - Duration::from_secs(700);
        s.reset_window_if_needed();
        assert_eq!(s.restarts_in_window, 0, "should reset when >600s elapsed");
    }

    // -------------------------------------------------------------------------
    // SidecarState::can_restart
    // -------------------------------------------------------------------------

    #[test]
    fn can_restart_true_when_below_limit() {
        let mut s = make_state("svc", 1000);
        s.restarts_in_window = 0;
        assert!(s.can_restart());
        s.restarts_in_window = 1;
        assert!(s.can_restart());
    }

    #[test]
    fn can_restart_false_when_at_or_above_limit() {
        let mut s = make_state("svc", 1000);
        s.restarts_in_window = 2;
        assert!(!s.can_restart());
        s.restarts_in_window = 5;
        assert!(!s.can_restart());
    }

    // -------------------------------------------------------------------------
    // SidecarState::cooldown_remaining
    // -------------------------------------------------------------------------

    #[test]
    fn cooldown_remaining_none_when_no_last_restart() {
        let s = make_state("svc", 1000);
        assert!(s.cooldown_remaining().is_none());
    }

    #[test]
    fn cooldown_remaining_none_when_zero_restarts_in_window() {
        // restarts_in_window == 0 → required == 0s, so always elapsed >= required
        let mut s = make_state("svc", 1000);
        s.restarts_in_window = 0;
        s.last_restart = Some(Instant::now());
        // required is 0 so elapsed (even 0) is not < required
        assert!(s.cooldown_remaining().is_none());
    }

    #[test]
    fn cooldown_remaining_some_when_still_cooling_down() {
        let mut s = make_state("svc", 1000);
        // restarts_in_window == 1 → required = 10s
        s.restarts_in_window = 1;
        s.last_restart = Some(Instant::now()); // just restarted
        let remaining = s.cooldown_remaining();
        assert!(remaining.is_some(), "should be cooling down");
        // Remaining should be close to 10s (within 1s tolerance)
        let r = remaining.unwrap();
        assert!(r <= Duration::from_secs(10));
        assert!(r > Duration::from_secs(9));
    }

    #[test]
    fn cooldown_remaining_none_when_cooldown_elapsed() {
        let mut s = make_state("svc", 1000);
        // restarts_in_window == 1 → required = 10s, backdate by 15s
        s.restarts_in_window = 1;
        s.last_restart = Some(Instant::now() - Duration::from_secs(15));
        assert!(s.cooldown_remaining().is_none());
    }

    #[test]
    fn cooldown_remaining_30s_for_multiple_restarts() {
        let mut s = make_state("svc", 1000);
        // restarts_in_window >= 2 → required = 30s
        s.restarts_in_window = 2;
        s.last_restart = Some(Instant::now());
        let remaining = s.cooldown_remaining();
        assert!(remaining.is_some());
        let r = remaining.unwrap();
        assert!(r <= Duration::from_secs(30));
        assert!(r > Duration::from_secs(29));
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::new
    // -------------------------------------------------------------------------

    #[test]
    fn manager_inner_new_registers_synapses_on_11435() {
        let mgr = SidecarManagerInner::new();
        assert!(mgr.sidecars.contains_key("synapses"));
        let s = &mgr.sidecars["synapses"];
        assert_eq!(s.port, 11435);
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::get_all_info
    // -------------------------------------------------------------------------

    #[test]
    fn get_all_info_returns_sorted_by_name() {
        let mgr = SidecarManagerInner::new();
        let infos = mgr.get_all_info();
        // With only one sidecar this trivially passes; verify it at least returns one entry
        assert!(!infos.is_empty());
        // Verify sort order if there were multiple entries by checking adjacent pairs
        for w in infos.windows(2) {
            assert!(w[0].name <= w[1].name, "results must be sorted by name");
        }
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::get_info
    // -------------------------------------------------------------------------

    #[test]
    fn get_info_returns_some_for_known_name() {
        let mgr = SidecarManagerInner::new();
        let info = mgr.get_info("synapses");
        assert!(info.is_some());
        assert_eq!(info.unwrap().name, "synapses");
    }

    #[test]
    fn get_info_returns_none_for_unknown_name() {
        let mgr = SidecarManagerInner::new();
        assert!(mgr.get_info("nonexistent-service").is_none());
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::set_status
    // -------------------------------------------------------------------------

    #[test]
    fn set_status_updates_status() {
        let mut mgr = SidecarManagerInner::new();
        mgr.set_status("synapses", ServiceStatus::Degraded);
        assert_eq!(mgr.sidecars["synapses"].status, ServiceStatus::Degraded);

        mgr.set_status("synapses", ServiceStatus::Healthy);
        assert_eq!(mgr.sidecars["synapses"].status, ServiceStatus::Healthy);
    }

    #[test]
    fn set_status_noop_for_unknown_name() {
        let mut mgr = SidecarManagerInner::new();
        // Should not panic
        mgr.set_status("unknown", ServiceStatus::Offline);
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::record_failure
    // -------------------------------------------------------------------------

    #[test]
    fn record_failure_increments_consecutive_failures() {
        let mut mgr = SidecarManagerInner::new();
        let (count, _) = mgr.record_failure("synapses");
        assert_eq!(count, 1);
        let (count, _) = mgr.record_failure("synapses");
        assert_eq!(count, 2);
    }

    #[test]
    fn record_failure_sets_degraded_at_two_failures() {
        let mut mgr = SidecarManagerInner::new();
        mgr.record_failure("synapses"); // 1 — still Starting
        assert_eq!(mgr.sidecars["synapses"].status, ServiceStatus::Starting);
        mgr.record_failure("synapses"); // 2 → Degraded
        assert_eq!(mgr.sidecars["synapses"].status, ServiceStatus::Degraded);
    }

    #[test]
    fn record_failure_should_restart_true_at_three_when_can_restart() {
        let mut mgr = SidecarManagerInner::new();
        // restarts_in_window starts at 0 so can_restart() == true, no cooldown
        mgr.record_failure("synapses");
        mgr.record_failure("synapses");
        let (count, should_restart) = mgr.record_failure("synapses"); // 3rd failure
        assert_eq!(count, 3);
        assert!(should_restart);
    }

    #[test]
    fn record_failure_should_restart_false_when_cannot_restart() {
        let mut mgr = SidecarManagerInner::new();
        // Exhaust the restart window so can_restart() == false
        mgr.sidecars.get_mut("synapses").unwrap().restarts_in_window = 2;
        mgr.record_failure("synapses");
        mgr.record_failure("synapses");
        let (_, should_restart) = mgr.record_failure("synapses");
        assert!(!should_restart, "should not restart when window limit reached");
    }

    #[test]
    fn record_failure_returns_zero_for_unknown() {
        let mut mgr = SidecarManagerInner::new();
        let (count, should_restart) = mgr.record_failure("unknown");
        assert_eq!(count, 0);
        assert!(!should_restart);
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::record_success
    // -------------------------------------------------------------------------

    #[test]
    fn record_success_resets_failures_and_sets_healthy() {
        let mut mgr = SidecarManagerInner::new();
        mgr.sidecars.get_mut("synapses").unwrap().consecutive_failures = 5;
        mgr.sidecars.get_mut("synapses").unwrap().status = ServiceStatus::Degraded;

        mgr.record_success("synapses");

        let s = &mgr.sidecars["synapses"];
        assert_eq!(s.consecutive_failures, 0);
        assert_eq!(s.status, ServiceStatus::Healthy);
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::record_restart
    // -------------------------------------------------------------------------

    #[test]
    fn record_restart_increments_counters_and_sets_starting() {
        let mut mgr = SidecarManagerInner::new();
        mgr.sidecars.get_mut("synapses").unwrap().consecutive_failures = 4;
        mgr.sidecars.get_mut("synapses").unwrap().status = ServiceStatus::Degraded;

        mgr.record_restart("synapses");

        let s = &mgr.sidecars["synapses"];
        assert_eq!(s.restarts_in_window, 1);
        assert_eq!(s.restarts_total, 1);
        assert_eq!(s.consecutive_failures, 0);
        assert_eq!(s.status, ServiceStatus::Starting);
        assert!(s.last_restart.is_some());
    }

    #[test]
    fn record_restart_accumulates_restarts_total() {
        let mut mgr = SidecarManagerInner::new();
        mgr.record_restart("synapses");
        mgr.record_restart("synapses");
        assert_eq!(mgr.sidecars["synapses"].restarts_total, 2);
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::mark_offline
    // -------------------------------------------------------------------------

    #[test]
    fn mark_offline_sets_offline_status() {
        let mut mgr = SidecarManagerInner::new();
        mgr.mark_offline("synapses");
        assert_eq!(mgr.sidecars["synapses"].status, ServiceStatus::Offline);
    }

    #[test]
    fn mark_offline_noop_for_unknown() {
        let mut mgr = SidecarManagerInner::new();
        // Should not panic
        mgr.mark_offline("unknown");
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::get_binary_and_args
    // -------------------------------------------------------------------------

    #[test]
    fn get_binary_and_args_returns_some_for_known() {
        let mgr = SidecarManagerInner::new();
        let result = mgr.get_binary_and_args("synapses");
        assert!(result.is_some());
        let (binary, args) = result.unwrap();
        assert_eq!(binary, "synapses");
        assert_eq!(args, vec!["daemon", "serve"]);
    }

    #[test]
    fn get_binary_and_args_returns_none_for_unknown() {
        let mgr = SidecarManagerInner::new();
        assert!(mgr.get_binary_and_args("no-such-binary").is_none());
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::is_enabled
    // -------------------------------------------------------------------------

    #[test]
    fn is_enabled_true_by_default_for_known() {
        let mgr = SidecarManagerInner::new();
        assert!(mgr.is_enabled("synapses"));
    }

    #[test]
    fn is_enabled_false_for_unknown() {
        let mgr = SidecarManagerInner::new();
        assert!(!mgr.is_enabled("totally-unknown-service"));
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::set_enabled(false)
    // -------------------------------------------------------------------------

    #[test]
    fn set_enabled_false_sets_disabled_and_clears_enabled() {
        let mut mgr = SidecarManagerInner::new();
        mgr.set_enabled("synapses", false);
        let s = &mgr.sidecars["synapses"];
        assert!(!s.enabled);
        assert_eq!(s.status, ServiceStatus::Disabled);
    }

    // -------------------------------------------------------------------------
    // SidecarManagerInner::set_enabled(true)
    // -------------------------------------------------------------------------

    #[test]
    fn set_enabled_true_sets_starting_and_resets_failures() {
        let mut mgr = SidecarManagerInner::new();
        // First disable it, introduce some failures, then re-enable
        mgr.set_enabled("synapses", false);
        mgr.sidecars.get_mut("synapses").unwrap().consecutive_failures = 7;

        mgr.set_enabled("synapses", true);

        let s = &mgr.sidecars["synapses"];
        assert!(s.enabled);
        assert_eq!(s.status, ServiceStatus::Starting);
        assert_eq!(s.consecutive_failures, 0);
    }

    // -------------------------------------------------------------------------
    // synapses_data_dir
    // -------------------------------------------------------------------------

    #[test]
    fn synapses_data_dir_ends_with_dot_synapses() {
        let dir = synapses_data_dir();
        let last = dir.file_name().expect("should have a final component");
        assert_eq!(last, ".synapses");
    }

    #[test]
    fn synapses_data_dir_is_absolute() {
        let dir = synapses_data_dir();
        assert!(dir.is_absolute(), "data dir must be an absolute path");
    }

    // -------------------------------------------------------------------------
    // find_binary
    // -------------------------------------------------------------------------

    #[test]
    fn find_binary_returns_none_for_nonexistent_binary() {
        let result = find_binary("zzz_nonexistent_binary_xyz");
        assert!(result.is_none());
    }
}
