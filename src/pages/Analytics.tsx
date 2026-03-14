import { useState, useEffect, useCallback } from "react";
import { BarChart2, Zap, Cpu, Users, RefreshCw, AlertCircle, DollarSign, TrendingUp } from "lucide-react";

// Pulse telemetry is now in-process within the daemon (no HTTP endpoint yet).
// Analytics data is not available via HTTP in this version.
const PULSE_URL = "http://localhost:11434/api/pulse";

interface PulseSummary {
  total_tool_calls?: number;
  tokens_saved?: number;
  savings_pct?: number;
  cost_saved_usd?: number;
  sessions?: number;
  brain_enrichment_rate?: number;
  task_completion_rate?: number;
  correction_rate?: number;
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

type Days = 7 | 30 | 90;

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

export function Analytics() {
  const [data, setData] = useState<{ summary?: PulseSummary; tools?: PulseToolStats[]; agents?: PulseAgentStats[] } | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<Days>(7);

  const fetchDashboard = useCallback((d: Days) => {
    setLoading(true);
    fetch(`${PULSE_URL}/v1/dashboard?days=${d}`, { signal: AbortSignal.timeout(4000) })
      .then((r) => { if (!r.ok) throw new Error("not ok"); return r.json(); })
      .then((json) => { setData(json); setOffline(false); })
      .catch(() => { setData(null); setOffline(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchDashboard(days); }, [fetchDashboard, days]);

  if (offline) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Analytics</h1></div>
        <div className="offline-banner">
          <AlertCircle size={16} />
          <span>Analytics unavailable — Pulse telemetry is built into the daemon. Check that the daemon is running on Dashboard.</span>
        </div>
      </div>
    );
  }

  const enrichWarn = data?.summary?.brain_enrichment_rate != null && data.summary.brain_enrichment_rate < 0.2;

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
              onClick={() => { setDays(d); fetchDashboard(d); }}
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
          {/* Value metrics */}
          <section className="settings-section">
            <h2 className="section-title">Value — last {days} days</h2>
            <div className="cards-grid">
              <StatCard icon={<Zap size={16} style={{ color: "var(--accent)" }} />} label="Tokens Saved" value={fmt(data.summary?.tokens_saved)} sub={data.summary?.savings_pct != null ? `${data.summary.savings_pct.toFixed(1)}% compression` : undefined} />
              <StatCard icon={<DollarSign size={16} style={{ color: "var(--success)" }} />} label="Cost Saved" value={data.summary?.cost_saved_usd != null ? `$${data.summary.cost_saved_usd.toFixed(2)}` : "—"} />
              <StatCard icon={<Cpu size={16} style={{ color: "var(--warning)" }} />} label="Tool Calls" value={fmt(data.summary?.total_tool_calls)} />
              <StatCard icon={<Users size={16} style={{ color: "var(--accent-h)" }} />} label="Sessions" value={fmt(data.summary?.sessions)} />
            </div>
          </section>

          {/* Intent alignment — shown when pulse provides these fields */}
          {(data.summary?.brain_enrichment_rate != null || data.summary?.task_completion_rate != null || data.summary?.correction_rate != null) && (
            <section className="settings-section">
              <h2 className="section-title">Intent Alignment</h2>
              <div className="cards-grid">
                {data.summary!.brain_enrichment_rate != null && (
                  <StatCard
                    icon={<TrendingUp size={16} style={{ color: enrichWarn ? "var(--warning)" : "var(--success)" }} />}
                    label="Brain Enrichment"
                    value={`${(data.summary!.brain_enrichment_rate * 100).toFixed(1)}%`}
                    sub={enrichWarn ? "⚠ Low — aim for >20%" : "of deliveries enriched"}
                    warn={enrichWarn}
                  />
                )}
                {data.summary!.task_completion_rate != null && (
                  <StatCard icon={<BarChart2 size={16} style={{ color: "var(--success)" }} />} label="Task Completion" value={`${(data.summary!.task_completion_rate * 100).toFixed(0)}%`} sub="plans done vs abandoned" />
                )}
                {data.summary!.correction_rate != null && (
                  <StatCard icon={<RefreshCw size={16} style={{ color: "var(--text-muted)" }} />} label="Correction Rate" value={`${(data.summary!.correction_rate * 100).toFixed(1)}%`} sub="re-fetched same entity" />
                )}
              </div>
            </section>
          )}

          {/* Latency table */}
          {data.tools && data.tools.length > 0 && (
            <section className="settings-section">
              <h2 className="section-title">Tool Latency</h2>
              <div className="latency-table">
                <div className="latency-table-header">
                  <span>Tool</span><span>Calls</span><span>Avg Latency</span><span>Error Rate</span>
                </div>
                {data.tools.slice(0, 15).map((t) => (
                  <div key={t.name} className="latency-table-row">
                    <span className="latency-name">{t.name}</span>
                    <span className="latency-calls">{t.calls.toLocaleString()}</span>
                    <span className="latency-ms" style={{ color: latencyColor(t.avg_ms) }}>
                      {t.avg_ms != null ? `${t.avg_ms.toFixed(0)}ms` : "—"}
                      {t.avg_ms != null && t.avg_ms >= 2000 && " ⚠"}
                    </span>
                    <span style={{ fontSize: 12, color: (t.error_rate ?? 0) > 0.05 ? "var(--danger)" : "var(--text-muted)" }}>
                      {t.error_rate != null ? `${(t.error_rate * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="settings-hint" style={{ marginTop: 8 }}>
                <span style={{ color: "var(--success)" }}>Green &lt;500ms</span> ·{" "}
                <span style={{ color: "var(--warning)" }}>yellow &lt;2s</span> ·{" "}
                <span style={{ color: "var(--danger)" }}>red ≥2s</span>. Target: get_context &lt;500ms.
              </p>
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
                      <span className="analytics-meta">{fmt(a.tool_calls)} calls</span>
                      <span className="analytics-count">{fmt(a.tokens_saved)} saved</span>
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

function StatCard({ icon, label, value, sub, warn }: { icon: React.ReactNode; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`card ${warn ? "card-warn" : ""}`}>
      <div className="card-header">
        <div className="card-title">{icon}<span className="service-name" style={{ textTransform: "none" }}>{label}</span></div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: warn ? "var(--warning)" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: warn ? "var(--warning)" : "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
