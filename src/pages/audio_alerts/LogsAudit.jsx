import React, { useState, useEffect } from "react";
import { Download, ChevronDown, ChevronUp, Loader2, FileText, ShieldCheck, X } from "lucide-react";
import { useAuditLog } from "./hooks/useAuditLog";
import { useCan } from "./hooks/useCan";
import FilterBar from "./components/FilterBar";
import PriorityBadge from "./components/PriorityBadge";
import EmptyState from "./components/EmptyState";
import { PRIORITIES } from "./utils/constants";
import { formatTimestamp, formatDuration } from "./utils/formatters";

const TABS = [
  { id: "alert-logs", label: "Alert Logs", icon: FileText },
  { id: "audit", label: "Audit Log", icon: ShieldCheck },
];

const ACTION_COLORS = {
  "ack": "bg-emerald-100 text-emerald-700",
  "rule.create": "bg-blue-100 text-blue-700",
  "rule.edit": "bg-indigo-100 text-indigo-700",
  "rule.delete": "bg-red-100 text-red-700",
  "audio.upload": "bg-purple-100 text-purple-700",
  "audio.delete": "bg-red-100 text-red-700",
  "device.add": "bg-cyan-100 text-cyan-700",
  "device.restart": "bg-amber-100 text-amber-700",
  "config.change": "bg-orange-100 text-orange-700",
  "login": "bg-slate-100 text-slate-600",
  "login-fail": "bg-red-100 text-red-700",
  "user.create": "bg-blue-100 text-blue-700",
  "user.edit": "bg-indigo-100 text-indigo-700",
  "user.delete": "bg-red-100 text-red-700",
};

function exportCSV(data, filename) {
  if (!data.length) return;
  const keys = Object.keys(data[0]).filter((k) => k !== "timeline" && k !== "before" && k !== "after");
  const csv = [keys.join(","), ...data.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

function TimelineDrawer({ log, onClose }) {
  if (!log) return null;
  return (
    <div className="fixed inset-0 z-999 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-2xl flex flex-col h-full z-10 overflow-y-auto">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="font-semibold text-slate-800">{log.alert_code}</p>
            <p className="text-xs text-slate-400">{log.zone} • {log.plant}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400" aria-label="Close timeline">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-2">
          <PriorityBadge priority={log.priority} />
          <p className="text-sm text-slate-700">{log.message}</p>
          <div className="grid grid-cols-2 gap-2 text-xs mt-2">
            <div><span className="text-slate-400">Trigger value:</span> <span className="font-mono font-semibold">{log.trigger_value}</span></div>
            <div><span className="text-slate-400">Duration:</span> <span>{formatDuration(log.duration_on_air_sec)}</span></div>
            <div><span className="text-slate-400">Language:</span> <span>{log.language_played}</span></div>
            <div><span className="text-slate-400">Escalation:</span> <span>{log.escalation_count} steps</span></div>
            {log.ack_user && <div className="col-span-2"><span className="text-slate-400">Acked by:</span> <span className="font-medium">{log.ack_user} via {log.ack_source}</span></div>}
          </div>
          {log.timeline && (
            <div className="mt-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Event Timeline</p>
              <div className="relative pl-5">
                <div className="absolute left-1.5 top-0 bottom-0 w-px bg-slate-200" />
                {log.timeline.map((ev, i) => (
                  <div key={i} className="mb-4 relative">
                    <div className="absolute -left-4 top-1 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white" />
                    <p className="text-xs font-semibold text-slate-700">{ev.event}</p>
                    <p className="text-[11px] text-slate-500">{ev.detail}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">{formatTimestamp(ev.ts)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LogsAudit() {
  const [activeTab, setActiveTab] = useState("alert-logs");
  const [alertFilters, setAlertFilters] = useState({ search: "", priority: "", status: "", from: undefined, to: undefined });
  const [auditFilters, setAuditFilters] = useState({ user: "", action: "", from: undefined, to: undefined });
  const [alertPage, setAlertPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState(null);
  const canExport = useCan("aa.logs.export");
  const canViewAudit = useCan("aa.audit.view");
  const { alertLogs, auditLogs, alertTotal, auditTotal, loading, error, loadAlertLogs, loadAuditLogs } = useAuditLog();

  const PAGE_SIZE = 20;

  useEffect(() => {
    if (activeTab === "alert-logs") loadAlertLogs(alertFilters, alertPage, PAGE_SIZE);
  }, [activeTab, alertFilters, alertPage, loadAlertLogs]);

  useEffect(() => {
    if (activeTab === "audit" && canViewAudit) loadAuditLogs(auditFilters, auditPage, PAGE_SIZE);
  }, [activeTab, auditFilters, auditPage, loadAuditLogs, canViewAudit]);

  const alertPages = Math.ceil(alertTotal / PAGE_SIZE);
  const auditPages = Math.ceil(auditTotal / PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex border-b border-slate-100" role="tablist">
          {TABS.filter((t) => t.id !== "audit" || canViewAudit).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-400 ${activeTab === tab.id ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Alert Logs */}
        {activeTab === "alert-logs" && (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <FilterBar
                filters={alertFilters}
                onFilterChange={(f) => { setAlertFilters(f); setAlertPage(1); }}
                placeholder="Search alerts…"
                fields={[
                  { key: "priority", label: "Priority", options: PRIORITIES },
                  { key: "status", label: "Status", options: ["Active", "Acknowledged", "Auto-closed"] },
                ]}
              />
              {canExport && (
                <button type="button" onClick={() => exportCSV(alertLogs, "alert-logs.csv")} className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-500 hover:bg-slate-50" aria-label="Export alert logs as CSV">
                  <Download size={13} aria-hidden="true" /> Export CSV
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
            ) : error ? (
              <EmptyState title="Could not load logs" message={error} />
            ) : alertLogs.length === 0 ? (
              <EmptyState title="No logs found" message="No alert events have been recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      {["Timestamp", "Code", "Priority", "Zone", "Trigger Value", "Language", "Duration", "Ack Time", "Ack By", "Status"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left font-semibold text-slate-600 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {alertLogs.map((log) => (
                      <tr key={log.id} onClick={() => setSelectedLog(log)} className="cursor-pointer hover:bg-indigo-50/30 transition-colors">
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                        <td className="px-3 py-3 font-mono text-xs font-bold text-slate-700">{log.alert_code}</td>
                        <td className="px-3 py-3"><PriorityBadge priority={log.priority} size="xs" /></td>
                        <td className="px-3 py-3 text-xs text-slate-500">{log.zone}</td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-700">{log.trigger_value}</td>
                        <td className="px-3 py-3 text-xs">{log.language_played}</td>
                        <td className="px-3 py-3 text-xs text-slate-500">{formatDuration(log.duration_on_air_sec)}</td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">{log.ack_time ? formatTimestamp(log.ack_time) : "—"}</td>
                        <td className="px-3 py-3 text-xs text-slate-500">{log.ack_user ?? "—"}</td>
                        <td className="px-3 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${log.status === "Active" ? "bg-red-100 text-red-700" : log.status === "Acknowledged" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{log.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {alertPages > 1 && (
              <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                <span>Page {alertPage} of {alertPages} ({alertTotal} total)</span>
                <div className="flex gap-1">
                  <button type="button" disabled={alertPage === 1} onClick={() => setAlertPage((p) => p - 1)} className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50">Prev</button>
                  <button type="button" disabled={alertPage === alertPages} onClick={() => setAlertPage((p) => p + 1)} className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Audit Logs */}
        {activeTab === "audit" && canViewAudit && (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <FilterBar
                filters={auditFilters}
                onFilterChange={(f) => { setAuditFilters(f); setAuditPage(1); }}
                placeholder="Search user / action…"
                showSearch={false}
                fields={[
                  { key: "action", label: "Action", options: ["ack", "rule", "audio", "device", "config", "login", "user"] },
                  { key: "user", label: "User", options: ["superadmin", "admin", "engineer1", "supervisor1", "operator1", "tech1", "auditor1"] },
                ]}
              />
              {canExport && (
                <button type="button" onClick={() => exportCSV(auditLogs, "audit-log.csv")} className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-500 hover:bg-slate-50" aria-label="Export audit log as CSV">
                  <Download size={13} aria-hidden="true" /> Export CSV
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
            ) : error ? (
              <EmptyState title="Could not load audit log" message={error} />
            ) : auditLogs.length === 0 ? (
              <EmptyState title="No audit records" message="No audit events have been recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      {["Timestamp", "User", "Action", "Target", "Before / After", "IP"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left font-semibold text-slate-600 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                        <td className="px-3 py-3 text-xs font-medium text-slate-700">{log.user}</td>
                        <td className="px-3 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600"}`}>{log.action}</span>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500">{log.target_label}</td>
                        <td className="px-3 py-3 text-[11px] text-slate-400 max-w-[160px]">
                          {log.after ? (
                            <span className="font-mono truncate block" title={JSON.stringify(log.after)}>{JSON.stringify(log.after).slice(0, 60)}…</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-400">{log.ip}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {auditPages > 1 && (
              <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
                <span>Page {auditPage} of {auditPages} ({auditTotal} total) — Immutable log</span>
                <div className="flex gap-1">
                  <button type="button" disabled={auditPage === 1} onClick={() => setAuditPage((p) => p - 1)} className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50">Prev</button>
                  <button type="button" disabled={auditPage === auditPages} onClick={() => setAuditPage((p) => p + 1)} className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <TimelineDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}
