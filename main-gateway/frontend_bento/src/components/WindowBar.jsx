import { Search, Bell, Hourglass } from "lucide-react";
import UserMenu from "./UserMenu";

export default function WindowBar() {
  return (
    <header className="h-16 shrink-0 bg-zinc-800 border-b border-zinc-700 flex items-center">
      <div className="w-56 shrink-0 h-full flex items-center gap-2.5 px-5 border-r border-zinc-700/60">
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#1c6b47,#0d3a26)" }}
        >
          <Hourglass className="w-4.5 h-4.5 text-white" strokeWidth={2.25} />
        </span>
        <div className="text-[13px] font-bold text-white leading-tight">
          Audio Alert &amp;<br />Information System
        </div>
      </div>

      <div className="flex-1 flex items-center gap-4 px-6 min-w-0">
        <div className="flex items-center gap-2 bg-zinc-700 border border-zinc-600 rounded-full px-4 py-2.5 w-full max-w-sm text-zinc-400">
          <Search className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span className="text-sm truncate">Search zones, SOPs, devices…</span>
        </div>

        <div className="ml-auto flex items-center gap-4 shrink-0">
          <button
            aria-label="Notifications"
            className="relative w-10 h-10 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-600 transition-colors"
          >
            <Bell className="w-4 h-4" strokeWidth={2} />
          </button>
          <div className="w-px h-8 bg-zinc-700" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
