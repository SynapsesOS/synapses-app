import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FolderOpen,
  Zap,
  Brain,
  Settings,
  Sun,
  Moon,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/",          icon: LayoutDashboard, label: "Home"     },
  { to: "/projects",  icon: FolderOpen,      label: "Projects" },
  { to: "/activity",  icon: Zap,             label: "Activity" },
  { to: "/brain",     icon: Brain,           label: "Brain"    },
  { to: "/settings",  icon: Settings,        label: "Settings" },
];

export function Sidebar() {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("synapses-theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("synapses-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <Zap size={18} className="logo-icon" />
        <span className="logo-text">Synapses</span>
      </div>

      <ul className="nav-list" style={{ gap: 2 }}>
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
        <span className="sidebar-version">v0.2.0</span>
        <button
          className="theme-toggle"
          onClick={() => setDark((d) => !d)}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
    </nav>
  );
}
