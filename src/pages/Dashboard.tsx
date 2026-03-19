import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useServices } from "../hooks/useServices";
import {
  FolderOpen, Zap, DollarSign, Activity, BarChart2,
  PlusCircle, Plug, AlertCircle, RefreshCw, ChevronRight,
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
  compression_ratio?: number;
  savings_pct?: number;
}

interface AgentStat {
  agent_id: string;
  sessions: number;
  tool_calls: number;
  tokens_saved: number;
  last_seen?: string;
}

function fmt(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function relTime(iso?: string): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3_600_000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    return "just now";
  } catch { return ""; }
}

const STATUS_COLOR: Record<string, string> = {
  healthy:  "var(--success)",
  degraded: "var(--warning)",
  offline:  "var(--danger)",
  disabled: "var(--text-dim)",
  starting: "var(--warning)",
};

export function Dashboard() {
  const { services, startupError } = useServices();
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [summary,   setSummary]   = useState<PulseSummary | null>(null);
  const [agents,    setAgents]    = useState<AgentStat[]>([]);
  const [offline,   setOffline]   = useState(false);
  const [loading,   setLoading]   = useState(true);

  const healthy = services.filter((s) => s.status === "healthy").length;
  const total   = services.length;

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
        setAgents((pulse.value.agents ?? []).slice(0, 4));
        setOffline(false);
      } else {
        setOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const costStr = summary?.cost_saved_usd != null
    ? `$${summary.cost_saved_usd.toFixed(2)}`
    : offline ? "—" : "—";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Home</h1>
          <span className="page-subtitle">
            {total > 0
              ? `${healthy}/${total} services healthy · ${projects.length} project${projects.length !== 1 ? "s" : ""} indexed`
              : "Starting up…"}
          </span>
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

      {/* ── Value metrics ────────────────────────────────────────────────── */}
      <section className="dash-section">
        <div className="home-value-grid">
          <HomeCard
            icon={<Zap size={16} />}
            accentColor="var(--accent)"
            label="Tokens Saved (7d)"
            value={fmt(summary?.tokens_saved)}
            sub={summary?.savings_pct ? `${summary.savings_pct.toFixed(1)}% of baseline` : "context compressed"}
          />
          <HomeCard
            icon={<DollarSign size={16} />}
            accentColor="var(--success)"
            label="Est. Cost Saved"
            value={costStr}
            sub="vs uncompressed baseline"
          />
          <HomeCard
            icon={<Activity size={16} />}
            accentColor="var(--warning)"
            label="Agent Sessions"
            value={fmt(summary?.sessions)}
            sub="in the last 7 days"
          />
          <HomeCard
            icon={<BarChart2 size={16} />}
            accentColor="var(--text-muted)"
            label="Tool Calls"
            value={fmt(summary?.total_tool_calls)}
            sub={summary?.compression_ratio ? `${summary.compression_ratio.toFixed(1)}× compression` : "MCP tool calls"}
          />
        </div>
      </section>

      {/* ── System health compact ─────────────────────────────────────────── */}
      {services.length > 0 && (
        <section className="dash-section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Services</h2>
            <span className="section-meta" style={{ color: healthy === total ? "var(--success)" : "var(--warning)" }}>
              {healthy}/{total} healthy
            </span>
          </div>
          <div className="home-health-row">
            <div className="home-health-services">
              {services.map((s) => (
                <div key={s.name} className="home-health-svc">
                  <div className="home-health-svc-dot" style={{ background: STATUS_COLOR[s.status] ?? "var(--text-dim)" }} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize" }}>{s.name}</span>
                </div>
              ))}
            </div>
            <Link to="/settings" style={{ fontSize: 11.5, color: "var(--text-dim)", textDecoration: "none", display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
              Manage <ChevronRight size={12} />
            </Link>
          </div>
        </section>
      )}

      {/* ── Projects ─────────────────────────────────────────────────────── */}
      <section className="dash-section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Projects</h2>
          <Link to="/projects" className="section-link">
            Manage <ChevronRight size={12} />
          </Link>
        </div>
        {projects.length === 0 ? (
          <Link to="/projects" className="quick-action" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="quick-action-icon"><PlusCircle size={18} /></div>
            <div>
              <div className="quick-action-label">Index your first project</div>
              <div className="quick-action-desc">Point Synapses at a codebase to start</div>
            </div>
          </Link>
        ) : (
          <div className="home-project-strip">
            {projects.slice(0, 5).map((p) => (
              <Link key={p.path} to="/projects" style={{ textDecoration: "none" }}>
                <div className="home-project-row">
                  <FolderOpen size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                  <span className="home-project-name">{p.name}</span>
                  <div className="home-project-meta">
                    {p.nodes != null && <span>{p.nodes.toLocaleString()} nodes</span>}
                    {p.scale && (
                      <span className="project-scale-badge" style={{
                        color: "var(--text-dim)",
                        borderColor: "var(--border)",
                        background: "var(--surface2)",
                      }}>{p.scale}</span>
                    )}
                    {p.last_indexed && <span>{relTime(p.last_indexed)}</span>}
                  </div>
                </div>
              </Link>
            ))}
            {projects.length > 5 && (
              <Link to="/projects" style={{ fontSize: 12, color: "var(--text-dim)", textDecoration: "none", padding: "4px 14px" }}>
                +{projects.length - 5} more projects →
              </Link>
            )}
          </div>
        )}
      </section>

      {/* ── Recent agent activity ─────────────────────────────────────────── */}
      {agents.length > 0 && (
        <section className="dash-section">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Recent Agents</h2>
            <Link to="/activity" className="section-link">
              Full analytics <ChevronRight size={12} />
            </Link>
          </div>
          <div className="agent-feed">
            {agents.map((a) => (
              <div key={a.agent_id} className="agent-feed-row">
                <div className="agent-feed-dot" />
                <div className="agent-feed-info">
                  <div className="agent-feed-id">{a.agent_id}</div>
                  <div className="agent-feed-meta">
                    {a.sessions} session{a.sessions !== 1 ? "s" : ""}
                    {a.last_seen && ` · ${relTime(a.last_seen)}`}
                  </div>
                </div>
                <div className="agent-feed-stat">{fmt(a.tokens_saved)} saved</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Quick actions when empty ──────────────────────────────────────── */}
      {agents.length === 0 && projects.length > 0 && (
        <section className="dash-section">
          <h2 className="section-title">Next Steps</h2>
          <div className="actions-row">
            <Link to="/settings" className="quick-action">
              <div className="quick-action-icon"><Plug size={15} /></div>
              <div className="quick-action-label">Connect an Agent</div>
              <div className="quick-action-desc">Write MCP config for Claude Code, Cursor, or Windsurf</div>
            </Link>
            <Link to="/brain" className="quick-action">
              <div className="quick-action-icon"><Zap size={15} style={{ color: "var(--accent)" }} /></div>
              <div className="quick-action-label">Set Up AI Brain</div>
              <div className="quick-action-desc">Download the local model for richer context</div>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function HomeCard({
  icon, accentColor, label, value, sub,
}: {
  icon: React.ReactNode;
  accentColor: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="home-value-card">
      <div className="home-value-accent" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }} />
      <div style={{ color: accentColor, opacity: 0.8, marginBottom: 4 }}>{icon}</div>
      <div className="home-value-label">{label}</div>
      <div className="home-value-number">{value}</div>
      {sub && <div className="home-value-sub">{sub}</div>}
    </div>
  );
}
