import React from "react";
import StatusPill from "./StatusPill";
import { formatTimestamp } from "../utils/formatters";

const ALERT_TYPE_LABELS = {
  sop: "SOP Broadcast",
  scheduled: "Scheduled Alert",
  broadcast: "Manual Alert",
  paging: "Live Paging",
  alert: "Alert",
};

const PLAYBACK_LABELS = {
  playing: "Playing",
  queued: "Queued",
  idle: "Idle",
};

export default function EdgeNodeCard({ device }) {
  const np = device.now_playing;
  const typeLabel = np ? (ALERT_TYPE_LABELS[np.type] || np.type) : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-2" role="region" aria-label={`Edge node ${device.name}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{device.name}</p>
          <p className="text-[11px] text-slate-400 truncate">{device.zone_name || device.zone_id || "No zone"}</p>
        </div>
        <StatusPill status={device.status} />
      </div>

      {np ? (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">{typeLabel}</span>
            <span className="text-[10px] font-semibold text-slate-500 uppercase">
              {PLAYBACK_LABELS[device.playback_status] || device.playback_status}
            </span>
          </div>
          <p className="text-sm text-slate-700 truncate" title={np.name}>{np.name}</p>
          {np.started_at && (
            <p className="text-[11px] text-slate-400">Since {formatTimestamp(np.started_at)}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic px-1 py-1">
          {device.playback_status === "queued" ? "Queued — waiting to play" : "Idle — nothing playing"}
        </p>
      )}
    </div>
  );
}
