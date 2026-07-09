import React from "react";
import { MapPin, Clock, RefreshCw, ChevronRight } from "lucide-react";
import PriorityBadge from "./PriorityBadge";
import AcknowledgeButton from "./AcknowledgeButton";
import { timeAgo } from "../utils/formatters";
import { PRIORITY_CONFIG } from "../utils/priorityConfig";

export default function AlertCard({ alert, onAck, compact = false }) {
  const cfg = PRIORITY_CONFIG[alert.priority];

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2 transition-shadow hover:shadow-md"
      style={{ background: cfg?.cardBg ?? "#fff", borderColor: cfg?.cardBorder ?? "#e2e8f0" }}
      role="article"
      aria-label={`Alert: ${alert.alert_code}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PriorityBadge priority={alert.priority} />
            <span className="text-xs font-mono font-bold text-slate-600">{alert.alert_code}</span>
            {alert.escalation_step > 0 && (
              <span className="text-[10px] font-semibold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-full">
                Step {alert.escalation_step}/5
              </span>
            )}
          </div>
          <p className="text-sm text-slate-700 font-medium leading-snug mt-0.5">{alert.message}</p>
        </div>
        {onAck && alert.status === "Active" && alert.ack_required && (
          <div className="flex-shrink-0">
            <AcknowledgeButton alert={alert} onAck={onAck} size="sm" />
          </div>
        )}
      </div>

      {!compact && (
        <div className="flex items-center gap-4 text-[11px] text-slate-500 flex-wrap pt-1 border-t border-white/60">
          <span className="flex items-center gap-1">
            <MapPin size={11} aria-hidden="true" />
            {[alert.plant, alert.line, alert.zone].filter(Boolean).join(" › ") || "—"}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={11} aria-hidden="true" />
            {timeAgo(alert.timestamp)}
          </span>
          {alert.repeat_count > 1 && (
            <span className="flex items-center gap-1">
              <RefreshCw size={11} aria-hidden="true" />
              Repeated {alert.repeat_count}×
            </span>
          )}
          {alert.trigger_value !== undefined && (
            <span className="font-mono">
              {alert.source_parameter}: <strong>{alert.trigger_value}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
