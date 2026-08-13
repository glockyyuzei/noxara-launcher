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
  HardDrive,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { AccountSelector } from "../components/AccountSelector";
import { Tooltip } from "../components/Tooltip";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home, end: true, section: "Main" },
  { to: "/instances", label: "Instances", icon: Boxes, end: false, section: "Main" },
  { to: "/modpacks", label: "Modpacks", icon: Package, end: false, section: "Content" },
  { to: "/mods", label: "Mods", icon: Puzzle, end: false, section: "Content" },
  { to: "/resourcepacks", label: "Resource Packs", icon: Image, end: false, section: "Content" },
  { to: "/shaders", label: "Shaders", icon: Sparkles, end: false, section: "Content" },
  { to: "/servers", label: "Servers", icon: Server, end: false, section: "Multiplayer" },
  { to: "/accounts", label: "Accounts", icon: Users, end: false, section: "Account" },
  { to: "/skins", label: "Skins", icon: Shirt, end: false, section: "Account" },
  { to: "/java", label: "Java", icon: Coffee, end: false, section: "System" },
  { to: "/downloads", label: "Downloads", icon: Download, end: false, section: "System" },
  { to: "/storage", label: "Storage", icon: HardDrive, end: false, section: "System" },
  { to: "/settings", label: "Settings", icon: Settings, end: false, section: "System" },
] as const;

const SECTION_ORDER = ["Main", "Content", "Multiplayer", "Account", "System"] as const;

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? "w-16" : "w-56"
      } shrink-0 flex flex-col bg-noxara-void border-r border-noxara-border transition-[width] duration-200 ease-out`}
    >
      <nav className="flex-1 py-3 px-2.5 space-y-3.5 overflow-y-auto overflow-x-hidden">
        {SECTION_ORDER.map((section) => {
          const items = NAV_ITEMS.filter((i) => i.section === section);
          return (
            <div key={section}>
              {!collapsed && (
                <p className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-noxara-muted/70">
                  {section}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map(({ to, label, icon: Icon, end }) => {
                  const link = (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      className={({ isActive }) =>
                        `group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 yz-focus-ring ${
                          isActive
                            ? "bg-noxara-elevated text-noxara-white shadow-card"
                            : "text-noxara-subtle hover:text-noxara-text hover:bg-noxara-surface/60"
                        }`
                      }
                    >
                      <Icon size={16} className="shrink-0" strokeWidth={1.75} />
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
              </div>
            </div>
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
