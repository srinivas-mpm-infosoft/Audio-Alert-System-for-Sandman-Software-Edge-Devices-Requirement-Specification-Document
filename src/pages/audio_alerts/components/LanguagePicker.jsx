import React from "react";
import { useAppConfigStore } from "../../../store/useAppConfigStore";

export default function LanguagePicker({ value, onChange, label = "Language", includeZoneDefault = false, disabled = false }) {
  const LANGUAGES = useAppConfigStore((s) => s.languages);
  const options = includeZoneDefault
    ? [{ code: null, label: "Use zone default", flag: "🔁" }, ...LANGUAGES]
    : LANGUAGES;

  return (
    <div>
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">{label}</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 disabled:opacity-50"
      >
        {options.map((l) => (
          <option key={l.code ?? "default"} value={l.code ?? ""}>
            {l.flag} {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
