import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import WindowBar from "./components/WindowBar";
import MainPanel from "./components/MainPanel";
import Login from "./pages/login";
import './App.css'
import { ToastProvider } from "./components/ToastContext"; // New Toast Provider
import { useAuthStore } from "./store/useAuthStore";
import { useAppConfigStore } from "./store/useAppConfigStore";
import {targetUrl} from "./config";
import { ROLE_PERMISSIONS } from "./pages/audio_alerts/utils/constants";

// Convert static Set-based ROLE_PERMISSIONS to plain arrays for the store
const STATIC_RP_AS_ARRAYS = Object.fromEntries(
  Object.entries(ROLE_PERMISSIONS).map(([role, set]) => [role, [...set]])
);
// import {BrowserRouter as Router, Route, Routes, BrowserRouter} from "react-router-dom";

export default function App() {
  const [activePanel, setActivePanel] = useState("io-general");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const setUser = useAuthStore((state) => state.setUser);
  const setRolePermissions = useAuthStore((state) => state.setRolePermissions);
  const user = useAuthStore((state) => state.user);
  const setAppConfig = useAppConfigStore((s) => s.setAppConfig);

  useEffect(() => {
    async function verifySession() {
      try {
        const res = await fetch(`${targetUrl}/whoami`, { credentials: "include" });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          setIsAuthenticated(true);
          // load dynamic role permissions so useCan reflects backend-edited perms
          try {
            const rp = await fetch(`${targetUrl}/roles/permissions`, { credentials: "include" });
            if (rp.ok) {
              const rpData = await rp.json();
              setRolePermissions(rpData.data ?? STATIC_RP_AS_ARRAYS);
            } else {
              setRolePermissions(STATIC_RP_AS_ARRAYS);
            }
          } catch (_) {
            setRolePermissions(STATIC_RP_AS_ARRAYS);
          }
          // load app settings (languages, zone_types, parameters)
          try {
            const ac = await fetch(`${targetUrl}/audio-alerts/config/app-settings`, { credentials: "include" });
            if (ac.ok) {
              const acData = await ac.json();
              if (acData.data) setAppConfig(acData.data);
            }
          } catch (_) { /* non-critical, falls back to static constants */ }
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (err) {
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    }

    verifySession();
  }, [setUser, setRolePermissions]);

  useEffect(() => {
    if (user?.role === "user" && (activePanel === "database" || activePanel === "admin-settings")) {
      setActivePanel("io-general");
    }
  }, [user, activePanel]);

  // Show a blank screen or spinner while checking
  if (loading) return <div className="min-h-screen bg-[#dfe3ea]" />;

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    // <Router>
    // <Routes>
    //   <Route path="/user" element={<div>{JSON.stringify(user)}</div>} /> // just print the User variable details
    // </Routes>
    // </Router>
    <ToastProvider>
      <div className="flex flex-col h-screen overflow-hidden bg-[#dfe3ea]">
        {/* Top Bar - Fixed height, won't scroll */}
        <div className="flex-shrink-0">
          <WindowBar /> 
        </div>

        {/* Body Area - Takes remaining height */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar - Fixed width, won't scroll with content */}
          <div className="flex-shrink-0">
            <Sidebar active={activePanel} onSelect={setActivePanel} role={user?.role} />
          </div>

          {/* Main Content - THIS is the only part that scrolls */}
          <main className="flex-1 overflow-y-auto bg-slate-50">
            <MainPanel panel={activePanel} user={user} />
          </main>

        </div>
      </div>
    </ToastProvider>

  );
}