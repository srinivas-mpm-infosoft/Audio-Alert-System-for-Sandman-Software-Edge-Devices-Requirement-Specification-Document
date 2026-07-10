import { useState, useEffect } from "react";
import {
  Sliders, Lock, LogOut, Cpu,
  ChevronDown, Volume2, Activity,
  Users, Megaphone,
} from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { EXISTING_ROLE_MAP } from "../pages/audio_alerts/utils/constants";

// Normalize legacy 3-role names to the 7-role system
function normalizeRole(role) {
  return { superadmin: "administrator", admin: "plant_manager", user: "operator" }[role] ?? role;
}

const NAV_ITEMS = [
  { id: "audio-alerts-group", icon: Volume2,    label: "Audio Alerts",    isAAGroup: true },
  { id: "user-management",    icon: Users,      label: "User Management", domId: "nav-user-mgmt",      requiresSuper: true },
  { id: "change-password",    icon: Lock,       label: "Change Password" },
  { id: "logout",             icon: LogOut,     label: "Logout" },
];

// aa-access removed — User Management is now a top-level nav item
// Each item combines several formerly-separate pages behind its own internal
// tab strip (see MonitorHub/SendAlertHub/SetupHub) — this list itself stays
// flat, no group headers needed for just three items.
const AA_SUB_ITEMS = [
  { id: "aa-monitor", icon: Activity,  label: "Monitor",    perms: ["aa.live.view", "aa.logs.view"] },
  { id: "aa-send",    icon: Megaphone, label: "Send Alert", perms: ["aa.broadcast.manual", "aa.paging.use", "aa.sop.view", "aa.schedule.view"] },
  { id: "aa-setup",   icon: Sliders,   label: "Setup",      perms: ["aa.devices.view", "aa.alerttypes.view", "aa.audio.upload", "aa.users.manage"] },
];

const AA_PANEL_IDS = new Set(AA_SUB_ITEMS.map((i) => i.id));

export default function Sidebar({ active, onSelect, role }) {
  const nr = normalizeRole(role);
  const rolePermissions = useAuthStore((s) => s.rolePermissions);

  const [aaOpen, setAaOpen] = useState(() => AA_PANEL_IDS.has(active));

  useEffect(() => {
    if (AA_PANEL_IDS.has(active)) setAaOpen(true);
  }, [active]);

  const isAdmin = ["administrator", "plant_manager"].includes(nr);
  const isSuper = nr === "administrator";

  const allowedItems = NAV_ITEMS.filter((item) => {
    if (item.requiresAdmin && !isAdmin) return false;
    if (item.requiresSuper && !isSuper) return false;
    return true;
  });

  const isAAActive = AA_PANEL_IDS.has(active);

  // Use dynamic permissions from backend (rolePermissions) to filter sidebar tabs
  const rbacRole = EXISTING_ROLE_MAP[role] ?? role ?? "operator";
  const can = (perm) => {
    if (!rolePermissions) return false;
    const perms = rolePermissions[rbacRole];
    return Array.isArray(perms) ? perms.includes(perm) : false;
  };
  // Show a combined menu item if the role has ANY of the permissions for
  // the pages folded into it — the item itself then only shows the inner
  // tabs that role actually has access to (see MonitorHub/SendAlertHub/SetupHub).
  const allowedAASubs = AA_SUB_ITEMS.filter((sub) => sub.perms.some(can));

  return (
    <nav
      className="w-56 h-full flex flex-col border-r border-white/5"
      style={{ background: "#111827" }}
    >
      {/* Logo */}
      <div className="px-4 py-4 border-b border-white/5 flex items-center gap-2.5">
        <div
          className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: "#2563eb22", border: "1px solid #2563eb44" }}
        >
          <Cpu size={12} style={{ color: "#60a5fa" }} />
        </div>
        <span className="text-sm font-semibold tracking-wide" style={{ color: "#e2e8f0" }}>
          Gateway
        </span>
      </div>

      {/* Nav items */}
      <ul className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {allowedItems.map((item) => {
          const Icon = item.icon;

          /* ── Audio Alerts expandable group ── */
          if (item.isAAGroup) {
            return (
              <li key={item.id}>
                <button
                  onClick={() => setAaOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-semibold transition-colors duration-100"
                  style={isAAActive ? { background: "#1e3a5f22", color: "#93c5fd", borderLeft: "2px solid #3b82f6" } : { color: "#e2e8f0" }}
                  onMouseEnter={(e) => { if (!isAAActive) e.currentTarget.style.color = "#f8fafc"; }}
                  onMouseLeave={(e) => { if (!isAAActive) e.currentTarget.style.color = "#e2e8f0"; }}
                  aria-expanded={aaOpen}
                >
                  <div className="flex items-center gap-2.5">
                    <Volume2 size={15} style={{ color: isAAActive ? "#60a5fa" : "#94a3b8" }} aria-hidden="true" />
                    <span className="font-semibold">{item.label}</span>
                  </div>
                  <ChevronDown
                    size={13}
                    style={{ color: "#94a3b8", transform: aaOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}
                    aria-hidden="true"
                  />
                </button>

                <div style={{ maxHeight: aaOpen ? `${allowedAASubs.length * 38}px` : "0px", overflow: "hidden", transition: "max-height 0.2s ease" }}>
                  <div className="mt-0.5 ml-3 pl-3 space-y-0.5" style={{ borderLeft: "1px solid #1f2937" }}>
                    {allowedAASubs.map((sub) => {
                      const SubIcon  = sub.icon;
                      const isActive = active === sub.id;
                      return (
                        <button
                          key={sub.id}
                          onClick={() => onSelect(sub.id)}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] font-semibold transition-colors duration-100"
                          style={isActive ? { background: "#1e3a5f33", color: "#93c5fd" } : { color: "#cbd5e1" }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "#f1f5f9"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "#cbd5e1"; }}
                        >
                          <SubIcon size={12} style={{ color: isActive ? "#60a5fa" : "#94a3b8" }} aria-hidden="true" />
                          {sub.label}
                          {isActive && <span className="ml-auto rounded-full shrink-0" style={{ width: 5, height: 5, background: "#3b82f6" }} aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          }

          /* ── Regular item ── */
          const isActive = active === item.id;
          return (
            <li key={item.id} id={item.domId}>
              <button
                onClick={() => onSelect(item.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-semibold transition-colors duration-100"
                style={isActive ? { background: "#1e3a5f22", color: "#93c5fd", borderLeft: "2px solid #3b82f6" } : { color: "#e2e8f0" }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "#f8fafc"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "#e2e8f0"; }}
              >
                <Icon size={15} style={{ color: isActive ? "#60a5fa" : "#94a3b8" }} />
                {item.label}
                {isActive && <span className="ml-auto rounded-full" style={{ width: 5, height: 5, background: "#3b82f6", flexShrink: 0 }} />}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/5 text-center">
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "#374151" }}>
          Gateway v2.0
        </p>
      </div>
    </nav>
  );
}
