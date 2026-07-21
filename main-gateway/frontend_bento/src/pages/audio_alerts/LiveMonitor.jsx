import React, { useState, useEffect, useCallback, useMemo } from "react";
import { CheckCircle2, Cpu, ListChecks, History } from "lucide-react";
import { useAlertsStore } from "../../store/useAlertsStore";
import { useAlerts } from "./hooks/useAlerts";
import { useSopExecutions } from "./hooks/useSopExecutions";
import { useSops } from "./hooks/useSops";
import { useSchedules } from "./hooks/useSchedules";
import { useCan } from "./hooks/useCan";
import { acknowledgeAlert, acknowledgeBroadcastAlert } from "./api/alerts.api";
import { acknowledgeSopStep } from "./api/sop.api";
import { getAnnouncementHistory } from "./api/logs.api";
import { useToast } from "../../components/ToastContext";
import { useAuthStore } from "../../store/useAuthStore";
import { useEdgeNodeStatus } from "./hooks/useEdgeNodeStatus";
import AlertCard from "./components/AlertCard";
import EdgeNodeCard from "./components/EdgeNodeCard";
import EmptyState from "./components/EmptyState";
import { PRIORITY_CONFIG } from "./utils/priorityConfig";
import { PRIORITIES, ANNOUNCEMENT_TYPE_LABEL, ANNOUNCEMENT_TYPE_COLOR, DELIVERY_COLORS } from "./utils/constants";
import { formatTimestamp } from "./utils/formatters";
import { KpiCard, Avatar, Badge } from "../../components/ui/Bento";
import ChartBar from "./components/ChartBar";

// Manual Broadcast / Scheduled dispatches have no AlertEvent row of their
// own (dispatch_service only writes alert_logs) — the only live signal that
// one is still in flight is the target edge node's own /health.currently_playing,
// already polled by useEdgeNodeStatus. Reshape that into an AlertCard-shaped
// row so it shows up here instead of only in the edge node grid above.
// ponytail: one row per device (whatever it's playing right now), not a full
// per-device queue browser — good enough for a glance-able monitor.
function broadcastAlertsFromEdgeNodes(edgeNodes) {
  return edgeNodes
    .filter((d) => d.now_playing?.alert_id && ["broadcast", "scheduled"].includes(d.now_playing.type))
    .map((d) => ({
      alert_id: d.now_playing.alert_id,
      alert_code: d.now_playing.type === "scheduled" ? "SCHEDULED" : "MANUAL",
      priority: null,
      message: d.now_playing.name,
      status: "Active",
      ack_required: true,
      zone: d.zone_name || d.zone_id,
      timestamp: d.now_playing.started_at,
      source: "broadcast",
    }));
}

function sopAlertsFromExecutions(executions) {
  return executions
    .filter((ex) => ex.status === "WAITING_FOR_ACKNOWLEDGEMENT")
    .map((ex) => ({
      alert_id: `sop-${ex.id}`,
      execution_id: ex.id,
      alert_code: "SOP",
      priority: null,
      message: `${ex.sop_name} — Step ${ex.current_step_number}/${ex.total_steps}` +
        (ex.current_step?.message ? `: ${ex.current_step.message}` : ""),
      status: "Active",
      ack_required: true,
      zone: ex.plant_wide ? "Plant-wide" : (ex.zone_ids || []).join(", "),
      timestamp: ex.step_started_at,
      source: "sop",
    }));
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// One rolling window fetch drives the KPI tiles, weekly chart, ack-rate
// donut, and recent-announcements list below — all four are different views
// over the exact same recent history, not four separate endpoints.
function useAnnouncementStats() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getAnnouncementHistory({}, 1, 250).then((res) => {
      if (!cancelled && res.ok) setItems(res.data.items ?? []);
    });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    const now = new Date();
    const todayKey = dayKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayKey = dayKey(yesterday);

    const buckets = new Map();
    const order = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const k = dayKey(d);
      buckets.set(k, { label: WEEKDAY_LETTERS[d.getDay()], count: 0 });
      order.push(k);
    }

    let todayCount = 0, yesterdayCount = 0;
    let acknowledged = 0, delivered = 0, pending = 0;

    for (const row of items) {
      const ts = row.timestamp ? new Date(row.timestamp) : null;
      if (ts && !Number.isNaN(ts.getTime())) {
        const k = dayKey(ts);
        if (buckets.has(k)) buckets.get(k).count += 1;
        if (k === todayKey) todayCount += 1;
        if (k === yesterdayKey) yesterdayCount += 1;
      }
      const status = (row.status || "").toLowerCase();
      if (status === "acknowledged" || status === "completed") acknowledged += 1;
      else if (status === "delivered" || status === "sent" || status === "success") delivered += 1;
      else pending += 1;
    }

    const ackTotal = acknowledged + delivered + pending;
    const ackPct = ackTotal ? Math.round((acknowledged / ackTotal) * 100) : 0;

    return {
      recent: items.slice(0, 4),
      weekChart: order.map((k) => buckets.get(k)),
      todayCount,
      todayDelta: todayCount - yesterdayCount,
      acknowledged, delivered, pending, ackPct,
    };
  }, [items]);
}

function AckDonut({ pct }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative w-32 h-32 rounded-full flex items-center justify-center"
        style={{ background: `conic-gradient(#0d6b45 ${pct * 3.6}deg, #e5e7eb 0deg)` }}
      >
        <div className="absolute w-24 h-24 rounded-full bg-white flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-gray-900">{pct}%</span>
          <span className="text-[11px] text-gray-400">Ack rate</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4 text-[11px] text-gray-500 flex-wrap justify-center">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-700" />Acknowledged</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400" />Delivered</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300" />Pending</span>
      </div>
    </div>
  );
}

export default function LiveMonitor() {
  useAlerts();

  const { alerts, ackAlert } = useAlertsStore();
  const [filters, setFilters] = useState({ priorities: [], zones: [], ackStatus: "" });

  const { devices: edgeNodes, onlineCount: edgeOnline, totalCount: edgeTotal } = useEdgeNodeStatus();
  const { executions: sopExecutions } = useSopExecutions({ activeOnly: true });
  const { sops, load: loadSops } = useSops();
  const { schedules, load: loadSchedules } = useSchedules();
  const stats = useAnnouncementStats();

  useEffect(() => { loadSops(); }, [loadSops]);
  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  const showToast = useToast();
  const user = useAuthStore((s) => s.user);
  const canAck = useCan("aa.alerts.ack");

  // Merge all three alert lifecycles this app has (rule-fired AlertEvent
  // rows, Manual Broadcast/Schedule dispatches, SOP steps) into one list —
  // each already fetched/live-updated elsewhere, no new polling added here.
  const mergedAlerts = useMemo(() => [
    ...alerts.filter((a) => a.status === "Active"),
    ...broadcastAlertsFromEdgeNodes(edgeNodes),
    ...sopAlertsFromExecutions(sopExecutions),
  ], [alerts, edgeNodes, sopExecutions]);

  const handleAck = useCallback(async (alert_id) => {
    const target = mergedAlerts.find((a) => a.alert_id === alert_id);
    try {
      const res = target?.source === "sop"
        ? await acknowledgeSopStep(target.execution_id)
        : target?.source === "broadcast"
        ? await acknowledgeBroadcastAlert(alert_id)
        : await acknowledgeAlert(alert_id, "", user?.username);
      if (res.ok) {
        ackAlert(alert_id);
        showToast("Alert acknowledged successfully", "success");
      } else {
        showToast(res.error || "Failed to acknowledge alert", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  }, [mergedAlerts, ackAlert, showToast, user]);

  const filteredAlerts = mergedAlerts.filter((a) => {
    if (filters.priorities.length && !filters.priorities.includes(a.priority)) return false;
    if (filters.zones.length && !filters.zones.includes(a.zone_id)) return false;
    if (filters.ackStatus === "acked" && !a.ack_time) return false;
    if (filters.ackStatus === "unacked" && a.ack_time) return false;
    return true;
  });

  // Edge nodes double as the zone directory here — avoids a second getZones()
  // fetch just to label a schedule's target zones.
  const zoneNameById = useMemo(
    () => Object.fromEntries(edgeNodes.map((d) => [d.zone_id, d.zone_name || d.zone_id])),
    [edgeNodes]
  );
  const targetLabel = useCallback((s) => (
    s.plant_wide ? "Plant-wide" : (s.zone_ids || []).map((id) => zoneNameById[id] || id).join(", ") || "—"
  ), [zoneNameById]);

  const nextSchedule = useMemo(() => {
    const upcoming = schedules
      .filter((s) => s.is_enabled && s.next_run_at && new Date(s.next_run_at) > new Date());
    upcoming.sort((a, b) => new Date(a.next_run_at) - new Date(b.next_run_at));
    return upcoming[0] || null;
  }, [schedules]);

  const activeSops = useMemo(() => sops.filter((s) => s.is_active), [sops]);
  const sopsSub = sops.length === 0 ? "None configured" : (activeSops.length === sops.length ? "All active" : `${activeSops.length} active`);

  return (
    <div className="flex flex-col gap-5">
      {/* KPI tiles */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <KpiCard dark label="Active alerts" value={mergedAlerts.length}
          sub={mergedAlerts.length === 0 ? "All clear today" : `${mergedAlerts.length} need${mergedAlerts.length === 1 ? "s" : ""} attention`} />
        <KpiCard label="Edge nodes online" value={`${edgeOnline}/${edgeTotal}`}
          sub={edgeTotal - edgeOnline > 0 ? `${edgeTotal - edgeOnline} offline` : "All nodes online"} />
        <KpiCard label="Announcements today" value={stats.todayCount}
          sub={`${stats.todayDelta >= 0 ? "+" : ""}${stats.todayDelta} from yesterday`} />
        <KpiCard label="SOPs configured" value={sops.length} sub={sopsSub} />
      </div>

      {/* Weekly chart / Next scheduled / Active SOPs */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center"><History className="w-3.5 h-3.5" strokeWidth={2.25} /></span>
            <h3 className="text-[15px] font-bold text-gray-900">Weekly announcements</h3>
          </div>
          <ChartBar data={stats.weekChart} barColor="#0d6b45" height={140} />
        </div>

        <div className="rounded-2xl p-5 text-white flex flex-col" style={{ background: "linear-gradient(135deg,#1c6b47,#0d3a26)" }}>
          <div className="text-[13px] font-bold text-white/90 mb-3">Next scheduled</div>
          {nextSchedule ? (
            <>
              <div className="text-lg font-bold mb-1 truncate">{nextSchedule.name}</div>
              <div className="text-xs text-white/70 mb-4">{targetLabel(nextSchedule)} · {formatTimestamp(nextSchedule.next_run_at)}</div>
            </>
          ) : (
            <p className="text-sm text-white/70 flex-1">No upcoming schedules — set one up under Send Alert → Schedule.</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center"><ListChecks className="w-3.5 h-3.5" strokeWidth={2.25} /></span>
              <h3 className="text-[15px] font-bold text-gray-900">Active SOPs</h3>
            </div>
          </div>
          {activeSops.length === 0 ? (
            <p className="text-sm text-gray-400">No SOPs are currently active.</p>
          ) : (
            <div className="space-y-3">
              {activeSops.slice(0, 4).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-800 truncate">{s.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">Target {targetLabel(s)}</div>
                  </div>
                  <Badge tone="normal" dot>Active</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edge Node grid — the real-time state of each speaker/node */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Cpu size={15} className="text-emerald-700" aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-700">{edgeOnline}/{edgeTotal} Edge Nodes Online</span>
        </div>
        {edgeNodes.length === 0 ? (
          <EmptyState icon={Cpu} title="No edge nodes configured" message="Add edge nodes from Devices & Zones to see live playback state here." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {edgeNodes.map((device) => (
              <EdgeNodeCard key={device.id} device={device} />
            ))}
          </div>
        )}
      </div>

      {/* Recent announcements / Ack rate */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center"><History className="w-3.5 h-3.5" strokeWidth={2.25} /></span>
            <h3 className="text-[15px] font-bold text-gray-900">Recent announcements</h3>
          </div>
          {stats.recent.length === 0 ? (
            <p className="text-sm text-gray-400">No announcements recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.recent.map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Avatar
                    label={(ANNOUNCEMENT_TYPE_LABEL[r.type] ?? r.type ?? "?").slice(0, 2).toUpperCase()}
                    tone={ANNOUNCEMENT_TYPE_COLOR[r.type]}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-gray-800 truncate">
                      {ANNOUNCEMENT_TYPE_LABEL[r.type] ?? r.type} · {r.target || "—"}
                    </div>
                    <div className="text-[11px] text-gray-400">{r.timestamp ? formatTimestamp(r.timestamp) : "—"}</div>
                  </div>
                  <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${DELIVERY_COLORS[(r.status || "").toLowerCase()] ?? "bg-gray-100 text-gray-500"}`}>{r.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center justify-center">
          <AckDonut pct={stats.ackPct} />
        </div>
      </div>

      {/* Filter chips + Alert queue */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-1">Filter:</span>
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
                className="px-2.5 py-1 rounded-full text-xs font-semibold border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-400"
                style={active ? { background: cfg.badgeBg, color: cfg.badgeText, borderColor: cfg.dot } : { background: "#f9fafb", color: "#6b7280", borderColor: "#e5e7eb" }}
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
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-700"
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
    </div>
  );
}
