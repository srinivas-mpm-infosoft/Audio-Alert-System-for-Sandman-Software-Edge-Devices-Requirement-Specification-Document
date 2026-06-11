import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle, X, RefreshCw, Save } from "lucide-react";
import { useToast } from "../components/ToastContext";
import { targetUrl } from "../config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

const DEFAULT_ENG_UNITS = [
  { type: "temperature", symbols: ["°C", "°F"] },
  { type: "flow",        symbols: ["L/min", "m³/h"] },
  { type: "pressure",    symbols: ["bar", "psi", "Pa"] },
  { type: "level",       symbols: ["%", "m"] },
  { type: "energy",      symbols: ["kWh", "Wh"] },
  { type: "voltage",     symbols: ["V"] },
  { type: "current",     symbols: ["A", "mA"] },
];

function ensureBase(cfg) {
  const next = deepClone(cfg ?? {});
  next.adminSettings ??= {};
  next.adminSettings.mailBody ??= {};
  next.adminSettings.mailBody.analog     ??= "";
  next.adminSettings.mailBody.digital    ??= "";
  next.adminSettings.mailBody.modbus_rtu ??= "";
  next.adminSettings.mailBody.plc        ??= "";
  if (!Array.isArray(next.adminSettings.rs485Ports))
    next.adminSettings.rs485Ports = [];
  if (!Array.isArray(next.adminSettings.engineeringUnits))
    next.adminSettings.engineeringUnits = DEFAULT_ENG_UNITS;
  next.smtp     ??= { server: "", port: 587, user: "", password: "" };
  next.ioSettings ??= {};
  next.ioSettings.analog       ??= {};
  next.ioSettings.analog.generate_random ??= false;
  next.ioSettings.digitalInput ??= {};
  next.ioSettings.digitalInput.generate_random ??= false;
  return next;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------
const inp = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400";
const lbl = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";

const DEFAULT_SYS_CONFIG = {
  app: {
    server_host: "0.0.0.0", server_port: 8000,
    log_root: "/home/recomputer/logs",
    session_lifetime_days: 365, cookie_secure: false, cookie_samesite: "Lax"
  },
  database: { host: "localhost", port: 3306, name: "users", user: "gateway", password: "" },
  cors_origins: [],
  gpio_pins: {},
  alerts_limits: { audit_log_max: 2000, alert_log_max: 2000, rule_test_default_minutes: 5 },
  shifts: {
    Morning:   { start: "06:00", end: "14:00" },
    Afternoon: { start: "14:00", end: "22:00" },
    Night:     { start: "22:00", end: "06:00" },
  },
};

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------
function MailBodyEditor({ value, disabled, onChange }) {
  return (
    <div className="space-y-2">
      <label className={lbl}>Mail Body</label>
      <textarea rows={6} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        placeholder="Email message template…"
        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400 resize-y" />
    </div>
  );
}

function RandomCheckbox({ label, checked, disabled, onChange }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 accent-zinc-700" />
      <span className="text-sm text-slate-600 font-medium">{label}</span>
    </label>
  );
}

function SubTabBar({ tabs, active, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mb-5 pb-4 border-b border-slate-100">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${active === t.key ? "bg-zinc-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
const MAIN_TABS = [
  { key: "smtp",        label: "SMTP" },
  { key: "modbus_rtu",  label: "Modbus RTU" },
  { key: "modbus_tcp",  label: "Modbus TCP" },
  { key: "system",      label: "System" },
  { key: "shift_times", label: "Shift Times" },
];

const RTU_SUBTABS = [
  { key: "mail",        label: "Mail Body" },
  { key: "rs485",       label: "RS485 Ports" },
  { key: "engineering", label: "Engineering Units" },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AdminSettings({ isReadOnly }) {
  const showToast = useToast();

  const [config,   setConfig]   = useState(null);
  const [localCfg, setLocalCfg] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab]   = useState("smtp");
  const [rtuSubTab, setRtuSubTab]   = useState("mail");

  // System config state
  const [sysCfg,    setSysCfg]    = useState(null);
  const [sysLocal,  setSysLocal]  = useState(null);
  const [sysLoading,setSysLoading]= useState(false);
  const [sysSaving, setSysSaving] = useState(false);
  const [newOrigin,  setNewOrigin]  = useState("");
  const [newGpioName,setNewGpioName]= useState("");
  const [newGpioPin, setNewGpioPin] = useState("");

  // Shift times state (from system config)
  const [shiftLocal, setShiftLocal] = useState(null);
  const [shiftSaving,setShiftSaving]= useState(false);

  useEffect(() => {
    fetch(`${targetUrl}/config`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        const base = ensureBase(data);
        setConfig(base); setLocalCfg(base); setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Fetch system config (lazy — only when needed)
  useEffect(() => {
    if ((activeTab !== "system" && activeTab !== "shift_times") || sysCfg !== null) return;
    setSysLoading(true);
    fetch(`${targetUrl}/system-config`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const data = d.data ?? DEFAULT_SYS_CONFIG;
        setSysCfg(data);
        setSysLocal(deepClone(data));
        const sc = d.data ?? DEFAULT_SYS_CONFIG;
        setShiftLocal(deepClone(sc.shifts ?? DEFAULT_SYS_CONFIG.shifts));
      })
      .catch(() => {
        setSysCfg(DEFAULT_SYS_CONFIG);
        setSysLocal(deepClone(DEFAULT_SYS_CONFIG));
        setShiftLocal(deepClone(DEFAULT_SYS_CONFIG.shifts));
      })
      .finally(() => setSysLoading(false));
  }, [activeTab, sysCfg]);

  // ---------------------------------------------------------------------------
  // Save helpers
  // ---------------------------------------------------------------------------
  const save = async () => {
    if (isReadOnly || !localCfg) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${targetUrl}/config`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localCfg),
      });
      if (res.ok) { setConfig(localCfg); showToast("Settings saved!", "success"); }
      else showToast("Save failed", "error");
    } catch { showToast("Network error", "error"); }
    finally  { setIsSaving(false); }
  };

  const patch = (updater) => setLocalCfg((prev) => { const next = deepClone(prev); updater(next); return next; });
  const patchSys = (updater) => setSysLocal((prev) => { const next = deepClone(prev); updater(next); return next; });

  const saveSys = async () => {
    if (isReadOnly || !sysLocal) return;
    setSysSaving(true);
    try {
      const res = await fetch(`${targetUrl}/system-config`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sysLocal),
      });
      if (res.ok) { setSysCfg(sysLocal); showToast("System config saved. Restart for DB/server changes.", "success"); }
      else { const d = await res.json().catch(() => ({})); showToast(d.error || "Save failed", "error"); }
    } catch { showToast("Network error", "error"); }
    finally { setSysSaving(false); }
  };

  const saveShiftTimes = async () => {
    if (isReadOnly || !shiftLocal) return;
    setShiftSaving(true);
    try {
      const res = await fetch(`${targetUrl}/audio-alerts/shift-times`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shiftLocal),
      });
      if (res.ok) showToast("Shift times saved!", "success");
      else showToast("Save failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setShiftSaving(false); }
  };

  const patchShift = (shift, field, value) =>
    setShiftLocal((prev) => ({ ...prev, [shift]: { ...prev?.[shift], [field]: value } }));

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------
  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-500">
      <Loader2 className="h-8 w-8 animate-spin mb-4 text-indigo-600" />
      <p className="font-medium">Loading configuration…</p>
    </div>
  );

  if (!localCfg) return (
    <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
      <AlertCircle className="h-5 w-5" />
      <p className="font-medium">Could not load configuration from gateway.</p>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Derived slices
  // ---------------------------------------------------------------------------
  const admin      = localCfg.adminSettings ?? {};
  const mailBody   = admin.mailBody ?? {};
  const rs485      = admin.rs485Ports ?? [];
  const engUnits   = admin.engineeringUnits ?? [];
  const smtp       = localCfg.smtp ?? {};
  const plcConfigs = localCfg.plc_configurations ?? [];

  // Tabs that need the generic Save button (config.json)
  const needsGenericSave = ["smtp", "modbus_rtu", "modbus_tcp"].includes(activeTab);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-0">

      {/* Page header */}
      <div className="flex items-center justify-between mb-5 p-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-700">Admin Settings</h2>
          <p className="text-xs text-slate-400 mt-0.5">System-level configuration and defaults</p>
        </div>
        {needsGenericSave && (
          <button disabled={isReadOnly || isSaving} onClick={save}
            className="inline-flex items-center gap-2 px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50">
            {isSaving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save"}
          </button>
        )}
      </div>

      {/* Main tab strip */}
      <div className="flex flex-wrap gap-0 border-b border-slate-200 mb-5 px-5">
        {MAIN_TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === t.key ? "border-zinc-700 text-zinc-800" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mx-5 space-y-6">

        {/* ── SMTP ──────────────────────────────────────────────── */}
        {activeTab === "smtp" && (
          <>
            <h3 className="text-sm font-semibold text-slate-700 pb-3 border-b border-slate-100">SMTP Configuration</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: "Server",   field: "server",   type: "text",     placeholder: "smtp.example.com" },
                { label: "Port",     field: "port",     type: "number",   placeholder: "587" },
                { label: "User",     field: "user",     type: "text",     placeholder: "user@example.com" },
                { label: "Password", field: "password", type: "password", placeholder: "••••••••" },
              ].map(({ label, field, type, placeholder }) => (
                <div key={field}>
                  <label className={lbl}>{label}</label>
                  <input type={type} value={smtp[field] ?? ""} placeholder={placeholder} disabled={isReadOnly}
                    onChange={(e) => patch((c) => { c.smtp ??= {}; c.smtp[field] = type === "number" ? Number(e.target.value) : e.target.value; })}
                    className={inp} />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">SMTP settings are transport-level configuration only.</p>
          </>
        )}

        {/* ── MODBUS RTU ────────────────────────────────────────── */}
        {activeTab === "modbus_rtu" && (
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-slate-700 pb-3 border-b border-slate-100">Modbus RTU</h3>
            <SubTabBar tabs={RTU_SUBTABS} active={rtuSubTab} onChange={setRtuSubTab} />

            {rtuSubTab === "mail" && (
              <MailBodyEditor value={mailBody.modbus_rtu ?? ""} disabled={isReadOnly}
                onChange={(v) => patch((c) => { c.adminSettings.mailBody.modbus_rtu = v; })} />
            )}

            {rtuSubTab === "rs485" && (
              <div className="space-y-4">
                <span className={lbl}>RS485 Ports</span>
                {rs485.length === 0 && <p className="text-xs text-slate-400 italic">No RS485 ports added yet.</p>}
                <div className="space-y-2">
                  {rs485.map((p, i) => (
                    <div key={i} className="grid gap-3 items-end rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                      style={{ gridTemplateColumns: "1fr 1fr auto" }}>
                      <div>
                        <label className={lbl}>Port Name</label>
                        <input value={p.name ?? ""} placeholder="Display name" disabled={isReadOnly}
                          onChange={(e) => patch((c) => { c.adminSettings.rs485Ports[i].name = e.target.value; })} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Device Path</label>
                        <input value={p.port ?? ""} placeholder="/dev/ttyAMA5" disabled={isReadOnly}
                          onChange={(e) => patch((c) => { c.adminSettings.rs485Ports[i].port = e.target.value; })} className={inp} />
                      </div>
                      <button type="button" disabled={isReadOnly}
                        onClick={() => patch((c) => { c.adminSettings.rs485Ports.splice(i, 1); })}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={isReadOnly}
                  onClick={() => patch((c) => { c.adminSettings.rs485Ports.push({ name: "", port: "" }); })}
                  className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-500 hover:border-zinc-400 hover:text-zinc-700 hover:bg-white transition-colors disabled:opacity-50">
                  + Add RS485 Port
                </button>
              </div>
            )}

            {rtuSubTab === "engineering" && (
              <div className="space-y-4">
                <span className={lbl}>Sensor Type → Symbol Mappings</span>
                {engUnits.length === 0 && <p className="text-xs text-slate-400 italic">No engineering units defined.</p>}
                <div className="space-y-2">
                  {engUnits.map((row, i) => (
                    <div key={i} className="grid gap-3 items-end rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                      style={{ gridTemplateColumns: "1fr 1fr auto" }}>
                      <div>
                        <label className={lbl}>Sensor Type</label>
                        <input value={row.type ?? ""} placeholder="e.g. temperature" disabled={isReadOnly}
                          onChange={(e) => patch((c) => { c.adminSettings.engineeringUnits[i].type = e.target.value; })} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Symbols (comma-separated)</label>
                        <input value={(row.symbols ?? []).join(",")} placeholder="e.g. °C,°F" disabled={isReadOnly}
                          onChange={(e) => patch((c) => {
                            c.adminSettings.engineeringUnits[i].symbols = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                          })} className={inp} />
                      </div>
                      <button type="button" disabled={isReadOnly}
                        onClick={() => patch((c) => { c.adminSettings.engineeringUnits.splice(i, 1); })}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={isReadOnly}
                  onClick={() => patch((c) => { c.adminSettings.engineeringUnits.push({ type: "", symbols: [] }); })}
                  className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-500 hover:border-zinc-400 hover:text-zinc-700 hover:bg-white transition-colors disabled:opacity-50">
                  + Add Sensor Type
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── MODBUS TCP ────────────────────────────────────────── */}
        {activeTab === "modbus_tcp" && (
          <>
            <h3 className="text-sm font-semibold text-slate-700 pb-3 border-b border-slate-100">Modbus TCP Configuration</h3>
            <div className="space-y-3">
              <span className={lbl}>Generate Random Values</span>
              {plcConfigs.length === 0 && <p className="text-xs text-slate-400 italic">No PLC configurations found.</p>}
              {plcConfigs.map((plc, i) => (
                <RandomCheckbox key={i}
                  label={`${plc.plcType || "Unknown"} PLC #${i + 1}${plc.PLC?.cred?.ip ? ` — ${plc.PLC.cred.ip}` : ""}`}
                  checked={plc.generate_random} disabled={isReadOnly}
                  onChange={(v) => patch((c) => { c.plc_configurations[i].generate_random = v; })} />
              ))}
            </div>
            <MailBodyEditor value={mailBody.plc ?? ""} disabled={isReadOnly}
              onChange={(v) => patch((c) => { c.adminSettings.mailBody.plc = v; })} />
          </>
        )}

        {/* ── SYSTEM ────────────────────────────────────────────── */}
        {activeTab === "system" && (
          <div className="space-y-8">
            {sysLoading ? (
              <div className="flex items-center gap-2 text-slate-500 py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading system config…</span>
              </div>
            ) : !sysLocal ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm font-medium">Could not load system configuration.</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">System Configuration</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Stored in system_config.json — DB/server changes require restart</p>
                  </div>
                  <button disabled={isReadOnly || sysSaving} onClick={saveSys}
                    className="inline-flex items-center gap-2 px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50">
                    {sysSaving ? <><RefreshCw size={13} className="animate-spin" /> Saving…</> : "Save System Config"}
                  </button>
                </div>

                {/* Application */}
                <section className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    Application
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold uppercase tracking-wide">restart required</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: "Server Host",              field: "server_host",          type: "text",   placeholder: "0.0.0.0" },
                      { label: "Server Port",              field: "server_port",          type: "number", placeholder: "8000" },
                      { label: "Log Root Path",            field: "log_root",             type: "text",   placeholder: "/home/recomputer/logs" },
                      { label: "Session Lifetime (days)",  field: "session_lifetime_days",type: "number", placeholder: "365" },
                      { label: "Cookie SameSite",          field: "cookie_samesite",      type: "text",   placeholder: "Lax" },
                    ].map(({ label, field, type, placeholder }) => (
                      <div key={field}>
                        <label className={lbl}>{label}</label>
                        <input type={type} value={sysLocal.app?.[field] ?? ""} placeholder={placeholder} disabled={isReadOnly}
                          onChange={(e) => patchSys((c) => { c.app ??= {}; c.app[field] = type === "number" ? Number(e.target.value) : e.target.value; })}
                          className={inp} />
                      </div>
                    ))}
                    <div className="flex items-center gap-2.5 pt-5">
                      <input type="checkbox" id="cookie_secure" checked={!!sysLocal.app?.cookie_secure} disabled={isReadOnly}
                        onChange={(e) => patchSys((c) => { c.app ??= {}; c.app.cookie_secure = e.target.checked; })}
                        className="h-4 w-4 rounded border-slate-300 accent-zinc-700" />
                      <label htmlFor="cookie_secure" className="text-sm text-slate-600 font-medium cursor-pointer">Cookie Secure (HTTPS only)</label>
                    </div>
                  </div>
                </section>

                {/* Database */}
                <section className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    Database
                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold uppercase tracking-wide">restart required</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: "Host",     field: "host",     type: "text",     placeholder: "localhost" },
                      { label: "Port",     field: "port",     type: "number",   placeholder: "3306" },
                      { label: "Database", field: "name",     type: "text",     placeholder: "users" },
                      { label: "User",     field: "user",     type: "text",     placeholder: "gateway" },
                      { label: "Password", field: "password", type: "password", placeholder: "••••••••" },
                    ].map(({ label, field, type, placeholder }) => (
                      <div key={field}>
                        <label className={lbl}>{label}</label>
                        <input type={type} value={sysLocal.database?.[field] ?? ""} placeholder={placeholder} disabled={isReadOnly}
                          onChange={(e) => patchSys((c) => { c.database ??= {}; c.database[field] = type === "number" ? Number(e.target.value) : e.target.value; })}
                          className={inp} />
                      </div>
                    ))}
                  </div>
                </section>

                {/* CORS Origins */}
                <section className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">CORS Origins <span className="normal-case font-normal text-slate-400">(hot reload)</span></h4>
                  {(sysLocal.cors_origins ?? []).length === 0 && <p className="text-xs text-slate-400 italic">No origins added yet.</p>}
                  <div className="space-y-1.5">
                    {(sysLocal.cors_origins ?? []).map((origin, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={origin} disabled={isReadOnly}
                          onChange={(e) => patchSys((c) => { c.cors_origins[i] = e.target.value; })}
                          className={inp} placeholder="http://localhost:5173" />
                        <button type="button" disabled={isReadOnly}
                          onClick={() => patchSys((c) => { c.cors_origins.splice(i, 1); })}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)} disabled={isReadOnly}
                      onKeyDown={(e) => { if (e.key === "Enter" && newOrigin.trim()) { patchSys((c) => { c.cors_origins.push(newOrigin.trim()); }); setNewOrigin(""); } }}
                      placeholder="http://192.168.1.10:5173" className={inp} />
                    <button type="button" disabled={isReadOnly || !newOrigin.trim()}
                      onClick={() => { patchSys((c) => { c.cors_origins.push(newOrigin.trim()); }); setNewOrigin(""); }}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium disabled:opacity-40 whitespace-nowrap">
                      + Add
                    </button>
                  </div>
                </section>

                {/* GPIO Pins */}
                <section className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">GPIO Pins <span className="normal-case font-normal text-slate-400">(hot reload)</span></h4>
                  {Object.keys(sysLocal.gpio_pins ?? {}).length === 0 && <p className="text-xs text-slate-400 italic">No GPIO pins configured.</p>}
                  <div className="space-y-2">
                    {Object.entries(sysLocal.gpio_pins ?? {}).map(([name, pin]) => (
                      <div key={name} className="grid gap-3 items-end rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                        style={{ gridTemplateColumns: "1fr 140px auto" }}>
                        <div><label className={lbl}>Output Name</label><input value={name} disabled className={inp} /></div>
                        <div>
                          <label className={lbl}>BCM Pin #</label>
                          <input type="number" value={pin} disabled={isReadOnly}
                            onChange={(e) => patchSys((c) => { const p = { ...c.gpio_pins }; p[name] = Number(e.target.value); c.gpio_pins = p; })}
                            className={inp} />
                        </div>
                        <button type="button" disabled={isReadOnly}
                          onClick={() => patchSys((c) => { delete c.gpio_pins[name]; })}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 140px auto" }}>
                    <input value={newGpioName} onChange={(e) => setNewGpioName(e.target.value)} placeholder="Digital Output 5" disabled={isReadOnly} className={inp} />
                    <input type="number" value={newGpioPin} onChange={(e) => setNewGpioPin(e.target.value)} placeholder="BCM pin" disabled={isReadOnly} className={inp} />
                    <button type="button" disabled={isReadOnly || !newGpioName.trim() || !newGpioPin}
                      onClick={() => { patchSys((c) => { c.gpio_pins[newGpioName.trim()] = Number(newGpioPin); }); setNewGpioName(""); setNewGpioPin(""); }}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium disabled:opacity-40 whitespace-nowrap">
                      + Add
                    </button>
                  </div>
                </section>

                {/* Operational Limits */}
                <section className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Operational Limits</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                      { label: "Audit Log Max Entries",    field: "audit_log_max",             placeholder: "2000" },
                      { label: "Alert Log Max Entries",    field: "alert_log_max",             placeholder: "2000" },
                      { label: "Rule Test Default (min)",  field: "rule_test_default_minutes", placeholder: "5" },
                    ].map(({ label, field, placeholder }) => (
                      <div key={field}>
                        <label className={lbl}>{label}</label>
                        <input type="number" value={sysLocal.alerts_limits?.[field] ?? ""} placeholder={placeholder} disabled={isReadOnly}
                          onChange={(e) => patchSys((c) => { c.alerts_limits ??= {}; c.alerts_limits[field] = Number(e.target.value); })}
                          className={inp} />
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {/* ── SHIFT TIMES ───────────────────────────────────────── */}
        {activeTab === "shift_times" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Shift Times</h3>
                <p className="text-xs text-slate-400 mt-0.5">Define start and end times for each production shift</p>
              </div>
              {!isReadOnly && (
                <button disabled={shiftSaving || !shiftLocal} onClick={saveShiftTimes}
                  className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50">
                  {shiftSaving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save Shift Times</>}
                </button>
              )}
            </div>

            {sysLoading ? (
              <div className="flex items-center gap-2 text-slate-500 py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : !shiftLocal ? (
              <p className="text-sm text-slate-400">Could not load shift times.</p>
            ) : (
              <div className="space-y-4">
                {["Morning", "Afternoon", "Night"].map((shift) => (
                  <div key={shift} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end rounded-xl border border-slate-200 bg-slate-50/60 px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${shift === "Morning" ? "bg-amber-400" : shift === "Afternoon" ? "bg-orange-500" : "bg-indigo-600"}`} />
                      <span className="font-semibold text-sm text-slate-700">{shift}</span>
                    </div>
                    <div>
                      <label className={lbl}>Start Time</label>
                      <input type="time" value={shiftLocal[shift]?.start ?? ""} disabled={isReadOnly}
                        onChange={(e) => patchShift(shift, "start", e.target.value)}
                        className={inp} />
                    </div>
                    <div>
                      <label className={lbl}>End Time</label>
                      <input type="time" value={shiftLocal[shift]?.end ?? ""} disabled={isReadOnly}
                        onChange={(e) => patchShift(shift, "end", e.target.value)}
                        className={inp} />
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-400 mt-2">
                  These times are used by the shift-wise language assignment and alert shift detection.
                </p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
