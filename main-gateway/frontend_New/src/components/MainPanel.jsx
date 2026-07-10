import ChangePassword from "./../pages/ChangePassword";
import UserManagement from "./../pages/UserManagement";
import AudioAlerts from "./../pages/audio_alerts/index";
import { targetUrl } from "./../config";

// aa-access removed — User Management is the top-level nav item now
const AA_SUB_TAB_MAP = {
  "aa-monitor": "monitor",
  "aa-send":    "send",
  "aa-setup":   "setup",
};

const KNOWN_PANELS = new Set([
  "change-password", "user-management", "logout",
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

  const aaSubTab = AA_SUB_TAB_MAP[panel] ?? null;
  const isKnown  = aaSubTab !== null || KNOWN_PANELS.has(panel);

  return (
    <main id="main-panel">
      {/* ── Audio Alerts ── */}
      {aaSubTab !== null && (
        <AudioAlerts subTab={aaSubTab} user={user} />
      )}

      {panel === "change-password" && <ChangePassword />}

      {/* ── User Management (replaces Add User) ── */}
      {panel === "user-management" && <UserManagement user={user} />}

      {/* Fallback */}
      {!isKnown && <div style={{ padding: 20 }}>Page not found</div>}
    </main>
  );
}
