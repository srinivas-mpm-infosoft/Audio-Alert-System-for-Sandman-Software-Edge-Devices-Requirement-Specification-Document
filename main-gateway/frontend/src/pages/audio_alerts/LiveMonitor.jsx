import React, { useState, useCallback } from "react";
import { CheckCircle2, Cpu } from "lucide-react";
import { useAlertsStore } from "../../store/useAlertsStore";
import { useAlerts } from "./hooks/useAlerts";
import { useCan } from "./hooks/useCan";
import { acknowledgeAlert } from "./api/alerts.api";
import { useToast } from "../../components/ToastContext";
import { useAuthStore } from "../../store/useAuthStore";
import { useEdgeNodeStatus } from "./hooks/useEdgeNodeStatus";
import AlertCard from "./components/AlertCard";
import EdgeNodeCard from "./components/EdgeNodeCard";
import EmptyState from "./components/EmptyState";
import { PRIORITY_CONFIG } from "./utils/priorityConfig";
import { PRIORITIES } from "./utils/constants";

export default function LiveMonitor() {
  useAlerts();

  const { alerts, ackAlert } = useAlertsStore();
  const [filters, setFilters] = useState({ priorities: [], zones: [], ackStatus: "" });

  const { devices: edgeNodes, onlineCount: edgeOnline, totalCount: edgeTotal } = useEdgeNodeStatus();

  const showToast = useToast();
  const user = useAuthStore((s) => s.user);
  const canAck = useCan("aa.alerts.ack");

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

  return (
    <div className="flex flex-col gap-5">
      {/* Edge Node grid — the real-time state of each speaker/node */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Cpu size={15} className="text-indigo-600" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-700">{edgeOnline}/{edgeTotal} Edge Nodes Online</span>
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
    </div>
  );
}
