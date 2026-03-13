import { useServices } from "../hooks/useServices";

export function StatusStrip() {
  const { services } = useServices();

  const total = services.length;
  const healthy = services.filter((s) => s.status === "healthy").length;
  const anyOffline = services.some((s) => s.status === "offline");
  const anyDegraded = services.some((s) => s.status === "degraded");

  const color = anyOffline
    ? "var(--danger)"
    : anyDegraded
    ? "var(--warning)"
    : total > 0 && healthy === total
    ? "var(--success)"
    : "var(--text-dim)";

  const label =
    total === 0
      ? "Checking services…"
      : anyOffline
      ? `${total - healthy} service${total - healthy > 1 ? "s" : ""} offline`
      : anyDegraded
      ? "Degraded"
      : `${healthy}/${total} services healthy`;

  return (
    <div className="status-strip">
      <span className="status-strip-dot" style={{ background: color }} />
      <span className="status-strip-label">{label}</span>
      <span className="status-strip-sep">·</span>
      <span className="status-strip-brand">Synapses</span>
    </div>
  );
}
