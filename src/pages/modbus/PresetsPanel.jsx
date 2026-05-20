import React, { useState } from "react";
import { Pencil, Trash2, X, Settings2 } from "lucide-react";

/**
 * PresetsPanel – inline load / save / manage presets bar.
 *
 * Props:
 *   builtInSchema      – { label, rows[] } | null
 *   brandKey           – current brand key
 *   brandPresets       – { [pid]: { name, rows[] } }
 *   globalPresets      – { [pid]: { name, rows[] } }
 *   onLoad(rows)       – load rows into table
 *   onSave(name, scope) – save current rows as new preset
 *   onDelete(pid, scope)
 *   onEditPreset(pid, scope) – open full preset editor in parent
 *   isReadOnly
 */
export default function PresetsPanel({
  builtInSchema,
  brandKey,
  brandPresets,
  globalPresets,
  onLoad,
  onSave,
  onDelete,
  onEditPreset,
  isReadOnly,
}) {
  const [selectedPreset, setSelectedPreset] = useState("");
  const [scope, setScope] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [showManageModal, setShowManageModal] = useState(false);

  // ── derived lists ────────────────────────────────────────────────────────
  const builtInList = builtInSchema
    ? [{ id: `builtin:${brandKey}`, name: `Built-in: ${builtInSchema.label}` }]
    : [];
  const brandList = Object.entries(brandPresets || {}).map(([pid, p]) => ({
    pid, id: `brand:${pid}`, name: p.name || pid,
  }));
  const globalList = Object.entries(globalPresets || {}).map(([pid, p]) => ({
    pid, id: `global:${pid}`, name: p.name || pid,
  }));

  // ── load ─────────────────────────────────────────────────────────────────
  const handleLoad = () => {
    if (!selectedPreset) return;
    let rows = [];
    if (selectedPreset.startsWith("builtin:")) {
      rows = builtInSchema?.rows || [];
    } else if (selectedPreset.startsWith("brand:")) {
      rows = brandPresets?.[selectedPreset.split(":")[1]]?.rows || [];
    } else if (selectedPreset.startsWith("global:")) {
      rows = globalPresets?.[selectedPreset.split(":")[1]]?.rows || [];
    }
    onLoad(rows);
  };

  // ── save ─────────────────────────────────────────────────────────────────
  const confirmSave = () => {
    if (!presetName.trim()) return;
    onSave(presetName.trim(), scope);
    setShowSaveModal(false);
    setPresetName("");
  };

  // ── shared styles ─────────────────────────────────────────────────────────
  const selectCls =
    "border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-700 bg-white " +
    "hover:border-slate-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";
  const btnOutline =
    "px-3 py-1.5 border border-slate-300 rounded-md text-xs font-medium text-slate-700 " +
    "bg-white hover:bg-slate-50 hover:border-slate-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";
  const btnDark =
    "px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap " +
    "bg-zinc-800 hover:bg-zinc-700";

  return (
    <>
      {/* ── Single-row bar (no wrap) ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-0.5" style={{ scrollbarWidth: "none" }}>

        {/* Load section */}
        <select
          value={selectedPreset}
          onChange={(e) => setSelectedPreset(e.target.value)}
          disabled={isReadOnly}
          className={selectCls}
          style={{ minWidth: 150, maxWidth: 180 }}
        >
          <option value="">Load preset…</option>
          {builtInList.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          {brandList.length > 0 && (
            <optgroup label="Device">
              {brandList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
          {globalList.length > 0 && (
            <optgroup label="Global">
              {globalList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
        </select>

        <button disabled={!selectedPreset || isReadOnly} onClick={handleLoad} className={btnOutline}>
          Load
        </button>

        <span className="w-px h-5 bg-slate-200 mx-1 flex-shrink-0" />

        {/* Save section */}
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          disabled={isReadOnly}
          className={selectCls}
          style={{ minWidth: 120 }}
        >
          <option value="">Save as Preset</option>
          <option value="brand">Device preset</option>
          <option value="global">Global preset</option>
        </select>

        <button disabled={isReadOnly} onClick={() => setShowSaveModal(true)} className={btnOutline}>
          Okay
        </button>

        <span className="w-px h-5 bg-slate-200 mx-1 flex-shrink-0" />

        {/* Manage */}
        <button
          onClick={() => setShowManageModal(true)}
          className={btnOutline}
          title="Manage saved presets"
        >
          <Settings2 size={11} className="inline mr-1 -mt-px" />
          Manage
        </button>
      </div>

      {/* ── Save-name Modal ── */}
      {showSaveModal && (
        <Overlay onClose={() => { setShowSaveModal(false); setPresetName(""); }}>
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Save as Preset</h3>
          <label className="block mb-4">
            <span className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
              Preset Name
            </span>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g. Site A v1"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && confirmSave()}
            />
          </label>
          <p className="text-xs text-slate-500 mb-4">
            Saving to: <span className="font-medium text-slate-700">{scope === "global" ? "Global" : "Device"}</span>
          </p>
          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button onClick={confirmSave} disabled={!presetName.trim()} className="flex-1 py-2 rounded-md text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">
              Okay
            </button>
            <button onClick={() => { setShowSaveModal(false); setPresetName(""); }}
              className="flex-1 py-2 border border-slate-200 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Manage Presets Modal ── */}
      {showManageModal && (
        <Overlay onClose={() => setShowManageModal(false)} width={480}>
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Manage Presets</h3>
          <p className="text-xs text-slate-400 mb-4">Edit or delete saved presets</p>

          <PresetSection
            title="Device Presets"
            items={brandList}
            scope="brand"
            onEdit={(pid, s) => { setShowManageModal(false); onEditPreset(pid, s); }}
            onDelete={(pid) => onDelete(pid, "brand")}
            isReadOnly={isReadOnly}
          />

          <PresetSection
            title="Global Presets"
            items={globalList}
            scope="global"
            onEdit={(pid, s) => { setShowManageModal(false); onEditPreset(pid, s); }}
            onDelete={(pid) => onDelete(pid, "global")}
            isReadOnly={isReadOnly}
          />

          {brandList.length === 0 && globalList.length === 0 && (
            <p className="text-sm text-slate-400 italic text-center py-6">No saved presets yet.</p>
          )}

          <div className="pt-3 border-t border-slate-100 mt-2">
            <button
              onClick={() => setShowManageModal(false)}
              className="w-full py-2 border border-slate-200 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </Overlay>
      )}
    </>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function Overlay({ children, onClose, width = 360 }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-xl shadow-2xl p-6 relative" style={{ width, maxHeight: "85vh", overflowY: "auto" }}>
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <X size={15} />
        </button>
        {children}
      </div>
    </div>
  );
}

function PresetSection({ title, items, scope, onEdit, onDelete, isReadOnly }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">{title}</p>
      <ul className="space-y-1.5">
        {items.map(({ pid, name }) => (
          <li key={pid} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <span className="flex-1 text-sm font-medium text-slate-700 truncate">{name}</span>
            <button
              disabled={isReadOnly}
              onClick={() => onEdit(pid, scope)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 hover:text-zinc-800 rounded transition-colors disabled:opacity-30"
              title="Edit preset rows and name"
            >
              <Pencil size={11} />
              Edit
            </button>
            <button
              disabled={isReadOnly}
              onClick={() => { if (window.confirm(`Delete preset "${name}"?`)) onDelete(pid); }}
              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors disabled:opacity-30"
              title="Delete preset"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
