import React, { useState, useEffect } from "react";
import {
  Sliders, Wifi, Database,
  Settings, Lock, LogOut,
  Settings2, Cpu, Network,
  ChevronDown, Volume2, BarChart3, FileText, Activity,
  Users, CalendarClock, ListChecks, Megaphone, Mic,
} from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { EXISTING_ROLE_MAP } from "../pages/audio_alerts/utils/constants";

// Normalize legacy 3-role names to the 7-role system
function normalizeRole(role) {
  return { superadmin: "administrator", admin: "plant_manager", user: "operator" }[role] ?? role;
}

const NAV_ITEMS = [
  { id: "io-settings-group",  icon: Sliders,   label: "I/O Settings",    isGroup: true },
  { id: "audio-alerts-group", icon: Volume2,    label: "Audio Alerts",    isAAGroup: true },
  { id: "Wifi/4G",            icon: Wifi,       label: "WiFi / 4G / Ethernet" },
  { id: "database",           icon: Database,   label: "Database",        domId: "nav-database",       requiresAdmin: true },
  { id: "admin-settings",     icon: Settings,   label: "Admin Settings",  domId: "nav-admin-settings", requiresAdmin: true },
  { id: "user-management",    icon: Users,      label: "User Management", domId: "nav-user-mgmt",      requiresSuper: true },
  { id: "change-password",    icon: Lock,       label: "Change Password" },
  { id: "logout",             icon: LogOut,     label: "Logout" },
];

const IO_SUB_ITEMS = [
  { id: "io-general",    icon: Settings2, label: "General"    },
  { id: "io-modbus-rtu", icon: Cpu,       label: "Modbus RTU" },
  { id: "io-plc",        icon: Network,   label: "PLC"        },
  { id: "io-scada",      icon: Network,   label: "SCADA PC"   },
  { id: "io-hmi",        icon: Settings2, label: "HMI"        },
  { id: "io-mqtt",       icon: Wifi,      label: "MQTT"       },
];

const IO_PANEL_IDS = new Set(IO_SUB_ITEMS.map((i) => i.id));

// aa-access removed — User Management is now a top-level nav item
// Grouped for foundry-floor usability: what's happening now, how to send an
// alert, how to plan one ahead, rarely-touched setup, then after-the-fact review.
const AA_SUB_ITEMS = [
  { id: "aa-devices",    icon: Cpu,           label: "Devices & Zones",  perm: "aa.devices.view",     group: "Setup" },
  { id: "aa-alerttypes", icon: Sliders,       label: "Alert Types",      perm: "aa.alerttypes.view",  group: "Setup" },
  { id: "aa-audio",      icon: Volume2,       label: "Audio Config",     perm: "aa.audio.upload",     group: "Setup" },
  { id: "aa-settings",   icon: Settings2,     label: "App Settings",     perm: "aa.users.manage",     group: "Setup" },
  { id: "aa-live",       icon: Activity,      label: "Live Monitor",     perm: "aa.live.view",        group: "Monitor" },
  { id: "aa-broadcast",  icon: Megaphone,     label: "Manual Broadcast", perm: "aa.broadcast.manual", group: "Send Alert" },
  { id: "aa-paging",     icon: Mic,           label: "Live Paging",      perm: "aa.paging.use",       group: "Send Alert" },
  { id: "aa-sop",        icon: ListChecks,    label: "SOP Guidance",     perm: "aa.sop.view",         group: "Send Alert" },
  // Rule Builder hidden from navigation for now — kept here (commented) for easy re-enable.
  // { id: "aa-rules",     icon: Sliders,   label: "Rule Builder",    perm: "aa.rules.view", group: "Send Alert" },
  { id: "aa-schedule",   icon: CalendarClock, label: "Schedule",         perm: "aa.schedule.view",    group: "Plan Ahead" },
  // { id: "aa-analytics",  icon: BarChart3,     label: "Analytics",        perm: "aa.analytics.view",   group: "Reports" },
  { id: "aa-logs",       icon: FileText,      label: "Logs",             perm: "aa.logs.view",        group: "Reports" },
];

const AA_PANEL_IDS = new Set(AA_SUB_ITEMS.map((i) => i.id));

export default function Sidebar({ active, onSelect, role }) {
  const nr = normalizeRole(role);
  const rolePermissions = useAuthStore((s) => s.rolePermissions);

  const [ioOpen, setIoOpen] = useState(() => IO_PANEL_IDS.has(active));
  const [aaOpen, setAaOpen] = useState(() => AA_PANEL_IDS.has(active));

  useEffect(() => {
    if (IO_PANEL_IDS.has(active)) setIoOpen(true);
    if (AA_PANEL_IDS.has(active)) setAaOpen(true);
  }, [active]);

  const isAdmin = ["administrator", "plant_manager"].includes(nr);
  const isSuper = nr === "administrator";

  const allowedItems = NAV_ITEMS.filter((item) => {
    if (item.requiresAdmin && !isAdmin) return false;
    if (item.requiresSuper && !isSuper) return false;
    return true;
  });

  const isIOActive = IO_PANEL_IDS.has(active);
  const isAAActive = AA_PANEL_IDS.has(active);

  // Use dynamic permissions from backend (rolePermissions) to filter sidebar tabs
  const rbacRole = EXISTING_ROLE_MAP[role] ?? role ?? "operator";
  const can = (perm) => {
    if (!rolePermissions) return false;
    const perms = rolePermissions[rbacRole];
    return Array.isArray(perms) ? perms.includes(perm) : false;
  };
  const allowedAASubs = AA_SUB_ITEMS.filter((sub) => can(sub.perm));
  const aaGroupCount = new Set(allowedAASubs.map((s) => s.group)).size;

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

          /* ── I/O expandable group ── */
          if (item.isGroup) {
            return (
              <li key={item.id}>
                <button
                  onClick={() => setIoOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-semibold transition-colors duration-100"
                  style={isIOActive ? { background: "#1e3a5f22", color: "#7dd3fc", borderLeft: "2px solid #3b82f6" } : { color: "#e2e8f0" }}
                  onMouseEnter={(e) => { if (!isIOActive) e.currentTarget.style.color = "#f8fafc"; }}
                  onMouseLeave={(e) => { if (!isIOActive) e.currentTarget.style.color = "#e2e8f0"; }}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={15} style={{ color: isIOActive ? "#60a5fa" : "#94a3b8" }} />
                    <span className="font-semibold">{item.label}</span>
                  </div>
                  <ChevronDown
                    size={13}
                    style={{ color: "#94a3b8", transform: ioOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}
                  />
                </button>

                <div style={{ maxHeight: ioOpen ? `${IO_SUB_ITEMS.length * 38}px` : "0px", overflow: "hidden", transition: "max-height 0.2s ease" }}>
                  <div className="mt-0.5 ml-3 pl-3 space-y-0.5" style={{ borderLeft: "1px solid #1f2937" }}>
                    {IO_SUB_ITEMS.map((sub) => {
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
                          <SubIcon size={12} style={{ color: isActive ? "#60a5fa" : "#94a3b8" }} />
                          {sub.label}
                          {isActive && <span className="ml-auto rounded-full flex-shrink-0" style={{ width: 5, height: 5, background: "#3b82f6" }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          }

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

                <div style={{ maxHeight: aaOpen ? `${allowedAASubs.length * 38 + aaGroupCount * 22}px` : "0px", overflow: "hidden", transition: "max-height 0.2s ease" }}>
                  <div className="mt-0.5 ml-3 pl-3 space-y-0.5" style={{ borderLeft: "1px solid #1f2937" }}>
                    {(() => {
                      let lastGroup = null;
                      return allowedAASubs.map((sub) => {
                        const SubIcon    = sub.icon;
                        const isActive   = active === sub.id;
                        const showHeader = sub.group !== lastGroup;
                        lastGroup = sub.group;
                        return (
                          <React.Fragment key={sub.id}>
                            {showHeader && (
                              <div className="pt-2 pb-0.5 px-2.5 text-[9.5px] font-bold uppercase tracking-widest" style={{ color: "#7dd3fc" }}>
                                {sub.group}
                              </div>
                            )}
                            <button
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
                          </React.Fragment>
                        );
                      });
                    })()}
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
