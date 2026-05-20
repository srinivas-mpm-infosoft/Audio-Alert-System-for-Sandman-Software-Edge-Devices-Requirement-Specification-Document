import { useState, useEffect } from "react";
import { Plus, Trash2, Save, Loader2, X, Shield, Pencil, Check } from "lucide-react";
import { useAuthStore } from "../../store/useAuthStore";
import { useAppConfigStore } from "../../store/useAppConfigStore";
import { useToast } from "../../components/ToastContext";
import { saveAppSettings } from "./api/config.api";

const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";
const INPUT = "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 text-slate-700";
const SECTION = "bg-white rounded-xl border border-slate-200 shadow-sm p-5";

export default function AppSettings() {
  const user = useAuthStore((s) => s.user);
  const { languages: storeLangs, zone_types: storeZoneTypes, parameters: storeParams, setAppConfig } = useAppConfigStore();
  const showToast = useToast();

  const [languages, setLanguages] = useState(storeLangs);
  const [zoneTypes, setZoneTypes] = useState(storeZoneTypes);
  const [parameters, setParameters] = useState(storeParams);

  const [savingLang, setSavingLang] = useState(false);
  const [savingZone, setSavingZone] = useState(false);
  const [savingParam, setSavingParam] = useState(false);

  const [newLang, setNewLang] = useState({ code: "", label: "", flag: "" });
  const [newZone, setNewZone] = useState("");
  const [newParam, setNewParam] = useState({ id: "", label: "", unit: "" });

  const [editingLangCode, setEditingLangCode] = useState(null);
  const [editingLang, setEditingLang] = useState(null);

  useEffect(() => { setLanguages(storeLangs); }, [storeLangs]);
  useEffect(() => { setZoneTypes(storeZoneTypes); }, [storeZoneTypes]);
  useEffect(() => { setParameters(storeParams); }, [storeParams]);

  const isAdmin = user?.role === "administrator";
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <Shield className="h-12 w-12 text-slate-300 mx-auto mb-3" aria-hidden="true" />
        <p className="text-slate-500 font-medium">App Settings is restricted to administrators.</p>
      </div>
    );
  }

  // ── Languages ─────────────────────────────────────────────────
  const addLang = () => {
    const code = newLang.code.trim().toUpperCase();
    if (!code || !newLang.label.trim() || languages.some((l) => l.code === code)) return;
    setLanguages((l) => [...l, { code, label: newLang.label.trim(), flag: newLang.flag.trim() || "🌐" }]);
    setNewLang({ code: "", label: "", flag: "" });
  };

  const saveLangs = async () => {
    setSavingLang(true);
    const res = await saveAppSettings({ languages });
    if (res.ok) { setAppConfig({ languages: res.data?.languages ?? languages }); showToast("Languages saved", "success"); }
    else showToast("Failed to save languages", "error");
    setSavingLang(false);
  };

  // ── Zone Types ────────────────────────────────────────────────
  const addZoneType = () => {
    const t = newZone.trim();
    if (!t || zoneTypes.includes(t)) return;
    setZoneTypes((z) => [...z, t]);
    setNewZone("");
  };

  const saveZones = async () => {
    setSavingZone(true);
    const res = await saveAppSettings({ zone_types: zoneTypes });
    if (res.ok) { setAppConfig({ zone_types: res.data?.zone_types ?? zoneTypes }); showToast("Zone types saved", "success"); }
    else showToast("Failed to save zone types", "error");
    setSavingZone(false);
  };

  // ── Parameters ────────────────────────────────────────────────
  const addParam = () => {
    const id = newParam.id.trim().toLowerCase().replace(/\s+/g, "_");
    if (!id || !newParam.label.trim() || parameters.some((p) => p.id === id)) return;
    setParameters((p) => [...p, { id, label: newParam.label.trim(), unit: newParam.unit.trim() }]);
    setNewParam({ id: "", label: "", unit: "" });
  };

  const saveParams = async () => {
    setSavingParam(true);
    const res = await saveAppSettings({ parameters });
    if (res.ok) { setAppConfig({ parameters: res.data?.parameters ?? parameters }); showToast("Parameters saved", "success"); }
    else showToast("Failed to save parameters", "error");
    setSavingParam(false);
  };

  const SaveBtn = ({ saving, onClick }) => (
    <button onClick={onClick} disabled={saving}
      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
      {saving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />} Save
    </button>
  );

  return (
    <div className="flex flex-col gap-5">

      {/* Languages */}
      <div className={SECTION}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div>
            <h3 className="font-semibold text-slate-800">Languages</h3>
            <p className="text-xs text-slate-400 mt-0.5">Spoken languages available for audio clips and TTS templates</p>
          </div>
          <SaveBtn saving={savingLang} onClick={saveLangs} />
        </div>
        <div className="space-y-1.5 mb-4">
          {languages.map((l) => (
            editingLangCode === l.code ? (
              <div key={l.code} className="flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-200">
                <input className={`${INPUT} w-20 text-xs font-mono`} value={editingLang.flag} maxLength={4} placeholder="🇬🇧"
                  onChange={(e) => setEditingLang((x) => ({ ...x, flag: e.target.value }))} />
                <input className={`${INPUT} w-16 text-xs font-mono font-bold`} value={editingLang.code} maxLength={5}
                  onChange={(e) => setEditingLang((x) => ({ ...x, code: e.target.value.toUpperCase() }))} />
                <input className={`${INPUT} flex-1 text-sm`} value={editingLang.label}
                  onChange={(e) => setEditingLang((x) => ({ ...x, label: e.target.value }))} />
                <button onClick={() => {
                  const updated = { ...editingLang, code: editingLang.code.trim().toUpperCase(), label: editingLang.label.trim() };
                  if (!updated.code || !updated.label) return;
                  setLanguages((ls) => ls.map((x) => x.code === l.code ? updated : x));
                  setEditingLangCode(null); setEditingLang(null);
                }} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" aria-label="Confirm edit">
                  <Check size={14} />
                </button>
                <button onClick={() => { setEditingLangCode(null); setEditingLang(null); }}
                  className="p-1 text-slate-400 hover:bg-slate-100 rounded" aria-label="Cancel edit">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div key={l.code} className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg">
                <span className="text-lg w-7 text-center shrink-0">{l.flag}</span>
                <span className="font-mono text-xs font-bold text-indigo-600 w-8 shrink-0">{l.code}</span>
                <span className="text-sm text-slate-700 flex-1">{l.label}</span>
                <button onClick={() => { setEditingLangCode(l.code); setEditingLang({ ...l }); }}
                  className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" aria-label={`Edit ${l.label}`}>
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button onClick={() => setLanguages((ls) => ls.filter((x) => x.code !== l.code))}
                  className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" aria-label={`Remove ${l.label}`}>
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            )
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div><label className={LABEL}>Code</label>
            <input className={`${INPUT} w-20`} value={newLang.code} maxLength={5} placeholder="EN"
              onChange={(e) => setNewLang((l) => ({ ...l, code: e.target.value.toUpperCase() }))} /></div>
          <div><label className={LABEL}>Label</label>
            <input className={`${INPUT} w-36`} value={newLang.label} placeholder="English"
              onChange={(e) => setNewLang((l) => ({ ...l, label: e.target.value }))} /></div>
          <div><label className={LABEL}>Flag emoji</label>
            <input className={`${INPUT} w-24`} value={newLang.flag} placeholder="🇬🇧"
              onChange={(e) => setNewLang((l) => ({ ...l, flag: e.target.value }))} /></div>
          <button onClick={addLang}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 self-end transition-colors">
            <Plus size={13} aria-hidden="true" /> Add
          </button>
        </div>
      </div>

      {/* Zone Types */}
      <div className={SECTION}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div>
            <h3 className="font-semibold text-slate-800">Zone Types</h3>
            <p className="text-xs text-slate-400 mt-0.5">Categories for classifying production zones</p>
          </div>
          <SaveBtn saving={savingZone} onClick={saveZones} />
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {zoneTypes.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-sm font-medium">
              {t}
              <button onClick={() => setZoneTypes((z) => z.filter((x) => x !== t))}
                className="text-slate-400 hover:text-red-500 transition-colors" aria-label={`Remove ${t}`}>
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input className={`${INPUT} flex-1 max-w-xs`} value={newZone} placeholder="New zone type…"
            onChange={(e) => setNewZone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addZoneType()} />
          <button onClick={addZoneType}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            <Plus size={13} aria-hidden="true" /> Add
          </button>
        </div>
      </div>

      {/* Parameters */}
      <div className={SECTION}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div>
            <h3 className="font-semibold text-slate-800">Process Parameters</h3>
            <p className="text-xs text-slate-400 mt-0.5">Measurable process variables used in alert rule conditions</p>
          </div>
          <SaveBtn saving={savingParam} onClick={saveParams} />
        </div>
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                {["ID", "Label", "Unit", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {parameters.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.id}</td>
                  <td className="px-3 py-2 text-slate-700">{p.label}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.unit || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setParameters((ps) => ps.filter((x) => x.id !== p.id))}
                      className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" aria-label={`Remove ${p.label}`}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div><label className={LABEL}>ID</label>
            <input className={`${INPUT} w-40`} value={newParam.id} placeholder="sand_temp"
              onChange={(e) => setNewParam((p) => ({ ...p, id: e.target.value.toLowerCase().replace(/\s+/g, "_") }))} /></div>
          <div><label className={LABEL}>Label</label>
            <input className={`${INPUT} w-52`} value={newParam.label} placeholder="Sand Temperature"
              onChange={(e) => setNewParam((p) => ({ ...p, label: e.target.value }))} /></div>
          <div><label className={LABEL}>Unit</label>
            <input className={`${INPUT} w-20`} value={newParam.unit} placeholder="°C"
              onChange={(e) => setNewParam((p) => ({ ...p, unit: e.target.value }))} /></div>
          <button onClick={addParam}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 self-end transition-colors">
            <Plus size={13} aria-hidden="true" /> Add
          </button>
        </div>
      </div>

    </div>
  );
}
