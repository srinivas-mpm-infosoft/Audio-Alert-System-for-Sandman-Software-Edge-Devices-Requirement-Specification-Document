import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function StatCard({ label, value, delta, deltaLabel, icon: Icon, iconColor = "#6366f1", iconBg = "#eef2ff", unit = "" }) {
  const isPositive = delta > 0;
  const isNeutral = delta === 0 || delta === undefined || delta === null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
            <Icon size={16} style={{ color: iconColor }} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold text-slate-900 leading-none">{value ?? "—"}</span>
        {unit && <span className="text-sm text-slate-400 mb-0.5">{unit}</span>}
      </div>
      {!isNeutral && (
        <div className={`flex items-center gap-1 text-xs font-medium ${isPositive ? "text-red-500" : "text-emerald-600"}`}>
          {isPositive ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />}
          <span>{isPositive ? "+" : ""}{delta} {deltaLabel ?? "vs last hour"}</span>
        </div>
      )}
      {isNeutral && <div className="flex items-center gap-1 text-xs text-slate-400"><Minus size={12} aria-hidden="true" /><span>No change</span></div>}
    </div>
  );
}
