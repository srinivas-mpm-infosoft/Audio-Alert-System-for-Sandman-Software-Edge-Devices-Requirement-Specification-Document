import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Save, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Upload, GripVertical } from "lucide-react";
import ZonePicker from "./components/ZonePicker";
import LanguagePicker from "./components/LanguagePicker";
import AudioPreviewButton from "./components/AudioPreviewButton";
import AlertTypeOverrideFields from "./components/AlertTypeOverrideFields";
import { getClips, uploadClip } from "./api/audio.api";

const INPUT = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700";
const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";
const SECTION = "bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4";

function blankStep() {
  return {
    title: "", audio_mode: "text", message: "", clip_id: "", language: null,
    type_code: null, play_count_override: null, requires_ack_override: null,
  };
}

function blank(initial) {
  return {
    name: initial?.name || "",
    description: initial?.description || "",
    zone_ids: initial?.zone_ids || [],
    plant_wide: initial?.plant_wide || false,
    ack_timeout_sec: initial?.ack_timeout_sec ?? 120,
    is_active: initial?.is_active ?? true,
    steps: initial?.steps?.length ? initial.steps.map((s) => ({ ...s })) : [blankStep()],
  };
}

function StepEditor({ step, index, total, clips, onChange, onRemove, onMoveUp, onMoveDown, onUpload, uploading }) {
  const fileRef = useRef(null);
  const set = (k, v) => onChange({ ...step, [k]: v });

  return (
    <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3 bg-slate-50/40">
      <div className="flex items-center gap-2">
        <GripVertical size={14} className="text-slate-300" aria-hidden="true" />
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Step {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onMoveUp} disabled={index === 0} className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 transition-colors" aria-label="Move step up">
            <ChevronUp size={14} />
          </button>
          <button type="button" onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 transition-colors" aria-label="Move step down">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={onRemove} className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" aria-label={`Remove step ${index + 1}`}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <input className={INPUT} value={step.title} onChange={(e) => set("title", e.target.value)} placeholder={`Step ${index + 1} title (e.g. "Confirm furnace door closed")`} />

      <div className="flex gap-3">
        {[{ v: "text", l: "Dynamic Text" }, { v: "clip", l: "Pre-Recorded Voice" }].map(({ v, l }) => (
          <label key={v} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name={`step-mode-${index}`} value={v} checked={step.audio_mode === v} onChange={() => set("audio_mode", v)} className="text-indigo-600" />
            <span className="text-sm text-slate-700">{l}</span>
          </label>
        ))}
      </div>

      {step.audio_mode === "text" ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className={LABEL}>Step Message</label>
            <textarea rows={2} className={`${INPUT} resize-none`} value={step.message} onChange={(e) => set("message", e.target.value)} placeholder="What the system should say for this step…" />
          </div>
          <LanguagePicker value={step.language} onChange={(v) => set("language", v)} label="Language" includeZoneDefault />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <select className={`${INPUT} flex-1`} value={step.clip_id} onChange={(e) => set("clip_id", e.target.value)}>
              <option value="">Select a clip…</option>
              {clips.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.duration_sec}s)</option>)}
            </select>
            {step.clip_id && <AudioPreviewButton payload={{ clip_id: step.clip_id }} label="Preview" />}
          </div>
          <div>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
              {uploading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Upload size={12} aria-hidden="true" />}
              {uploading ? "Uploading…" : "or upload a new MP3/WAV file"}
            </button>
            <input ref={fileRef} type="file" accept=".wav,.mp3,audio/*" className="hidden"
              onChange={(e) => { onUpload(e.target.files?.[0] || null, (clip) => set("clip_id", clip.id)); e.target.value = ""; }} />
          </div>
        </div>
      )}

      <AlertTypeOverrideFields
        value={step}
        onChange={onChange}
        typeLabel="Alert Type" defaultTypeLabel="Default (High)"
      />
    </div>
  );
}

export default function SopForm({ initialSop, onSave, onCancel }) {
  const [form, setForm] = useState(() => blank(initialSop));
  const [clips, setClips] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState([]);

  useEffect(() => { getClips().then((r) => { if (r.ok) setClips(r.data); }); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const updateStep = (i, next) => setForm((f) => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? next : s) }));
  const removeStep = (i) => setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }));
  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, blankStep()] }));
  const moveStep = (i, dir) => setForm((f) => {
    const steps = [...f.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return f;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...f, steps };
  });

  const handleUpload = async (file, onDone) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadClip({ name: file.name.replace(/\.[^.]+$/, ""), language: "EN" }, file);
      if (res.ok) { setClips((c) => [res.data, ...c]); onDone(res.data); }
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
    const errs = [];
    if (!form.name.trim()) errs.push("Name is required");
    if (!form.plant_wide && form.zone_ids.length === 0) errs.push("Select at least one target zone, or choose plant-wide");
    if (form.steps.length === 0) errs.push("Add at least one step");
    form.steps.forEach((s, i) => {
      if (!s.title.trim()) errs.push(`Step ${i + 1}: title is required`);
      if (s.audio_mode === "text" && !s.message?.trim()) errs.push(`Step ${i + 1}: message text is required`);
      if (s.audio_mode === "clip" && !s.clip_id) errs.push(`Step ${i + 1}: select an audio clip`);
    });
    if (form.ack_timeout_sec < 5) errs.push("Acknowledgement timeout must be at least 5 seconds");
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        zone_ids: form.plant_wide ? [] : form.zone_ids,
        plant_wide: form.plant_wide,
        ack_timeout_sec: form.ack_timeout_sec,
        is_active: form.is_active,
        steps: form.steps.map((s) => ({
          title: s.title.trim(),
          audio_mode: s.audio_mode,
          message: s.audio_mode === "text" ? s.message.trim() : null,
          clip_id: s.audio_mode === "clip" ? s.clip_id : null,
          language: s.language,
          type_code: s.type_code,
          play_count_override: s.play_count_override,
          requires_ack_override: s.requires_ack_override,
        })),
      };
      const res = await onSave(payload);
      if (!res?.ok) setErrors([res?.error || "Failed to save SOP"]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Back to SOPs">
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h2 className="text-lg font-bold text-slate-800">{initialSop ? "Edit SOP" : "New SOP"}</h2>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div className={SECTION}>
        <div>
          <label className={LABEL}>SOP Name</label>
          <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Furnace Startup Procedure" />
        </div>
        <div>
          <label className={LABEL}>Description</label>
          <textarea rows={2} className={`${INPUT} resize-none`} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What this SOP is for and when to run it…" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Acknowledgement Timeout (seconds)</label>
            <input type="number" min={5} max={3600} className={INPUT} value={form.ack_timeout_sec}
              onChange={(e) => set("ack_timeout_sec", Math.max(5, +e.target.value || 5))} />
            <p className="text-[10px] text-slate-400 mt-1">If a step isn't acknowledged within this time, it replays and the retry count increases. It never auto-advances.</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer self-end pb-2">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
            <span className="text-sm text-slate-700">Active (can be started from the dashboard)</span>
          </label>
        </div>
      </div>

      <div className={SECTION}>
        <label className={LABEL}>Target</label>
        <label className="flex items-center gap-2 cursor-pointer mb-1">
          <input type="checkbox" checked={form.plant_wide} onChange={(e) => set("plant_wide", e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
          <span className="text-sm text-slate-700 font-medium">Plant-wide (all zones)</span>
        </label>
        {!form.plant_wide && (
          <ZonePicker selected={form.zone_ids} onChange={(v) => set("zone_ids", v)} label="Target Zone(s)" />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className={LABEL}>Steps ({form.steps.length})</label>
          <button type="button" onClick={addStep} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold">
            <Plus size={13} aria-hidden="true" /> Add Step
          </button>
        </div>
        {form.steps.map((step, i) => (
          <StepEditor
            key={i} step={step} index={i} total={form.steps.length} clips={clips}
            onChange={(next) => updateStep(i, next)}
            onRemove={() => removeStep(i)}
            onMoveUp={() => moveStep(i, -1)}
            onMoveDown={() => moveStep(i, 1)}
            onUpload={handleUpload}
            uploading={uploading}
          />
        ))}
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1">
          {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
          Save SOP
        </button>
      </div>
    </div>
  );
}
