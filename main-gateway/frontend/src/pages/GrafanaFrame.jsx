import { useEffect, useState } from "react";

export default function GrafanaFrame() {
  const [theme, setTheme] = useState("dark");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === "SET_THEME") {
        setLoading(true);
        setTheme(event.data.theme);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
      }}
    >
      <iframe
        key={theme}
        src={`http://localhost:3000/d/adws7bj/mixer-diagram?kiosk&theme=light`}
        onLoad={() => setLoading(false)}
        style={{
          width: "125%",            // compensate for scale
          height: "120vh",
          border: "none",

          transform: "scale(0.8)", // 👈 zoom out
          transformOrigin: "top left",

          opacity: loading ? 0 : 1,
          transition: "opacity 0.2s ease",
        }}
      />
    </div>
  );
}