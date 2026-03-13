import { useState, useEffect, useCallback } from "react";
import { BarChart2, Zap, Cpu, Users, RefreshCw, AlertCircle } from "lucide-react";

const PULSE_URL = "http://localhost:11437";

// Matches pulse's /v1/dashboard response shape
interface PulseSummary {
  total_tool_calls?: number;
  tokens_saved?: number;
  tokens_delivered?: number;
  savings_pct?: number;
  cost_saved_usd?: number;
  sessions?: number;
}

interface PulseToolStats {
  name: string;
  calls: number;
  avg_ms?: number;
  error_rate?: number;
}

interface PulseAgentStats {
  agent_id: string;
  sessions: number;
  tool_calls: number;
  tokens_saved: number;
}

interface DashboardData {
  summary?: PulseSummary;
  tools?: PulseToolStats[];
  agents?: PulseAgentStats[];
  timeline?: unknown[];
  brain_costs?: unknown;
  main_model?: string;
}

type Days = 7 | 30 | 90;

export function Analytics() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<Days>(7);

  const fetchDashboard = useCallback((d: Days) => {
    setLoading(true);
    fetch(`${PULSE_URL}/v1/dashboard?days=${d}`, { signal: AbortSignal.timeout(4000) })
      .then((r) => {
        if (!r.ok) throw new Error("not ok");
        return r.json();
      })
      .then((json) => {
        setData(json);
        setOffline(false);
      })
      .catch(() => {
        setData(null);
        setOffline(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDashboard(days);
  }, [fetchDashboard, days]);

  const handleDaysChange = (d: Days) => {
    setDays(d);
    fetchDashboard(d);
  };

  if (offline) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Analytics</h1>
        </div>
        <div className="offline-banner">
          <AlertCircle size={16} />
          <span>Analytics unavailable — pulse is not running.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {([7, 30, 90] as Days[]).map((d) => (
            <button
              key={d}
              className={days === d ? "btn-primary" : "btn-secondary"}
              style={{ padding: "5px 12px", fontSize: 12 }}
              onClick={() => handleDaysChange(d)}
            >
              {d}d
            </button>
          ))}
          <button className="btn-ghost" onClick={() => fetchDashboard(days)} title="Refresh">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="empty-state">Loading analytics…</div>
      ) : !data ? null : (
        <>
          {/* Summary cards */}
          <section className="settings-section">
            <h2 className="section-title">Summary — last {days} days</h2>
            <div className="cards-grid">
              <StatCard
                icon={<Zap size={16} style={{ color: "var(--accent)" }} />}
                label="Tool Calls"
                value={fmt(data.summary?.total_tool_calls)}
              />
              <StatCard
                icon={<Cpu size={16} style={{ color: "var(--warning)" }} />}
                label="Tokens Saved"
                value={fmt(data.summary?.tokens_saved)}
              />
              <StatCard
                icon={<Users size={16} style={{ color: "var(--success)" }} />}
                label="Active Agents"
                value={String(data.agents?.length ?? 0)}
              />
            </div>
          </section>

          {/* Top tools */}
          {data.tools && data.tools.length > 0 && (
            <section className="settings-section">
              <h2 className="section-title">Top Tools</h2>
              <div className="analytics-list">
                {data.tools.slice(0, 10).map((t: PulseToolStats) => (
                  <div key={t.name} className="analytics-row">
                    <span className="analytics-name">
                      <BarChart2 size={13} style={{ opacity: 0.5 }} />
                      {t.name}
                    </span>
                    <span className="analytics-count">{t.calls.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Agent activity */}
          {data.agents && data.agents.length > 0 && (
            <section className="settings-section">
              <h2 className="section-title">Agent Activity</h2>
              <div className="analytics-list">
                {data.agents.map((a) => (
                  <div key={a.agent_id} className="analytics-row">
                    <span className="analytics-name">
                      <Users size={13} style={{ opacity: 0.5 }} />
                      {a.agent_id}
                    </span>
                    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                      <span className="analytics-meta">{a.sessions} sessions</span>
                      <span className="analytics-count">{a.tool_calls} calls</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.tools?.length === 0 && data.agents?.length === 0 && (
            <div className="empty-state">No data for this period yet.</div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">{icon}<span className="service-name" style={{ textTransform: "none" }}>{label}</span></div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

function fmt(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}
