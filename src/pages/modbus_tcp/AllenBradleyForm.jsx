import React from "react";
import { X } from "lucide-react";
import DBSettings from "../DBSettings";
import { convertFromSec, convertToSec, normalizeAllenBradleyRow } from "./helpers";

const TYPES = ["FLOAT","DINT", "INT", "REAL", "BOOL", "STRING"];

const inp = "w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400";
const th = "text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 py-2 whitespace-nowrap";
const td = "px-2 py-1.5 align-middle";

export default function AllenBradleyForm({ plc, plcType, onChange, role, isReadOnly }) {
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

  const updRow = (i, field, rawValue) => {
    const value = field === "value"
      ? String(Math.min(100, Math.max(0, Number(rawValue) || 0)))
      : rawValue;
    onChange((p) => {
      const read = [...(p.PLC.address_access?.read ?? [])];
      read[i] = { ...read[i], [field]: value };
      return { ...p, PLC: { ...p.PLC, address_access: { ...p.PLC.address_access, read } } };
    });
  };

  const addRow = () =>
    onChange((p) => ({
      ...p,
      PLC: {
        ...p.PLC,
        address_access: {
          ...p.PLC.address_access,
          read: [...(p.PLC.address_access?.read ?? []), normalizeAllenBradleyRow({})],
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-400 mb-1 block">IP Address</label>
            <input
              type="text"
              value={plc.cred?.ip ?? ""}
              placeholder="192.168.1.200"
              disabled={isReadOnly}
              onChange={(e) => updCred("ip", e.target.value)}
              className={inp}
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-400 mb-1 block">Port</label>
            <input
              type="number"
              value={plc.cred?.port ?? 44818}
              disabled={isReadOnly}
              onChange={(e) => updCred("port", Number(e.target.value))}
              className={inp}
            />
          </div>
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
        prefix="ab"
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
          <table className="w-full text-xs" style={{ minWidth: 680 }}>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Tag", "Address", "Type", "Length", "Min", "Max", "Output %", "Read", "Write", ""].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-400 italic text-xs">
                    No tags configured. Click &quot;+ Add Tag&quot; to start.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const hideRange = r.datatype === "STRING" || r.datatype === "BOOL";
                return (
                  <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                    <td className={td}>
                      <input
                        value={r.tag ?? ""}
                        placeholder="Tag"
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "tag", e.target.value)}
                        className={inp}
                      />
                    </td>
                    <td className={td}>
                      <input
                        value={r.address ?? ""}
                        placeholder="N7:0"
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "address", e.target.value)}
                        className={`${inp} w-24`}
                      />
                    </td>
                    <td className={td}>
                      <select
                        value={r.datatype ?? "FLOAT"}
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "datatype", e.target.value)}
                        className={`${inp} w-20`}
                      >
                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        value={r.length ?? 1}
                        min="1"
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "length", Number(e.target.value))}
                        className={`${inp} w-14`}
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
                        type="number"
                        min="0"
                        max="100"
                        value={r.value ?? ""}
                        placeholder="0–100"
                        disabled={isReadOnly}
                        onChange={(e) => updRow(i, "value", e.target.value)}
                        className={`${inp} w-16`}
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
