import { LogOut } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";

export default function UserMenu({ variant = "navbar" }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const name = user?.username || "User";
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const dark = variant === "sidebar";

  return (
    <div className="flex items-center gap-2 min-w-0" style={{ color: dark ? "#e2e8f0" : "#1f2937" }}>
      <div
        title={name}
        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
        style={{ background: dark ? "#2563eb33" : "#2563eb22", color: dark ? "#93c5fd" : "#2563eb" }}
      >
        {initials}
      </div>
      <span className="text-sm font-medium truncate">{name}</span>
      <button
        onClick={logout}
        title="Log out"
        className="flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 hover:bg-black/10"
        style={{ color: "#dc2626" }}
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
