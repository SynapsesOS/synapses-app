import { useServices } from "../hooks/useServices";
import { ServiceCard } from "../components/ServiceCard";

export function Dashboard() {
  const { services, restart, stop } = useServices();

  const healthy = services.filter((s) => s.status === "healthy").length;
  const total = services.length;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="page-subtitle">
          {total > 0 ? `${healthy}/${total} services healthy` : "Loading…"}
        </span>
      </div>

      <section>
        <h2 className="section-title">Services</h2>
        <div className="cards-grid">
          {services.length === 0 ? (
            <div className="empty-state">Checking service status…</div>
          ) : (
            services.map((s) => (
              <ServiceCard
                key={s.name}
                info={s}
                onRestart={restart}
                onStop={stop}
              />
            ))
          )}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 className="section-title">Quick Actions</h2>
        <div className="actions-row">
          <QuickAction
            label="Add Project"
            desc="Index a new codebase"
            href="/projects"
          />
          <QuickAction
            label="Connect Agent"
            desc="Copy MCP config for Claude Code / Cursor"
            href="/settings"
          />
        </div>
      </section>
    </div>
  );
}

function QuickAction({
  label,
  desc,
  href,
}: {
  label: string;
  desc: string;
  href: string;
}) {
  return (
    <a className="quick-action" href={href}>
      <div className="quick-action-label">{label}</div>
      <div className="quick-action-desc">{desc}</div>
    </a>
  );
}
