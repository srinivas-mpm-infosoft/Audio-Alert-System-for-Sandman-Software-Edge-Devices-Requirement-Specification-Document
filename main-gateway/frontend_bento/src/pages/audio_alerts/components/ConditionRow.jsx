import React from "react";
import { Trash2 } from "lucide-react";
import { OPERATORS } from "../utils/constants";
import { useAppConfigStore } from "../../../store/useAppConfigStore";

export default function ConditionRow({ condition, onChange, onRemove, index, canRemove = true }) {
  const PARAMETERS = useAppConfigStore((s) => s.parameters);
  const param = PARAMETERS.find((p) => p.id === condition.parameter);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {index > 0 && (
        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded w-10 text-center flex-shrink-0">AND</span>
      )}

      {/* Parameter */}
      <select
        value={condition.parameter}
        onChange={(e) => onChange({ ...condition, parameter: e.target.value, unit: PARAMETERS.find((p) => p.id === e.target.value)?.unit ?? "" })}
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700 flex-1 min-w-[160px]"
        aria-label="Parameter"
      >
        <option value="">Select parameter…</option>
        {PARAMETERS.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>

      {/* Operator */}
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700 w-32"
        aria-label="Operator"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>

      {/* Value(s) */}
      {(condition.operator === "between" || condition.operator === "outside range") ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={Array.isArray(condition.value) ? condition.value[0] : ""}
            onChange={(e) => onChange({ ...condition, value: [+e.target.value, Array.isArray(condition.value) ? condition.value[1] : 0] })}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700 w-24"
            placeholder="Min"
            aria-label="Min value"
          />
          <span className="text-slate-400 text-xs">–</span>
          <input
            type="number"
            value={Array.isArray(condition.value) ? condition.value[1] : ""}
            onChange={(e) => onChange({ ...condition, value: [Array.isArray(condition.value) ? condition.value[0] : 0, +e.target.value] })}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700 w-24"
            placeholder="Max"
            aria-label="Max value"
          />
        </div>
      ) : (
        <input
          type="number"
          value={condition.value ?? ""}
          onChange={(e) => onChange({ ...condition, value: e.target.value === "" ? "" : +e.target.value })}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700 w-28"
          placeholder="Value"
          aria-label="Threshold value"
        />
      )}

      {/* Unit */}
      {param?.unit && (
        <span className="text-xs text-slate-400 font-mono w-10">{param.unit}</span>
      )}

      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
          aria-label="Remove condition"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
