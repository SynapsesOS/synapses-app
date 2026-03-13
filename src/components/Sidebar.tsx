import { NavLink } from "react-router-dom";
import { LayoutDashboard, FolderOpen, Settings, Zap, Brain, BarChart2, Globe } from "lucide-react";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/projects", icon: FolderOpen, label: "Projects" },
  { to: "/models", icon: Brain, label: "Models" },
  { to: "/analytics", icon: BarChart2, label: "Analytics" },
  { to: "/scout", icon: Globe, label: "Scout" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <Zap size={20} className="logo-icon" />
        <span className="logo-text">Synapses</span>
      </div>
      <ul className="nav-list">
        {NAV.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
