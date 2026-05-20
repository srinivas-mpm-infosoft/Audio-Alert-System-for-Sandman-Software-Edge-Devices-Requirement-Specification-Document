import React from "react";
import { X } from "lucide-react";
import DBSettings from "../DBSettings";
import { convertFromSec, convertToSec, normalizeSiemensRow } from "./helpers";

const TYPES = ["float", "dint", "int", "real", "bool", "string"];

const inp = "w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400";
const th = "text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2 whitespace-nowrap";
const td = "px-2 py-1.5 align-middle";

export default function SiemensForm({ plc, onChange, role, isReadOnly }) {
  const rows = plc.address_access?.read ?? [];
  const displayFreq = convertFromSec(plc.data_freq_sec ?? 1, plc.data_freq_unit ?? "sec");

  const updCred = (field, value) =>
    onChange((p) => ({
      ...p,
      PLC: { ...p.PLC, cred: { ...p.PLC.cred, [field]: value } },
    }));

  const updFreqValue = (val) =>
    onChange((p) => ({
      ...p,
      PLC: { ...p.PLC, data_freq_sec: convertToSec(Number(val) || 0, p.PLC.data_freq_unit) },
    }));

  const updFreqUnit = (unit) =>
    onChange((p) => ({ ...p, PLC: { ...p.PLC, data_freq_unit: unit } }));

  const updDB = (field, value) =>
    onChange((p) => ({
      ...p,
      PLC: { ...p.PLC, Database: { ...p.PLC.Database, [field]: value } },
    }));

  const updRow = (i, field, value) =>
    onChange((p) => {
      const read = [...(p.PLC.address_access?.read ?? [])];
      read[i] = { ...read[i], [field]: value };
      return { ...p, PLC: { ...p.PLC, address_access: { ...p.PLC.address_access, read } } };
    });

  const addRow = () =>
    onChange((p) => ({
      ...p,
      PLC: {
        ...p.PLC,
        address_access: {
          ...p.PLC.address_access,
          read: [...(p.PLC.address_access?.read ?? []), normalizeSiemensRow({})],
        },
      },
    }));

  const removeRow = (i) =>
    onChange((p) => ({
      ...p,
      PLC: {
        ...p.PLC,
        address_access: {
          ...p.PLC.address_access,
          read: (p.PLC.address_access?.read ?? []).filter((_, idx) => idx !== i),
        },
      },
    }));

  return (
    <div className="space-y-5">

      {/* Credentials */}
      <div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Credentials</span>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "IP Address", field: "ip", type: "text", placeholder: "192.168.0.1" },
            { label: "Rack", field: "rack", type: "number", placeholder: "0" },
            { label: "Slot", field: "slot", type: "number", placeholder: "2" },
          ].map(({ label, field, type, placeholder }) => (
            <div key={field}>
              <label className="text-[10px] text-slate-400 mb-1 block">{label}</label>
              <input
                type={type}
                value={plc.cred?.[field] ?? ""}
                placeholder={placeholder}
                disabled={isReadOnly}
                onChange={(e) =>
                  updCred(field, type === "number" ? Number(e.target.value) : e.target.value)
                }
                className={inp}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Polling */}
      <div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Polling Interval</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={displayFreq}
            disabled={isReadOnly}
            onChange={(e) => updFreqValue(e.target.value)}
            className={`${inp} w-28`}
          />
          <select
            value={plc.data_freq_unit ?? "sec"}
            disabled={isReadOnly}
            onChange={(e) => updFreqUnit(e.target.value)}
            className={`${inp} w-24`}
          >
            <option value="sec">Sec</option>
            <option value="min">Min</option>
            <option value="hour">Hour</option>
          </select>
        </div>
      </div>

      {/* DB Settings */}
      <DBSettings
        prefix="siemens"
        db={plc.Database}
        role={role}
        isReadOnly={isReadOnly}
        onChange={updDB}
      />

      {/* Tag Map */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tag Map</span>
          <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {rows.length} tag{rows.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs" style={{ minWidth: 720 }}>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Tag Name", "DB No.", "Address", "Type", "Size (bytes)", "Min", "Max", "Value", "Read", "Write", ""].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-slate-400 italic text-xs">
                    No tags configured. Click &quot;+ Add Tag&quot; to start.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const hideRange = r.type === "string" || r.type === "bool";
                return (
                  <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                    <td className={td}>
                      <input
                        value={r.content ?? ""}
                        placeholder="Tag name"
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "content", e.target.value)}
                        className={inp}
                      />
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        value={r.DB_no ?? 0}
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "DB_no", Number(e.target.value))}
                        className={`${inp} w-14`}
                      />
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        value={r.address ?? 0}
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "address", Number(e.target.value))}
                        className={`${inp} w-16`}
                      />
                    </td>
                    <td className={td}>
                      <select
                        value={r.type ?? "float"}
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "type", e.target.value)}
                        className={`${inp} w-20`}
                      >
                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        min="1"
                        value={r.size ?? ""}
                        placeholder="—"
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "size", e.target.value)}
                        className={`${inp} w-16`}
                      />
                    </td>
                    <td className={td}>
                      {hideRange
                        ? <span className="text-slate-300 text-xs px-2">—</span>
                        : <input type="number" value={r.min ?? ""} disabled={isReadOnly} onChange={(e) => updRow(i, "min", e.target.value)} className={`${inp} w-16`} />}
                    </td>
                    <td className={td}>
                      {hideRange
                        ? <span className="text-slate-300 text-xs px-2">—</span>
                        : <input type="number" value={r.max ?? ""} disabled={isReadOnly} onChange={(e) => updRow(i, "max", e.target.value)} className={`${inp} w-16`} />}
                    </td>
                    <td className={td}>
                      <input
                        value={r.value ?? ""}
                        placeholder="—"
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "value", e.target.value)}
                        className={`${inp} w-20`}
                      />
                    </td>
                    <td className={`${td} text-center`}>
                      <input
                        type="checkbox"
                        checked={r.read !== false}
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "read", e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-zinc-700"
                      />
                    </td>
                    <td className={`${td} text-center`}>
                      <input
                        type="checkbox"
                        checked={!!r.write}
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "write", e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-zinc-700"
                      />
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => removeRow(i)}
                        className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Remove row"
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          disabled={isReadOnly}
          onClick={addRow}
          className="mt-2 w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-500 hover:border-zinc-400 hover:text-zinc-700 hover:bg-white transition-colors disabled:opacity-50"
        >
          + Add Tag
        </button>
      </div>
    </div>
  );
}
