import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Square, Play } from "lucide-react";
import type { SidecarInfo, ServiceStatus } from "../types";

const STATUS_COLOR: Record<ServiceStatus, string> = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  offline: "#ef4444",
  disabled: "#6b7280",
  starting: "#3b82f6",
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
  disabled: "Disabled",
  starting: "Starting…",
};

const SERVICE_DESC: Record<string, string> = {
  brain: "AI enrichment · port 11435",
  scout: "Web intelligence · port 11436",
  pulse: "Analytics · port 11437",
};

interface Props {
  info: SidecarInfo;
  onRestart: (name: string) => void;
  onStop: (name: string) => void;
}

export function ServiceCard({ info, onRestart, onStop }: Props) {
  const dot = STATUS_COLOR[info.status] ?? "#6b7280";
  const label = STATUS_LABEL[info.status] ?? info.status;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">
          <span
            className={`status-dot ${info.status === "healthy" ? "healthy" : ""}`}
            style={info.status !== "healthy" ? { background: dot } : undefined}
          />
          <span className="service-name">{info.name}</span>
        </div>
        <div className="card-actions">
          {info.status !== "disabled" && (
            <button
              className="icon-btn"
              title="Restart"
              onClick={() => onRestart(info.name)}
            >
              <RefreshCw size={14} />
            </button>
          )}
          {info.status === "disabled" ? (
            <button
              className="icon-btn"
              title="Enable"
              onClick={() => invoke("enable_service", { name: info.name })}
            >
              <Play size={14} />
            </button>
          ) : (
            <button
              className="icon-btn icon-btn-danger"
              title="Stop"
              onClick={() => onStop(info.name)}
            >
              <Square size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="card-body">
        <div className="service-status-label" style={{ color: dot }}>
          {label}
        </div>
        <div className="service-desc">{SERVICE_DESC[info.name] ?? ""}</div>
        {info.restarts_total > 0 && (
          <div className="service-restarts">
            Auto-restarted {info.restarts_total}×
          </div>
        )}
      </div>
    </div>
  );
}
