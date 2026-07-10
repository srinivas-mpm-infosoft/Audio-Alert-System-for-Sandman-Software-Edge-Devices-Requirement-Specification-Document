import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, X, MapPin } from "lucide-react";
import { getZones } from "../api/devices.api";

export default function ZonePicker({ selected = [], onChange, label = "Zones", disabled = false }) {
  const [open, setOpen] = useState(false);
  const [zones, setZones] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    getZones().then((res) => { if (res.ok) setZones(res.data); });
  }, []);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };

  const selectedZones = zones.filter((z) => selected.includes(z.id));

  return (
    <div ref={ref} className="relative">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">{label}</label>
      {/* A <div role="button"> here, not a <button> — the "Remove" chips
          below are real <button>s, and HTML forbids nesting <button> inside
          <button> (browsers silently break out of it, which was causing a
          React hydration-mismatch warning and unreliable chip clicks). */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen((o) => !o); } }}
        aria-disabled={disabled}
        className={`w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 flex items-center justify-between min-h-[38px] cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {selectedZones.length === 0 ? (
            <span className="text-slate-400">Select zones…</span>
          ) : (
            selectedZones.map((z) => (
              <span key={z.id} className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">
                {z.name}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle(z.id); }}
                  aria-label={`Remove ${z.name}`}
                  className="hover:text-indigo-900"
                >
                  <X size={10} />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto" role="listbox" aria-multiselectable="true">
          {zones.length > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 sticky top-0 bg-white">
              <button
                type="button"
                onClick={() => onChange(zones.map((z) => z.id))}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Select all (plant-wide)
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            </div>
          )}
          {zones.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-400">Loading zones…</div>
          ) : (
            zones.map((z) => {
              const checked = selected.includes(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(z.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-slate-50 transition-colors ${checked ? "text-indigo-700" : "text-slate-700"}`}
                >
                  <MapPin size={12} className="text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{z.name}</span>
                  <span className="text-[10px] text-slate-400">{z.type}</span>
                  {checked && <span className="w-4 h-4 rounded bg-indigo-600 flex items-center justify-center shrink-0">
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none" aria-hidden="true"><path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
