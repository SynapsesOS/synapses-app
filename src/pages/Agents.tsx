import { useState, useEffect, useCallback } from "react";
import {
  Users,
  RefreshCw,
  AlertCircle,
  Activity,
  BarChart2,
  Zap,
  Clock,
} from "lucide-react";

// Pulse telemetry is now in-process within the daemon (no HTTP endpoint yet).
const PULSE_URL = "http://localhost:11434/api/pulse";

interface AgentStats {
  agent_id: string;
  sessions: number;
  tool_calls: number;
  tokens_saved: number;
  last_seen?: string;
}

interface ToolStats {
  name: string;
  calls: number;
  avg_ms?: number;
  error_rate?: number;
}

function fmt(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function latencyColor(ms?: number): string {
  if (ms == null) return "var(--text-dim)";
  if (ms < 500) return "var(--success)";
  if (ms < 2000) return "var(--warning)";
  return "var(--danger)";
}

export function Agents() {
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [tools, setTools] = useState<ToolStats[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const fetchData = useCallback((d: number) => {
    setLoading(true);
    fetch(`${PULSE_URL}/v1/dashboard?days=${d}`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setAgents(data.agents ?? []);
        setTools(data.tools ?? []);
        setOffline(false);
      })
      .catch(() => setOffline(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData(days);
  }, [fetchData, days]);

  if (offline) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Agents</h1>
        </div>
        <div className="offline-banner">
          <AlertCircle size={16} />
          <span>Agent data unavailable — Pulse telemetry is built into the daemon. Check that the daemon is running on Dashboard.</span>
        </div>
        <div className="empty-state-large">
          <Users size={40} className="empty-icon" />
          <div>No agent activity data. Pulse tracks agent sessions and tool usage.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <span className="page-subtitle">
            {agents.length > 0 ? `${agents.length} agent${agents.length > 1 ? "s" : ""} tracked` : "No agents yet"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              className={days === d ? "btn-primary" : "btn-secondary"}
              style={{ padding: "5px 12px", fontSize: 12 }}
              onClick={() => { setDays(d); fetchData(d); }}
            >
              {d}d
            </button>
          ))}
          <button className="btn-ghost" onClick={() => fetchData(days)} title="Refresh">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* Agent list */}
      <section className="dash-section">
        <h2 className="section-title">Agent Activity</h2>
        {agents.length === 0 ? (
          <div className="empty-state-large">
            <Users size={40} className="empty-icon" />
            <div>No agent sessions recorded in the last {days} days.</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
              Agents appear here once they start using Synapses via MCP.
            </div>
          </div>
        ) : (
          <div className="agent-list">
            {agents.map((a) => (
              <div key={a.agent_id} className="agent-card">
                <button
                  className="agent-card-header"
                  onClick={() => setExpanded(expanded === a.agent_id ? null : a.agent_id)}
                >
                  <div className="agent-card-left">
                    <div className="agent-feed-dot" />
                    <div>
                      <div className="agent-card-id">{a.agent_id}</div>
                      {a.last_seen && (
                        <div className="agent-card-meta">
                          <Clock size={11} /> Last seen: {a.last_seen}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="agent-card-stats">
                    <AgentBadge icon={<Activity size={12} />} value={`${a.sessions} sessions`} />
                    <AgentBadge icon={<BarChart2 size={12} />} value={`${fmt(a.tool_calls)} calls`} />
                    <AgentBadge icon={<Zap size={12} />} value={`${fmt(a.tokens_saved)} saved`} />
                  </div>
                </button>

                {expanded === a.agent_id && (
                  <div className="agent-card-detail">
                    <div className="agent-detail-grid">
                      <div className="agent-detail-item">
                        <span className="agent-detail-label">Sessions</span>
                        <span className="agent-detail-value">{a.sessions}</span>
                      </div>
                      <div className="agent-detail-item">
                        <span className="agent-detail-label">Tool Calls</span>
                        <span className="agent-detail-value">{fmt(a.tool_calls)}</span>
                      </div>
                      <div className="agent-detail-item">
                        <span className="agent-detail-label">Tokens Saved</span>
                        <span className="agent-detail-value">{fmt(a.tokens_saved)}</span>
                      </div>
                    </div>
                    <p className="agent-detail-note">
                      Detailed per-agent tool breakdown and session timeline are available
                      in the Analytics page.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tool usage breakdown */}
      {tools.length > 0 && (
        <section className="dash-section">
          <h2 className="section-title">Tool Usage — Last {days} Days</h2>
          <div className="tool-table">
            <div className="tool-table-header">
              <span>Tool</span>
              <span>Calls</span>
              <span>Avg Latency</span>
              <span>Error Rate</span>
            </div>
            {tools.slice(0, 15).map((t) => (
              <div key={t.name} className="tool-table-row">
                <span className="tool-name">{t.name}</span>
                <span className="tool-calls">{fmt(t.calls)}</span>
                <span
                  className="tool-latency"
                  style={{ color: latencyColor(t.avg_ms) }}
                >
                  {t.avg_ms != null ? `${t.avg_ms.toFixed(0)}ms` : "—"}
                </span>
                <span
                  className="tool-error"
                  style={{ color: (t.error_rate ?? 0) > 0.05 ? "var(--danger)" : "var(--text-muted)" }}
                >
                  {t.error_rate != null ? `${(t.error_rate * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            ))}
          </div>
          <p className="section-desc" style={{ marginTop: 12 }}>
            Latency color: <span style={{ color: "var(--success)" }}>green &lt;500ms</span> ·{" "}
            <span style={{ color: "var(--warning)" }}>yellow &lt;2s</span> ·{" "}
            <span style={{ color: "var(--danger)" }}>red ≥2s</span>
          </p>
        </section>
      )}
    </div>
  );
}

function AgentBadge({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <span className="agent-badge">
      {icon}
      {value}
    </span>
  );
}
