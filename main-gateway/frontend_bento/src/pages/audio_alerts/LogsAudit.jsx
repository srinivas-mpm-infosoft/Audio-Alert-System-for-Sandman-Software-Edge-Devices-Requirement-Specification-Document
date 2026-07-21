import React, { useState, useEffect, useCallback } from "react";
import { Download, Loader2, FileText, ShieldCheck, X, ChevronUp, ChevronDown, Search, RefreshCw, AlertTriangle, History } from "lucide-react";
import { useAuditLog } from "./hooks/useAuditLog";
import { useCan } from "./hooks/useCan";
import { getAnnouncementHistory } from "./api/logs.api";
import PriorityBadge from "./components/PriorityBadge";
import EmptyState from "./components/EmptyState";
import { PRIORITIES, ANNOUNCEMENT_TYPE_LABEL, ANNOUNCEMENT_TYPE_COLOR, DELIVERY_COLORS } from "./utils/constants";
import { formatTimestamp } from "./utils/formatters";

const TABS = [
  { id: "announcements", label: "Announcement History", icon: History },
  { id: "alert-logs", label: "Alert Logs",  icon: FileText },
  // { id: "audit",      label: "Audit Log",   icon: ShieldCheck },
];

const ACTION_COLORS = {
  "ack":           "bg-emerald-100 text-emerald-700",
  "rule.create":   "bg-blue-100 text-blue-700",
  "rule.edit":     "bg-emerald-100 text-emerald-700",
  "rule.delete":   "bg-red-100 text-red-700",
  "audio.upload":  "bg-purple-100 text-purple-700",
  "audio.delete":  "bg-red-100 text-red-700",
  "device.add":    "bg-cyan-100 text-cyan-700",
  "device.restart":"bg-amber-100 text-amber-700",
  "config.change": "bg-orange-100 text-orange-700",
  "login":         "bg-gray-100 text-gray-600",
  "login-fail":    "bg-red-100 text-red-700",
  "user.create":   "bg-blue-100 text-blue-700",
  "user.edit":     "bg-emerald-100 text-emerald-700",
  "user.delete":   "bg-red-100 text-red-700",
};

function exportCSV(data, filename) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const csv = [
    keys.join(","),
    ...data.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(",")),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

/** Render a destination IPs value that may be JSON array, comma string, or plain string */
function DestIps({ value }) {
  if (!value) return <span className="text-gray-400">—</span>;
  let ips = [];
  if (typeof value === "string") {
    try { ips = JSON.parse(value); } catch { ips = value.split(",").map((s) => s.trim()); }
  } else if (Array.isArray(value)) {
    ips = value;
  } else {
    ips = [String(value)];
  }
  return (
    <div className="flex flex-col gap-0.5">
      {ips.map((ip, i) => (
        <span key={i} className="font-mono text-[11px] text-gray-600">{ip}</span>
      ))}
    </div>
  );
}

function SortHeader({ label, sortKey, sortState, onSort }) {
  const active = sortState.by === sortKey;
  return (
    <th
      className="px-3 py-3 text-left font-semibold text-gray-600 text-[10px] uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-gray-100/60 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortState.dir === "desc" ? <ChevronDown size={11} /> : <ChevronUp size={11} />
        ) : (
          <span className="opacity-20"><ChevronDown size={11} /></span>
        )}
      </span>
    </th>
  );
}

export default function LogsAudit() {
  const [activeTab, setActiveTab] = useState("announcements");

  // Announcement history filters
  const [annItems, setAnnItems] = useState([]);
  const [annTotal, setAnnTotal] = useState(0);
  const [annPage, setAnnPage] = useState(1);
  const [annType, setAnnType] = useState("");
  const [annZone, setAnnZone] = useState("");
  const [annLoading, setAnnLoading] = useState(false);
  const [annError, setAnnError] = useState(null);

  // Alert log filters
  const [search, setSearch]           = useState("");
  const [priorityFilter, setPriority] = useState("");
  const [zoneFilter, setZone]         = useState("");
  const [alertPage, setAlertPage]     = useState(1);
  const [alertSort, setAlertSort]     = useState({ by: "", dir: "desc" });

  // Audit filters
  const [auditFilters, setAuditFilters] = useState({ user: "", action: "" });
  const [auditPage, setAuditPage]       = useState(1);

  const canExport   = useCan("aa.logs.export");
  const canViewAudit = useCan("aa.audit.view");

  const {
    alertLogs, auditLogs,
    alertTotal, auditTotal,
    alertMeta,
    loading, error,
    loadAlertLogs, loadAuditLogs,
  } = useAuditLog();

  const PAGE_SIZE = 20;

  const loadAnnouncements = useCallback(async () => {
    setAnnLoading(true);
    setAnnError(null);
    try {
      const res = await getAnnouncementHistory(
        { type: annType, zone: annZone }, annPage, PAGE_SIZE,
      );
      if (res.ok) { setAnnItems(res.data.items); setAnnTotal(res.data.total); }
      else setAnnError(res.error || "Failed to load announcement history");
    } catch {
      setAnnError("Network error");
    } finally {
      setAnnLoading(false);
    }
  }, [annType, annZone, annPage]);

  useEffect(() => {
    if (activeTab === "announcements") loadAnnouncements();
  }, [activeTab, loadAnnouncements]);

  const annPages = Math.max(1, Math.ceil(annTotal / PAGE_SIZE));

  const buildAlertFilters = useCallback(() => ({
    ...(search       ? { search }             : {}),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
    ...(zoneFilter   ? { zone: zoneFilter }   : {}),
    ...(alertSort.by ? { sort_by: alertSort.by, sort_dir: alertSort.dir } : {}),
  }), [search, priorityFilter, zoneFilter, alertSort]);

  useEffect(() => {
    if (activeTab === "alert-logs") loadAlertLogs(buildAlertFilters(), alertPage, PAGE_SIZE);
  }, [activeTab, alertPage, buildAlertFilters, loadAlertLogs]);

  useEffect(() => {
    if (activeTab === "audit" && canViewAudit) loadAuditLogs(auditFilters, auditPage, PAGE_SIZE);
  }, [activeTab, auditFilters, auditPage, loadAuditLogs, canViewAudit]);

  const alertPages = Math.max(1, Math.ceil(alertTotal / PAGE_SIZE));
  const auditPages = Math.max(1, Math.ceil(auditTotal / PAGE_SIZE));

  function handleSort(key) {
    setAlertSort((s) => s.by === key
      ? { by: key, dir: s.dir === "desc" ? "asc" : "desc" }
      : { by: key, dir: "desc" }
    );
    setAlertPage(1);
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setAlertPage(1);
  }

  // Resolve column values using meta mapping
  function getField(row, colKey) {
    const col = alertMeta[colKey];
    return col ? row[col] : undefined;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex border-b border-gray-100" role="tablist">
          {TABS.filter((t) => t.id !== "audit" || canViewAudit).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500 ${activeTab === tab.id ? "border-b-2 border-emerald-700 text-emerald-800" : "text-gray-500 hover:text-gray-700"}`}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Announcement History (D1) ───────────────────────────── */}
        {activeTab === "announcements" && (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="flex gap-2 flex-wrap items-center">
                <select
                  value={annType}
                  onChange={(e) => { setAnnType(e.target.value); setAnnPage(1); }}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-600"
                >
                  <option value="">All types</option>
                  <option value="broadcast">Manual Broadcast</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="paging">Live Paging</option>
                  <option value="sop">SOP Step</option>
                </select>
                <input
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 w-36 text-gray-600"
                  placeholder="Filter by zone…"
                  value={annZone}
                  onChange={(e) => { setAnnZone(e.target.value); setAnnPage(1); }}
                />
                <button type="button"
                  onClick={() => { setAnnType(""); setAnnZone(""); setAnnPage(1); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors" title="Clear filters">
                  <X size={13} />
                </button>
                <button type="button" onClick={loadAnnouncements}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors" title="Refresh">
                  <RefreshCw size={13} />
                </button>
              </div>
              {canExport && (
                <button type="button" onClick={() => exportCSV(annItems, "announcement-history.csv")}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50">
                  <Download size={13} /> Export CSV
                </button>
              )}
            </div>

            {annLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></div>
            ) : annError ? (
              <EmptyState title="Could not load announcement history" message={annError} />
            ) : annItems.length === 0 ? (
              <EmptyState title="No announcements yet" message="Manual broadcasts, scheduled announcements, live paging sessions, and SOP steps will appear here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      {["Timestamp", "Type", "Target", "Audio Mode", "Language", "Status", "Source"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left font-semibold text-gray-600 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {annItems.map((row, idx) => (
                      <tr key={idx} className="hover:bg-emerald-50/20 transition-colors">
                        <td className="px-3 py-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                          {row.timestamp ? formatTimestamp(row.timestamp) : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${ANNOUNCEMENT_TYPE_COLOR[row.type] ?? "bg-gray-100 text-gray-600"}`}>
                            {ANNOUNCEMENT_TYPE_LABEL[row.type] ?? row.type}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-700 max-w-[160px]">
                          <span className="block truncate" title={row.target}>{row.target || "—"}</span>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500 capitalize">{row.audio_mode?.replace("_", " ") || "—"}</td>
                        <td className="px-3 py-3 text-xs text-gray-500">{row.language || "—"}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${DELIVERY_COLORS[(row.status || "").toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-[11px] text-gray-400">{row.source || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {annPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
                <span>Page {annPage} of {annPages} ({annTotal} total)</span>
                <div className="flex gap-1">
                  <button type="button" disabled={annPage === 1} onClick={() => setAnnPage((p) => p - 1)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
                  <button type="button" disabled={annPage === annPages} onClick={() => setAnnPage((p) => p + 1)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Alert Logs ───────────────────────────────────────────── */}
        {activeTab === "alert-logs" && (
          <div className="p-4 flex flex-col gap-4">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-wrap items-center">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 w-52"
                    placeholder="Search alert name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onBlur={() => { setAlertPage(1); loadAlertLogs(buildAlertFilters(), 1, PAGE_SIZE); }}
                  />
                </div>
                <select
                  value={priorityFilter}
                  onChange={(e) => { setPriority(e.target.value); setAlertPage(1); }}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-600"
                >
                  <option value="">All priorities</option>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 w-36 text-gray-600"
                  placeholder="Filter by zone…"
                  value={zoneFilter}
                  onChange={(e) => { setZone(e.target.value); setAlertPage(1); }}
                />
                <button type="button"
                  onClick={() => { setSearch(""); setPriority(""); setZone(""); setAlertPage(1); setAlertSort({ by: "", dir: "desc" }); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors" title="Clear filters">
                  <X size={13} />
                </button>
                <button type="button"
                  onClick={() => { setAlertPage(1); loadAlertLogs(buildAlertFilters(), 1, PAGE_SIZE); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors" title="Refresh">
                  <RefreshCw size={13} />
                </button>
              </form>
              {canExport && (
                <button type="button" onClick={() => exportCSV(alertLogs, "alert-logs.csv")}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50">
                  <Download size={13} /> Export CSV
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertTriangle size={32} className="text-amber-400" />
                <p className="text-sm font-medium text-gray-700">{error}</p>
                <p className="text-xs text-gray-400 max-w-sm">
                  {error.includes("not found")
                    ? "The alert_logs table has not been created yet. It will be populated by the device alert program."
                    : "Check the backend connection and try again."}
                </p>
              </div>
            ) : alertLogs.length === 0 ? (
              <EmptyState title="No alert logs found" message="No alert delivery records have been recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <SortHeader label="Timestamp"        sortKey={alertMeta.timestamp_col || "timestamp"} sortState={alertSort} onSort={handleSort} />
                      <SortHeader label="Alert Name"       sortKey={alertMeta.name_col      || "alert_name"} sortState={alertSort} onSort={handleSort} />
                      <SortHeader label="Priority"         sortKey={alertMeta.priority_col  || "priority"}  sortState={alertSort} onSort={handleSort} />
                      <SortHeader label="Zone"             sortKey={alertMeta.zone_col       || "zone"}      sortState={alertSort} onSort={handleSort} />
                      <th className="px-3 py-3 text-left font-semibold text-gray-600 text-[10px] uppercase tracking-wide">Destination IPs</th>
                      <SortHeader label="Delivery Status"  sortKey={alertMeta.status_col    || "delivery_status"} sortState={alertSort} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {alertLogs.map((row, idx) => {
                      const ts       = alertMeta.timestamp_col ? row[alertMeta.timestamp_col] : row.timestamp ?? row.created_at ?? row.triggered_at;
                      const name     = alertMeta.name_col      ? row[alertMeta.name_col]      : row.alert_name ?? row.name ?? row.message ?? row.alert ?? "—";
                      const priority = alertMeta.priority_col  ? row[alertMeta.priority_col]  : row.priority ?? row.severity ?? row.level;
                      const zone     = alertMeta.zone_col      ? row[alertMeta.zone_col]      : row.zone ?? row.zone_name ?? row.location ?? "—";
                      const destIps  = alertMeta.dest_col      ? row[alertMeta.dest_col]      : row.destination_ips ?? row.dest_ips ?? row.target_ips ?? row.destination;
                      const status   = alertMeta.status_col    ? row[alertMeta.status_col]    : row.delivery_status ?? row.send_status ?? row.dispatch_status;
                      const statusKey = (status || "").toLowerCase();

                      return (
                        <tr key={row.id ?? idx} className="hover:bg-emerald-50/20 transition-colors">
                          <td className="px-3 py-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                            {ts ? formatTimestamp(ts) : "—"}
                          </td>
                          <td className="px-3 py-3 text-xs font-medium text-gray-800 max-w-[200px]">
                            <span className="block truncate" title={name}>{name || "—"}</span>
                          </td>
                          <td className="px-3 py-3">
                            {priority
                              ? <PriorityBadge priority={String(priority).toUpperCase()} size="xs" />
                              : <span className="text-gray-400 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-500">{zone || "—"}</td>
                          <td className="px-3 py-3"><DestIps value={destIps} /></td>
                          <td className="px-3 py-3">
                            {status ? (
                              <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${DELIVERY_COLORS[statusKey] ?? "bg-gray-100 text-gray-600"}`}>
                                {status}
                              </span>
                            ) : <span className="text-gray-400 text-xs">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {alertPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
                <span>Page {alertPage} of {alertPages} ({alertTotal} total)</span>
                <div className="flex gap-1">
                  <button type="button" disabled={alertPage === 1} onClick={() => setAlertPage((p) => p - 1)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
                  <button type="button" disabled={alertPage === alertPages} onClick={() => setAlertPage((p) => p + 1)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Audit Logs ───────────────────────────────────────────── */}
        {activeTab === "audit" && canViewAudit && (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-2 flex-wrap">
                <select
                  value={auditFilters.action}
                  onChange={(e) => { setAuditFilters((f) => ({ ...f, action: e.target.value })); setAuditPage(1); }}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-600"
                >
                  <option value="">All actions</option>
                  {["ack","rule","audio","device","config","login","user"].map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <input
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 w-32 text-gray-600"
                  placeholder="Filter user…"
                  value={auditFilters.user}
                  onChange={(e) => { setAuditFilters((f) => ({ ...f, user: e.target.value })); setAuditPage(1); }}
                />
                <button type="button" onClick={() => loadAuditLogs(auditFilters, auditPage, PAGE_SIZE)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors" title="Refresh">
                  <RefreshCw size={13} />
                </button>
              </div>
              {canExport && (
                <button type="button" onClick={() => exportCSV(auditLogs, "audit-log.csv")}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50">
                  <Download size={13} /> Export CSV
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-emerald-700" /></div>
            ) : error ? (
              <EmptyState title="Could not load audit log" message={error} />
            ) : auditLogs.length === 0 ? (
              <EmptyState title="No audit records" message="No audit events have been recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      {["Timestamp", "User", "Action", "Target", "Before / After", "IP"].map((h) => (
                        <th key={h} className="px-3 py-3 text-left font-semibold text-gray-600 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                        <td className="px-3 py-3 text-xs font-medium text-gray-700">{log.user}</td>
                        <td className="px-3 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-600"}`}>{log.action}</span>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500">{log.target_label}</td>
                        <td className="px-3 py-3 text-[11px] text-gray-400 max-w-[160px]">
                          {log.after ? (
                            <span className="font-mono truncate block" title={JSON.stringify(log.after)}>{JSON.stringify(log.after).slice(0, 60)}…</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] text-gray-400">{log.ip}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {auditPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
                <span>Page {auditPage} of {auditPages} ({auditTotal} total) — Immutable log</span>
                <div className="flex gap-1">
                  <button type="button" disabled={auditPage === 1} onClick={() => setAuditPage((p) => p - 1)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
                  <button type="button" disabled={auditPage === auditPages} onClick={() => setAuditPage((p) => p + 1)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
