import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useServices } from "../hooks/useServices";
import { ServiceCard } from "../components/ServiceCard";
import { FolderPlus, Plug, FolderOpen, TrendingUp, AlertCircle } from "lucide-react";

export function Dashboard() {
  const { services, restart, stop, startupError } = useServices();

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

      {startupError && (
        <div className="offline-banner">
          <AlertCircle size={16} />
          <span>{startupError}</span>
        </div>
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

function QuickAction({
  icon,
  label,
  desc,
  href,
}: {
  icon: ReactNode;
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
