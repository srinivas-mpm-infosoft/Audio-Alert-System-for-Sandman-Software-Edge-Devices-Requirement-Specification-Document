import React, { useEffect, useState } from "react";
import { useToast } from "../../components/ToastContext";
import SiemensForm from "./SiemensForm";
import AllenBradleyForm from "./AllenBradleyForm";
import ScadaHmiForm from "./ScadaHmiForm";
import {
  deepClone,
  ensureBase,
  normalizePlcEntry,
  normalizeScadaDevice,
  normalizeHmiDevice,
} from "./helpers";

const BRANDS = ["Siemens"];
const MAIN_TABS = ["PLC", "SCADA PC", "HMI"];

const mainTabCls = (active) =>
  `px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ` +
  (active ? "bg-zinc-800 text-white shadow-sm" : "text-slate-500 hover:text-zinc-700 hover:bg-slate-100");

const brandTabCls = (active) =>
  `px-3 py-1 rounded-md text-xs font-medium transition-colors ` +
  (active ? "bg-zinc-700 text-white" : "text-slate-500 hover:text-zinc-700 hover:bg-slate-100");

const deviceTabCls = (active) =>
  `px-3 py-1 rounded-md text-xs font-medium border transition-colors ` +
  (active
    ? "bg-zinc-800 text-white border-zinc-800"
    : "bg-white text-slate-500 border-slate-200 hover:border-zinc-400 hover:text-zinc-700");

export default function ModbusTCP({ config, onSave, setConfig, role = "admin", isReadOnly, defaultTab = "PLC" }) {
  const showToast = useToast();
  const [localCfg, setLocalCfg] = useState(() => ensureBase(config));
  const [isSaving, setIsSaving] = useState(false);
  const [mainTab, setMainTab] = useState(defaultTab);
  const [activeBrand, setActiveBrand] = useState("Siemens");
  const [activePlcGlobalIdx, setActivePlcGlobalIdx] = useState(null);
  const [activeScadaIdx, setActiveScadaIdx] = useState(null);
  const [activeHmiIdx, setActiveHmiIdx] = useState(null);

  useEffect(() => {
    const base = ensureBase(config);
    setLocalCfg(base);
    // Auto-select first PLC of current brand
    const first = (base.plc_configurations ?? []).findIndex((p) => p.plcType === activeBrand);
    setActivePlcGlobalIdx(first >= 0 ? first : null);
    const firstScada = (base.scada_configurations ?? []).length > 0 ? 0 : null;
    const firstHmi = (base.hmi_configurations ?? []).length > 0 ? 0 : null;
    setActiveScadaIdx(firstScada);
    setActiveHmiIdx(firstHmi);
  }, [config]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  const save = async () => {
    if (isReadOnly) return;
    setIsSaving(true);
    try {
      await onSave(localCfg);
      setConfig?.(localCfg);
      showToast("Ethernet TCP/IP settings saved!", "success");
    } catch (err) {
      console.error(err);
      showToast("Save failed", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Tab switching helpers
  // ---------------------------------------------------------------------------
  const handleMainTabChange = (t) => {
    setMainTab(t);
    if (t === "PLC") {
      const idx = (localCfg.plc_configurations ?? []).findIndex((p) => p.plcType === activeBrand);
      setActivePlcGlobalIdx(idx >= 0 ? idx : null);
    } else if (t === "SCADA PC") {
      setActiveScadaIdx((localCfg.scada_configurations ?? []).length > 0 ? 0 : null);
    } else {
      setActiveHmiIdx((localCfg.hmi_configurations ?? []).length > 0 ? 0 : null);
    }
  };

  const handleBrandChange = (brand) => {
    setActiveBrand(brand);
    const idx = (localCfg.plc_configurations ?? []).findIndex((p) => p.plcType === brand);
    setActivePlcGlobalIdx(idx >= 0 ? idx : null);
  };

  // ---------------------------------------------------------------------------
  // PLC helpers
  // ---------------------------------------------------------------------------
  const plcs = localCfg.plc_configurations ?? [];
  const brandPlcs = plcs.map((p, i) => ({ p, i })).filter(({ p }) => p.plcType === activeBrand);

  const addPlc = () => {
    const newIdx = plcs.length;
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.plc_configurations.push(normalizePlcEntry({ plcType: activeBrand, isExpanded: true, enabled: true }));
      return next;
    });
    setActivePlcGlobalIdx(newIdx);
  };

  const removePlc = (globalIdx) => {
    if (!window.confirm("Remove this device?")) return;
    const remaining = plcs
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => p.plcType === activeBrand && i !== globalIdx)
      .map(({ i }) => (i > globalIdx ? i - 1 : i));
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.plc_configurations.splice(globalIdx, 1);
      return next;
    });
    setActivePlcGlobalIdx(remaining.length > 0 ? remaining[0] : null);
  };

  const updatePlc = (globalIdx, updater) => {
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.plc_configurations[globalIdx] =
        typeof updater === "function"
          ? updater(next.plc_configurations[globalIdx])
          : { ...next.plc_configurations[globalIdx], ...updater };
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // SCADA helpers
  // ---------------------------------------------------------------------------
  const scadas = localCfg.scada_configurations ?? [];

  const addScada = () => {
    const newIdx = scadas.length;
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.scada_configurations.push(normalizeScadaDevice({}));
      return next;
    });
    setActiveScadaIdx(newIdx);
  };

  const removeScada = (i) => {
    if (!window.confirm("Remove this SCADA device?")) return;
    const newSel = scadas.length > 1 ? Math.max(0, i - 1) : null;
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.scada_configurations.splice(i, 1);
      return next;
    });
    setActiveScadaIdx(newSel);
  };

  const updateScada = (i, updater) => {
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.scada_configurations[i] =
        typeof updater === "function"
          ? updater(next.scada_configurations[i])
          : { ...next.scada_configurations[i], ...updater };
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // HMI helpers
  // ---------------------------------------------------------------------------
  const hmis = localCfg.hmi_configurations ?? [];

  const addHmi = () => {
    const newIdx = hmis.length;
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.hmi_configurations.push(normalizeHmiDevice({}));
      return next;
    });
    setActiveHmiIdx(newIdx);
  };

  const removeHmi = (i) => {
    if (!window.confirm("Remove this HMI device?")) return;
    const newSel = hmis.length > 1 ? Math.max(0, i - 1) : null;
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.hmi_configurations.splice(i, 1);
      return next;
    });
    setActiveHmiIdx(newSel);
  };

  const updateHmi = (i, updater) => {
    setLocalCfg((prev) => {
      const next = deepClone(prev);
      next.hmi_configurations[i] =
        typeof updater === "function"
          ? updater(next.hmi_configurations[i])
          : { ...next.hmi_configurations[i], ...updater };
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Label helpers
  // ---------------------------------------------------------------------------
  const plcLabel = (p) => p.PLC?.cred?.ip || "New Device";
  // const deviceLabel = (d, i) => d.ip || d.label || `Device ${i + 1}`;

  const deviceLabel = (d, i) => {
  if (d.protocol === "OPC UA") {
    return (
      d.connection?.endpoint_url ||
      d.label ||
      `Device ${i + 1}`
    );
  }

  return (
    d.connection?.ip ||
    d.label ||
    `Device ${i + 1}`
  );
};

  // Active items (with bounds check)
  const activePlc =
    activePlcGlobalIdx !== null && activePlcGlobalIdx < plcs.length
      ? plcs[activePlcGlobalIdx]
      : null;
  const activeScada = activeScadaIdx !== null && activeScadaIdx < scadas.length ? scadas[activeScadaIdx] : null;
  const activeHmi = activeHmiIdx !== null && activeHmiIdx < hmis.length ? hmis[activeHmiIdx] : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-700">{mainTab}</h2>
          <p className="text-xs text-slate-400 mt-0.5">Configure device connections and settings</p>
        </div>
        <button
          disabled={isReadOnly || isSaving}
          onClick={save}
          className="inline-flex items-center gap-2 px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Tab switcher hidden — PLC / SCADA PC / HMI are now separate sidebar items */}

      {/* ── PLC ── */}
      {mainTab === "PLC" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">

          {/* Brand sub-tabs */}
          <div className="flex gap-1 p-1 bg-slate-50 rounded-lg border border-slate-200 w-fit">
            {BRANDS.map((b) => (
              <button key={b} type="button" onClick={() => handleBrandChange(b)} className={brandTabCls(activeBrand === b)}>
                {b}
              </button>
            ))}
          </div>

          {/* Device tabs (IP address tabs) */}
          <div className="flex items-center gap-1 flex-wrap">
            {brandPlcs.map(({ p, i }) => (
              <button
                key={i}
                type="button"
                onClick={() => setActivePlcGlobalIdx(i)}
                className={deviceTabCls(activePlcGlobalIdx === i)}
              >
                {plcLabel(p)}
              </button>
            ))}
            {!isReadOnly && (
              <button
                type="button"
                onClick={addPlc}
                className="px-3 py-1 rounded-md text-xs font-medium border border-dashed border-slate-300 text-slate-400 hover:border-zinc-400 hover:text-zinc-600 transition-colors"
              >
                + Add Device
              </button>
            )}
          </div>

          {/* Device form */}
          {activePlc ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  {activeBrand} — {plcLabel(activePlc)}
                </span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!activePlc.enabled}
                      disabled={isReadOnly}
                      onChange={(e) => updatePlc(activePlcGlobalIdx, { enabled: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-zinc-700"
                    />
                    <span className="text-xs text-slate-500 font-medium">Enabled</span>
                  </label>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => removePlc(activePlcGlobalIdx)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Remove Device
                    </button>
                  )}
                </div>
              </div>
              {activePlc.plcType === "Siemens" ? (
                <SiemensForm
                  plc={activePlc.PLC}
                  role={role}
                  isReadOnly={isReadOnly}
                  onChange={(updater) => updatePlc(activePlcGlobalIdx, updater)}
                />
              ) : (
                <AllenBradleyForm
                  plc={activePlc.PLC}
                  plcType={activePlc.plcType}
                  role={role}
                  isReadOnly={isReadOnly}
                  onChange={(updater) => updatePlc(activePlcGlobalIdx, updater)}
                />
              )}
            </div>
          ) : (
            <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
              No {activeBrand} devices configured. Click &quot;+ Add Device&quot; to get started.
            </div>
          )}
        </div>
      )}

      {/* ── SCADA PC ── */}
      {mainTab === "SCADA PC" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">

          {/* Device tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {scadas.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveScadaIdx(i)}
                className={deviceTabCls(activeScadaIdx === i)}
              >
                {deviceLabel(d, i)}
              </button>
            ))}
            {!isReadOnly && (
              <button
                type="button"
                onClick={addScada}
                className="px-3 py-1 rounded-md text-xs font-medium border border-dashed border-slate-300 text-slate-400 hover:border-zinc-400 hover:text-zinc-600 transition-colors"
              >
                + Add Device
              </button>
            )}
          </div>

          {activeScada ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  SCADA PC — {deviceLabel(activeScada, activeScadaIdx)}
                </span>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => removeScada(activeScadaIdx)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    Remove Device
                  </button>
                )}
              </div>
              <ScadaHmiForm
                device={activeScada}
                isReadOnly={isReadOnly}
                isScada={true}
                onChange={(updater) => updateScada(activeScadaIdx, updater)}
              />
            </div>
          ) : (
            <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
              No SCADA PC devices configured. Click &quot;+ Add Device&quot; to get started.
            </div>
          )}
        </div>
      )}

      {/* ── HMI ── */}
      {mainTab === "HMI" && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">

          {/* Device tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {hmis.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveHmiIdx(i)}
                className={deviceTabCls(activeHmiIdx === i)}
              >
                {deviceLabel(d, i)}
              </button>
            ))}
            {!isReadOnly && (
              <button
                type="button"
                onClick={addHmi}
                className="px-3 py-1 rounded-md text-xs font-medium border border-dashed border-slate-300 text-slate-400 hover:border-zinc-400 hover:text-zinc-600 transition-colors"
              >
                + Add Device
              </button>
            )}
          </div>

          {activeHmi ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  HMI — {deviceLabel(activeHmi, activeHmiIdx)}
                </span>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => removeHmi(activeHmiIdx)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    Remove Device
                  </button>
                )}
              </div>
              <ScadaHmiForm
                device={activeHmi}
                isReadOnly={isReadOnly}
                isScada={false}
                onChange={(updater) => updateHmi(activeHmiIdx, updater)}
              />
            </div>
          ) : (
            <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
              No HMI devices configured. Click &quot;+ Add Device&quot; to get started.
            </div>
          )}
        </div>
      )}

    </div>
  );
}
