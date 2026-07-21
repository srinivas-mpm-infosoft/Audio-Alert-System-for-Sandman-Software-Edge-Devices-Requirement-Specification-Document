import React from "react";
import AlertTypePicker from "./AlertTypePicker";

const INPUT = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-gray-700";
const LABEL = "text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block";

// requires_ack_override tri-state: null = "use the alert type's setting", true/false = explicit override.
const ACK_OPTIONS = [
  { v: "", l: "Use alert type's setting" },
  { v: "true", l: "Require acknowledgement" },
  { v: "false", l: "Auto-acknowledge (no ack needed)" },
];

// value: { type_code, play_count_override, requires_ack_override }
export default function AlertTypeOverrideFields({ value, onChange, typeLabel = "Alert Type", defaultTypeLabel = "Default" }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const hasOverride = value.type_code != null || value.play_count_override != null || value.requires_ack_override != null;

  return (
    <details open={hasOverride} className="group">
      <summary className="text-xs font-semibold text-emerald-800 cursor-pointer select-none list-none marker:content-none inline-flex items-center gap-1">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>
        Advanced: alert type, play count, acknowledgement
      </summary>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <AlertTypePicker value={value.type_code} onChange={(v) => set("type_code", v)} label={typeLabel} placeholderLabel={defaultTypeLabel} />

        <div>
          <label className={LABEL}>Play Count Override</label>
          <input
            type="number" min={1} className={INPUT}
            value={value.play_count_override ?? ""}
            placeholder="Use alert type's setting"
            onChange={(e) => set("play_count_override", e.target.value === "" ? null : Math.max(1, +e.target.value || 1))}
          />
        </div>

        <div>
          <label className={LABEL}>Acknowledgement</label>
          <select
            className={INPUT}
            value={value.requires_ack_override === null || value.requires_ack_override === undefined ? "" : String(value.requires_ack_override)}
            onChange={(e) => set("requires_ack_override", e.target.value === "" ? null : e.target.value === "true")}
          >
            {ACK_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
      </div>
    </details>
  );
}
