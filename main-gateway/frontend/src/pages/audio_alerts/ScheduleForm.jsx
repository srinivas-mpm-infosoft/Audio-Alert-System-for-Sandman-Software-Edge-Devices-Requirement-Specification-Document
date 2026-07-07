import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Save, Loader2, Upload } from "lucide-react";
import ZonePicker from "./components/ZonePicker";
import LanguagePicker from "./components/LanguagePicker";
import AudioPreviewButton from "./components/AudioPreviewButton";
import TimeWheelPicker from "./components/TimeWheelPicker";
import { getClips, uploadClip } from "./api/audio.api";

const INPUT = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700";
const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";
const SECTION = "bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4";

const DAYS = [
  { v: 0, l: "Mon" }, { v: 1, l: "Tue" }, { v: 2, l: "Wed" }, { v: 3, l: "Thu" },
  { v: 4, l: "Fri" }, { v: 5, l: "Sat" }, { v: 6, l: "Sun" },
];

function todayLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function blank(initial) {
  return {
    name: initial?.name || "",
    message: initial?.message || "",
    clip_id: initial?.clip_id || "",
    audio_mode: initial?.clip_id ? "clip" : "text",
    language: initial?.language || "EN",
    zone_ids: initial?.zone_ids || [],
    plant_wide: initial?.plant_wide || false,
    schedule_type: initial?.schedule_type || "once",
    scheduled_at: initial?.scheduled_at ? initial.scheduled_at.slice(0, 16) : "",
    days_of_week: initial?.days_of_week || [],
    time_of_day: initial?.time_of_day || "09:00",
    is_enabled: initial?.is_enabled ?? true,
  };
}

export default function ScheduleForm({ initialSchedule, onSave, onCancel }) {
  const [form, setForm] = useState(() => blank(initialSchedule));
  const [clips, setClips] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [clipUploading, setClipUploading] = useState(false);
  const clipFileRef = useRef(null);

  useEffect(() => { getClips().then((r) => { if (r.ok) setClips(r.data); }); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (d) => set("days_of_week", form.days_of_week.includes(d)
    ? form.days_of_week.filter((x) => x !== d) : [...form.days_of_week, d]);

  const handleInlineUpload = async (file) => {
    if (!file) return;
    setClipUploading(true);
    try {
      const res = await uploadClip({ name: file.name.replace(/\.[^.]+$/, ""), language: form.language }, file);
      if (res.ok) {
        setClips((c) => [res.data, ...c]);
        set("clip_id", res.data.id);
      }
    } finally {
      setClipUploading(false);
    }
  };

  const validate = () => {
    const errs = [];
    if (!form.name.trim()) errs.push("Name is required");
    if (form.audio_mode === "text" && !form.message.trim()) errs.push("Message text is required");
    if (form.audio_mode === "clip" && !form.clip_id) errs.push("Select an audio clip");
    if (!form.plant_wide && form.zone_ids.length === 0) errs.push("Select at least one zone, or choose plant-wide");
    if (form.schedule_type === "once" && !form.scheduled_at) errs.push("Pick a date/time for a one-off announcement");
    if (form.schedule_type === "weekly" && form.days_of_week.length === 0) errs.push("Select at least one day of the week");
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
        message: form.audio_mode === "text" ? form.message.trim() : null,
        clip_id: form.audio_mode === "clip" ? form.clip_id : null,
        language: form.language,
        zone_ids: form.plant_wide ? [] : form.zone_ids,
        plant_wide: form.plant_wide,
        schedule_type: form.schedule_type,
        scheduled_at: form.schedule_type === "once" ? new Date(form.scheduled_at).toISOString() : null,
        days_of_week: form.schedule_type === "weekly" ? form.days_of_week : [],
        time_of_day: form.schedule_type !== "once" ? form.time_of_day : null,
        is_enabled: form.is_enabled,
      };
      const res = await onSave(payload);
      if (!res?.ok) setErrors([res?.error || "Failed to save schedule"]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Back to schedules">
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <h2 className="text-lg font-bold text-slate-800">{initialSchedule ? "Edit Schedule" : "New Scheduled Announcement"}</h2>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div className={SECTION}>
        <div>
          <label className={LABEL}>Name</label>
          <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Morning Shift Start Reminder" />
        </div>

        <div>
          <label className={LABEL}>Announcement Content</label>
          <div className="flex gap-3 mb-2">
            {[{ v: "text", l: "Type message" }, { v: "clip", l: "Use pre-recorded clip" }].map(({ v, l }) => (
              <label key={v} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="sched-mode" value={v} checked={form.audio_mode === v} onChange={() => set("audio_mode", v)} className="text-indigo-600" />
                <span className="text-sm text-slate-700">{l}</span>
              </label>
            ))}
          </div>
          {form.audio_mode === "text" ? (
            <textarea rows={3} className={`${INPUT} resize-none`} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="Message to speak…" />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <select className={`${INPUT} flex-1`} value={form.clip_id} onChange={(e) => set("clip_id", e.target.value)}>
                  <option value="">Select a clip…</option>
                  {clips.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.duration_sec}s)</option>)}
                </select>
                {form.clip_id && <AudioPreviewButton payload={{ clip_id: form.clip_id }} label="Preview" />}
              </div>
              <div>
                <button type="button" onClick={() => clipFileRef.current?.click()} disabled={clipUploading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                  {clipUploading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Upload size={12} aria-hidden="true" />}
                  {clipUploading ? "Uploading…" : "or upload a new MP3/WAV file"}
                </button>
                <input ref={clipFileRef} type="file" accept=".wav,.mp3,audio/*" className="hidden"
                  onChange={(e) => { handleInlineUpload(e.target.files?.[0] || null); e.target.value = ""; }} />
              </div>
            </div>
          )}
        </div>

        <LanguagePicker value={form.language} onChange={(v) => set("language", v)} label="Language" />
      </div>

      <div className={SECTION}>
        <label className={LABEL}>Target</label>
        <label className="flex items-center gap-2 cursor-pointer mb-1">
          <input type="checkbox" checked={form.plant_wide} onChange={(e) => set("plant_wide", e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
          <span className="text-sm text-slate-700 font-medium">Plant-wide (all zones)</span>
        </label>
        {!form.plant_wide && (
          <ZonePicker selected={form.zone_ids} onChange={(v) => set("zone_ids", v)} label="Target Zones / Group" />
        )}
      </div>

      <div className={SECTION}>
        <label className={LABEL}>Schedule</label>
        <div className="flex gap-3 mb-2">
          {[{ v: "once", l: "One-time" }, { v: "daily", l: "Daily" }, { v: "weekly", l: "Weekly" }].map(({ v, l }) => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="sched-type" value={v} checked={form.schedule_type === v} onChange={() => set("schedule_type", v)} className="text-indigo-600" />
              <span className="text-sm text-slate-700">{l}</span>
            </label>
          ))}
        </div>

        {form.schedule_type === "once" && (() => {
          const datePart = form.scheduled_at ? form.scheduled_at.slice(0, 10) : "";
          const timePart = form.scheduled_at ? form.scheduled_at.slice(11, 16) : "09:00";
          return (
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className={LABEL}>Date</label>
                <input
                  type="date"
                  className={INPUT}
                  value={datePart}
                  onChange={(e) => set("scheduled_at", `${e.target.value}T${timePart}`)}
                />
              </div>
              <TimeWheelPicker
                value={timePart}
                onChange={(v) => set("scheduled_at", `${datePart || todayLocalDateString()}T${v}`)}
                label="Time"
              />
            </div>
          );
        })()}

        {form.schedule_type !== "once" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {form.schedule_type === "weekly" && (
              <div>
                <label className={LABEL}>Days of Week</label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d) => {
                    const active = form.days_of_week.includes(d.v);
                    return (
                      <button
                        key={d.v} type="button" onClick={() => toggleDay(d.v)}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${active ? "bg-indigo-100 text-indigo-700 border-indigo-300" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                      >
                        {d.l}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <TimeWheelPicker value={form.time_of_day} onChange={(v) => set("time_of_day", v)} label="Time of Day" />
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input type="checkbox" checked={form.is_enabled} onChange={(e) => set("is_enabled", e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
          <span className="text-sm text-slate-700">Enabled</span>
        </label>
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="button" onClick={handleSubmit} disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
        >
          {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
          Save Schedule
        </button>
      </div>
    </div>
  );
}
