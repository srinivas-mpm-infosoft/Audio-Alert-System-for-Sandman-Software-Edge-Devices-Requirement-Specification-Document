import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import WindowBar from "./components/WindowBar";
import MainPanel from "./components/MainPanel";
import Login from "./pages/login";
import "./App.css";
import { ToastProvider } from "./components/ToastContext";
import { useAuthStore } from "./store/useAuthStore";
import GrafanaFrame from "./pages/GrafanaFrame";
import { targetUrl } from "./config";

export default function App() {
  const [activePanel, setActivePanel] = useState("io-general");
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const setUser = useAuthStore((state) => state.setUser);
  const user = useAuthStore((state) => state.user);

  // 🔐 AUTH CHECK
  useEffect(() => {
    async function verifySession() {
      try {
        const res = await fetch(`${targetUrl}/whoami`,{
          credentials: 'include',
        });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.warn("Backend not reachable");
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    }

    verifySession();
  }, [setUser]);

  // 🔒 ROLE CONTROL
  useEffect(() => {
    if (
      user?.role === "user" &&
      (activePanel === "database" || activePanel === "admin-settings")
    ) {
      setActivePanel("io-general");
    }
  }, [user, activePanel]);

  if (loading) return null;

  if (!isAuthenticated) {
    return <Login />;
  }

return (
  <ToastProvider>
    {/* ✅ ALWAYS SHOW GRAFANA */}
    <GrafanaFrame />

    {/* 🔒 LOGIN OVERLAY */}
    {!isAuthenticated && <Login />}

    {/* 🔧 PANEL (ONLY AFTER LOGIN) */}
    {isAuthenticated && (
      <>

          {/* 🌑 BACKDROP */}
          {open && !fullscreen && (
            <div
              onClick={() => setOpen(false)}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                zIndex: 999,
              }}
            />
          )}

          {/* 🔵 FLOATING BUBBLE */}
          {!open && (
            <div
              onClick={() => setOpen(true)}
              style={{
                position: "fixed",
                bottom: "20px",
                right: "20px",
                width: "100px",
                height: "60px",
                borderRadius: "60%",
                background: "#2563eb",
                color: "white",
                fontSize: "22px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                zIndex: 1000,
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
              }}
            >
              ☰
            </div>
          )}

          {/* 📦 PANEL */}
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: fullscreen ? "100%" : "380px",
              height: "100vh",
              background: "#dfe3ea",
              zIndex: 1001,
              boxShadow: fullscreen ? "none" : "-5px 0 20px rgba(0,0,0,0.5)",
              transform: open ? "translateX(0)" : "translateX(100%)",
              opacity: open ? 1 : 0,
              pointerEvents: open ? "auto" : "none",
              transition: "all 0.3s ease-in-out",
            }}
          >
            {/* 🔧 CONTROL BAR */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "10px" }}>
              <button onClick={() => setFullscreen(!fullscreen)} style={{ fontSize: "16px", cursor: "pointer" }}>
                {fullscreen ? "🗗" : "🗖"}
              </button>
              <button onClick={() => { setOpen(false); setFullscreen(false); }} style={{ fontSize: "18px", cursor: "pointer" }}>
                —
              </button>
            </div>

            {/* 🔥 YOUR EXISTING UI */}
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100% - 40px)" }}>
              <div style={{ flexShrink: 0 }}>
                <WindowBar />
              </div>
              <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                <div style={{ flexShrink: 0 }}>
                  <Sidebar active={activePanel} onSelect={setActivePanel} role={user?.role} />
                </div>
                <main style={{ flex: 1, overflowY: "auto", background: "#f8fafc", minHeight: "100%" }}>
                  <MainPanel panel={activePanel} user={user} />
                </main>
              </div>
            </div>
          </div>
        </>
      )}
    </ToastProvider>
  );
}