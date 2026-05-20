import React from "react";
import { Bell } from "lucide-react";

/**
 * RegisterTable – register row table for a Modbus RTU slave.
 *
 * Mode column (after Offset) controls Read vs Write behaviour:
 *   Read  → Process Range min/max shown; Write Type and Write Fields show "—"
 *   Write → Process Range shows "—"; Write Type dropdown (Independent / Alert) appears;
 *             Independent + BOOLEAN      → True / False select
 *             Independent + other types  → Min, Max, Write % inputs
 *             Alert                      → Min, Max inputs (synced to Alert modal limits)
 */

// Only BOOLEAN data type uses a true/false toggle; all others use numeric range + %
const BOOL_TYPES = ["BOOLEAN"];

const Dash = () => <span className="text-slate-300 text-xs">—</span>;

export default function RegisterTable({
  rows,
  engineeringConfig,
  isSuperAdmin,   // kept for future use
  isReadOnly,
  onRowChange,
  onRemoveRow,
  onAlertOpen,
}) {
  const engCfgList = engineeringConfig || [];

  const thCls = "px-3 py-2.5 text-left text-[11px] font-semibold text-zinc-300 uppercase tracking-wider whitespace-nowrap";
  const tdCls = "px-2 py-1.5 border-b border-slate-100 w-20";
  const inputCls = "border border-slate-200 rounded-md px-2 py-1 text-xs bg-white focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 w-full disabled:bg-slate-50 disabled:text-slate-400 text-slate-700";
  const selectCls = `${inputCls}`;

  return (
    <table className="w-full text-xs border-collapse" style={{ minWidth: 1400 }}>
      <thead>
        <tr className="bg-zinc-800 text-center">
          <th className={thCls}>S. NO</th>
          <th className={`${thCls} text-center`}>Enable</th>
          <th className={thCls}>Name</th>
          <th className={thCls}>Start Addr</th>
          <th className={thCls}>Offset</th>
          <th className={thCls}>Mode</th>
          <th className={thCls}>Register Type</th>
          <th className={thCls}>Sensor Type</th>
          <th className={thCls}>Eng Symbol</th>
          <th className={thCls}>Elec. Range</th>
          {/* <th className={thCls}>Data Type</th> */}
          <th className={thCls}>Length</th>
          {/* <th className={thCls}>Multiply</th>
          <th className={thCls}>Divide</th> */}
          {/* Read-only column */}
          <th className={thCls}>Process Range</th>
          {/* Write-only columns */}
          <th className={thCls}>Write Type</th>
          <th className={thCls}>Write Fields</th>
          <th className={`${thCls} text-center`}>Control</th>
          <th className={`${thCls} text-center`}>Delete</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const cfg = engCfgList.find((e) => e.type === r.sensor_type);
          const rowBg = i % 2 === 0 ? "bg-white" : "bg-gray-50/80";
          const hasAlert = (r.alerts ?? []).some(a => a.enabled);
          const isWrite = r.mode === "write";
          const isBool = BOOL_TYPES.includes(r.sql_type);

          return (
            <tr key={i} className={`${rowBg} hover:bg-zinc-50/80 transition-colors group`}>
              {/* S.No */}
              <td className={`${tdCls} text-center text-slate-400 font-medium w-8`}>{i + 1}</td>

              {/* Enable/Disable */}
              <td className={`${tdCls} text-center`}>
                <input
                  type="checkbox"
                  checked={r.enabled !== false}
                  disabled={isReadOnly}
                  onChange={(e) => onRowChange(i, "enabled", e.target.checked)}
                  className="h-4 w-4 rounded accent-zinc-700 cursor-pointer disabled:cursor-not-allowed"
                  title={r.enabled !== false ? "Disable register" : "Enable register"}
                />
              </td>

              {/* Name */}
              <td className={tdCls}>
                <input
                  type="text"
                  value={r.name ?? ""}
                  disabled={isReadOnly}
                  style={{ width: 160 }}
                  onChange={(e) => onRowChange(i, "name", e.target.value)}
                  className={inputCls}
                />
              </td>

              {/* Start Address */}
              <td className={tdCls}>
                <input
                  type="number"
                  value={r.start ?? ""}
                  disabled={isReadOnly}
                  style={{ width: 80 }}
                  onChange={(e) => onRowChange(i, "start", e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className={inputCls}
                />
              </td>

              {/* Offset */}
              <td className={tdCls}>
                <input
                  type="number"
                  value={r.offset ?? 0}
                  disabled={isReadOnly}
                  style={{ width: 60 }}
                  onChange={(e) => onRowChange(i, "offset", parseInt(e.target.value, 10) || 0)}
                  className={inputCls}
                />
              </td>

              {/* Mode (Read / Write) */}
              <td className={tdCls}>
                <select
                  value={r.mode ?? "read"}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    const m = e.target.value;
                    onRowChange(i, { mode: m, read: m === "read", write: m === "write" });
                  }}
                  className={selectCls}
                  style={{ width: 75 }}
                >
                  <option value="read">Read</option>
                  <option value="write">Write</option>
                </select>
              </td>

              {/* Register Type */}
              <td className={tdCls}>
                <select
                  value={r.type ?? "Input Register"}
                  disabled={isReadOnly}
                  onChange={(e) => onRowChange(i, "type", e.target.value)}
                  className={selectCls}
                  style={{ width: 130 }}
                >
                  <option>Coil</option>
                  <option>Discrete Input</option>
                  <option>Holding Register</option>
                  <option>Input Register</option>
                </select>
              </td>

              {/* Sensor Type */}
              <td className={tdCls}>
                <select
                  value={r.sensor_type ?? ""}
                  disabled={isReadOnly}
                  onChange={(e) => {
                    const newType = e.target.value;
                    const newCfg = engCfgList.find((ec) => ec.type === newType);
                    onRowChange(i, { sensor_type: newType, eng_symbol: newCfg?.symbols?.[0] ?? "" });
                  }}
                  className={selectCls}
                  style={{ width: 110 }}
                >
                  <option value="">— Select —</option>
                  {engCfgList.map((ec) => (
                    <option key={ec.type} value={ec.type}>{ec.type}</option>
                  ))}
                </select>
              </td>

              {/* Engineering Symbol */}
              <td className={tdCls}>
                {cfg && cfg.symbols.length > 0 ? (
                  <select
                    value={r.eng_symbol ?? ""}
                    disabled={isReadOnly}
                    onChange={(e) => onRowChange(i, "eng_symbol", e.target.value)}
                    className={selectCls}
                    style={{ width: 80 }}
                  >
                    {cfg.symbols.map((sym) => (
                      <option key={sym} value={sym}>{sym}</option>
                    ))}
                  </select>
                ) : (
                  <Dash />
                )}
              </td>

              {/* Electrical Range (eng_unit) */}
              <td className={tdCls}>
                <select
                  value={r.eng_unit ?? "4-20mA"}
                  disabled={isReadOnly}
                  onChange={(e) => onRowChange(i, "eng_unit", e.target.value)}
                  className={selectCls}
                  style={{ width: 100 }}
                >
                  <option value="4-20mA">4–20 mA</option>
                  <option value="0-20mA">0–20 mA</option>
                  <option value="0-10V">0–10 V</option>
                  <option value="0-5V">0–5 V</option>
                  <option value="1-5V">1–5 V</option>
                  <option value="none">None</option>
                </select>
              </td>

              {/* Data Type (sql_type) */}
              {/* <td className={tdCls}>
                <select
                  value={r.sql_type ?? "FLOAT"}
                  disabled={isReadOnly}
                  onChange={(e) => onRowChange(i, "sql_type", e.target.value)}
                  className={selectCls}
                  style={{ width: 90 }}
                >
                  <option>FLOAT</option>
                  <option>INT</option>
                  <option>BIGINT</option>
                  <option>BOOLEAN</option>
                </select>
              </td> */}

              {/* Length */}
              <td className={tdCls}>
                <input
                  type="number"
                  value={r.length ?? 2}
                  disabled={isReadOnly}
                  style={{ width: 55 }}
                  onChange={(e) => onRowChange(i, "length", parseInt(e.target.value, 10) || 2)}
                  className={inputCls}
                />
              </td>

              {/* Multiply */}
              {/* <td className={tdCls}>
                <input
                  type="number"
                  step="any"
                  value={r.multiply ?? 1}
                  disabled={isReadOnly}
                  style={{ width: 65 }}
                  onChange={(e) => onRowChange(i, "multiply", parseFloat(e.target.value) || 1)}
                  className={inputCls}
                />
              </td> */}

              {/* Divide */}
              {/* <td className={tdCls}>
                <input
                  type="number"
                  step="any"
                  value={r.divide ?? 1}
                  disabled={isReadOnly}
                  style={{ width: 65 }}
                  onChange={(e) => onRowChange(i, "divide", parseFloat(e.target.value) || 1)}
                  className={inputCls}
                />
              </td> */}

              {/* ── Process Range — only meaningful for Read rows ── */}
              <td className={tdCls}>
                {!isWrite ? (
                  <div className="flex gap-1">
                    <input
                      type="number"
                      placeholder="Min"
                      style={{ width: 60 }}
                      value={r.process_min ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) => onRowChange(i, "process_min", e.target.value)}
                      className={inputCls}
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      style={{ width: 60 }}
                      value={r.process_max ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) => onRowChange(i, "process_max", e.target.value)}
                      className={inputCls}
                    />
                  </div>
                ) : <Dash />}
              </td>

              {/* ── Write Type — only meaningful for Write rows ── */}
              <td className={tdCls}>
                {isWrite ? (
                  <select
                    value={r.write_mode ?? "independent"}
                    disabled={isReadOnly}
                    onChange={(e) => onRowChange(i, "write_mode", e.target.value)}
                    className={selectCls}
                    style={{ width: 115 }}
                  >
                    <option value="independent">UnAssigned</option>
                    <option value="alert">Assigned</option>
                  </select>
                ) : <Dash />}
              </td>

              {/* ── Write Fields — only meaningful for Write rows ── */}
              <td className={tdCls}>
                {isWrite ? (
                  <div className="flex gap-1 items-center">
                    {r.write_mode === "independent" ? (
                      isBool ? (
                        // Independent + BOOLEAN: true / false toggle
                        <select
                          value={r.write_boolean ?? "true"}
                          disabled={isReadOnly}
                          onChange={(e) => onRowChange(i, "write_boolean", e.target.value)}
                          className={selectCls}
                          style={{ width: 80 }}
                        >
                          <option value="true">NO</option>
                          <option value="false">NC</option>
                        </select>
                      ) : (
                        // Independent + FLOAT / INT / BIGINT : Min, Max, Write %
                        <>
                          <input
                            type="number"
                            placeholder="Min"
                            style={{ width: 60 }}
                            value={r.write_min_reg ?? ""}
                            disabled={isReadOnly}
                            onChange={(e) => onRowChange(i, "write_min_reg", e.target.value)}
                            className={inputCls}
                          />
                          <input
                            type="number"
                            placeholder="Max"
                            style={{ width: 60 }}
                            value={r.write_max_reg ?? ""}
                            disabled={isReadOnly}
                            onChange={(e) => onRowChange(i, "write_max_reg", e.target.value)}
                            className={inputCls}
                          />
                          <input
                            type="number"
                            placeholder="Write%"
                            style={{ width: 62 }}
                            min={0}
                            max={100}
                            value={r.write_pct ?? ""}
                            disabled={isReadOnly}
                            onChange={(e) => onRowChange(i, "write_pct", e.target.value)}
                            className={inputCls}
                          />
                        </>
                      )
                    ) : isBool ? (
                      // Alert + BOOLEAN: no threshold inputs needed — alert fires on any change
                      <span className="text-[10px] text-slate-400 italic">Triggers on change</span>
                    ) : (
                      // Alert + non-BOOLEAN: min and max thresholds — synced to Alert modal
                      <>
                        <input
                          type="number"
                          placeholder="Min"
                          style={{ width: 65 }}
                          value={r.write_min_reg ?? ""}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const val = e.target.value;
                            onRowChange(i, {
                              write_min_reg: val,
                              alert: { ...r.alert, lower_limit: val === "" ? "" : Number(val), enabled: true },
                            });
                          }}
                          className={inputCls}
                        />
                        <input
                          type="number"
                          placeholder="Max"
                          style={{ width: 65 }}
                          value={r.write_max_reg ?? ""}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const val = e.target.value;
                            onRowChange(i, {
                              write_max_reg: val,
                              alert: { ...r.alert, upper_limit: val === "" ? "" : Number(val), enabled: true },
                            });
                          }}
                          className={inputCls}
                        />
                      </>
                    )}
                  </div>
                ) : null}
              </td>

              {/* Alert Settings — hidden for write registers */}
              <td className={`${tdCls} text-center`}>
                {!isWrite && (
                  <button
                    type="button"
                    title="Alert Settings"
                    onClick={() => onAlertOpen(i)}
                    className={`inline-flex items-center justify-center p-1.5 rounded-md transition-colors ${
                      hasAlert
                        ? "bg-amber-100 text-amber-600 hover:bg-amber-200"
                        : "text-slate-700 hover:text-amber-500 hover:bg-amber-50"
                    }`}
                  >
                    <Bell size={13} strokeWidth={hasAlert ? 2.5 : 1.5} />
                  </button>
                )}
              </td>

              {/* Remove */}
              <td className={`${tdCls} text-center`}>
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={() => onRemoveRow(i)}
                  className="inline-flex items-center justify-center p-1.5 rounded-md text-red-700 bg-rose-50 transition-colors disabled:opacity-30"
                >
                  ×
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
