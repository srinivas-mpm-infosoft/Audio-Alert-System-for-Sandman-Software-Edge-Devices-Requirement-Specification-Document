import { LogOut } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { EXISTING_ROLE_MAP, ROLES } from "../pages/audio_alerts/utils/constants";

export default function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const name = user?.username || "User";
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const rbacRole = EXISTING_ROLE_MAP[user?.role] ?? user?.role ?? "operator";
  const roleLabel = ROLES.find((r) => r.id === rbacRole)?.label ?? "User";

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-emerald-600 text-white">{initials}</span>
      <div className="hidden sm:block leading-tight min-w-0">
        <div className="text-[13px] font-bold text-white truncate max-w-[9rem]">{name}</div>
        <div className="text-[11px] text-zinc-400 truncate">{roleLabel}</div>
      </div>
      <button onClick={logout} title="Log out" aria-label="Log out" className="text-zinc-500 hover:text-zinc-200 ml-1 shrink-0">
        <LogOut className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
}
