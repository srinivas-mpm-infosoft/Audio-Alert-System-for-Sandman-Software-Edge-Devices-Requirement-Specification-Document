import React, { useEffect, useState } from "react";
import { getAlertTypes } from "../api/audio.api";

export default function AlertTypePicker({ value, onChange, label = "Alert Type", placeholderLabel = "Default" }) {
  const [types, setTypes] = useState([]);

  useEffect(() => {
    getAlertTypes().then((res) => { if (res.ok) setTypes(res.data); });
  }, []);

  const alerts = types.filter((t) => t.category !== "information");
  const information = types.filter((t) => t.category === "information");

  return (
    <div>
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">{label}</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700"
      >
        <option value="">{placeholderLabel}</option>
        {alerts.length > 0 && (
          <optgroup label="Alerts">
            {alerts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </optgroup>
        )}
        {information.length > 0 && (
          <optgroup label="Information">
            {information.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </optgroup>
        )}
      </select>
    </div>
  );
}
