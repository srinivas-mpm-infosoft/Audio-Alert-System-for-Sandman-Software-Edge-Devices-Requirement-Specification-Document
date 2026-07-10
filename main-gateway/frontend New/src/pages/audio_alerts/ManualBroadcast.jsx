import React, { useState, useEffect, useRef, useCallback } from "react";
import { Megaphone, Loader2, Upload } from "lucide-react";
import { broadcastManual } from "./api/alerts.api";
import { useToast } from "../../components/ToastContext";
import ConfirmDialog from "./components/ConfirmDialog";
import ZonePicker from "./components/ZonePicker";
import LanguagePicker from "./components/LanguagePicker";
import AudioPreviewButton from "./components/AudioPreviewButton";
import AlertTypeOverrideFields from "./components/AlertTypeOverrideFields";
import { getClips, uploadClip } from "./api/audio.api";
import RefreshButton from "./components/RefreshButton";

export default function ManualBroadcast() {
  const showToast = useToast();

  const [broadcastZones, setBroadcastZones] = useState([]);
  const [broadcastLang, setBroadcastLang] = useState(null);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastClipId, setBroadcastClipId] = useState("");
  const [broadcastMode, setBroadcastMode] = useState("text");
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastConfirm, setBroadcastConfirm] = useState(false);
  const [clips, setClips] = useState([]);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [clipUploading, setClipUploading] = useState(false);
  const [override, setOverride] = useState({ type_code: null, play_count_override: null, requires_ack_override: null });
  const clipFileRef = useRef(null);

  const loadClips = useCallback(() => {
    setClipsLoading(true);
    getClips().then((r) => { if (r.ok) setClips(r.data); }).finally(() => setClipsLoading(false));
  }, []);

  useEffect(() => { loadClips(); }, [loadClips]);

  const handleInlineUpload = async (file) => {
    if (!file) return;
    setClipUploading(true);
    try {
      const res = await uploadClip({ name: file.name.replace(/\.[^.]+$/, ""), language: broadcastLang || "EN" }, file);
      if (res.ok) {
        setClips((c) => [res.data, ...c]);
        setBroadcastClipId(res.data.id);
        showToast(res.reused_existing_file ? "Identical audio already in the library — reusing it" : "File uploaded", "success");
      } else {
        showToast(res.error || "Upload failed", "error");
      }
    } finally {
      setClipUploading(false);
    }
  };

  const handleBroadcast = async () => {
    setBroadcastConfirm(false);
    setBroadcastBusy(true);
    try {
      const res = await broadcastManual({
        zone_ids: broadcastZones,
        language: broadcastLang,
        message: broadcastMode === "text" ? broadcastMsg : undefined,
        clip_id: broadcastMode === "clip" ? broadcastClipId : undefined,
        audio_type: "voice",
        type_code: override.type_code,
        play_count_override: override.play_count_override,
        requires_ack_override: override.requires_ack_override,
      });
      if (res.ok) {
        showToast("Broadcast sent successfully", "success");
        setBroadcastMsg("");
        setBroadcastZones([]);
      } else {
        showToast("Broadcast failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBroadcastBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-600">
          <Megaphone size={16} className="text-indigo-600" aria-hidden="true" />
          <span className="text-sm font-semibold">Manual Broadcast</span>
          <span className="text-xs text-slate-400">— broadcast a message to zone speakers now</span>
        </div>
        <RefreshButton onClick={loadClips} loading={clipsLoading} title="Refresh clip list" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ZonePicker selected={broadcastZones} onChange={setBroadcastZones} label="Target Zones" />
          <LanguagePicker value={broadcastLang} onChange={setBroadcastLang} label="Language" includeZoneDefault />
        </div>

        <AlertTypeOverrideFields value={override} onChange={setOverride} defaultTypeLabel="Default (Normal)" />

        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Message Type</label>
          <div className="flex gap-3">
            {[{ v: "text", l: "Type message" }, { v: "clip", l: "Use pre-recorded clip" }].map(({ v, l }) => (
              <label key={v} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="bcast-mode" value={v} checked={broadcastMode === v} onChange={() => setBroadcastMode(v)} className="text-indigo-600" />
                <span className="text-sm text-slate-700">{l}</span>
              </label>
            ))}
          </div>
        </div>

        {broadcastMode === "text" ? (
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Message Text</label>
            <textarea
              rows={3}
              value={broadcastMsg}
              onChange={(e) => setBroadcastMsg(e.target.value)}
              placeholder="Type the message to broadcast…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700 resize-none"
              aria-label="Broadcast message text"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Audio Clip</label>
            <div className="flex items-center gap-2">
              <select
                value={broadcastClipId}
                onChange={(e) => setBroadcastClipId(e.target.value)}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700"
                aria-label="Select audio clip"
              >
                <option value="">Select a clip…</option>
                {clips.filter((c) => !broadcastLang || c.language === broadcastLang).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.duration_sec}s)</option>
                ))}
              </select>
              {broadcastClipId && (
                <AudioPreviewButton payload={{ clip_id: broadcastClipId }} label="Preview" />
              )}
            </div>
            <div>
              <button
                type="button"
                onClick={() => clipFileRef.current?.click()}
                disabled={clipUploading}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              >
                {clipUploading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Upload size={12} aria-hidden="true" />}
                {clipUploading ? "Uploading…" : "or upload a new MP3/WAV file"}
              </button>
              <input
                ref={clipFileRef} type="file" accept=".wav,.mp3,audio/*" className="hidden"
                onChange={(e) => { handleInlineUpload(e.target.files?.[0] || null); e.target.value = ""; }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            disabled={broadcastBusy || (!broadcastMsg && !broadcastClipId) || !broadcastZones.length}
            onClick={() => setBroadcastConfirm(true)}
            className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
          >
            {broadcastBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Megaphone size={14} aria-hidden="true" />}
            Broadcast Now
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={broadcastConfirm}
        title="Confirm Broadcast"
        message={`This will immediately play audio in ${broadcastZones.length} zone(s). Confirm you want to broadcast this message.`}
        confirmLabel="Yes, Broadcast"
        onConfirm={handleBroadcast}
        onCancel={() => setBroadcastConfirm(false)}
        variant="primary"
      />
    </div>
  );
}
