import { NavLink } from "react-router-dom";
import { useState } from "react";
import {
  Home,
  Boxes,
  Package,
  Puzzle,
  Image,
  Sparkles,
  Server,
  Users,
  Shirt,
  Coffee,
  Download,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { AccountSelector } from "../components/AccountSelector";
import { Tooltip } from "../components/Tooltip";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/instances", label: "Instances", icon: Boxes },
  { to: "/modpacks", label: "Modpacks", icon: Package },
  { to: "/mods", label: "Mods", icon: Puzzle },
  { to: "/resourcepacks", label: "Resource Packs", icon: Image },
  { to: "/shaders", label: "Shaders", icon: Sparkles },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/accounts", label: "Accounts", icon: Users },
  { to: "/skins", label: "Skins", icon: Shirt },
  { to: "/java", label: "Java", icon: Coffee },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? "w-16" : "w-56"
      } shrink-0 flex flex-col bg-noxara-black border-r border-noxara-border transition-[width] duration-200 ease-out`}
    >
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => {
          const link = (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded px-3 py-2 text-sm transition-all duration-150 yz-focus-ring ${
                  isActive
                    ? "bg-noxara-surface text-noxara-white before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-noxara-white before:rounded-full before:-ml-2"
                    : "text-noxara-subtle hover:text-noxara-text hover:bg-noxara-surface/60 hover:translate-x-0.5"
                }`
              }
            >
              <Icon size={17} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={to} label={label} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className="border-t border-noxara-border p-2">
        <AccountSelector collapsed={collapsed} />

        <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="mt-1 w-full flex items-center justify-center gap-2 rounded px-2 py-1.5 text-noxara-muted hover:text-noxara-text hover:bg-noxara-surface transition-colors duration-150 yz-focus-ring"
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
