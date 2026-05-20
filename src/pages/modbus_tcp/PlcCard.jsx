import React from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import SiemensForm from "./SiemensForm";
import AllenBradleyForm from "./AllenBradleyForm";

const PLC_TYPES = ["Siemens", "Allen Bradley", "Delta"];

export default function PlcCard({ plc, index, role, isReadOnly, onToggle, onTypeChange, onUpdate, onRemove }) {
  const ip = plc.PLC?.cred?.ip || "Not Set";
  const isExpanded = plc.isExpanded ?? true;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <button
          type="button"
          onClick={onToggle}
          className="flex-shrink-0 p-1 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-200 transition-colors"
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-semibold text-slate-700 text-sm">{plc.plcType}</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500 text-xs font-mono truncate">{ip}</span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!plc.enabled}
              disabled={isReadOnly}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-zinc-700"
            />
            <span className="text-xs text-slate-500 font-medium">Enabled</span>
          </label>
          <button
            type="button"
            disabled={isReadOnly}
            onClick={onRemove}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
            title="Remove PLC"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="p-5 space-y-6">

          {/* PLC Type selector */}
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">PLC Type</span>
            <div className="flex rounded-xl border border-slate-200 overflow-hidden w-fit">
              {PLC_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => plc.plcType !== t && onTypeChange(t)}
                  className={`px-4 py-2 text-xs font-semibold border-l border-slate-200 first:border-l-0 transition-colors disabled:cursor-not-allowed ${
                    plc.plcType === t
                      ? "bg-zinc-800 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Type-specific form */}
          {plc.plcType === "Siemens" ? (
            <SiemensForm
              plc={plc.PLC}
              onChange={onUpdate}
              role={role}
              isReadOnly={isReadOnly}
            />
          ) : (
            <AllenBradleyForm
              plc={plc.PLC}
              plcType={plc.plcType}
              onChange={onUpdate}
              role={role}
              isReadOnly={isReadOnly}
            />
          )}
        </div>
      )}
    </div>
  );
}
