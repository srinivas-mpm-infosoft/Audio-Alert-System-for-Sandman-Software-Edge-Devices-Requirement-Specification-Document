import ChangePassword from "./../pages/ChangePassword";
import Wifi4G from "./../pages/Wifi4G";
import UserManagement from "./../pages/UserManagement";
import AudioAlerts from "./../pages/audio_alerts/index";

// Normalize legacy 3-role → 7-role for permission checks
function normalizeRole(role) {
  return { superadmin: "administrator", admin: "plant_manager", user: "operator" }[role] ?? role;
}

// aa-access removed — User Management is the top-level nav item now
const AA_SUB_TAB_MAP = {
  "aa-monitor": "monitor",
  "aa-send":    "send",
  "aa-setup":   "setup",
};

const KNOWN_PANELS = new Set([
  "Wifi/4G", "change-password", "user-management",
]);

export default function MainPanel({ panel, user }) {
  const role = normalizeRole(user?.role);
  const isAdmin = ["administrator", "plant_manager"].includes(role);
  const isReadOnly = !isAdmin;

  const aaSubTab = AA_SUB_TAB_MAP[panel] ?? null;
  const isKnown  = aaSubTab !== null || KNOWN_PANELS.has(panel);

  return (
    <main id="main-panel">
      {/* ── Audio Alerts ── */}
      {aaSubTab !== null && (
        <AudioAlerts subTab={aaSubTab} user={user} />
      )}

      {panel === "Wifi/4G"    && <Wifi4G isReadOnly={isReadOnly} />}
      
      {panel === "change-password" && <ChangePassword />}

      {/* ── User Management (replaces Add User) ── */}
      {panel === "user-management" && <UserManagement user={user} />}

      {/* Fallback */}
      {!isKnown && <div style={{ padding: 20 }}>Page not found</div>}
    </main>
  );
}
