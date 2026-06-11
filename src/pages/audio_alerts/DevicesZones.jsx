import React, { useState, useEffect, useCallback } from "react";
import { Plus, ChevronRight, ChevronDown, Loader2, RefreshCw, MapPin, Building2, Pencil, Trash2, Check, X, WifiOff, Edit2, Globe, Save } from "lucide-react";
import { useDevices } from "./hooks/useDevices";
import { useCan } from "./hooks/useCan";
import {
  addDevice, updateDevice, getDeviceStatus,
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
import { targetUrl as BASE_URL } from "../../config";

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
  if (type === "Edge Node") return <span className="text-indigo-600 font-bold text-xs">EN</span>;
  return <span className="text-slate-500 font-bold text-xs">{(type || "DEV").slice(0, 3).toUpperCase()}</span>;
}

function HeartbeatTime({ ts }) {
  if (!ts) return <span className="text-slate-400">Never</span>;
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000);
  const color = sec < 60 ? "text-emerald-600" : sec < 300 ? "text-amber-600" : "text-red-600";
  return <span className={`font-mono text-xs ${color}`}>{timeAgo(ts)}</span>;
}

async function apiFetch(method, path, body) {
  try {
    const r = await fetch(path, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json();
    return { ok: r.ok && json.ok !== false, ...json };
  } catch (e) {
    return { ok: false, error: "Network error" };
  }
}

// ── Language Settings component ──────────────────────────────
const LANG_TYPES = [
  { key: "plant", label: "Plant-wise",  desc: "One language per plant — applies to all zones in that plant" },
  { key: "zone",  label: "Zone-wise",   desc: "Individual language per zone" },
  { key: "shift", label: "Shift-wise",  desc: "Language changes per shift (Morning / Afternoon / Night)" },
];
const SHIFTS = ["Morning", "Afternoon", "Night"];

function LanguageSettings({ plants, zones, languages, showToast, canEdit }) {
  const [activeType, setActiveType] = useState("zone");
  const [configs, setConfigs]       = useState({ plant: {}, zone: {}, shift: {} });
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch("GET", `${BASE_URL}/audio-alerts/zone-language-config`)
      .then((res) => {
        if (res.ok) {
          setActiveType(res.data?.active_type ?? "zone");
          setConfigs(res.data?.configs ?? { plant: {}, zone: {}, shift: {} });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const setLang = (type, refId, lang) =>
    setConfigs((c) => ({ ...c, [type]: { ...c[type], [refId]: lang } }));

  const handleSave = async () => {
    setSaving(true);
    const res = await apiFetch("PUT", `${BASE_URL}/audio-alerts/zone-language-config`, {
      active_type: activeType,
      configs,
      apply: true,
    });
    setSaving(false);
    if (res.ok) showToast("Language settings saved and applied to zones", "success");
    else showToast(res.error || "Save failed", "error");
  };

  const LangSelect = ({ value, onChange }) => (
    <select
      value={value || "EN"}
      onChange={(e) => onChange(e.target.value)}
      disabled={!canEdit}
      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400"
    >
      {languages.map((l) => <option key={l.code} value={l.code}>{l.code} — {l.label}</option>)}
    </select>
  );

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" /></div>;

  return (
    <div className="flex flex-col gap-5">
      {/* Type selector */}
      <div>
        <p className={LABEL + " mb-2"}>Language Assignment Mode</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LANG_TYPES.map((t) => (
            <button key={t.key} type="button"
              onClick={() => canEdit && setActiveType(t.key)}
              className={`text-left px-4 py-3 rounded-xl border transition-colors ${activeType === t.key ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"} ${!canEdit ? "cursor-default" : "cursor-pointer"}`}>
              <p className={`text-xs font-bold mb-0.5 ${activeType === t.key ? "text-indigo-700" : "text-slate-700"}`}>{t.label}</p>
              <p className="text-[11px] text-slate-400 leading-snug">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Plant-wise */}
      {activeType === "plant" && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className={LABEL}>Language per Plant</p>
          {plants.length === 0 && <p className="text-xs text-slate-400 italic">No plants configured.</p>}
          {plants.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-slate-700 flex-1">{p.name} <span className="text-xs text-slate-400">({p.location})</span></span>
              <LangSelect value={configs.plant[p.id] || "EN"} onChange={(v) => setLang("plant", p.id, v)} />
            </div>
          ))}
        </div>
      )}

      {/* Zone-wise */}
      {activeType === "zone" && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <p className={LABEL}>Language per Zone</p>
          {zones.length === 0 && <p className="text-xs text-slate-400 italic">No zones configured.</p>}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {zones.map((z) => (
              <div key={z.id} className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-700">{z.name}</span>
                  <span className="ml-1.5 text-[11px] text-slate-400">{z.type}</span>
                </div>
                <LangSelect value={configs.zone[z.id] || z.default_language || "EN"} onChange={(v) => setLang("zone", z.id, v)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shift-wise */}
      {activeType === "shift" && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className={LABEL}>Language per Shift</p>
          <p className="text-xs text-slate-400">The selected language will be applied to all zones during that shift.</p>
          {SHIFTS.map((s) => (
            <div key={s} className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-slate-700 w-28">{s}</span>
              <LangSelect value={configs.shift[s] || "EN"} onChange={(v) => setLang("shift", s, v)} />
            </div>
          ))}
        </div>
      )}

      {/* Save */}
      {canEdit && (
        <div className="flex justify-end">
          <button type="button" onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : "Save & Apply to Zones"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Plant Structure management panel ─────────────────────────
function PlantManagement({ showToast }) {
  const ZONE_TYPES        = useAppConfigStore((s) => s.zone_types);
  const LANGUAGES         = useAppConfigStore((s) => s.languages);
  const refreshLanguages  = useAppConfigStore((s) => s.refreshLanguages);
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
    await refreshLanguages();
    setLoading(false);
  }, [refreshLanguages]);

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
    if (!plant_id) { showToast("Could not determine plant for selected line", "error"); return; }
    const zoneType = newZone.type || (ZONE_TYPES[0] ?? "Custom");
    try {
      const res = await createZone({ ...newZone, type: zoneType, plant_id });
      if (res.ok) {
        showToast("Zone added", "success");
        setNewZone({ name: "", type: ZONE_TYPES[0] || "Custom", line_id: "", plant_id: "", default_language: "EN" });
        setAddOpen(false);
        reload();
      } else {
        showToast(res.error || "Failed to add zone", "error");
      }
    } catch (e) {
      showToast("Network error", "error");
    }
  };

  const SECTIONS = [
    { key: "plants",    label: "Plants",    count: plants.length },
    { key: "lines",     label: "Lines",     count: lines.length },
    { key: "zones",     label: "Zones",     count: zones.length },
    // { key: "languages", label: "Languages", count: null },
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
                    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
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
            {/* ["Zone Name", "Type", "Line", "Plant", "Default Lang", ""] */}
              {["Zone Name", "Type", "Line", "Plant", ""].map((h) => <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-600 uppercase tracking-wide">{h}</th>)}
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
                    {/* <td className="px-4 py-3 text-xs">
                      {canEdit ? (
                        <select value={z.default_language || "EN"}
                          onChange={(e) => handleSaveEdit("zone", z.id, "default_language", e.target.value)}
                          className="border border-slate-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700">
                          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.code}</option>)}
                        </select>
                      ) : (
                        LANGUAGES.find((l) => l.code === z.default_language)?.(z.default_language || "EN")
                      )}
                    </td> */}
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

        {/* ── Language Settings ────────────────────────────────────── */}
        {activeSection === "languages" && (
          <LanguageSettings
            plants={plants}
            zones={zones}
            languages={LANGUAGES}
            showToast={showToast}
            canEdit={canEdit}
          />
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
  const [addWizardOpen, setAddWizardOpen]   = useState(false);
  const [wizardStep, setWizardStep]         = useState(1);
  const [newDevice, setNewDevice]           = useState({ name: "", type: "Edge Node", ip: "", mac: "", zone_id: "" });

  // Heartbeat / status fetch state
  const [deviceStatus, setDeviceStatus]         = useState(null);
  const [deviceStatusLoading, setDeviceStatusLoading] = useState(false);
  const [deviceStatusError, setDeviceStatusError]     = useState(null);

  // Edit-IP modal state
  const [editIpOpen, setEditIpOpen]   = useState(false);
  const [editIpValue, setEditIpValue] = useState("");
  const [savingIp, setSavingIp]       = useState(false);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (plants.length) {
      setExpandedPlants(new Set(plants.map((p) => p.id)));
      setExpandedLines(new Set(lines.map((l) => l.id)));
    }
  }, [plants, lines]);

  // Fetch device status whenever selected device changes
  useEffect(() => {
    if (!selectedDevice?.id || !selectedDevice?.address) {
      setDeviceStatus(null);
      setDeviceStatusError(null);
      return;
    }
    setDeviceStatus(null);
    setDeviceStatusError(null);
    setDeviceStatusLoading(true);
    getDeviceStatus(selectedDevice.id)
      .then((res) => {
        if (res.ok) setDeviceStatus(res.data);
        else setDeviceStatusError(res.error || "Device unreachable");
      })
      .catch(() => setDeviceStatusError("Failed to connect to device"))
      .finally(() => setDeviceStatusLoading(false));
  }, [selectedDevice?.id]);

  const handleSaveIp = async () => {
    if (!editIpValue.trim() || !selectedDevice) return;
    setSavingIp(true);
    const res = await updateDevice(selectedDevice.id, { address: editIpValue.trim() });
    setSavingIp(false);
    if (res.ok) {
      showToast("IP address updated", "success");
      setEditIpOpen(false);
      setSelectedDevice((d) => ({ ...d, address: editIpValue.trim(), ip: editIpValue.trim() }));
      await refreshDevices();
    } else {
      showToast(res.error || "Failed to update IP", "error");
    }
  };

  // Exclude Modbus TCP / RTU devices — they are managed in the Modbus config pages
  const filteredDevices = devices
    .filter((d) => !d.type?.toLowerCase().includes("modbus"))
    .filter((d) => {
      if (selectedZone && d.zone_id !== selectedZone) return false;
      if (!selectedZone && selectedLine && !zones.filter((z) => z.line_id === selectedLine).some((z) => z.id === d.zone_id)) return false;
      if (!selectedZone && !selectedLine && selectedPlant && d.plant !== plants.find((p) => p.id === selectedPlant)?.name) return false;
      return true;
    });

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
                    {["Name", "Type", "Zone", "IP", "Last Heartbeat", "Status", ""].map((h) => (
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
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{d.address || d.ip || "—"}</td>
                      <td className="px-4 py-3"><HeartbeatTime ts={d.last_heartbeat} /></td>
                      <td className="px-4 py-3"><StatusPill status={d.status} /></td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedDevice(d); }} className="p-1 rounded text-slate-400 hover:text-indigo-600" title="View details">
                          <Edit2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredDevices.length === 0 && (
                    <tr><td colSpan={7}><EmptyState title="No devices" message="No devices match the current selection." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Device detail */}
          {selectedDevice && (
            <div className="w-80 shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-y-auto">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{selectedDevice.name}</p>
                  <p className="text-xs text-slate-400">{selectedDevice.type}</p>
                </div>
                <button type="button" onClick={() => setSelectedDevice(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
              </div>
              <div className="p-4 flex flex-col gap-4">
                <StatusPill status={selectedDevice.status} />

                {/* IP Address */}
                <div>
                  <p className={LABEL}>IP Address</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-700 flex-1">
                      {selectedDevice.address || selectedDevice.ip || <span className="text-slate-400 italic">Not set</span>}
                    </span>
                    {canEdit && (
                      <button type="button"
                        onClick={() => { setEditIpValue(selectedDevice.address || selectedDevice.ip || ""); setEditIpOpen(true); }}
                        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        title="Edit IP address">
                        <Edit2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Last Heartbeat (from DB) */}
                <div>
                  <p className={LABEL}>Last Heartbeat (DB)</p>
                  <HeartbeatTime ts={selectedDevice.last_heartbeat || selectedDevice.last_seen} />
                </div>

                {/* Live Status from device */}
                <div>
                  <p className={LABEL}>Live Device Status</p>
                  {!selectedDevice.address && !selectedDevice.ip ? (
                    <p className="text-xs text-slate-400 italic">No IP address configured</p>
                  ) : deviceStatusLoading ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Loader2 size={12} className="animate-spin" /> Fetching from device…
                    </div>
                  ) : deviceStatusError ? (
                    <div className="flex items-center gap-1.5 text-xs text-red-500">
                      <WifiOff size={12} /> {deviceStatusError}
                    </div>
                  ) : deviceStatus ? (
                    <div className="space-y-1 mt-1">
                      {Object.entries(deviceStatus).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs">
                          <span className="text-slate-500 capitalize">{k.replace(/_/g, " ")}</span>
                          <span className="font-mono font-semibold text-slate-700 max-w-[140px] truncate" title={String(v)}>
                            {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No status data</p>
                  )}
                </div>

                {selectedDevice.metrics && (
                  <div>
                    <p className={LABEL}>Stored Metrics</p>
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

                <div>
                  <p className={LABEL}>Actions</p>
                  <div className="flex flex-col gap-2">
                    <button type="button"
                      disabled={deviceStatusLoading || !selectedDevice.address}
                      onClick={() => {
                        if (!selectedDevice?.address) return;
                        setDeviceStatus(null);
                        setDeviceStatusError(null);
                        setDeviceStatusLoading(true);
                        getDeviceStatus(selectedDevice.id)
                          .then((res) => {
                            if (res.ok) setDeviceStatus(res.data);
                            else setDeviceStatusError(res.error || "Device unreachable");
                          })
                          .catch(() => setDeviceStatusError("Failed to connect"))
                          .finally(() => setDeviceStatusLoading(false));
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-50 transition-colors disabled:opacity-50">
                      {deviceStatusLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {deviceStatusLoading ? "Fetching Status…" : "Refresh Status"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit IP Modal */}
      {editIpOpen && selectedDevice && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditIpOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 z-10 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">Edit Device Details</h3>
              <button type="button" onClick={() => setEditIpOpen(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Device: <span className="font-medium text-slate-700">{selectedDevice.name}</span></p>
            </div>
            <div>
              <label className={LABEL} htmlFor="edit-ip">IP Address</label>
              <input
                id="edit-ip"
                className={INPUT}
                value={editIpValue}
                onChange={(e) => setEditIpValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveIp()}
                placeholder="e.g. 192.168.1.100"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
              <button type="button" onClick={() => setEditIpOpen(false)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={handleSaveIp} disabled={savingIp || !editIpValue.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                {savingIp ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
              </button>
            </div>
          </div>
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
                {/* <div><label className={LABEL} htmlFor="dev-mac">MAC Address</label><input id="dev-mac" className={INPUT} value={newDevice.mac} onChange={(e) => setNewDevice((d) => ({ ...d, mac: e.target.value }))} placeholder="AA:BB:CC:DD:EE:FF" /></div> */}
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

    </div>
  );
}
