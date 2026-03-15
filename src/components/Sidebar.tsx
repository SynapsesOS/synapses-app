import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FolderOpen,
  Users,
  Brain,
  BarChart2,
  Database,
  Shield,
  Settings,
  Zap,
  Search,
} from "lucide-react";

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Control",
    items: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/projects", icon: FolderOpen, label: "Projects" },
      { to: "/agents", icon: Users, label: "Agents" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/explorer", icon: Search, label: "Explorer" },
      { to: "/models", icon: Brain, label: "Models & Brain" },
    ],
  },
  {
    label: "Observe",
    items: [
      { to: "/analytics", icon: BarChart2, label: "Analytics" },
      { to: "/memory", icon: Database, label: "Memory" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/privacy", icon: Shield, label: "Privacy & Data" },
      { to: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <Zap size={18} className="logo-icon" />
        <span className="logo-text">Synapses</span>
      </div>

      <div className="nav-groups">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="nav-group">
            <div className="nav-section-label">{group.label}</div>
            <ul className="nav-list">
              {group.items.map(({ to, icon: Icon, label }) => (
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
          </div>
        ))}
      </div>

      <div className="sidebar-footer">v0.2.0</div>
    </nav>
  );
}
