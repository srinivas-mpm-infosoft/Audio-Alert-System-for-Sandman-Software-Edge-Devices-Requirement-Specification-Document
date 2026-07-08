import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowLeft, Save, Loader2, Upload, Zap, RotateCw, Users, CalendarDays,
  CalendarRange, CalendarCheck, Power,
} from "lucide-react";
import ZonePicker from "./components/ZonePicker";
import LanguagePicker from "./components/LanguagePicker";
import AudioPreviewButton from "./components/AudioPreviewButton";
import TimeWheelPicker from "./components/TimeWheelPicker";
import { getClips, uploadClip } from "./api/audio.api";
import { getShiftTimes } from "./api/config.api";
import { scheduleSummary } from "./utils/scheduleSummary";

const INPUT = "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 text-slate-700";
const LABEL = "text-sm font-semibold text-slate-600 mb-1.5 block";
const SECTION = "bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4";
const SECTION_TITLE = "text-base font-bold text-slate-800";

const DAYS = [
  { v: 0, l: "Mon" }, { v: 1, l: "Tue" }, { v: 2, l: "Wed" }, { v: 3, l: "Thu" },
  { v: 4, l: "Fri" }, { v: 5, l: "Sat" }, { v: 6, l: "Sun" },
];

const WHEN_OPTIONS = [
  { v: "quick", label: "Soon", sub: "Play in the next few minutes", icon: Zap },
  { v: "hourly", label: "Hourly", sub: "Repeats every hour or few hours", icon: RotateCw },
  { v: "shift", label: "Shift-Based", sub: "Tied to a shift start, end, or break", icon: Users },
  { v: "daily", label: "Daily", sub: "Same time every day", icon: CalendarDays },
  { v: "weekly", label: "Weekly", sub: "Specific days of the week", icon: CalendarRange },
  { v: "once", label: "One Time", sub: "A specific date and time", icon: CalendarCheck },
];

const QUICK_PRESETS = [
  { label: "In 5 minutes", minutes: 5 },
  { label: "In 10 minutes", minutes: 10 },
  { label: "In 15 minutes", minutes: 15 },
  { label: "In 30 minutes", minutes: 30 },
  { label: "In 1 hour", minutes: 60 },
];

const OFFSET_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const HOURLY_INTERVALS = [1, 2, 3, 4, 6, 8, 12];
const HOURLY_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function todayLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowLocalTimeString() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Derive the guided "When" bucket + UI-only flags from a schedule loaded for editing. */
function whenModeFor(initial) {
  if (!initial) return "quick";
  if (initial.schedule_type === "weekly") return "weekly";
  if (["hourly", "shift", "daily", "once"].includes(initial.schedule_type)) return initial.schedule_type;
  return "once";
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
    whenMode: whenModeFor(initial),
    scheduled_at: initial?.scheduled_at ? initial.scheduled_at.slice(0, 16) : "",
    days_of_week: initial?.days_of_week || [],
    time_of_day: initial?.time_of_day || "09:00",
    dailyWorkingDaysOnly: false,
    interval_hours: initial?.interval_hours || 1,
    hourly_minute: initial?.schedule_type === "hourly" ? Number((initial.time_of_day || "00:00").split(":")[1]) : 0,
    shift_name: initial?.shift_name || "",
    shift_event: initial?.shift_event || "start",
    shift_offset_min: Math.abs(initial?.shift_offset_min || 15),
    shift_offset_before: (initial?.shift_offset_min || 0) < 0,
    is_enabled: initial?.is_enabled ?? true,
  };
}

/** Build the actual API payload (schedule_type + backend fields) from the
 * guided-flow form state. This is the one place UI buckets map to the small
 * set of schedule_types the backend actually understands. */
function toPayload(form) {
  const base = {
    name: form.name.trim(),
    message: form.audio_mode === "text" ? form.message.trim() : null,
    clip_id: form.audio_mode === "clip" ? form.clip_id : null,
    language: form.language,
    zone_ids: form.plant_wide ? [] : form.zone_ids,
    plant_wide: form.plant_wide,
    is_enabled: form.is_enabled,
    scheduled_at: null, days_of_week: [], time_of_day: null,
    interval_hours: null, shift_name: null, shift_event: null, shift_offset_min: 0,
  };

  if (form.whenMode === "quick" || form.whenMode === "once") {
    const parsed = form.scheduled_at ? new Date(form.scheduled_at) : null;
    const valid = parsed && !Number.isNaN(parsed.getTime());
    return { ...base, schedule_type: "once", scheduled_at: valid ? parsed.toISOString() : null };
  }
  if (form.whenMode === "hourly") {
    return { ...base, schedule_type: "hourly", interval_hours: form.interval_hours,
             time_of_day: `00:${String(form.hourly_minute).padStart(2, "0")}` };
  }
  if (form.whenMode === "shift") {
    return {
      ...base, schedule_type: "shift", shift_name: form.shift_name, shift_event: form.shift_event,
      shift_offset_min: form.shift_event === "offset"
        ? (form.shift_offset_before ? -form.shift_offset_min : form.shift_offset_min)
        : 0,
    };
  }
  if (form.whenMode === "daily") {
    return form.dailyWorkingDaysOnly
      ? { ...base, schedule_type: "weekly", days_of_week: [0, 1, 2, 3, 4], time_of_day: form.time_of_day }
      : { ...base, schedule_type: "daily", time_of_day: form.time_of_day };
  }
  // weekly
  return { ...base, schedule_type: "weekly", days_of_week: form.days_of_week, time_of_day: form.time_of_day };
}

/** Shared date+time picker for "scheduled_at" — used by both the quick
 * schedule's custom-time option and the plain one-time date/time fields. */
function DateTimeFields({ value, onChange, defaultTime }) {
  const datePart = value ? value.slice(0, 10) : todayLocalDateString();
  const timePart = value ? value.slice(11, 16) : defaultTime;
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className={LABEL}>Date</label>
        <input type="date" className={INPUT} style={{ width: 170 }} value={datePart}
          onChange={(e) => onChange(`${e.target.value}T${timePart}`)} />
      </div>
      <TimeWheelPicker value={timePart} onChange={(v) => onChange(`${datePart}T${v}`)} label="Time" />
    </div>
  );
}

function OptionCard({ active, onClick, icon: Icon, label, sub }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all min-h-[92px] ${
        active ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
      aria-pressed={active}
    >
      <Icon size={20} className={active ? "text-indigo-600" : "text-slate-400"} aria-hidden="true" />
      <span className={`text-sm font-bold ${active ? "text-indigo-700" : "text-slate-700"}`}>{label}</span>
      <span className="text-xs text-slate-400 leading-snug">{sub}</span>
    </button>
  );
}

export default function ScheduleForm({ initialSchedule, onSave, onCancel }) {
  const [form, setForm] = useState(() => blank(initialSchedule));
  const [clips, setClips] = useState([]);
  const [shiftsConfig, setShiftsConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [clipUploading, setClipUploading] = useState(false);
  const clipFileRef = useRef(null);

  useEffect(() => { getClips().then((r) => { if (r.ok) setClips(r.data); }); }, []);
  useEffect(() => {
    getShiftTimes().then((r) => {
      if (r.ok) {
        setShiftsConfig(r.data);
        const firstShift = Object.keys(r.data)[0];
        if (firstShift) setForm((f) => ({ ...f, shift_name: f.shift_name || firstShift }));
      }
    });
  }, []);

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

  const setQuickPreset = (minutes) => {
    const target = new Date(Date.now() + minutes * 60000);
    const y = target.getFullYear(), mo = String(target.getMonth() + 1).padStart(2, "0"), d = String(target.getDate()).padStart(2, "0");
    const hh = String(target.getHours()).padStart(2, "0"), mm = String(target.getMinutes()).padStart(2, "0");
    set("scheduled_at", `${y}-${mo}-${d}T${hh}:${mm}`);
  };

  const validate = () => {
    const errs = [];
    if (!form.name.trim()) errs.push("Give this announcement a name");
    if (form.audio_mode === "text" && !form.message.trim()) errs.push("Type the message to announce");
    if (form.audio_mode === "clip" && !form.clip_id) errs.push("Choose an audio clip");
    if (!form.plant_wide && form.zone_ids.length === 0) errs.push("Choose where it should play");
    if ((form.whenMode === "quick" || form.whenMode === "once") && !form.scheduled_at) errs.push("Pick when it should play");
    if (form.whenMode === "weekly" && form.days_of_week.length === 0) errs.push("Pick at least one day of the week");
    if (form.whenMode === "shift" && !form.shift_name) errs.push("Choose a shift");
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length) return;
    setSaving(true);
    try {
      const res = await onSave(toPayload(form));
      if (!res?.ok) setErrors([res?.error || "Could not save this announcement"]);
    } finally {
      setSaving(false);
    }
  };

  const previewSchedule = useMemo(() => toPayload(form), [form]);
  const summaryText = scheduleSummary(previewSchedule, shiftsConfig);
  const shiftNames = shiftsConfig ? Object.keys(shiftsConfig) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" aria-label="Back to schedules">
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <h2 className="text-lg font-bold text-slate-800">{initialSchedule ? "Edit Announcement" : "New Scheduled Announcement"}</h2>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {/* 1. Enable — always first, always obvious */}
      <div className={SECTION}>
        <button
          type="button"
          onClick={() => set("is_enabled", !form.is_enabled)}
          className={`flex items-center justify-between gap-3 rounded-xl border-2 p-4 text-left transition-colors ${
            form.is_enabled ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-slate-50"
          }`}
        >
          <span className="flex items-center gap-3">
            <Power size={22} className={form.is_enabled ? "text-emerald-600" : "text-slate-400"} aria-hidden="true" />
            <span>
              <span className="block text-base font-bold text-slate-800">Enable this announcement</span>
              <span className={`block text-sm font-semibold ${form.is_enabled ? "text-emerald-700" : "text-slate-500"}`}>
                {form.is_enabled ? "Enabled — will play as scheduled" : "Disabled — will not play"}
              </span>
            </span>
          </span>
          <span className={`shrink-0 w-14 h-8 rounded-full flex items-center px-1 transition-colors ${form.is_enabled ? "bg-emerald-500 justify-end" : "bg-slate-300 justify-start"}`}>
            <span className="w-6 h-6 rounded-full bg-white shadow" />
          </span>
        </button>
      </div>

      {/* 2. What should be announced? */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>What should be announced?</h3>
        <div>
          <label className={LABEL}>Name</label>
          <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Morning Safety Reminder" />
        </div>

        <div>
          <label className={LABEL}>Message</label>
          <div className="flex gap-3 mb-2">
            {[{ v: "text", l: "Type a message" }, { v: "clip", l: "Use a recorded clip" }].map(({ v, l }) => (
              <label key={v} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="sched-mode" value={v} checked={form.audio_mode === v} onChange={() => set("audio_mode", v)} className="text-indigo-600" />
                <span className="text-sm text-slate-700">{l}</span>
              </label>
            ))}
          </div>
          {form.audio_mode === "text" ? (
            <textarea rows={3} className={`${INPUT} resize-none`} value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="What should be said…" />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <select className={`${INPUT} flex-1`} value={form.clip_id} onChange={(e) => set("clip_id", e.target.value)}>
                  <option value="">Choose a clip…</option>
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

      {/* 3. When should it play? */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>When should it play?</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {WHEN_OPTIONS.map((opt) => (
            <OptionCard key={opt.v} active={form.whenMode === opt.v} onClick={() => set("whenMode", opt.v)} {...opt} />
          ))}
        </div>

        {form.whenMode === "quick" && (
          <div className="flex flex-col gap-3 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap gap-2">
              {QUICK_PRESETS.map((p) => (
                <button key={p.minutes} type="button" onClick={() => setQuickPreset(p.minutes)}
                  className="px-4 py-2.5 rounded-lg border-2 border-slate-200 hover:border-indigo-400 text-sm font-semibold text-slate-700">
                  {p.label}
                </button>
              ))}
            </div>
            <div>
              <label className={LABEL}>Or pick a custom date & time</label>
              <DateTimeFields value={form.scheduled_at} onChange={(v) => set("scheduled_at", v)} defaultTime={nowLocalTimeString()} />
            </div>
          </div>
        )}

        {form.whenMode === "once" && (
          <div className="pt-2 border-t border-slate-100">
            <DateTimeFields value={form.scheduled_at} onChange={(v) => set("scheduled_at", v)} defaultTime="09:00" />
          </div>
        )}

        {form.whenMode === "hourly" && (
          <div className="flex flex-wrap items-end gap-6 pt-2 border-t border-slate-100">
            <div>
              <label className={LABEL}>Every how many hours?</label>
              <select className={INPUT} value={form.interval_hours} onChange={(e) => set("interval_hours", Number(e.target.value))}>
                {HOURLY_INTERVALS.map((h) => <option key={h} value={h}>{h === 1 ? "Every hour" : `Every ${h} hours`}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>At how many minutes past the hour?</label>
              <select className={INPUT} value={form.hourly_minute} onChange={(e) => set("hourly_minute", Number(e.target.value))}>
                {HOURLY_MINUTES.map((m) => <option key={m} value={m}>{m === 0 ? "On the hour (:00)" : `:${String(m).padStart(2, "0")}`}</option>)}
              </select>
            </div>
          </div>
        )}

        {form.whenMode === "shift" && (
          <div className="flex flex-col gap-4 pt-2 border-t border-slate-100">
            {shiftNames.length === 0 ? (
              <p className="text-sm text-slate-400">No shifts are configured yet. Set them up in Admin Settings → Shift Times.</p>
            ) : (
              <>
                <div>
                  <label className={LABEL}>Which shift?</label>
                  <div className="flex flex-wrap gap-2">
                    {shiftNames.map((name) => (
                      <button key={name} type="button" onClick={() => set("shift_name", name)}
                        className={`px-4 py-2.5 rounded-lg border-2 text-sm font-semibold ${form.shift_name === name ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}>
                        {name} ({shiftsConfig[name].start}–{shiftsConfig[name].end})
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={LABEL}>When during the shift?</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { v: "start", l: "At the start" },
                      { v: "end", l: "At the end" },
                      { v: "offset", l: "At a specific time during it" },
                    ].map((opt) => (
                      <button key={opt.v} type="button" onClick={() => set("shift_event", opt.v)}
                        className={`px-4 py-2.5 rounded-lg border-2 text-sm font-semibold ${form.shift_event === opt.v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                </div>
                {form.shift_event === "offset" && (
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className={LABEL}>Before or after the shift starts?</label>
                      <div className="flex gap-2">
                        {[{ v: true, l: "Before start" }, { v: false, l: "After start" }].map((opt) => (
                          <button key={String(opt.v)} type="button" onClick={() => set("shift_offset_before", opt.v)}
                            className={`px-4 py-2.5 rounded-lg border-2 text-sm font-semibold ${form.shift_offset_before === opt.v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}>
                            {opt.l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={LABEL}>How many minutes?</label>
                      <select className={INPUT} value={form.shift_offset_min} onChange={(e) => set("shift_offset_min", Number(e.target.value))}>
                        {OFFSET_PRESETS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {form.whenMode === "daily" && (
          <div className="flex flex-wrap items-end gap-6 pt-2 border-t border-slate-100">
            <div>
              <label className={LABEL}>Which days?</label>
              <div className="flex gap-2">
                {[{ v: false, l: "Every day" }, { v: true, l: "Working days only" }].map((opt) => (
                  <button key={String(opt.v)} type="button" onClick={() => set("dailyWorkingDaysOnly", opt.v)}
                    className={`px-4 py-2.5 rounded-lg border-2 text-sm font-semibold ${form.dailyWorkingDaysOnly === opt.v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}>
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
            <TimeWheelPicker value={form.time_of_day} onChange={(v) => set("time_of_day", v)} label="Time" />
          </div>
        )}

        {form.whenMode === "weekly" && (
          <div className="flex flex-wrap items-end gap-6 pt-2 border-t border-slate-100">
            <div>
              <label className={LABEL}>Which days?</label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const active = form.days_of_week.includes(d.v);
                  return (
                    <button
                      key={d.v} type="button" onClick={() => toggleDay(d.v)}
                      className={`px-3.5 py-2 rounded-full text-sm font-semibold border-2 transition-all ${active ? "bg-indigo-100 text-indigo-700 border-indigo-400" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </div>
            <TimeWheelPicker value={form.time_of_day} onChange={(v) => set("time_of_day", v)} label="Time" />
          </div>
        )}
      </div>

      {/* 4. Where should it play? */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Where should it play?</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.plant_wide} onChange={(e) => set("plant_wide", e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-indigo-600" />
          <span className="text-sm text-slate-700 font-medium">Everywhere (plant-wide)</span>
        </label>
        {!form.plant_wide && (
          <ZonePicker selected={form.zone_ids} onChange={(v) => set("zone_ids", v)} label="Edge Nodes / Zones" />
        )}
      </div>

      {/* 5. Review */}
      <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-5">
        <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-widest mb-1.5">Before you save</p>
        <p className="text-base font-semibold text-indigo-900">{summaryText}</p>
      </div>

      {/* 6. Save */}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-5 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="button" onClick={handleSubmit} disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
        >
          {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          Save Announcement
        </button>
      </div>
    </div>
  );
}
