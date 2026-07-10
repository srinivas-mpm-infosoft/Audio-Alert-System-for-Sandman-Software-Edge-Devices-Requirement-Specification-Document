import React, { useState, useEffect, useRef, useCallback } from "react";
import { Upload, Trash2, Plus, Loader2, Volume2, Pencil } from "lucide-react";
import { getClips, uploadClip, updateClip, deleteClip, getTemplates, createTemplate, updateTemplate, deleteTemplate, saveAudioConfig } from "./api/audio.api";
import { getZones, updateZone } from "./api/devices.api";
import { useAudioConfigStore } from "../../store/useAudioConfigStore";
import { useCan } from "./hooks/useCan";
import { useToast } from "../../components/ToastContext";
import { useAuthStore } from "../../store/useAuthStore";
import { useAppConfigStore } from "../../store/useAppConfigStore";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import RefreshButton from "./components/RefreshButton";
import { AUDIO_TYPES, PRIORITIES } from "./utils/constants";
import { formatFileSize, formatDate } from "./utils/formatters";
import AudioPreviewButton from "./components/AudioPreviewButton";

//const TABS_FULL = ["Voice Library", "TTS Templates", "Zones & Languages", "Volume & Audio Types"];
const TABS = ["Voice Library", "Zones & Languages"] // "Volume & Audio"];
const INPUT = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700";
const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";

export default function AudioConfig() {
  const [tab, setTab] = useState(0);
  const [clips, setClips] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [zones, setZones] = useState([]);
  const [zonesDirty, setZonesDirty] = useState({});
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteType, setDeleteType] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingClip, setEditingClip] = useState(null);
  const [editSelectedFile, setEditSelectedFile] = useState(null);
  const [newClip, setNewClip] = useState({ name: "", alert_code: "", language: "EN", description: "" });
  const [selectedFile, setSelectedFile] = useState(null);
  const [newTpl, setNewTpl] = useState({ name: "", alert_code: "", language: "EN", voice: "female", tone: "calm", body: "" });
  const [tplFormOpen, setTplFormOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState(null);
  const [audioSaving, setAudioSaving] = useState(false);
  const [zoneSaving, setZoneSaving] = useState(false);
  const fileRef = useRef(null);
  const editFileRef = useRef(null);

  const LANGUAGES = useAppConfigStore((s) => s.languages);
  const canUpload = useCan("aa.audio.upload");
  const canDelete = useCan("aa.audio.delete");
  const showToast = useToast();
  const user = useAuthStore((s) => s.user);
  const { masterVolume, zoneVolumes, priorityOffsets, audioTypes,
    setMasterVolume, setZoneVolume, setPriorityOffset, setAudioType,
    isDirty, markClean } = useAudioConfigStore();

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([getClips(), getTemplates(), getZones()]).then(([cr, tr, zr]) => {
      if (cr.ok) setClips(cr.data);
      if (tr.ok) setTemplates(tr.data);
      if (zr.ok) setZones(zr.data);
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── duplicate helpers ──────────────────────────────────────

  const clipNameExists = (name, excludeId = null) =>
    clips.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase() && c.id !== excludeId);
  const clipCodeExists = (code, excludeId = null) =>
    code && clips.some((c) => c.alert_code?.toLowerCase() === code.toLowerCase() && c.id !== excludeId);
  const tplNameExists = (name, excludeId = null) =>
    templates.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase() && t.id !== excludeId);
  const tplCodeExists = (code, excludeId = null) =>
    code && templates.some((t) => t.alert_code?.toLowerCase() === code.toLowerCase() && t.id !== excludeId);

  // ── Clips ──────────────────────────────────────────────────

  const handleDeleteClip = async () => {
    const res = await deleteClip(deleteTarget, user?.username);
    if (res.ok) { setClips((c) => c.filter((x) => x.id !== deleteTarget)); showToast("Clip deleted", "success"); }
    else showToast("Delete failed", "error");
    setDeleteTarget(null); setDeleteType(null);
  };

  const handleUpdateClip = async () => {
    if (!editingClip) return;
    if (clipNameExists(editingClip.name, editingClip.id)) {
      showToast(`A clip named "${editingClip.name}" already exists`, "error"); return;
    }
    if (clipCodeExists(editingClip.alert_code, editingClip.id)) {
      showToast(`Alert code "${editingClip.alert_code}" is already used by another clip`, "error"); return;
    }
    const res = await updateClip(editingClip.id, {
      name: editingClip.name,
      alert_code: editingClip.alert_code,
      language: editingClip.language,
      description: editingClip.description,
    }, editSelectedFile);
    if (res.ok) {
      setClips((c) => c.map((x) => x.id === editingClip.id ? res.data : x));
      showToast("Clip updated", "success");
      setEditingClip(null);
      setEditSelectedFile(null);
    } else showToast(res.error || "Update failed", "error");
  };

  const handleUploadClip = async () => {
    if (clipNameExists(newClip.name)) {
      showToast(`A clip named "${newClip.name}" already exists`, "error"); return;
    }
    if (clipCodeExists(newClip.alert_code)) {
      showToast(`Alert code "${newClip.alert_code}" is already used by another clip`, "error"); return;
    }
    const res = await uploadClip(newClip, selectedFile, user?.username);
    if (res.ok) {
      setClips((c) => [res.data, ...c]);
      showToast("Clip uploaded", "success");
      setUploadOpen(false);
      setNewClip({ name: "", alert_code: "", language: "EN", description: "" });
      setSelectedFile(null);
    } else showToast(res.error || "Upload failed", "error");
  };

  // ── TTS Templates ──────────────────────────────────────────

  const handleDeleteTemplate = async () => {
    const res = await deleteTemplate(deleteTarget, user?.username);
    if (res.ok) { setTemplates((t) => t.filter((x) => x.id !== deleteTarget)); showToast("Template deleted", "success"); }
    else showToast("Delete failed", "error");
    setDeleteTarget(null); setDeleteType(null);
  };

  const handleCreateTemplate = async () => {
    if (tplNameExists(newTpl.name)) {
      showToast(`A template named "${newTpl.name}" already exists`, "error"); return;
    }
    if (tplCodeExists(newTpl.alert_code)) {
      showToast(`Alert code "${newTpl.alert_code}" is already used by another template`, "error"); return;
    }
    const res = await createTemplate(newTpl, user?.username);
    if (res.ok) {
      setTemplates((t) => [res.data, ...t]);
      showToast("Template created", "success");
      setTplFormOpen(false);
      setNewTpl({ name: "", alert_code: "", language: "EN", voice: "female", tone: "calm", body: "" });
    } else showToast(res.error || "Failed to create template", "error");
  };

  const handleSaveTemplate = async () => {
    if (!editingTpl) return;
    if (tplNameExists(editingTpl.name, editingTpl.id)) {
      showToast(`A template named "${editingTpl.name}" already exists`, "error"); return;
    }
    if (tplCodeExists(editingTpl.alert_code, editingTpl.id)) {
      showToast(`Alert code "${editingTpl.alert_code}" is already used by another template`, "error"); return;
    }
    const res = await updateTemplate(editingTpl.id, editingTpl, user?.username);
    if (res.ok) {
      setTemplates((ts) => ts.map((t) => t.id === editingTpl.id ? res.data : t));
      showToast("Template updated", "success");
      setEditingTpl(null);
    } else showToast(res.error || "Update failed", "error");
  };

  // ── Zone Languages ─────────────────────────────────────────

  const handleZoneFieldChange = (zoneId, field, value) => {
    setZones((zs) => zs.map((z) => z.id === zoneId ? { ...z, [field]: value } : z));
    setZonesDirty((d) => ({ ...d, [zoneId]: { ...(d[zoneId] || {}), [field]: value } }));
  };

  const handleSaveZoneLanguages = async () => {
    if (Object.keys(zonesDirty).length === 0) { showToast("No changes to save", "info"); return; }
    setZoneSaving(true);
    let failed = 0;
    await Promise.all(
      Object.entries(zonesDirty).map(async ([id, updates]) => {
        const res = await updateZone(id, updates, user?.username);
        if (!res.ok) failed++;
      })
    );
    setZoneSaving(false);
    if (failed === 0) { showToast("Zone language settings saved", "success"); setZonesDirty({}); }
    else showToast(`${failed} zone(s) failed to save`, "error");
  };

  // ── Audio Settings ────────────────────────────────────────

  const handleSaveVolume = async () => {
    setAudioSaving(true);
    const res = await saveAudioConfig({
      master_volume: masterVolume,
      zone_volumes: zoneVolumes,
      priority_offsets: priorityOffsets,
      audio_types: audioTypes,
    });
    setAudioSaving(false);
    if (res.ok) { markClean(); showToast("Audio settings saved", "success"); }
    else showToast("Save failed", "error");
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100">
          <div className="flex overflow-x-auto" role="tablist">
            {TABS.map((t, i) => (
              <button key={i} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
                className={`px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none ${tab === i ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}>
                {t}
              </button>
            ))}
          </div>
          <RefreshButton onClick={loadAll} loading={loading} title="Refresh audio config" className="mr-3 shrink-0" />
        </div>

        <div className="p-5">

          {/* A. Voice Library — shared Pre-Recorded Audio Library (D1) */}
          {tab === 0 && (
            <div className="flex flex-col gap-4">
              {canUpload && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => setUploadOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold">
                    <Upload size={14} /> Upload Clip
                  </button>
                </div>
              )}
              {loading ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div> : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {clips.map((clip) => (
                    <div key={clip.id} className="border border-slate-200 rounded-xl p-4 flex flex-col gap-2 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 text-sm truncate">{clip.name}</p>
                          {clip.alert_code && <p className="text-xs text-indigo-600 font-mono">{clip.alert_code}</p>}
                        </div>
                        <span className="text-lg shrink-0">{LANGUAGES.find((l) => l.code === clip.language)?.flag ?? "🌐"}</span>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2">{clip.description}</p>
                      {clip.file_path && (
                        <p className="text-[10px] text-slate-300 font-mono truncate" title={clip.file_path}>{clip.file_path}</p>
                      )}
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        {clip.duration_sec && <span>{clip.duration_sec}s</span>}
                        {clip.file_size && <span>{formatFileSize(clip.file_size)}</span>}
                        {clip.format && <span>{clip.format}</span>}
                        <span className="ml-auto">{formatDate(clip.upload_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                        <AudioPreviewButton payload={{ clip_id: clip.id, language: clip.language }} label="Preview" />
                        {canUpload && (
                          <button type="button" onClick={() => { setEditingClip({ ...clip }); setEditSelectedFile(null); }}
                            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                            <Pencil size={13} />
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => { setDeleteTarget(clip.id); setDeleteType("clip"); }}
                            className={`p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors ${!canUpload ? "ml-auto" : ""}`}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {clips.length === 0 && <div className="col-span-3"><EmptyState title="No clips uploaded" message="Upload WAV or MP3 files to use in manual broadcasts, schedules, and SOP steps." /></div>}
                </div>
              )}
            </div>
          )}

          {/* B. TTS Templates */}
          {/* {tab === 1 && (
            <div className="flex flex-col gap-4">
              {canUpload && !editingTpl && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => setTplFormOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold">
                    <Plus size={14} /> New Template
                  </button>
                </div>
              )}

              {tplFormOpen && !editingTpl && (
                <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50 flex flex-col gap-3">
                  <h4 className="font-semibold text-slate-800">New TTS Template</h4>
                  <TplForm tpl={newTpl} setTpl={setNewTpl} />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setTplFormOpen(false)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                    <button onClick={handleCreateTemplate} disabled={!newTpl.name || !newTpl.body} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Create</button>
                  </div>
                </div>
              )}

              {templates.map((tpl) => (
                editingTpl?.id === tpl.id ? (
                  <div key={tpl.id} className="border border-amber-200 rounded-xl p-4 bg-amber-50 flex flex-col gap-3">
                    <h4 className="font-semibold text-slate-800 text-sm">Editing — {tpl.name}</h4>
                    <TplForm tpl={editingTpl} setTpl={setEditingTpl} />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingTpl(null)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
                      <button onClick={handleSaveTemplate} disabled={!editingTpl.name || !editingTpl.body} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Save Changes</button>
                    </div>
                  </div>
                ) : (
                  <div key={tpl.id} className="border border-slate-200 rounded-xl p-4 flex flex-col gap-2 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-slate-800">{tpl.name}</p>
                        <div className="flex gap-2 mt-1 text-xs text-slate-500 flex-wrap">
                          {tpl.alert_code && <span className="font-mono text-indigo-600 font-semibold">{tpl.alert_code}</span>}
                          {tpl.alert_code && <span>•</span>}
                          <span>{LANGUAGES.find((l) => l.code === tpl.language)?.flag} {LANGUAGES.find((l) => l.code === tpl.language)?.label}</span>
                          <span>•</span><span className="capitalize">{tpl.voice} voice</span>
                          <span>•</span><span className="capitalize">{tpl.tone} tone</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <AudioPreviewButton payload={{ template_id: tpl.id }} label="Preview" />
                        {canUpload && (
                          <button type="button" onClick={() => { setEditingTpl({ ...tpl }); setTplFormOpen(false); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                            <Pencil size={13} />
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => { setDeleteTarget(tpl.id); setDeleteType("template"); }}
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-mono text-slate-600 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">{tpl.body}</p>
                    {tpl.variables && <div className="flex flex-wrap gap-1">{tpl.variables.map((v) => <span key={v} className="text-[10px] font-mono bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{"{" + v + "}"}</span>)}</div>}
                  </div>
                )
              ))}
              {templates.length === 0 && !tplFormOpen && <EmptyState title="No templates" message="Create TTS templates with variable placeholders." />}
            </div>
          )} */}

          {/* C. Zones & Languages */}
          {tab === 1 && (
            <div className="flex flex-col gap-4">
              {Object.keys(zonesDirty).length > 0 && (
                <p className="text-xs text-amber-600 font-medium">You have unsaved language changes for {Object.keys(zonesDirty).length} zone(s).</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {/* ["Zone", "Default Language", "Fallback Language", "Morning", "Afternoon", "Night"] */}
                      {["Zone", "Audio Language"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {zones.map((zone) => (
                      <tr key={zone.id} className={`hover:bg-slate-50/50 ${zonesDirty[zone.id] ? "bg-amber-50/30" : ""}`}>
                        <td className="px-4 py-3 font-medium text-slate-800">{zone.name}</td>
                        {/* ["default_language", "fallback_language", "morning_language", "afternoon_language", "night_language"] */}
                        {["default_language"].map((field) => (
                          <td key={field} className="px-4 py-2">
                            <select
                              value={zone[field] ?? "EN"}
                              onChange={(e) => handleZoneFieldChange(zone.id, field, e.target.value)}
                              className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700"
                            >
                              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                            </select>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={handleSaveZoneLanguages} disabled={zoneSaving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
                  {zoneSaving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save Zone Languages"}
                </button>
              </div>
            </div>
          )}

          {/* D. Volume & Audio Types */}
          {tab === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <label className={LABEL} htmlFor="master-vol">Master Volume</label>
                <div className="flex items-center gap-4">
                  <input id="master-vol" type="range" min={0} max={100} value={masterVolume} onChange={(e) => setMasterVolume(+e.target.value)} className="flex-1 accent-indigo-600" />
                  <span className="w-12 text-right font-bold text-slate-700">{masterVolume}%</span>
                </div>
              </div>
              <div>
                <p className={LABEL}>Per-Priority Volume Offset (%)</p>
                <div className="space-y-3">
                  {PRIORITIES.map((p) => (
                    <div key={p} className="flex items-center gap-4">
                      <span className="w-20 text-sm font-medium text-slate-700">{p}</span>
                      <input type="range" min={-12} max={12} value={priorityOffsets[p] ?? 0}
                        onChange={(e) => setPriorityOffset(p, +e.target.value)} className="flex-1 accent-indigo-600" />
                      <span className="w-14 text-right font-bold text-slate-700 font-mono">{priorityOffsets[p] >= 0 ? "+" : ""}{priorityOffsets[p] ?? 0} %</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* <div>
                <p className={LABEL}>Audio Type per Priority</p>
                <div className="space-y-2">
                  {PRIORITIES.map((p) => (
                    <div key={p} className="flex items-center gap-4">
                      <span className="w-20 text-sm font-medium text-slate-700">{p}</span>
                      <select value={audioTypes[p] ?? "voice"} onChange={(e) => setAudioType(p, e.target.value)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700">
                        {AUDIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div> */}
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button type="button" onClick={handleSaveVolume} disabled={audioSaving}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
                  {audioSaving ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                  {audioSaving ? "Saving…" : "Save Audio Settings"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Clip Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setUploadOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 z-10 flex flex-col gap-4">
            <h3 className="font-bold text-slate-900">Upload Audio Clip</h3>
            <div><label className={LABEL} htmlFor="clip-name">Name *</label><input id="clip-name" className={INPUT} value={newClip.name} onChange={(e) => setNewClip((c) => ({ ...c, name: e.target.value }))} placeholder="Moisture High — EN" /></div>
            <div><label className={LABEL} htmlFor="clip-code">Alert Code</label><input id="clip-code" className={INPUT} value={newClip.alert_code} onChange={(e) => setNewClip((c) => ({ ...c, alert_code: e.target.value.toUpperCase() }))} placeholder="MOIST_HIGH" /></div>
            <div>
              <label className={LABEL} htmlFor="clip-lang">Language</label>
              <select id="clip-lang" className={INPUT} value={newClip.language} onChange={(e) => setNewClip((c) => ({ ...c, language: e.target.value }))}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
              </select>
            </div>
            <div><label className={LABEL} htmlFor="clip-desc">Description</label><textarea id="clip-desc" rows={2} className={INPUT} value={newClip.description} onChange={(e) => setNewClip((c) => ({ ...c, description: e.target.value }))} placeholder="What does this clip say?" /></div>
            <div>
              <label className={LABEL}>Audio File (WAV / MP3)</label>
              <div onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center text-slate-400 text-sm cursor-pointer hover:border-indigo-300 transition-colors">
                <Upload size={20} className="mx-auto mb-2 opacity-50" />
                {selectedFile
                  ? <p className="text-slate-700 font-medium">{selectedFile.name} <span className="text-xs text-slate-400">({formatFileSize(selectedFile.size)})</span></p>
                  : <p>Click to select WAV / MP3 file</p>}
              </div>
              <input ref={fileRef} type="file" accept=".wav,.mp3,audio/*" className="hidden"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setUploadOpen(false); setSelectedFile(null); }} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleUploadClip} disabled={!newClip.name} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Upload</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Clip Modal */}
      {editingClip && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setEditingClip(null); setEditSelectedFile(null); }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 z-10 flex flex-col gap-4">
            <h3 className="font-bold text-slate-900">Edit Audio Clip</h3>
            <div><label className={LABEL}>Name *</label><input className={INPUT} value={editingClip.name} onChange={(e) => setEditingClip((c) => ({ ...c, name: e.target.value }))} /></div>
            <div><label className={LABEL}>Alert Code</label><input className={INPUT} value={editingClip.alert_code ?? ""} onChange={(e) => setEditingClip((c) => ({ ...c, alert_code: e.target.value.toUpperCase() }))} /></div>
            <div>
              <label className={LABEL}>Language</label>
              <select className={INPUT} value={editingClip.language} onChange={(e) => setEditingClip((c) => ({ ...c, language: e.target.value }))}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
              </select>
            </div>
            <div><label className={LABEL}>Description</label><textarea rows={2} className={INPUT} value={editingClip.description ?? ""} onChange={(e) => setEditingClip((c) => ({ ...c, description: e.target.value }))} /></div>
            {/* Replace audio file */}
            <div>
              <label className={LABEL}>Replace Audio File (optional)</label>
              {editingClip.file_path && !editSelectedFile && (
                <p className="text-[11px] text-slate-400 font-mono mb-1 truncate" title={editingClip.file_path}>
                  Current: {editingClip.file_path.split("/").pop()}
                </p>
              )}
              <div onClick={() => editFileRef.current?.click()}
                className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center text-slate-400 text-sm cursor-pointer hover:border-indigo-300 transition-colors">
                <Upload size={16} className="mx-auto mb-1 opacity-50" />
                {editSelectedFile
                  ? <p className="text-slate-700 font-medium text-xs">{editSelectedFile.name} ({formatFileSize(editSelectedFile.size)})</p>
                  : <p className="text-xs">Click to replace audio file</p>}
              </div>
              <input ref={editFileRef} type="file" accept=".wav,.mp3,audio/*" className="hidden"
                onChange={(e) => setEditSelectedFile(e.target.files?.[0] || null)} />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setEditingClip(null); setEditSelectedFile(null); }} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleUpdateClip} disabled={!editingClip.name} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteType === "clip" ? "Delete Clip" : "Delete Template"}
        message="This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={deleteType === "clip" ? handleDeleteClip : handleDeleteTemplate}
        onCancel={() => { setDeleteTarget(null); setDeleteType(null); }}
        variant="danger"
      />
    </div>
  );
}

// ── Shared template form ───────────────────────────────────────
function TplForm({ tpl, setTpl }) {
  const PARAMETERS = useAppConfigStore((s) => s.parameters);
  const LANGUAGES  = useAppConfigStore((s) => s.languages);
  const textareaRef = useRef(null);

  const insertParam = (paramId) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const token = `{${paramId}}`;
    const newBody = tpl.body.slice(0, start) + token + tpl.body.slice(end);
    setTpl((t) => ({ ...t, body: newBody }));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + token.length, start + token.length); }, 0);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className={LABEL} htmlFor="tpl-name">Template Name *</label>
          <input id="tpl-name" className={INPUT} value={tpl.name} onChange={(e) => setTpl((t) => ({ ...t, name: e.target.value }))} placeholder="e.g. Critical Alert Template" />
        </div>
        <div>
          <label className={LABEL} htmlFor="tpl-alert-code">Alert Code</label>
          <input id="tpl-alert-code" className={INPUT} value={tpl.alert_code ?? ""} onChange={(e) => setTpl((t) => ({ ...t, alert_code: e.target.value.toUpperCase() }))} placeholder="e.g. MOIST_HIGH" />
        </div>
        <div>
          <label className={LABEL} htmlFor="tpl-lang">Language</label>
          <select id="tpl-lang" className={INPUT} value={tpl.language ?? "EN"} onChange={(e) => setTpl((t) => ({ ...t, language: e.target.value }))}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="tpl-voice">Voice</label>
          <select id="tpl-voice" className={INPUT} value={tpl.voice ?? "female"} onChange={(e) => setTpl((t) => ({ ...t, voice: e.target.value }))}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="tpl-tone">Tone</label>
          <select id="tpl-tone" className={INPUT} value={tpl.tone ?? "calm"} onChange={(e) => setTpl((t) => ({ ...t, tone: e.target.value }))}>
            <option value="calm">Calm</option>
            <option value="urgent">Urgent</option>
            <option value="neutral">Neutral</option>
          </select>
        </div>
      </div>

      <div>
        <label className={LABEL}>Insert Parameter</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {PARAMETERS.map((p) => (
            <button key={p.label} type="button" onClick={() => insertParam(p.label)}
              title={`${p.label}${p.unit ? " (" + p.unit + ")" : ""}`}
              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer">
              {"{" + p.label + "}"}
            </button>
          ))}
        </div>
        <label className={LABEL} htmlFor="tpl-body">Template Body *</label>
        <textarea ref={textareaRef} id="tpl-body" rows={4} className={INPUT} value={tpl.body ?? ""}
          onChange={(e) => setTpl((t) => ({ ...t, body: e.target.value }))}
          placeholder="Attention. {alert_code} in {zone}. Current value: {trigger_value} {unit}." />
        {tpl.body && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {[...new Set([...tpl.body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].map((v) => (
              <span key={v} className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{"{" + v + "}"}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
