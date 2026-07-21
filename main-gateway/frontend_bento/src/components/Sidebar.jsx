import { useState, useEffect } from "react";
import {
  Sliders, Lock, Wifi, Settings,
  ChevronDown, Volume2, Activity,
  Users, Megaphone, AlertTriangle,
} from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { EXISTING_ROLE_MAP } from "../pages/audio_alerts/utils/constants";
import { useEdgeNodeStatus } from "../pages/audio_alerts/hooks/useEdgeNodeStatus";

// Normalize legacy 3-role names to the 7-role system
function normalizeRole(role) {
  return { superadmin: "administrator", admin: "plant_manager", user: "operator" }[role] ?? role;
}

const NAV_ITEMS = [
  { id: "audio-alerts-group",  icon: Volume2,  label: "Audio Alerts",    isAAGroup: true },
  { id: "administration-group", icon: Settings, label: "Administration", isAdminGroup: true },
];

const ADMIN_SUB_ITEMS = [
  { id: "Wifi/4G",         icon: Wifi,  label: "WiFi / 4G / Ethernet" },
  { id: "user-management", icon: Users, label: "User Management", domId: "nav-user-mgmt", requiresSuper: true },
  { id: "change-password", icon: Lock,  label: "Change Password" },
];

const ADMIN_PANEL_IDS = new Set(ADMIN_SUB_ITEMS.map((i) => i.id));

// Each item combines several formerly-separate pages behind its own internal
// tab strip (see MonitorHub/SendAlertHub/SetupHub) — this list itself stays
// flat, no group headers needed for just three items.
const AA_SUB_ITEMS = [
  { id: "aa-monitor", icon: Activity,  label: "Monitor",    perms: ["aa.live.view", "aa.logs.view"] },
  { id: "aa-send",    icon: Megaphone, label: "Send Alert", perms: ["aa.broadcast.manual", "aa.paging.use", "aa.sop.view", "aa.schedule.view"] },
  { id: "aa-setup",   icon: Sliders,   label: "Setup",      perms: ["aa.devices.view", "aa.alerttypes.view", "aa.audio.upload", "aa.users.manage"] },
];

const AA_PANEL_IDS = new Set(AA_SUB_ITEMS.map((i) => i.id));

function GroupToggleButton({ Icon, label, isActive, isOpen, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
        isActive ? "bg-emerald-600/15 text-emerald-300 border-l-2 border-emerald-500" : "text-zinc-200 hover:text-white"
      }`}
      aria-expanded={isOpen}
    >
      <div className="flex items-center gap-2.5">
        <Icon size={15} className={isActive ? "text-emerald-400" : "text-zinc-400"} aria-hidden="true" />
        <span className="font-semibold">{label}</span>
      </div>
      <ChevronDown
        size={13}
        className="text-zinc-500 transition-transform"
        style={{ transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
        aria-hidden="true"
      />
    </button>
  );
}

function SubNavButton({ id, domId, Icon, label, isActive, onClick }) {
  return (
    <button
      key={id}
      id={domId}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] font-semibold transition-colors ${
        isActive ? "bg-emerald-600/20 text-emerald-300" : "text-zinc-400 hover:text-zinc-100"
      }`}
    >
      <Icon size={12} className={isActive ? "text-emerald-400" : "text-zinc-500"} aria-hidden="true" />
      {label}
      {isActive && <span className="ml-auto rounded-full shrink-0 w-1.5 h-1.5 bg-emerald-400" aria-hidden="true" />}
    </button>
  );
}

export default function Sidebar({ active, onSelect, role }) {
  const nr = normalizeRole(role);
  const rolePermissions = useAuthStore((s) => s.rolePermissions);
  const { devices: edgeDevices, onlineCount, totalCount } = useEdgeNodeStatus();

  const [aaOpen, setAaOpen] = useState(() => AA_PANEL_IDS.has(active));
  const [adminOpen, setAdminOpen] = useState(() => ADMIN_PANEL_IDS.has(active));

  useEffect(() => {
    if (AA_PANEL_IDS.has(active)) setAaOpen(true);
    if (ADMIN_PANEL_IDS.has(active)) setAdminOpen(true);
  }, [active]);

  const isSuper = nr === "administrator";

  const allowedAdminSubs = ADMIN_SUB_ITEMS.filter((sub) => !sub.requiresSuper || isSuper);

  const isAAActive = AA_PANEL_IDS.has(active);
  const isAdminGroupActive = ADMIN_PANEL_IDS.has(active);

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

  const offlineCount = totalCount - onlineCount;

  return (
    <nav className="w-56 h-full flex flex-col bg-zinc-800 border-r border-zinc-700/60">
      <div className="flex-1 overflow-y-auto py-5 px-3">
        <div className="space-y-1">
          {/* Audio Alerts expandable group */}
          <div>
            <GroupToggleButton Icon={Volume2} label="Audio Alerts" isActive={isAAActive} isOpen={aaOpen} onClick={() => setAaOpen((o) => !o)} />
            <div className="overflow-hidden transition-all" style={{ maxHeight: aaOpen ? `${allowedAASubs.length * 38}px` : "0px" }}>
              <div className="mt-0.5 ml-3 pl-3 space-y-0.5 border-l border-zinc-700">
                {allowedAASubs.map((sub) => (
                  <SubNavButton key={sub.id} id={sub.id} Icon={sub.icon} label={sub.label} isActive={active === sub.id} onClick={() => onSelect(sub.id)} />
                ))}
              </div>
            </div>
          </div>

          {/* Administration expandable group */}
          <div>
            <GroupToggleButton Icon={Settings} label="Administration" isActive={isAdminGroupActive} isOpen={adminOpen} onClick={() => setAdminOpen((o) => !o)} />
            <div className="overflow-hidden transition-all" style={{ maxHeight: adminOpen ? `${allowedAdminSubs.length * 38}px` : "0px" }}>
              <div className="mt-0.5 ml-3 pl-3 space-y-0.5 border-l border-zinc-700">
                {allowedAdminSubs.map((sub) => (
                  <SubNavButton key={sub.id} id={sub.id} domId={sub.domId} Icon={sub.icon} label={sub.label} isActive={active === sub.id} onClick={() => onSelect(sub.id)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {totalCount > 0 && (
        <div className="mx-3 mb-1">
          <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 px-2.5 mb-2">Edge Nodes</div>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {edgeDevices.map((d) => {
              const online = d.status === "online";
              return (
                <div key={d.id} className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-colors">
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${online ? "bg-emerald-400" : "border-[1.5px] border-zinc-500"}`} />
                    <span className="text-[13px] text-zinc-200 font-medium truncate">{d.zone_name || d.name}</span>
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${online ? "text-emerald-400" : "text-zinc-500"}`}>{d.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {offlineCount > 0 && (
        <div
          className="m-3 mt-2 rounded-2xl p-4 text-white relative overflow-hidden border border-white/10"
          style={{ background: "linear-gradient(160deg,#1f7a4f,#0c3521)", boxShadow: "0 12px 24px -8px rgba(0,0,0,.45)" }}
        >
          <AlertTriangle className="w-5 h-5 mb-2 text-white/90" strokeWidth={1.9} aria-hidden="true" />
          <div className="text-[13.5px] font-bold mb-1 tracking-[-0.01em]">
            {offlineCount} edge node{offlineCount === 1 ? "" : "s"} offline
          </div>
          <p className="text-[11.5px] text-white/70 mb-3.5 leading-relaxed">Check connectivity to restore live monitoring.</p>
          <button onClick={() => onSelect("aa-setup")} className="w-full bg-white text-emerald-800 text-xs font-bold py-2.5 rounded-full hover:bg-emerald-50 transition-colors">
            Check devices
          </button>
        </div>
      )}
    </nav>
  );
}
