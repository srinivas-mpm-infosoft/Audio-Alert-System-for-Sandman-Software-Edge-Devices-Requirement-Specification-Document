import React, { useState, useEffect, useCallback, useRef } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Volume2, Megaphone, ChevronDown, ChevronUp, Loader2, Radio, Upload } from "lucide-react";
import { useAlertsStore } from "../../store/useAlertsStore";
import { useAlerts } from "./hooks/useAlerts";
import { useCan } from "./hooks/useCan";
import { acknowledgeAlert, broadcastManual } from "./api/alerts.api";
import { useToast } from "../../components/ToastContext";
import { useAuthStore } from "../../store/useAuthStore";
import StatCard from "./components/StatCard";
import AlertCard from "./components/AlertCard";
import PriorityBadge from "./components/PriorityBadge";
import AcknowledgeButton from "./components/AcknowledgeButton";
import ConfirmDialog from "./components/ConfirmDialog";
import ZonePicker from "./components/ZonePicker";
import LanguagePicker from "./components/LanguagePicker";
import EmptyState from "./components/EmptyState";
import PagingPanel from "./components/PagingPanel";
import AudioPreviewButton from "./components/AudioPreviewButton";
import { PRIORITY_CONFIG } from "./utils/priorityConfig";
import { PRIORITIES } from "./utils/constants";
import { timeAgo, elapsedSeconds, formatDuration } from "./utils/formatters";
import { getClips, uploadClip } from "./api/audio.api";

export default function LiveMonitor() {
  useAlerts();

  const { alerts, activeCount, criticalCount, unackedCount, speakersUp, speakersTotal, nowPlaying, ackAlert } = useAlertsStore();
  const [elapsed, setElapsed] = useState(0);
  const [filters, setFilters] = useState({ priorities: [], zones: [], ackStatus: "" });
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastZones, setBroadcastZones] = useState([]);
  const [broadcastLang, setBroadcastLang] = useState("EN");
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastClipId, setBroadcastClipId] = useState("");
  const [broadcastMode, setBroadcastMode] = useState("text");
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastConfirm, setBroadcastConfirm] = useState(false);
  const [clips, setClips] = useState([]);
  const [clipUploading, setClipUploading] = useState(false);
  const clipFileRef = useRef(null);

  useEffect(() => {
    getClips().then((r) => { if (r.ok) setClips(r.data); });
  }, []);

  const handleInlineUpload = async (file) => {
    if (!file) return;
    setClipUploading(true);
    try {
      const res = await uploadClip({ name: file.name.replace(/\.[^.]+$/, ""), language: broadcastLang }, file);
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

  const showToast = useToast();
  const user = useAuthStore((s) => s.user);
  const canAck = useCan("aa.alerts.ack");
  const canBroadcast = useCan("aa.broadcast.manual");
  const canPage = useCan("aa.paging.use");

  // Live elapsed timer for now-playing card
  useEffect(() => {
    const timer = setInterval(() => {
      if (nowPlaying) setElapsed(elapsedSeconds(nowPlaying.timestamp));
    }, 1000);
    return () => clearInterval(timer);
  }, [nowPlaying]);

  const handleAck = useCallback(async (alert_id) => {
    try {
      const res = await acknowledgeAlert(alert_id, "", user?.username);
      if (res.ok) {
        ackAlert(alert_id);
        showToast("Alert acknowledged successfully", "success");
      } else {
        showToast("Failed to acknowledge alert", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  }, [ackAlert, showToast, user]);

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
      });
      if (res.ok) {
        showToast("Broadcast sent successfully", "success");
        setBroadcastMsg("");
        setBroadcastZones([]);
        setBroadcastOpen(false);
      } else {
        showToast("Broadcast failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBroadcastBusy(false);
    }
  };

  // Filter active alerts
  const activeAlerts = alerts.filter((a) => a.status === "Active");
  const filteredAlerts = activeAlerts.filter((a) => {
    if (filters.priorities.length && !filters.priorities.includes(a.priority)) return false;
    if (filters.zones.length && !filters.zones.includes(a.zone_id)) return false;
    if (filters.ackStatus === "acked" && !a.ack_time) return false;
    if (filters.ackStatus === "unacked" && a.ack_time) return false;
    return true;
  });

  const avgResponseSec = 94; // mock
  const nowCfg = nowPlaying ? PRIORITY_CONFIG[nowPlaying.priority] : null;

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Active Alerts" value={activeCount} delta={2} icon={Activity} iconColor="#ef4444" iconBg="#fee2e2" />
        <StatCard label="Critical" value={criticalCount} delta={1} icon={AlertTriangle} iconColor="#dc2626" iconBg="#fee2e2" />
        <StatCard label="Unacknowledged" value={unackedCount} delta={0} icon={CheckCircle2} iconColor="#f97316" iconBg="#ffedd5" />
        <StatCard label="Avg Response" value={avgResponseSec} unit="s" delta={-12} icon={Clock} iconColor="#6366f1" iconBg="#eef2ff" />
        <StatCard label="Speakers Up" value={speakersUp} unit={`/${speakersTotal}`} delta={0} icon={Volume2} iconColor="#0891b2" iconBg="#ecfeff" />
      </div>

      {/* Now Playing panel */}
      {nowPlaying && nowCfg && (
        <div
          className="rounded-xl border-2 p-5 flex flex-col gap-3"
          style={{ background: nowCfg.playingBg, borderColor: nowCfg.playingBorder }}
          role="region"
          aria-label="Now playing alert"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center animate-pulse" style={{ background: nowCfg.dot }}>
                <Radio size={20} className="text-white" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Now Playing</p>
                <div className="flex items-center gap-2">
                  <PriorityBadge priority={nowPlaying.priority} size="lg" />
                  <span className="font-mono font-bold text-slate-700">{nowPlaying.alert_code}</span>
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>Zone: <strong className="text-slate-700">{nowPlaying.zone}</strong></p>
              <p>Repeated: <strong className="text-slate-700">{nowPlaying.repeat_count}×</strong></p>
              <p className="font-mono text-slate-600 mt-1">{formatDuration(elapsed)} elapsed</p>
            </div>
          </div>
          <p className="text-base italic text-slate-700 leading-relaxed pl-14">"{nowPlaying.message}"</p>
          {canAck && (
            <div className="pl-14">
              <AcknowledgeButton alert={nowPlaying} onAck={handleAck} size="lg" />
            </div>
          )}
        </div>
      )}

      {/* Filter chips + Alert queue */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1">Filter:</span>
          {PRIORITIES.map((p) => {
            const active = filters.priorities.includes(p);
            const cfg = PRIORITY_CONFIG[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => setFilters((f) => ({
                  ...f,
                  priorities: active ? f.priorities.filter((x) => x !== p) : [...f.priorities, p],
                }))}
                className="px-2.5 py-1 rounded-full text-xs font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-indigo-400"
                style={active ? { background: cfg.badgeBg, color: cfg.badgeText, borderColor: cfg.dot } : { background: "#f8fafc", color: "#64748b", borderColor: "#e2e8f0" }}
                aria-pressed={active}
                aria-label={`Filter by ${cfg.label} priority`}
              >
                {cfg.label}
              </button>
            );
          })}
          <div className="ml-2">
            <select
              value={filters.ackStatus}
              onChange={(e) => setFilters((f) => ({ ...f, ackStatus: e.target.value }))}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700"
              aria-label="Filter by ack status"
            >
              <option value="">All statuses</option>
              <option value="unacked">Unacknowledged</option>
              <option value="acked">Acknowledged</option>
            </select>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {filteredAlerts.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No active alerts" message="All systems are operating within normal parameters." />
          ) : (
            filteredAlerts.map((alert) => (
              <AlertCard key={alert.alert_id} alert={alert} onAck={canAck ? handleAck : null} />
            ))
          )}
        </div>
      </div>

      {/* Manual broadcast */}
      {canBroadcast && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <button
            type="button"
            onClick={() => setBroadcastOpen((o) => !o)}
            className="w-full p-4 flex items-center justify-between text-left focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded-xl"
            aria-expanded={broadcastOpen}
          >
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-indigo-600" aria-hidden="true" />
              <span className="font-semibold text-slate-700">Manual Broadcast</span>
              <span className="text-xs text-slate-400">— broadcast a message to zone speakers now</span>
            </div>
            {broadcastOpen ? <ChevronUp size={16} className="text-slate-400" aria-hidden="true" /> : <ChevronDown size={16} className="text-slate-400" aria-hidden="true" />}
          </button>

          {broadcastOpen && (
            <div className="px-4 pb-5 border-t border-slate-100 pt-4 flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ZonePicker selected={broadcastZones} onChange={setBroadcastZones} label="Target Zones" />
                <LanguagePicker value={broadcastLang} onChange={setBroadcastLang} label="Language" />
              </div>

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
                  onClick={() => setBroadcastOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
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
          )}
        </div>
      )}

      {/* Live voice paging */}
      {canPage && <PagingPanel />}

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
