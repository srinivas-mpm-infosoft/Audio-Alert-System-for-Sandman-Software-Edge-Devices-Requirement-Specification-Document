import React, { useState, useEffect, useCallback } from "react";
import { Plus, ChevronRight, ChevronDown, Loader2, RefreshCw, Zap, RotateCcw, Settings, MapPin, Building2, Pencil, Trash2, Check, X } from "lucide-react";
import { useDevices } from "./hooks/useDevices";
import { useCan } from "./hooks/useCan";
import {
  testFireDevice, restartDevice, addDevice,
  getPlants, getLines, getZones,
  createPlant, updatePlant, deletePlant,
  createLine, updateLine, deleteLine,
  createZone, updateZone, deleteZone,
} from "./api/devices.api";
import { useToast } from "../../components/ToastContext";
import { useAuthStore } from "../../store/useAuthStore";
import { useAppConfigStore } from "../../store/useAppConfigStore";
import StatusPill from "./components/StatusPill";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import { DEVICE_TYPES } from "./utils/constants";
import { timeAgo } from "./utils/formatters";

const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";
const INPUT = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700";

// ── tiny inline text field ────────────────────────────────────
function InlineEdit({ value, onSave, onCancel }) {
  const [v, setV] = useState(value);
  return (
    <span className="flex items-center gap-1">
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(v); if (e.key === "Escape") onCancel(); }}
        className="border border-indigo-300 rounded px-2 py-0.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      <button type="button" onClick={() => onSave(v)} className="text-emerald-600 hover:text-emerald-700"><Check size={13} /></button>
      <button type="button" onClick={onCancel} className="text-slate-400 hover:text-red-500"><X size={13} /></button>
    </span>
  );
}

function DeviceTypeIcon({ type }) {
  if (type === "Gateway") return <span className="text-indigo-600 font-bold text-xs">GW</span>;
  if (type === "Speaker") return <span className="text-emerald-600 font-bold text-xs">SPK</span>;
  return <span className="text-amber-600 font-bold text-xs">AMP</span>;
}

function HeartbeatTime({ ts }) {
  if (!ts) return <span className="text-slate-400">Never</span>;
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000);
  const color = sec < 60 ? "text-emerald-600" : sec < 300 ? "text-amber-600" : "text-red-600";
  return <span className={`font-mono text-xs ${color}`}>{timeAgo(ts)}</span>;
}

// ── Plant Structure management panel ─────────────────────────
function PlantManagement({ showToast }) {
  const ZONE_TYPES = useAppConfigStore((s) => s.zone_types);
  const LANGUAGES  = useAppConfigStore((s) => s.languages);
  const canEdit = useCan("aa.zones.edit");
  const [plants, setPlants] = useState([]);
  const [lines, setLines]   = useState([]);
  const [zones, setZones]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("plants");

  // inline edit state
  const [editId, setEditId]   = useState(null);
  const [editField, setEditField] = useState(null);

  // add-form state
  const [newPlant, setNewPlant] = useState({ name: "", location: "" });
  const [newLine, setNewLine]   = useState({ name: "", plant_id: "" });
  const [newZone, setNewZone]   = useState({ name: "", type: "Melting", line_id: "", plant_id: "", default_language: "EN" });
  const [addOpen, setAddOpen]   = useState(false);
  const [delTarget, setDelTarget] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [pr, lr, zr] = await Promise.all([getPlants(), getLines(), getZones()]);
    if (pr.ok) setPlants(pr.data);
    if (lr.ok) setLines(lr.data);
    if (zr.ok) setZones(zr.data);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleSaveEdit = async (type, id, field, value) => {
    let res;
    if (type === "plant")  res = await updatePlant(id, { [field]: value });
    else if (type === "line")   res = await updateLine(id, { [field]: value });
    else                        res = await updateZone(id, { [field]: value });
    if (res.ok) { showToast("Saved", "success"); reload(); }
    else showToast(res.error || "Save failed", "error");
    setEditId(null); setEditField(null);
  };

  const handleDelete = async () => {
    if (!delTarget) return;
    let res;
    if (delTarget.type === "plant")  res = await deletePlant(delTarget.id);
    else if (delTarget.type === "line")   res = await deleteLine(delTarget.id);
    else                                  res = await deleteZone(delTarget.id);
    if (res.ok) { showToast("Deleted", "success"); reload(); }
    else showToast(res.error || "Delete failed", "error");
    setDelTarget(null);
  };

  const handleAddPlant = async () => {
    if (!newPlant.name.trim()) return;
    const res = await createPlant(newPlant);
    if (res.ok) { showToast("Plant added", "success"); setNewPlant({ name: "", location: "" }); setAddOpen(false); reload(); }
    else showToast(res.error || "Failed", "error");
  };

  const handleAddLine = async () => {
    if (!newLine.name.trim() || !newLine.plant_id) return;
    const res = await createLine(newLine);
    if (res.ok) { showToast("Line added", "success"); setNewLine({ name: "", plant_id: "" }); setAddOpen(false); reload(); }
    else showToast(res.error || "Failed", "error");
  };

  const handleAddZone = async () => {
    if (!newZone.name.trim() || !newZone.line_id) return;
    const plant_id = lines.find((l) => l.id === newZone.line_id)?.plant_id || newZone.plant_id;
    const res = await createZone({ ...newZone, plant_id });
    if (res.ok) { showToast("Zone added", "success"); setNewZone({ name: "", type: "Melting", line_id: "", plant_id: "", default_language: "EN" }); setAddOpen(false); reload(); }
    else showToast(res.error || "Failed", "error");
  };

  const SECTIONS = [
    { key: "plants", label: "Plants", count: plants.length },
    { key: "lines",  label: "Lines",  count: lines.length },
    { key: "zones",  label: "Zones",  count: zones.length },
  ];

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>;

  return (
    <div className="flex flex-col gap-4">
      {/* Section toggle */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        {SECTIONS.map((s) => (
          <button key={s.key} onClick={() => { setActiveSection(s.key); setAddOpen(false); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeSection === s.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {s.label} <span className="ml-1 opacity-60">({s.count})</span>
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={reload} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"><RefreshCw size={14} /></button>
          {canEdit && (
            <button type="button" onClick={() => setAddOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700">
              <Plus size={13} /> Add {SECTIONS.find((s) => s.key === activeSection)?.label.slice(0, -1)}
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {addOpen && canEdit && (
        <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50 flex flex-col gap-3">
          {activeSection === "plants" && (
            <>
              <h4 className="text-sm font-semibold text-slate-800">New Plant</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={LABEL}>Plant Name</label><input className={INPUT} value={newPlant.name} onChange={(e) => setNewPlant((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Plant-4" /></div>
                <div><label className={LABEL}>Location</label><input className={INPUT} value={newPlant.location} onChange={(e) => setNewPlant((p) => ({ ...p, location: e.target.value }))} placeholder="e.g. Surat, Gujarat" /></div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAddOpen(false)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={handleAddPlant} disabled={!newPlant.name.trim()} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Add Plant</button>
              </div>
            </>
          )}
          {activeSection === "lines" && (
            <>
              <h4 className="text-sm font-semibold text-slate-800">New Line</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Plant</label>
                  <select className={INPUT} value={newLine.plant_id} onChange={(e) => setNewLine((l) => ({ ...l, plant_id: e.target.value }))}>
                    <option value="">Select plant…</option>
                    {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div><label className={LABEL}>Line Name</label><input className={INPUT} value={newLine.name} onChange={(e) => setNewLine((l) => ({ ...l, name: e.target.value }))} placeholder="e.g. Line-3" /></div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAddOpen(false)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={handleAddLine} disabled={!newLine.name.trim() || !newLine.plant_id} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Add Line</button>
              </div>
            </>
          )}
          {activeSection === "zones" && (
            <>
              <h4 className="text-sm font-semibold text-slate-800">New Zone</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Line</label>
                  <select className={INPUT} value={newZone.line_id} onChange={(e) => setNewZone((z) => ({ ...z, line_id: e.target.value }))}>
                    <option value="">Select line…</option>
                    {lines.map((l) => {
                      const plant = plants.find((p) => p.id === l.plant_id);
                      return <option key={l.id} value={l.id}>{plant?.name} / {l.name}</option>;
                    })}
                  </select>
                </div>
                <div><label className={LABEL}>Zone Name</label><input className={INPUT} value={newZone.name} onChange={(e) => setNewZone((z) => ({ ...z, name: e.target.value }))} placeholder="e.g. Melting-4" /></div>
                <div>
                  <label className={LABEL}>Zone Type</label>
                  <select className={INPUT} value={newZone.type} onChange={(e) => setNewZone((z) => ({ ...z, type: e.target.value }))}>
                    {ZONE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Default Language</label>
                  <select className={INPUT} value={newZone.default_language} onChange={(e) => setNewZone((z) => ({ ...z, default_language: e.target.value }))}>
                    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setAddOpen(false)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                <button onClick={handleAddZone} disabled={!newZone.name.trim() || !newZone.line_id} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Add Zone</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        {activeSection === "plants" && (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              {["Plant Name", "Location", "Lines", ""].map((h) => <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {plants.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {editId === p.id && editField === "name"
                      ? <InlineEdit value={p.name} onSave={(v) => handleSaveEdit("plant", p.id, "name", v)} onCancel={() => { setEditId(null); setEditField(null); }} />
                      : p.name}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {editId === p.id && editField === "location"
                      ? <InlineEdit value={p.location || ""} onSave={(v) => handleSaveEdit("plant", p.id, "location", v)} onCancel={() => { setEditId(null); setEditField(null); }} />
                      : p.location || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{lines.filter((l) => l.plant_id === p.id).length}</td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setEditId(p.id); setEditField("name"); }} className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" title="Edit name"><Pencil size={12} /></button>
                        <button onClick={() => { setEditId(p.id); setEditField("location"); }} className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" title="Edit location"><MapPin size={12} /></button>
                        <button onClick={() => setDelTarget({ id: p.id, type: "plant", name: p.name })} className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50" title="Delete"><Trash2 size={12} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {plants.length === 0 && <tr><td colSpan={4}><EmptyState title="No plants" message="Add a plant to get started." /></td></tr>}
            </tbody>
          </table>
        )}

        {activeSection === "lines" && (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              {["Line Name", "Plant", "Zones", ""].map((h) => <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {lines.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {editId === l.id && editField === "name"
                      ? <InlineEdit value={l.name} onSave={(v) => handleSaveEdit("line", l.id, "name", v)} onCancel={() => { setEditId(null); setEditField(null); }} />
                      : l.name}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{plants.find((p) => p.id === l.plant_id)?.name || l.plant_id}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{zones.filter((z) => z.line_id === l.id).length}</td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setEditId(l.id); setEditField("name"); }} className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"><Pencil size={12} /></button>
                        <button onClick={() => setDelTarget({ id: l.id, type: "line", name: l.name })} className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={4}><EmptyState title="No lines" message="Add a line to a plant." /></td></tr>}
            </tbody>
          </table>
        )}

        {activeSection === "zones" && (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              {["Zone Name", "Type", "Line", "Plant", "Default Lang", ""].map((h) => <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {zones.map((z) => {
                const line  = lines.find((l) => l.id === z.line_id);
                const plant = plants.find((p) => p.id === z.plant_id || p.id === line?.plant_id);
                return (
                  <tr key={z.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {editId === z.id && editField === "name"
                        ? <InlineEdit value={z.name} onSave={(v) => handleSaveEdit("zone", z.id, "name", v)} onCancel={() => { setEditId(null); setEditField(null); }} />
                        : z.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{z.type}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{line?.name || z.line_id}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{plant?.name || "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {canEdit ? (
                        <select value={z.default_language || "EN"}
                          onChange={(e) => handleSaveEdit("zone", z.id, "default_language", e.target.value)}
                          className="border border-slate-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700">
                          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.code}</option>)}
                        </select>
                      ) : (
                        LANGUAGES.find((l) => l.code === z.default_language)?.flag + " " + (z.default_language || "EN")
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => { setEditId(z.id); setEditField("name"); }} className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"><Pencil size={12} /></button>
                          <button onClick={() => setDelTarget({ id: z.id, type: "zone", name: z.name })} className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {zones.length === 0 && <tr><td colSpan={6}><EmptyState title="No zones" message="Add zones to lines." /></td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!delTarget}
        title={`Delete ${delTarget?.type}`}
        message={`Delete "${delTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDelTarget(null)}
        variant="danger"
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function DevicesZones() {
  const LANGUAGES  = useAppConfigStore((s) => s.languages);
  const { devices, zones, plants, lines, loading, error, load, refreshDevices } = useDevices();
  const canEdit = useCan("aa.devices.edit");
  const showToast = useToast();
  const user = useAuthStore((s) => s.user);

  const [view, setView]                 = useState("devices"); // "devices" | "structure"
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [selectedPlant, setSelectedPlant]   = useState(null);
  const [selectedLine, setSelectedLine]     = useState(null);
  const [selectedZone, setSelectedZone]     = useState(null);
  const [expandedPlants, setExpandedPlants] = useState(new Set());
  const [expandedLines, setExpandedLines]   = useState(new Set());
  const [confirmAction, setConfirmAction]   = useState(null);
  const [addWizardOpen, setAddWizardOpen]   = useState(false);
  const [wizardStep, setWizardStep]         = useState(1);
  const [newDevice, setNewDevice]           = useState({ name: "", type: "Gateway", ip: "", mac: "", zone_id: "" });
  const [busyAction, setBusyAction]         = useState(null);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (plants.length) {
      setExpandedPlants(new Set(plants.map((p) => p.id)));
      setExpandedLines(new Set(lines.map((l) => l.id)));
    }
  }, [plants, lines]);

  const filteredDevices = devices.filter((d) => {
    if (selectedZone && d.zone_id !== selectedZone) return false;
    if (!selectedZone && selectedLine && !zones.filter((z) => z.line_id === selectedLine).some((z) => z.id === d.zone_id)) return false;
    if (!selectedZone && !selectedLine && selectedPlant && d.plant !== plants.find((p) => p.id === selectedPlant)?.name) return false;
    return true;
  });

  const handleTestFire = async (id) => {
    setBusyAction("test-" + id);
    const res = await testFireDevice(id);
    if (res.ok) showToast("Test beep sent successfully", "success");
    else showToast("Test fire failed", "error");
    setBusyAction(null); setConfirmAction(null);
  };

  const handleRestart = async (id) => {
    setBusyAction("restart-" + id);
    const res = await restartDevice(id, user?.username);
    if (res.ok) showToast("Restart command sent", "success");
    else showToast("Restart failed", "error");
    setBusyAction(null); setConfirmAction(null);
  };

  const handleAddDevice = async () => {
    const res = await addDevice(newDevice, user?.username);
    if (res.ok) { showToast("Device added", "success"); setAddWizardOpen(false); setWizardStep(1); await refreshDevices(); }
    else showToast("Failed to add device", "error");
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;

  return (
    <div className="flex flex-col gap-4">
      {/* View toggle */}
      <div className="flex gap-2">
        <button onClick={() => setView("devices")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === "devices" ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Devices
        </button>
        <button onClick={() => setView("structure")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === "structure" ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          <Building2 size={14} /> Plant Structure
        </button>
      </div>

      {/* Plant Structure view */}
      {view === "structure" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <PlantManagement showToast={showToast} />
        </div>
      )}

      {/* Devices view */}
      {view === "devices" && (
        <div className="flex gap-4 min-h-[560px]">
          {/* Left: Plant tree */}
          <div className="w-52 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-y-auto">
            <div className="p-3 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Plant Tree</p>
            </div>
            <div className="p-2 space-y-0.5">
              <button type="button" onClick={() => { setSelectedPlant(null); setSelectedLine(null); setSelectedZone(null); }}
                className={`w-full text-left px-2 py-1.5 rounded text-xs font-medium transition-colors ${!selectedPlant && !selectedLine && !selectedZone ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}>
                All Plants
              </button>
              {plants.map((plant) => {
                const plantLines = lines.filter((l) => l.plant_id === plant.id);
                const isExpanded = expandedPlants.has(plant.id);
                return (
                  <div key={plant.id}>
                    <button type="button"
                      onClick={() => {
                        setSelectedPlant(plant.id); setSelectedLine(null); setSelectedZone(null);
                        setExpandedPlants((s) => { const n = new Set(s); isExpanded ? n.delete(plant.id) : n.add(plant.id); return n; });
                      }}
                      className={`w-full text-left flex items-center gap-1 px-2 py-1.5 rounded text-xs font-semibold transition-colors ${selectedPlant === plant.id && !selectedLine ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"}`}>
                      {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      {plant.name}
                    </button>
                    {isExpanded && plantLines.map((line) => {
                      const lineZones  = zones.filter((z) => z.line_id === line.id);
                      const lineExpanded = expandedLines.has(line.id);
                      return (
                        <div key={line.id} className="ml-3">
                          <button type="button"
                            onClick={() => {
                              setSelectedPlant(plant.id); setSelectedLine(line.id); setSelectedZone(null);
                              setExpandedLines((s) => { const n = new Set(s); lineExpanded ? n.delete(line.id) : n.add(line.id); return n; });
                            }}
                            className={`w-full text-left flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${selectedLine === line.id && !selectedZone ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}>
                            {lineExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            {line.name}
                          </button>
                          {lineExpanded && lineZones.map((zone) => (
                            <button key={zone.id} type="button"
                              onClick={() => { setSelectedPlant(plant.id); setSelectedLine(line.id); setSelectedZone(zone.id); }}
                              className={`w-full text-left flex items-center gap-1 ml-2 px-2 py-1 rounded text-[11px] transition-colors ${selectedZone === zone.id ? "bg-indigo-100 text-indigo-700 font-semibold" : "text-slate-400 hover:bg-slate-50"}`}>
                              <MapPin size={9} className="shrink-0" />
                              {zone.name}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Center: Device table */}
          <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {filteredDevices.length} device{filteredDevices.length !== 1 ? "s" : ""}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => refreshDevices()} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"><RefreshCw size={14} /></button>
                {canEdit && <button type="button" onClick={() => setAddWizardOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700"><Plus size={13} /> Add Device</button>}
              </div>
            </div>
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    {["Name", "Type", "Zone", "IP", "Firmware", "Last Heartbeat", "Status", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredDevices.map((d) => (
                    <tr key={d.id} onClick={() => setSelectedDevice(d)}
                      className={`cursor-pointer hover:bg-slate-50/50 transition-colors ${selectedDevice?.id === d.id ? "bg-indigo-50/50" : ""}`}>
                      <td className="px-4 py-3 font-medium text-slate-800 text-sm">{d.name}</td>
                      <td className="px-4 py-3"><div className="flex items-center gap-1.5 text-xs"><DeviceTypeIcon type={d.type} />{d.type}</div></td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{d.zone_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{d.ip}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{d.firmware}</td>
                      <td className="px-4 py-3"><HeartbeatTime ts={d.last_heartbeat} /></td>
                      <td className="px-4 py-3"><StatusPill status={d.status} /></td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedDevice(d); }} className="p-1 rounded text-slate-400 hover:text-indigo-600">
                          <Settings size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredDevices.length === 0 && (
                    <tr><td colSpan={8}><EmptyState title="No devices" message="No devices match the current selection." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Device detail */}
          {selectedDevice && (
            <div className="w-72 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-y-auto">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{selectedDevice.name}</p>
                  <p className="text-xs text-slate-400">{selectedDevice.type} • {selectedDevice.ip}</p>
                </div>
                <button type="button" onClick={() => setSelectedDevice(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
              </div>
              <div className="p-4 flex flex-col gap-4">
                <StatusPill status={selectedDevice.status} />
                {selectedDevice.metrics && (
                  <div>
                    <p className={LABEL}>Live Metrics</p>
                    <div className="space-y-1">
                      {selectedDevice.type === "Gateway" && <>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">CPU</span><span className="font-mono font-semibold">{selectedDevice.metrics.cpu ?? "—"}%</span></div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Memory</span><span className="font-mono font-semibold">{selectedDevice.metrics.memory ?? "—"}%</span></div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Latency</span><span className="font-mono font-semibold">{selectedDevice.metrics.latency_ms ?? "—"} ms</span></div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Audio Queue</span><span className="font-mono font-semibold">{selectedDevice.metrics.audio_queue ?? 0}</span></div>
                      </>}
                      {selectedDevice.type === "Speaker" && <>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">SPL</span><span className="font-mono font-semibold">{selectedDevice.metrics.spl_db ?? "—"} dB</span></div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Impedance</span><span className="font-mono font-semibold">{selectedDevice.metrics.impedance_ohm ?? "—"} Ω</span></div>
                      </>}
                    </div>
                  </div>
                )}
                {canEdit && (
                  <div>
                    <p className={LABEL}>Actions</p>
                    <div className="flex flex-col gap-2">
                      <button type="button" onClick={() => setConfirmAction({ type: "test", id: selectedDevice.id, name: selectedDevice.name })}
                        className="w-full flex items-center gap-2 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-50 transition-colors">
                        <Zap size={12} /> Test Fire (Beep)
                      </button>
                      <button type="button" onClick={() => setConfirmAction({ type: "restart", id: selectedDevice.id, name: selectedDevice.name })}
                        className="w-full flex items-center gap-2 px-3 py-2 border border-amber-200 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-50 transition-colors">
                        <RotateCcw size={12} /> Restart Device
                      </button>
                    </div>
                  </div>
                )}
                {selectedDevice.events && selectedDevice.events.length > 0 && (
                  <div>
                    <p className={LABEL}>Recent Events</p>
                    <div className="space-y-1.5">
                      {selectedDevice.events.map((ev, i) => (
                        <div key={i} className="text-xs">
                          <p className="text-slate-700">{ev.msg}</p>
                          <p className="text-slate-400 font-mono">{timeAgo(ev.ts)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Device Wizard */}
      {addWizardOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAddWizardOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 z-10 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Add Device — Step {wizardStep}/3</h3>
              <button type="button" onClick={() => { setAddWizardOpen(false); setWizardStep(1); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            {wizardStep === 1 && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-500">Enter device details.</p>
                <div><label className={LABEL} htmlFor="dev-name">Device Name</label><input id="dev-name" className={INPUT} value={newDevice.name} onChange={(e) => setNewDevice((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Speaker-P1-Moulding-E" /></div>
                <div><label className={LABEL} htmlFor="dev-type">Device Type</label>
                  <select id="dev-type" className={INPUT} value={newDevice.type} onChange={(e) => setNewDevice((d) => ({ ...d, type: e.target.value }))}>
                    {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div><label className={LABEL} htmlFor="dev-ip">IP Address</label><input id="dev-ip" className={INPUT} value={newDevice.ip} onChange={(e) => setNewDevice((d) => ({ ...d, ip: e.target.value }))} placeholder="192.168.1.xx" /></div>
                <div><label className={LABEL} htmlFor="dev-mac">MAC Address</label><input id="dev-mac" className={INPUT} value={newDevice.mac} onChange={(e) => setNewDevice((d) => ({ ...d, mac: e.target.value }))} placeholder="AA:BB:CC:DD:EE:FF" /></div>
              </div>
            )}
            {wizardStep === 2 && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-500">Assign this device to a zone.</p>
                <div><label className={LABEL} htmlFor="dev-zone">Zone</label>
                  <select id="dev-zone" className={INPUT} value={newDevice.zone_id} onChange={(e) => setNewDevice((d) => ({ ...d, zone_id: e.target.value }))}>
                    <option value="">Select zone…</option>
                    {zones.map((z) => <option key={z.id} value={z.id}>{z.name} ({z.type})</option>)}
                  </select>
                </div>
              </div>
            )}
            {wizardStep === 3 && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-slate-500">Review and confirm.</p>
                <div className="bg-slate-50 rounded-lg p-4 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">Name:</span><span className="font-medium">{newDevice.name}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Type:</span><span className="font-medium">{newDevice.type}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">IP:</span><span className="font-mono">{newDevice.ip}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Zone:</span><span className="font-medium">{zones.find((z) => z.id === newDevice.zone_id)?.name ?? "—"}</span></div>
                </div>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-100">
              <button type="button" onClick={() => wizardStep > 1 ? setWizardStep((s) => s - 1) : setAddWizardOpen(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                {wizardStep === 1 ? "Cancel" : "Back"}
              </button>
              {wizardStep < 3
                ? <button type="button" onClick={() => setWizardStep((s) => s + 1)} disabled={wizardStep === 1 && !newDevice.name} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">Next</button>
                : <button type="button" onClick={handleAddDevice} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Save Device</button>
              }
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === "test" ? "Test Fire Device" : "Restart Device"}
        message={confirmAction?.type === "test" ? `Play a test beep on "${confirmAction?.name}"?` : `Restart "${confirmAction?.name}"? This will interrupt active playback.`}
        confirmLabel={confirmAction?.type === "test" ? "Fire Test Beep" : "Restart"}
        onConfirm={() => confirmAction?.type === "test" ? handleTestFire(confirmAction.id) : handleRestart(confirmAction.id)}
        onCancel={() => setConfirmAction(null)}
        variant={confirmAction?.type === "restart" ? "danger" : "primary"}
      />
    </div>
  );
}
