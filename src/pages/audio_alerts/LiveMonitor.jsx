import React, { useState, useEffect, useCallback } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Volume2, Radio, Cpu, ListChecks, Megaphone, Mic } from "lucide-react";
import { useAlertsStore } from "../../store/useAlertsStore";
import { useAlerts } from "./hooks/useAlerts";
import { useCan } from "./hooks/useCan";
import { acknowledgeAlert } from "./api/alerts.api";
import { useToast } from "../../components/ToastContext";
import { useAuthStore } from "../../store/useAuthStore";
import { useDashboardEvents } from "./hooks/useDashboardEvents";
import { useEdgeNodeStatus } from "./hooks/useEdgeNodeStatus";
import { useSopExecutions } from "./hooks/useSopExecutions";
import StatCard from "./components/StatCard";
import AlertCard from "./components/AlertCard";
import PriorityBadge from "./components/PriorityBadge";
import AcknowledgeButton from "./components/AcknowledgeButton";
import EmptyState from "./components/EmptyState";
import { PRIORITY_CONFIG } from "./utils/priorityConfig";
import { PRIORITIES } from "./utils/constants";
import { elapsedSeconds, formatDuration } from "./utils/formatters";

export default function LiveMonitor() {
  useAlerts();

  const { alerts, activeCount, criticalCount, unackedCount, speakersUp, speakersTotal, nowPlaying, ackAlert } = useAlertsStore();
  const [elapsed, setElapsed] = useState(0);
  const [filters, setFilters] = useState({ priorities: [], zones: [], ackStatus: "" });

  const { devices: edgeNodes, onlineCount: edgeOnline, totalCount: edgeTotal } = useEdgeNodeStatus();
  const { executions: sopExecutions } = useSopExecutions({ activeOnly: true });
  const [activeBroadcast, setActiveBroadcast] = useState(null);
  const [activePaging, setActivePaging] = useState(null);

  useDashboardEvents(useCallback((event) => {
    if (event.type === "manual_broadcast") {
      if (event.event === "start") {
        setActiveBroadcast({ operator: event.operator, zoneIds: event.zone_ids, plantWide: event.plant_wide });
      } else if (event.event === "end") {
        setActiveBroadcast(null);
      }
    } else if (event.type === "paging_session") {
      if (event.event === "start") {
        setActivePaging({ operator: event.operator, zoneIds: event.zone_ids, plantWide: event.plant_wide });
      } else if (event.event === "stop") {
        setActivePaging(null);
      }
    }
  }, []));

  const showToast = useToast();
  const user = useAuthStore((s) => s.user);
  const canAck = useCan("aa.alerts.ack");

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
      {/* Manual broadcast / live paging "currently active" banners */}
      {activeBroadcast && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-2 text-sm text-indigo-800">
          <Megaphone size={16} className="animate-pulse shrink-0" aria-hidden="true" />
          <span>
            Manual broadcast in progress by <strong>{activeBroadcast.operator || "an operator"}</strong>
            {activeBroadcast.plantWide ? " — plant-wide" : activeBroadcast.zoneIds?.length ? ` — ${activeBroadcast.zoneIds.length} zone(s)` : ""}
          </span>
        </div>
      )}
      {activePaging && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-sm text-emerald-800">
          <Mic size={16} className="animate-pulse shrink-0" aria-hidden="true" />
          <span>
            Live paging in progress by <strong>{activePaging.operator || "an operator"}</strong>
            {activePaging.plantWide ? " — plant-wide" : activePaging.zoneIds?.length ? ` — ${activePaging.zoneIds.length} zone(s)` : ""}
          </span>
        </div>
      )}

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

      {/* Edge-node status + SOP-playing indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Cpu size={15} className="text-indigo-600" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-700">{edgeOnline}/{edgeTotal} Edge Nodes Online</span>
          </div>
          {edgeNodes.filter((d) => d.status !== "online").length === 0 ? (
            <p className="text-xs text-slate-400">All edge nodes online</p>
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              Offline: {edgeNodes.filter((d) => d.status !== "online").map((d) => d.name).join(", ")}
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ListChecks size={15} className="text-indigo-600" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-700">SOPs In Progress</span>
          </div>
          {sopExecutions.length === 0 ? (
            <p className="text-xs text-slate-400">No SOPs currently running</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sopExecutions.map((execution) => (
                <li key={execution.id} className="text-xs text-slate-600 flex items-center justify-between gap-2">
                  <span className="truncate">{execution.sop_name}</span>
                  <span className="text-slate-400 shrink-0">
                    Step {execution.current_step_number} of {execution.total_steps} — {execution.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
