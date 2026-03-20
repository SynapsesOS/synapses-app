import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useServices } from "../hooks/useServices";
import {
  FolderOpen, DollarSign, Clock, CheckSquare, ChevronRight,
  PlusCircle, Plug, RefreshCw, AlertCircle, Users,
  Square, Play,
} from "lucide-react";

const PULSE_URL = "http://127.0.0.1:11435/api/admin/pulse/summary";

interface Project {
  path: string;
  name: string;
  nodes?: number;
  files?: number;
  scale?: string;
  last_indexed?: string;
  status?: string;
}

interface PulseSummary {
  tokens_saved?: number;
  cost_saved_usd?: number;
  total_tool_calls?: number;
  sessions?: number;
  tasks_completed?: number;
  context_deliveries?: number;
}

interface AgentStat {
  agent_id: string;
  sessions: number;
  tool_calls: number;
  tokens_saved: number;
  tasks_completed?: number;
  last_seen?: string;
}

function relTime(iso?: string): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return ""; }
}

function agentShortName(id: string): string {
  if (id.toLowerCase().includes("claude")) return "Claude Code";
  if (id.toLowerCase().includes("cursor")) return "Cursor";
  if (id.toLowerCase().includes("windsurf")) return "Windsurf";
  if (id.toLowerCase().includes("zed")) return "Zed";
  if (id.toLowerCase().includes("vscode") || id.toLowerCase().includes("vs code")) return "VS Code";
  // truncate long IDs
  return id.length > 24 ? id.slice(0, 22) + "…" : id;
}

function scaleLabel(scale?: string, files?: number): string {
  if (!scale) return "";
  const fileStr = files ? ` · ${files.toLocaleString()} files` : "";
  const label = scale.charAt(0).toUpperCase() + scale.slice(1);
  return `${label}${fileStr}`;
}

const STATUS_COLOR: Record<string, string> = {
  healthy:  "var(--success)",
  degraded: "var(--warning)",
  offline:  "var(--danger)",
  disabled: "var(--text-dim)",
  starting: "var(--warning)",
};

export function Dashboard() {
  const { services, restart, stop, enable, startupError } = useServices();
  const [restarting, setRestarting] = useState<Record<string, boolean>>({});
  const [showServices, setShowServices] = useState(false);
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [summary,   setSummary]   = useState<PulseSummary | null>(null);
  const [agents,    setAgents]    = useState<AgentStat[]>([]);
  const [offline,   setOffline]   = useState(false);
  const [loading,   setLoading]   = useState(true);

  const healthy = services.filter((s) => s.status === "healthy").length;
  const total   = services.length;
  const anyOffline  = services.some((s) => s.status === "offline");
  const anyDegraded = services.some((s) => s.status === "degraded");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [raw, pulse] = await Promise.allSettled([
        invoke<string>("run_synapses_cmd", { args: ["list", "--json"] }),
        fetch(`${PULSE_URL}?days=7`, { signal: AbortSignal.timeout(3000) })
          .then((r) => (r.ok ? r.json() : Promise.reject())),
      ]);
      if (raw.status === "fulfilled") {
        try { setProjects(JSON.parse(raw.value) as Project[]); } catch { /**/ }
      }
      if (pulse.status === "fulfilled") {
        setSummary(pulse.value.summary ?? null);
        setAgents((pulse.value.agents ?? []).slice(0, 6));
        setOffline(false);
      } else {
        setOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Hero status
  const statusOk   = total > 0 && healthy === total && !offline;
  const statusHeadline = offline
    ? "Engine is offline"
    : anyOffline
    ? `${total - healthy} service${total - healthy > 1 ? "s" : ""} offline`
    : anyDegraded
    ? "Running with issues"
    : total === 0
    ? "Starting up…"
    : "Synapses is running";

  const costStr = summary?.cost_saved_usd != null && summary.cost_saved_usd > 0
    ? `$${summary.cost_saved_usd.toFixed(2)}`
    : offline ? "—" : "—";

  const activeAgents = agents.filter((a) => {
    if (!a.last_seen) return false;
    return Date.now() - new Date(a.last_seen).getTime() < 24 * 3600_000;
  });

  return (
    <div className="page dash-page">

      {/* ── Hero status ───────────────────────────────────────────────────── */}
      <div className="hero-status">
        <div className="hero-status-left">
          <button
            className={`hero-orb ${anyOffline ? "orb-danger" : anyDegraded || offline ? "orb-warning" : statusOk ? "orb-success" : "orb-dim"}`}
            title="Click to see services"
            onClick={() => setShowServices((v) => !v)}
            style={{ cursor: "pointer", border: "none", background: "none", padding: 0 }}
          />
          <div>
            <div className="hero-headline">{statusHeadline}</div>
            <div className="hero-subline">
              {projects.length > 0
                ? `${projects.length} project${projects.length !== 1 ? "s" : ""} indexed`
                : "No projects yet"}
              {activeAgents.length > 0 && ` · ${activeAgents.length} agent${activeAgents.length !== 1 ? "s" : ""} active today`}
            </div>
          </div>
        </div>
        <button className="btn-ghost" onClick={fetchData} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      {startupError && (
        <div className="offline-banner">
          <AlertCircle size={15} />
          <span>{startupError}</span>
        </div>
      )}

      {/* ── Services panel (expandable) ──────────────────────────────────── */}
      {showServices && services.length > 0 && (
        <div className="services-panel">
          <div className="services-panel-header">
            <span className="services-panel-title">Services</span>
            <Link to="/settings" className="section-link" onClick={() => setShowServices(false)}>
              Manage <ChevronRight size={12} />
            </Link>
          </div>
          <div className="services-panel-list">
            {services.map((s) => {
              const dot = STATUS_COLOR[s.status] ?? "var(--text-dim)";
              const isRestarting = restarting[s.name];
              return (
                <div key={s.name} className="service-row">
                  <div className="service-row-left">
                    <div
                      className={`status-dot ${s.status === "healthy" ? "healthy" : ""}`}
                      style={s.status !== "healthy" ? { background: dot } : undefined}
                    />
                    <div>
                      <div className="service-name">{s.name}</div>
                      <div className="service-status-label" style={{ color: dot }}>
                        {s.status === "starting" ? "Starting…" : s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                        {s.restarts_total > 0 && (
                          <span className="service-restarts"> · restarted {s.restarts_total}×</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="card-actions">
                    {s.status !== "disabled" && (
                      <button
                        className="icon-btn"
                        title="Restart"
                        disabled={isRestarting}
                        onClick={async () => {
                          setRestarting((p) => ({ ...p, [s.name]: true }));
                          try { await restart(s.name); } finally {
                            setRestarting((p) => ({ ...p, [s.name]: false }));
                          }
                        }}
                      >
                        <RefreshCw size={13} className={isRestarting ? "spin" : ""} />
                      </button>
                    )}
                    {s.status === "disabled" ? (
                      <button className="icon-btn" title="Enable" onClick={() => enable(s.name)}>
                        <Play size={13} />
                      </button>
                    ) : (
                      <button className="icon-btn icon-btn-danger" title="Stop" onClick={() => stop(s.name)}>
                        <Square size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Value strip ──────────────────────────────────────────────────── */}
      <div className="value-strip">
        <ValueCard
          icon={<DollarSign size={18} />}
          color="var(--success)"
          value={costStr}
          label="Saved this week"
          sub="vs sending everything"
        />
        <ValueCard
          icon={<Clock size={18} />}
          color="var(--accent)"
          value={summary?.context_deliveries != null ? String(summary.context_deliveries) : offline ? "—" : "—"}
          label="Context deliveries"
          sub="last 7 days"
        />
        <ValueCard
          icon={<CheckSquare size={18} />}
          color="var(--warning)"
          value={summary?.tasks_completed != null ? String(summary.tasks_completed) : summary?.sessions != null ? String(summary.sessions) : offline ? "—" : "—"}
          label={summary?.tasks_completed != null ? "Tasks done" : "Agent sessions"}
          sub="last 7 days"
        />
      </div>

      {/* ── Projects ─────────────────────────────────────────────────────── */}
      <section className="dash-section">
        <div className="dash-section-header">
          <h2 className="section-title" style={{ margin: 0 }}>Your Projects</h2>
          <Link to="/projects" className="section-link">
            Manage <ChevronRight size={12} />
          </Link>
        </div>

        {projects.length === 0 ? (
          <Link to="/projects" className="quick-action" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="quick-action-icon"><PlusCircle size={20} /></div>
            <div>
              <div className="quick-action-label">Index your first project</div>
              <div className="quick-action-desc">Point Synapses at a codebase to start</div>
            </div>
          </Link>
        ) : (
          <div className="dash-project-grid">
            {projects.slice(0, 4).map((p) => (
              <Link key={p.path} to="/projects" style={{ textDecoration: "none" }}>
                <div className="dash-project-card">
                  <div className="dash-project-card-header">
                    <FolderOpen size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
                    <span className="dash-project-name">{p.name}</span>
                  </div>
                  <div className="dash-project-meta">
                    {scaleLabel(p.scale, p.files)}
                  </div>
                  {p.last_indexed && (
                    <div className="dash-project-time">
                      Updated {relTime(p.last_indexed)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
            {projects.length > 4 && (
              <Link to="/projects" style={{ textDecoration: "none" }}>
                <div className="dash-project-card dash-project-more">
                  <span>+{projects.length - 4} more</span>
                  <ChevronRight size={14} />
                </div>
              </Link>
            )}
          </div>
        )}
      </section>

      {/* ── Recent agent activity ──────────────────────────────────────────── */}
      {agents.length > 0 ? (
        <section className="dash-section">
          <div className="dash-section-header">
            <h2 className="section-title" style={{ margin: 0 }}>Recent Activity</h2>
            <Link to="/activity" className="section-link">
              View all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="agent-feed">
            {agents.map((a) => (
              <div key={a.agent_id} className="agent-feed-row">
                <div className="agent-feed-avatar">
                  <Users size={12} />
                </div>
                <div className="agent-feed-info">
                  <div className="agent-feed-id">{agentShortName(a.agent_id)}</div>
                  <div className="agent-feed-meta">
                    {a.sessions} session{a.sessions !== 1 ? "s" : ""}
                    {" · "}
                    {a.tool_calls} calls
                    {a.last_seen && ` · ${relTime(a.last_seen)}`}
                  </div>
                </div>
                {a.tasks_completed != null && a.tasks_completed > 0 && (
                  <div className="agent-feed-badge">
                    {a.tasks_completed} done
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : projects.length > 0 ? (
        <section className="dash-section">
          <h2 className="section-title">Get started</h2>
          <div className="actions-row">
            <Link to="/settings" className="quick-action">
              <div className="quick-action-icon"><Plug size={16} /></div>
              <div className="quick-action-label">Connect an editor</div>
              <div className="quick-action-desc">Add Synapses to Claude Code, Cursor, or Windsurf</div>
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ValueCard({
  icon, color, value, label, sub,
}: {
  icon: React.ReactNode;
  color: string;
  value: string;
  label: string;
  sub?: string;
}) {
  return (
    <div className="value-card">
      <div className="value-card-icon" style={{ color }}>
        {icon}
      </div>
      <div className="value-number" style={{ color }}>{value}</div>
      <div className="value-label">{label}</div>
      {sub && <div className="value-sub">{sub}</div>}
    </div>
  );
}
