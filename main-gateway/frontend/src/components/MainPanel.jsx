import IOSettings from "./../pages/iosettings";
import Wifi4G from "./../pages/Wifi4G";
import Alarm from "./../pages/Alarm";
import FileToDB from "./../pages/FileToDB";
import DatabasePage from "./../pages/DatabasePage";
import AdminSettings from "./../pages/AdminSettings";
import ChangePassword from "./../pages/ChangePassword";
import UserManagement from "./../pages/UserManagement";
import AudioAlerts from "./../pages/audio_alerts/index";
import { targetUrl } from "./../config";

// Normalize legacy 3-role → 7-role for permission checks
function normalizeRole(role) {
  return { superadmin: "administrator", admin: "plant_manager", user: "operator" }[role] ?? role;
}

const IO_SUB_TAB_MAP = {
  "io-general":    "general",
  "io-modbus-rtu": "modbus-rtu",
  "io-plc":        "plc",
  "io-scada":      "scada",
  "io-hmi":        "hmi",
  "io-mqtt":       "mqtt",
  "io-settings":   "general",   // legacy alias
  "io-modbus-tcp": "plc",       // legacy alias → PLC tab
};

// aa-access removed — User Management is the top-level nav item now
const AA_SUB_TAB_MAP = {
  "aa-live":      "live",
  "aa-broadcast": "broadcast",
  "aa-paging":    "paging",
  // "aa-rules":     "rules", // Rule Builder hidden from navigation for now
  "aa-schedule":  "schedule",
  "aa-sop":       "sop",
  "aa-audio":     "audio",
  "aa-alerttypes": "alerttypes",
  "aa-devices":   "devices",
  "aa-analytics": "analytics",
  "aa-logs":      "logs",
  "aa-settings":  "settings",
};

const KNOWN_PANELS = new Set([
  "Wifi/4G", "alarm", "file-to-db", "database",
  "admin-settings", "change-password", "user-management", "logout",
]);

export default function MainPanel({ panel, user }) {
  const logout = async () => {
    try {
      await fetch(`${targetUrl}/logout`, { method: "POST", credentials: "include" });
    } catch (err) {
      console.error(err);
    }
    window.location.href = "/";
  };

  if (panel === "logout") {
    logout();
    return <main id="main-panel"><div>Logging out…</div></main>;
  }

  const role   = normalizeRole(user?.role);
  const isAdmin = ["administrator", "plant_manager"].includes(role);
  const isReadOnly = !isAdmin;

  const ioSubTab = IO_SUB_TAB_MAP[panel] ?? null;
  const aaSubTab = AA_SUB_TAB_MAP[panel] ?? null;
  const isKnown  = ioSubTab !== null || aaSubTab !== null || KNOWN_PANELS.has(panel);

  return (
    <main id="main-panel">
      {/* ── I/O Settings ── */}
      {ioSubTab !== null && (
        <IOSettings subTab={ioSubTab} isReadOnly={isReadOnly} role={user?.role} />
      )}

      {/* ── Audio Alerts ── */}
      {aaSubTab !== null && (
        <AudioAlerts subTab={aaSubTab} user={user} />
      )}

      {/* ── Other pages ── */}
      {panel === "Wifi/4G"    && <Wifi4G isReadOnly={isReadOnly} />}
      {panel === "alarm"      && <Alarm  isReadOnly={isReadOnly} />}
      {panel === "file-to-db" && <FileToDB isReadOnly={isReadOnly} />}

      {panel === "database" && (
        isAdmin
          ? <DatabasePage isReadOnly={isReadOnly} />
          : <div style={{ padding: 20, color: "#d32f2f" }}>Access denied: database view available for admin/superadmin.</div>
      )}

      {panel === "admin-settings" && (
        isAdmin
          ? <AdminSettings isReadOnly={isReadOnly} />
          : <div style={{ padding: 20, color: "#d32f2f" }}>Access denied: admin settings available for admin/superadmin.</div>
      )}

      {panel === "change-password" && <ChangePassword />}

      {/* ── User Management (replaces Add User) ── */}
      {panel === "user-management" && <UserManagement user={user} />}

      {/* Fallback */}
      {!isKnown && <div style={{ padding: 20 }}>Page not found</div>}
    </main>
  );
}
