import React, { useState, useEffect, useRef, useCallback } from "react";
import { BarChart3, Download, Loader2, TrendingUp, Award, RefreshCw } from "lucide-react";
import { getAnalytics } from "./api/analytics.api";
import { useCan } from "./hooks/useCan";
import ChartBar from "./components/ChartBar";
import ChartLine from "./components/ChartLine";
import EmptyState from "./components/EmptyState";
import PriorityBadge from "./components/PriorityBadge";

const REFRESH_OPTIONS = [
  { label: "No refresh", value: 0 },
  { label: "3s", value: 3000 },
  { label: "5s", value: 5000 },
];

const PRIORITY_COLORS = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308", LOW: "#3b82f6" };

function exportCSV(data, filename) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const csv = [keys.join(","), ...data.map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

function Card({ title, children, exportData, exportFile }) {
  const canExport = useCan("aa.analytics.export");
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
        {canExport && exportData && (
          <button type="button" onClick={() => exportCSV(exportData, exportFile)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-50" aria-label={`Export ${title} as CSV`}>
            <Download size={12} aria-hidden="true" /> CSV
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

const DATE_RANGES = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(7);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const intervalRef = useRef(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    getAnalytics({ days: dateRange }).then((res) => {
      if (res.ok) setData(res.data);
      setLoading(false);
    });
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData, refreshKey]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => setRefreshKey((k) => k + 1), refreshInterval);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refreshInterval]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;
  if (!data) return <EmptyState title="Failed to load analytics" message="Try refreshing the page." />;

  const daily = data.daily.slice(-dateRange);

  return (
    <div className="flex flex-col gap-5">
      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date range:</span>
        {DATE_RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            onClick={() => setDateRange(r.days)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${dateRange === r.days ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {r.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Auto refresh:</span>
          <div className="flex rounded-lg overflow-hidden border border-slate-200">
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRefreshInterval(opt.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${refreshInterval === opt.value ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
            title="Refresh now"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* 1. Most frequent alerts */}
        <Card title="Most Frequent Alerts" exportData={data.alert_frequency} exportFile="alert-frequency.csv">
          <ChartBar
            data={data.alert_frequency.map((d) => ({ label: d.alert_code, count: d.count }))}
            valueKey="count"
            labelKey="label"
            horizontal
            height={200}
            barColor="#6366f1"
          />
        </Card>

        {/* 2. Shift-wise alert count */}
        <Card title="Shift-wise Alert Count" exportData={data.shifts} exportFile="shift-alerts.csv">
          <div className="space-y-3">
            {data.shifts.map((s) => (
              <div key={s.shift} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-20 flex-shrink-0">{s.shift}</span>
                <div className="flex-1 flex gap-0.5 rounded-full overflow-hidden h-5">
                  {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
                    s[p] > 0 && (
                      <div
                        key={p}
                        style={{ width: `${(s[p] / s.total) * 100}%`, background: PRIORITY_COLORS[p] }}
                        title={`${p}: ${s[p]}`}
                        role="presentation"
                      />
                    )
                  ))}
                </div>
                <span className="text-xs font-bold text-slate-700 w-6 text-right">{s.total}</span>
              </div>
            ))}
            <div className="flex gap-4 flex-wrap">
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
                <span key={p} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="w-3 h-3 rounded-sm" style={{ background: PRIORITY_COLORS[p] }} aria-hidden="true" />
                  {p}
                </span>
              ))}
            </div>
          </div>
        </Card>

        {/* 3. Alert trend */}
        <Card title="Alert Trend (with 7-day rolling avg)" exportData={daily} exportFile="alert-trend.csv">
          <ChartLine
            data={daily}
            valueKeys={["total"]}
            colors={["#6366f1"]}
            labelKey="date"
            height={180}
            showRollingAvg
          />
          <div className="flex gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-6 border-t-2 border-indigo-500 inline-block" aria-hidden="true" /> Total</span>
            <span className="flex items-center gap-1"><span className="w-6 border-t-2 border-orange-400 border-dashed inline-block" aria-hidden="true" /> 7-day avg</span>
          </div>
        </Card>

        {/* 4. Response times */}
        <Card title="Response Time Analysis" exportData={data.response_times} exportFile="response-times.csv">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" role="table">
              <thead><tr className="border-b border-slate-100">{["Shift", "Avg (s)", "P95 (s)", "Critical", "High", "Medium", "Low"].map((h) => <th key={h} className="px-2 py-2 text-left text-slate-500 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-50">
                {data.response_times.map((r) => (
                  <tr key={r.shift} className="hover:bg-slate-50/50">
                    <td className="px-2 py-2 font-medium text-slate-700">{r.shift}</td>
                    <td className="px-2 py-2 font-mono">{r.avg_ack_sec}s</td>
                    <td className="px-2 py-2 font-mono">{r.p95_ack_sec}s</td>
                    <td className="px-2 py-2 font-mono text-red-600">{r.CRITICAL}s</td>
                    <td className="px-2 py-2 font-mono text-orange-600">{r.HIGH}s</td>
                    <td className="px-2 py-2 font-mono text-yellow-600">{r.MEDIUM}s</td>
                    <td className="px-2 py-2 font-mono text-blue-600">{r.LOW}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 5. Device uptime */}
        <Card title="Device Uptime" exportData={data.device_uptime} exportFile="device-uptime.csv">
          <div className="space-y-2">
            {data.device_uptime.map((d) => {
              const color = d.uptime_pct >= 99 ? "#22c55e" : d.uptime_pct >= 95 ? "#f97316" : "#ef4444";
              return (
                <div key={d.device_id} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 flex-1 truncate" title={d.name}>{d.name}</span>
                  <div className="w-24 bg-slate-100 rounded-full h-2">
                    <div className="h-2 rounded-full" style={{ width: `${d.uptime_pct}%`, background: color }} role="progressbar" aria-valuenow={d.uptime_pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${d.name} uptime`} />
                  </div>
                  <span className="text-xs font-bold w-10 text-right" style={{ color }}>{d.uptime_pct}%</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* 6. False alerts */}
        <Card title="False Alert Analysis" exportData={data.false_alerts} exportFile="false-alerts.csv">
          {data.false_alerts.length === 0 ? (
            <EmptyState icon={Award} title="No false alerts detected" message="All rules have high efficacy scores." />
          ) : (
            <div className="space-y-3">
              {data.false_alerts.map((fa) => (
                <div key={fa.rule_id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{fa.rule_name}</p>
                    <p className="text-xs text-slate-500">{fa.auto_ack_count}/{fa.total} auto-acked ({fa.auto_ack_pct}%) • avg recovery {fa.avg_recovery_sec}s</p>
                    <p className="text-xs text-amber-700 font-medium mt-0.5">Suggested threshold: {fa.suggested_threshold}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 7. Ack source donut */}
        <Card title="Acknowledgement Source Breakdown" exportData={data.ack_sources} exportFile="ack-sources.csv">
          <div className="flex items-center gap-6">
            <svg viewBox="0 0 120 120" className="w-28 h-28 flex-shrink-0" role="img" aria-label="Acknowledgement sources donut chart">
              {(() => {
                const total = data.ack_sources.reduce((s, d) => s + d.count, 0);
                const colors = ["#6366f1", "#22c55e", "#f97316", "#94a3b8"];
                let start = -Math.PI / 2;
                return data.ack_sources.map((d, i) => {
                  const angle = (d.count / total) * 2 * Math.PI;
                  const x1 = 60 + 45 * Math.cos(start);
                  const y1 = 60 + 45 * Math.sin(start);
                  start += angle;
                  const x2 = 60 + 45 * Math.cos(start);
                  const y2 = 60 + 45 * Math.sin(start);
                  const large = angle > Math.PI ? 1 : 0;
                  return <path key={i} d={`M60 60 L${x1} ${y1} A45 45 0 ${large} 1 ${x2} ${y2} Z`} fill={colors[i]} />;
                });
              })()}
              <circle cx={60} cy={60} r={28} fill="white" />
            </svg>
            <div className="space-y-1.5">
              {data.ack_sources.map((s, i) => {
                const colors = ["#6366f1", "#22c55e", "#f97316", "#94a3b8"];
                return (
                  <div key={s.source} className="flex items-center gap-2 text-xs">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colors[i] }} aria-hidden="true" />
                    <span className="text-slate-600 flex-1">{s.source}</span>
                    <span className="font-bold text-slate-700">{s.pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* 8. Rule efficacy */}
        <Card title="Rule Efficacy Scorecard" exportData={data.rule_efficacy} exportFile="rule-efficacy.csv">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" role="table">
              <thead><tr className="border-b border-slate-100">{["Rule", "Triggers", "Acked", "Auto", "Avg (s)", "Score"].map((h) => <th key={h} className="px-2 py-2 text-left text-slate-500 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-50">
                {data.rule_efficacy.map((r) => {
                  const scoreColor = r.efficacy >= 90 ? "#22c55e" : r.efficacy >= 70 ? "#f97316" : "#ef4444";
                  return (
                    <tr key={r.rule_id} className="hover:bg-slate-50/50">
                      <td className="px-2 py-2 font-medium text-slate-700 max-w-[150px] truncate" title={r.rule_name}>{r.rule_name}</td>
                      <td className="px-2 py-2 font-mono">{r.total_triggers}</td>
                      <td className="px-2 py-2 font-mono">{r.acked_triggers ?? r.acked}</td>
                      <td className="px-2 py-2 font-mono">{r.auto_acks}</td>
                      <td className="px-2 py-2 font-mono">{r.avg_ack_sec}s</td>
                      <td className="px-2 py-2">
                        <span className="font-bold" style={{ color: scoreColor }}>{r.efficacy}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
