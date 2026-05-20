import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Save, Loader2, ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import PriorityBadge from "./components/PriorityBadge";
import ZonePicker from "./components/ZonePicker";
import LanguagePicker from "./components/LanguagePicker";
import ConditionRow from "./components/ConditionRow";
import EscalationEditor from "./components/EscalationEditor";
import { PRIORITIES } from "./utils/constants";
import { getClips, getTemplates } from "./api/audio.api";

const INPUT = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700";
const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";
const SECTION = "bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4";

const BLANK_RULE = {
  name: "",
  alert_code: "",
  priority: "HIGH",
  conditions: [{ parameter: "", operator: "<", value: "", unit: "" }],
  condition_logic: "AND",
  persistence_type: "cycles",
  persistence_value: 3,
  persistence_unit: "minutes",
  zone_ids: [],
  zones: [],
  audio_mode: "tts",
  tts_template_id: "",
  clip_id: "",
  language_override: null,
  volume_override: null,
  audio_type: "voice",
  use_default_escalation: true,
  escalation_steps: [],
  status: "Draft",
};

export default function RuleForm({ initialRule, onSave, onCancel }) {
  const [rule, setRule] = useState(() => ({ ...BLANK_RULE, ...initialRule }));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [showExample, setShowExample] = useState(false);
  const [clips, setClips] = useState([]);
  const [templates, setTemplates] = useState([]);
  const isEditing = !!initialRule?.id;

  useEffect(() => {
    getClips().then((r) => { if (r.ok) setClips(r.data); });
    getTemplates().then((r) => { if (r.ok) setTemplates(r.data); });
  }, []);

  const set = (key, val) => setRule((r) => ({ ...r, [key]: val }));

  const validate = () => {
    const errs = {};
    if (!rule.name.trim()) errs.name = "Rule name is required";
    if (!rule.zone_ids.length) errs.zones = "Select at least one zone";
    if (rule.conditions.some((c) => !c.parameter)) errs.conditions = "All conditions must have a parameter selected";
    if (rule.audio_mode === "clip" && !rule.clip_id) errs.clip = "Select an audio clip";
    if (rule.audio_mode === "tts" && !rule.tts_template_id) errs.tts = "Select a TTS template";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async (saveStatus) => {
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave({ ...rule, status: saveStatus });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" aria-label="Back to rule list">
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div>
          <h2 className="text-lg font-bold text-slate-900">{isEditing ? "Edit Rule" : "New Alert Rule"}</h2>
          <p className="text-xs text-slate-500">Configure trigger conditions, audio, and escalation</p>
        </div>
      </div>

      {/* 1. Basic Info */}
      <div className={SECTION}>
        <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-3">1. Basic Information</h3>
        <div>
          <label className={LABEL} htmlFor="rule-name">Rule Name *</label>
          <input
            id="rule-name"
            type="text"
            className={INPUT}
            value={rule.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Compactability Critical Low"
          />
          {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
        </div>

        <div>
          <label className={LABEL}>Priority *</label>
          <div className="flex gap-3 flex-wrap">
            {PRIORITIES.map((p) => (
              <label key={p} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="priority" value={p} checked={rule.priority === p} onChange={() => set("priority", p)} className="text-indigo-600" />
                <PriorityBadge priority={p} />
              </label>
            ))}
          </div>
        </div>

      </div>

      {/* 2. Conditions */}
      <div className={SECTION}>
        <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-3">2. Trigger Conditions</h3>
        <div className="space-y-3">
          {rule.conditions.map((cond, i) => (
            <ConditionRow
              key={i}
              index={i}
              condition={cond}
              onChange={(updated) => set("conditions", rule.conditions.map((c, j) => j === i ? updated : c))}
              onRemove={() => set("conditions", rule.conditions.filter((_, j) => j !== i))}
              canRemove={rule.conditions.length > 1}
            />
          ))}
          {errors.conditions && <p className="text-red-500 text-xs">{errors.conditions}</p>}
          <button
            type="button"
            onClick={() => set("conditions", [...rule.conditions, { parameter: "", operator: "<", value: "", unit: "" }])}
            className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium mt-1"
          >
            <Plus size={14} aria-hidden="true" /> Add condition
          </button>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <label className={LABEL}>Logic</label>
          {["AND", "OR"].map((logic) => (
            <label key={logic} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="logic" value={logic} checked={rule.condition_logic === logic} onChange={() => set("condition_logic", logic)} className="text-indigo-600" />
              <span className="text-sm font-semibold text-slate-700">{logic}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 3. Time Persistence */}
      <div className={SECTION}>
        <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-3">3. Time Persistence</h3>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="persist-type" value="cycles" checked={rule.persistence_type === "cycles"} onChange={() => set("persistence_type", "cycles")} className="text-indigo-600" />
            <span className="text-sm text-slate-700">By <strong>cycles</strong></span>
            {rule.persistence_type === "cycles" && (
              <input
                type="number" min={1} max={99}
                value={rule.persistence_value}
                onChange={(e) => set("persistence_value", +e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 w-20"
                aria-label="Number of cycles"
              />
            )}
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="persist-type" value="duration" checked={rule.persistence_type === "duration"} onChange={() => set("persistence_type", "duration")} className="text-indigo-600" />
            <span className="text-sm text-slate-700">By <strong>duration</strong></span>
            {rule.persistence_type === "duration" && (
              <div className="flex gap-2">
                <input
                  type="number" min={1}
                  value={rule.persistence_value}
                  onChange={(e) => set("persistence_value", +e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 w-20"
                  aria-label="Duration value"
                />
                <select
                  value={rule.persistence_unit ?? "minutes"}
                  onChange={(e) => set("persistence_unit", e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  aria-label="Duration unit"
                >
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </div>
            )}
          </label>
        </div>
      </div>

      {/* 4. Zone Scope */}
      <div className={SECTION}>
        <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-3">4. Zone Scope</h3>
        <ZonePicker selected={rule.zone_ids} onChange={(ids) => set("zone_ids", ids)} label="Apply to Zones *" />
        {errors.zones && <p className="text-red-500 text-xs">{errors.zones}</p>}
      </div>

      {/* 5. Audio Configuration */}
      <div className={SECTION}>
        <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-3">5. Audio Configuration</h3>

        {/* Mode selector */}
        <div className="flex gap-5 flex-wrap">
          {[
            { v: "tts",   l: "TTS Template",      desc: "Text-to-speech with dynamic variables" },
            { v: "clip",  l: "Pre-recorded Clip",  desc: "Play a saved audio file" },
            { v: "sound", l: "Alert Sound",        desc: "Non-verbal alert (siren, buzzer)" },
          ].map(({ v, l, desc }) => (
            <label key={v} className={`flex items-start gap-2.5 cursor-pointer px-3 py-2.5 rounded-lg border-2 transition-colors ${rule.audio_mode === v ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"}`}>
              <input type="radio" name="audio-mode" value={v} checked={rule.audio_mode === v} onChange={() => set("audio_mode", v)} className="mt-0.5 text-indigo-600" />
              <div>
                <p className={`text-sm font-semibold ${rule.audio_mode === v ? "text-indigo-700" : "text-slate-700"}`}>{l}</p>
                <p className="text-[11px] text-slate-400">{desc}</p>
              </div>
            </label>
          ))}
        </div>

        {/* TTS Template mode */}
        {rule.audio_mode === "tts" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={LABEL} htmlFor="tts-template">TTS Template *</label>
              <select id="tts-template" className={INPUT} value={rule.tts_template_id} onChange={(e) => set("tts_template_id", e.target.value)}>
                <option value="">Select template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
              </select>
              {errors.tts && <p className="text-red-500 text-xs mt-1">{errors.tts}</p>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <LanguagePicker value={rule.language_override} onChange={(v) => set("language_override", v)} label="Language Override" includeZoneDefault />
              <div>
                <label className={LABEL} htmlFor="vol-tts">Volume Override (dB)</label>
                <input id="vol-tts" type="number" min={-12} max={12} className={INPUT} value={rule.volume_override ?? ""} onChange={(e) => set("volume_override", e.target.value === "" ? null : +e.target.value)} placeholder="Use priority default" />
              </div>
            </div>
          </div>
        )}

        {/* Pre-recorded Clip mode */}
        {rule.audio_mode === "clip" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className={LABEL} htmlFor="clip-select">Audio Clip *</label>
                <select
                  id="clip-select"
                  className={INPUT}
                  value={rule.clip_id}
                  onChange={(e) => {
                    const clip = clips.find((c) => c.id === e.target.value);
                    set("clip_id", e.target.value);
                    if (clip?.alert_code) set("alert_code", clip.alert_code);
                  }}
                >
                  <option value="">Select clip…</option>
                  {clips.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.language} ({c.duration_sec}s)</option>)}
                </select>
                {errors.clip && <p className="text-red-500 text-xs mt-1">{errors.clip}</p>}
              </div>
              {rule.clip_id && (() => {
                const clip = clips.find((c) => c.id === rule.clip_id);
                return clip?.alert_code ? (
                  <div className="shrink-0 pb-0.5">
                    <p className={`${LABEL} mb-1.5`}>Alert Code</p>
                    <span className="inline-block px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono text-sm font-bold tracking-wide">
                      {clip.alert_code}
                    </span>
                  </div>
                ) : null;
              })()}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL} htmlFor="vol-clip">Volume Override (dB)</label>
                <input id="vol-clip" type="number" min={-12} max={12} className={INPUT} value={rule.volume_override ?? ""} onChange={(e) => set("volume_override", e.target.value === "" ? null : +e.target.value)} placeholder="Use priority default" />
              </div>
            </div>
          </div>
        )}

        {/* Alert Sound mode */}
        {rule.audio_mode === "sound" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={LABEL} htmlFor="sound-type">Sound Type</label>
              <select id="sound-type" className={INPUT} value={rule.audio_type} onChange={(e) => set("audio_type", e.target.value)}>
                {["siren", "buzzer", "beep", "alarm"].map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="vol-sound">Volume Override (dB)</label>
              <input id="vol-sound" type="number" min={-12} max={12} className={INPUT} value={rule.volume_override ?? ""} onChange={(e) => set("volume_override", e.target.value === "" ? null : +e.target.value)} placeholder="Use priority default" />
            </div>
          </div>
        )}
      </div>

      {/* 6. Repeat & Escalation */}
      <div className={SECTION}>
        <h3 className="font-semibold text-slate-800 border-b border-slate-100 pb-3">6. Repeat &amp; Escalation</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={rule.use_default_escalation}
            onChange={(e) => set("use_default_escalation", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          <span className="text-sm text-slate-700">Use system defaults for this priority</span>
        </label>
        {!rule.use_default_escalation && (
          <EscalationEditor steps={rule.escalation_steps} onChange={(steps) => set("escalation_steps", steps)} />
        )}
      </div>

      {/* Example helper */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowExample((o) => !o)}
          className="w-full px-5 py-3 flex items-center justify-between text-left focus:outline-none"
          aria-expanded={showExample}
        >
          <div className="flex items-center gap-2">
            <HelpCircle size={15} className="text-indigo-500" aria-hidden="true" />
            <span className="text-sm font-semibold text-indigo-700">Rule example</span>
          </div>
          {showExample ? <ChevronUp size={14} className="text-indigo-400" /> : <ChevronDown size={14} className="text-indigo-400" />}
        </button>
        {showExample && (
          <div className="px-5 pb-4 text-sm text-indigo-800 font-mono">
            <p className="leading-relaxed">
              <strong>IF</strong> compactability &lt; 36% <strong>AND</strong> moisture &lt; 2.50%{" "}
              <strong>FOR</strong> 3 cycles{" "}
              <strong>THEN</strong> trigger <span className="text-red-700 font-bold">HIGH</span> alert{" "}
              → play siren in Moulding-A zone, repeat every 60s, escalate after 5 repeats
            </p>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSave("Active")}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-colors shadow-sm"
        >
          {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
          {saving ? "Saving…" : (isEditing ? "Save Changes" : "Create Rule")}
        </button>
      </div>
    </div>
  );
}
