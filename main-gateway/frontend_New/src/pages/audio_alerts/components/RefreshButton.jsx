import React from "react";
import { RefreshCw, Loader2 } from "lucide-react";

export default function RefreshButton({ onClick, loading, title = "Refresh", className = "" }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} title={title} aria-label={title}
      className={`p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-50 ${className}`}>
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
    </button>
  );
}
