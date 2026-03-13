import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useServices } from "../hooks/useServices";
import { ServiceCard } from "../components/ServiceCard";
import { Zap, DollarSign, Activity, Users, FolderPlus, Plug, FolderOpen, TrendingUp } from "lucide-react";

const PULSE_URL = "http://localhost:11437";

interface PulseSummary {
  total_tool_calls?: number;
  tokens_saved?: number;
  savings_pct?: number;
  cost_saved_usd?: number;
  sessions?: number;
}

interface PulseAgentStats {
  agent_id: string;
  sessions: number;
  tool_calls: number;
  tokens_saved: number;
}

function fmt(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function Dashboard() {
  const { services, restart, stop } = useServices();
  const [pulse, setPulse] = useState<{ summary?: PulseSummary; agents?: PulseAgentStats[] } | null>(null);

  const fetchPulse = useCallback(() => {
    fetch(`${PULSE_URL}/v1/dashboard?days=7`, { signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPulse)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchPulse();
    const id = setInterval(fetchPulse, 30_000);
    return () => clearInterval(id);
  }, [fetchPulse]);

  const healthy = services.filter((s) => s.status === "healthy").length;
  const total = services.length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <span className="page-subtitle">
            {total > 0 ? `${healthy}/${total} services healthy` : "Checking…"}
          </span>
        </div>
      </div>

      {/* Hero stats — only when Pulse is running */}
      {pulse?.summary && (
        <section className="hero-stats">
          <HeroStat
            icon={<Zap size={18} style={{ color: "var(--accent)" }} />}
            label="Tokens Saved"
            value={fmt(pulse.summary.tokens_saved)}
            sub={
              pulse.summary.savings_pct != null
                ? `${pulse.summary.savings_pct.toFixed(1)}% compression`
                : "last 7 days"
            }
          />
          <HeroStat
            icon={<DollarSign size={18} style={{ color: "var(--success)" }} />}
            label="Cost Saved"
            value={
              pulse.summary.cost_saved_usd != null
                ? `$${pulse.summary.cost_saved_usd.toFixed(2)}`
                : "—"
            }
            sub="last 7 days"
          />
          <HeroStat
            icon={<Activity size={18} style={{ color: "var(--warning)" }} />}
            label="Tool Calls"
            value={fmt(pulse.summary.total_tool_calls)}
            sub="last 7 days"
          />
          <HeroStat
            icon={<Users size={18} style={{ color: "var(--accent-h)" }} />}
            label="Sessions"
            value={fmt(pulse.summary.sessions)}
            sub="last 7 days"
          />
        </section>
      )}

      {/* Services */}
      <section className="dash-section">
        <h2 className="section-title">Services</h2>
        <div className="cards-grid">
          {services.length === 0 ? (
            <div className="empty-state">Checking service status…</div>
          ) : (
            services.map((s) => (
              <ServiceCard key={s.name} info={s} onRestart={restart} onStop={stop} />
            ))
          )}
        </div>
      </section>

      {/* Recent agents */}
      {pulse?.agents && pulse.agents.length > 0 && (
        <section className="dash-section">
          <div className="section-header-row">
            <h2 className="section-title">Recent Agents</h2>
            <Link to="/agents" className="section-link">View all →</Link>
          </div>
          <div className="agent-feed">
            {pulse.agents.slice(0, 5).map((a) => (
              <div key={a.agent_id} className="agent-feed-row">
                <div className="agent-feed-dot" />
                <div className="agent-feed-info">
                  <span className="agent-feed-id">{a.agent_id}</span>
                  <span className="agent-feed-meta">
                    {a.sessions} session{a.sessions !== 1 ? "s" : ""} · {a.tool_calls} calls
                  </span>
                </div>
                <span className="agent-feed-stat">{fmt(a.tokens_saved)} saved</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick actions */}
      <section className="dash-section">
        <h2 className="section-title">Quick Actions</h2>
        <div className="actions-row">
          <QuickAction
            icon={<FolderPlus size={15} />}
            label="Add Project"
            desc="Index a new codebase"
            href="/projects"
          />
          <QuickAction
            icon={<Plug size={15} />}
            label="Connect Agent"
            desc="Copy MCP config for your AI agent"
            href="/settings"
          />
          <QuickAction
            icon={<TrendingUp size={15} />}
            label="Analytics"
            desc="Token savings, latency, activity"
            href="/analytics"
          />
          <QuickAction
            icon={<FolderOpen size={15} />}
            label="Privacy & Data"
            desc="See and control what's stored"
            href="/privacy"
          />
        </div>
      </section>
    </div>
  );
}

function HeroStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="hero-stat">
      <div className="hero-stat-icon">{icon}</div>
      <div className="hero-stat-value">{value}</div>
      <div className="hero-stat-label">{label}</div>
      {sub && <div className="hero-stat-sub">{sub}</div>}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  desc,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  href: string;
}) {
  return (
    <Link className="quick-action" to={href}>
      <div className="quick-action-icon">{icon}</div>
      <div className="quick-action-label">{label}</div>
      <div className="quick-action-desc">{desc}</div>
    </Link>
  );
}
