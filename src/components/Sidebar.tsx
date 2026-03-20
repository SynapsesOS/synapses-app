import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FolderOpen,
  Activity,
  Settings,
  Sun,
  Moon,
  Zap,
} from "lucide-react";
import { useServices } from "../hooks/useServices";

const NAV_ITEMS = [
  { to: "/",          icon: LayoutDashboard, label: "Home"     },
  { to: "/projects",  icon: FolderOpen,      label: "Projects" },
  { to: "/activity",  icon: Activity,        label: "Activity" },
  { to: "/settings",  icon: Settings,        label: "Settings" },
];

export function Sidebar() {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("synapses-theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const { services } = useServices();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("synapses-theme", dark ? "dark" : "light");
  }, [dark]);

  const total   = services.length;
  const healthy = services.filter((s) => s.status === "healthy").length;
  const anyOffline  = services.some((s) => s.status === "offline");
  const anyDegraded = services.some((s) => s.status === "degraded");

  const statusColor = anyOffline
    ? "var(--danger)"
    : anyDegraded
    ? "var(--warning)"
    : total > 0 && healthy === total
    ? "var(--success)"
    : "var(--text-dim)";

  const statusLabel =
    total === 0
      ? "Starting…"
      : anyOffline
      ? `${total - healthy} offline`
      : anyDegraded
      ? "Degraded"
      : "Running";

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <Zap size={17} className="logo-icon" />
        <span className="logo-text">Synapses</span>
      </div>

      <ul className="nav-list">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span
            className={`sidebar-status-dot ${!anyOffline && !anyDegraded && total > 0 ? "pulse" : ""}`}
            style={{ background: statusColor }}
          />
          <span className="sidebar-status-label" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        </div>
        <div className="sidebar-footer-row">
          <span className="sidebar-version">v0.3.0</span>
          <button
            className="theme-toggle"
            onClick={() => setDark((d) => !d)}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun size={12} /> : <Moon size={12} />}
          </button>
        </div>
      </div>
    </nav>
  );
}
