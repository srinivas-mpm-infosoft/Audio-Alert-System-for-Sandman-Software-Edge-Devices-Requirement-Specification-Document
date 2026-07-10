import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Edit2, Trash2, Loader2, ListChecks, PlayCircle, History,
  CheckCircle2, XCircle, Clock, AlertTriangle, RotateCcw,
} from "lucide-react";
import { useSops } from "./hooks/useSops";
import { useSopExecutions } from "./hooks/useSopExecutions";
import { useCan } from "./hooks/useCan";
import { useToast } from "../../components/ToastContext";
import { useDashboardEvents } from "./hooks/useDashboardEvents";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import RefreshButton from "./components/RefreshButton";
import SopForm from "./SopForm";
import { formatTimestamp } from "./utils/formatters";
import {
  getSopExecutions, getSopExecutionAudit, acknowledgeSopStep, cancelSopExecution, repeatSopStep, startSop,
} from "./api/sop.api";

const TABS = [
  { id: "manage", label: "Manage SOPs", icon: ListChecks },
  { id: "run",    label: "Live Executions", icon: PlayCircle },
  { id: "history", label: "History & Audit", icon: History },
];

const STATUS_STYLE = {
  NOT_STARTED: "bg-slate-100 text-slate-600",
  PLAYING_STEP: "bg-blue-100 text-blue-700",
  WAITING_FOR_ACKNOWLEDGEMENT: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-slate-200 text-slate-600",
  FAILED: "bg-red-100 text-red-700",
};

function targetLabel(item) {
  if (item.plant_wide) return "Plant-wide";
  return (item.zone_ids || []).join(", ") || "—";
}

function ExecutionCard({ execution, steps, canAck, canRun, onAck, onCancel, onRepeat, busy }) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const waitedSec = (now && execution.step_started_at)
    ? Math.floor((now - new Date(execution.step_started_at).getTime()) / 1000)
    : 0;
  const timeoutSec = execution.ack_timeout_sec || 120;
  const isWaiting = execution.status === "WAITING_FOR_ACKNOWLEDGEMENT";
  const overdue = isWaiting && waitedSec > timeoutSec * 0.7;
  const isStopped = execution.status === "CANCELLED" || execution.status === "FAILED";
  const hasSteps = Array.isArray(steps) && steps.length > 0;

  return (
    <div className={`rounded-xl border-2 p-5 flex flex-col gap-3 ${overdue ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">{execution.sop_name}</p>
          <div className="flex items-center gap-2">
            <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[execution.status] ?? "bg-slate-100 text-slate-600"}`}>
              {execution.status.replace(/_/g, " ")}
            </span>
            {!hasSteps && (
              <span className="text-sm font-semibold text-slate-700">
                Step {execution.current_step_number} of {execution.total_steps}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>Target: <strong className="text-slate-700">{targetLabel(execution)}</strong></p>
          <p>Started by: <strong className="text-slate-700">{execution.started_by}</strong></p>
          {!hasSteps && execution.retry_count > 0 && (
            <p className="flex items-center gap-1 justify-end text-amber-600 font-semibold mt-0.5">
              <RotateCcw size={11} aria-hidden="true" /> {execution.retry_count} retr{execution.retry_count === 1 ? "y" : "ies"}
            </p>
          )}
        </div>
      </div>

      {!hasSteps && (
        <>
          {execution.current_step && (
            <p className="text-base italic text-slate-700 leading-relaxed">
              "{execution.current_step.audio_mode === "clip" ? `[Clip: ${execution.current_step.title}]` : execution.current_step.message}"
            </p>
          )}

          {isWaiting && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Clock size={13} aria-hidden="true" />
              Waiting {waitedSec}s / {timeoutSec}s for acknowledgement
              {overdue && <span className="text-amber-600 font-semibold">— replay imminent</span>}
            </div>
          )}

          {canAck && isWaiting && (
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => onAck(execution.id)} disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                <CheckCircle2 size={14} aria-hidden="true" /> Acknowledge
              </button>
              <button type="button" onClick={() => onRepeat(execution.id)} disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-50">
                <RotateCcw size={14} aria-hidden="true" /> Repeat
              </button>
            </div>
          )}
        </>
      )}

      {hasSteps && (
        <div className="flex flex-col gap-1">
          {steps.map((step, idx) => {
            const stepNum = idx + 1;
            const isDone = stepNum < execution.current_step_number;
            const isCurrent = stepNum === execution.current_step_number;
            const isSkipped = !isDone && !isCurrent && isStopped;
            const stepLabel = step.title || (step.audio_mode === "clip" ? "Voice clip" : step.message) || `Step ${stepNum}`;

            return (
              <div
                key={step.id ?? stepNum}
                className={`flex items-start gap-3 rounded-lg px-3 py-2 ${
                  isCurrent ? (overdue ? "bg-amber-50 border border-amber-200" : "bg-indigo-50/60 border border-indigo-100") : "border border-transparent"
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle2 size={16} className="text-emerald-500" aria-hidden="true" />
                  ) : isSkipped ? (
                    <XCircle size={16} className="text-slate-400" aria-hidden="true" />
                  ) : isCurrent ? (
                    isWaiting
                      ? <Clock size={16} className="text-amber-500" aria-hidden="true" />
                      : <PlayCircle size={16} className="text-blue-500" aria-hidden="true" />
                  ) : (
                    <span className="inline-block w-4 h-4 rounded-full border-2 border-slate-200" aria-hidden="true" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${
                      isDone ? "text-slate-400 line-through" : isSkipped ? "text-slate-400" : isCurrent ? "text-slate-800" : "text-slate-500"
                    }`}>
                      Step {stepNum}: {stepLabel}
                    </span>
                    {isCurrent && (
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[execution.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {execution.status.replace(/_/g, " ")}
                      </span>
                    )}
                    {isCurrent && execution.retry_count > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-600 text-[10px] font-semibold">
                        <RotateCcw size={10} aria-hidden="true" /> {execution.retry_count} retr{execution.retry_count === 1 ? "y" : "ies"}
                      </span>
                    )}
                    {isSkipped && <span className="text-[10px] text-slate-400 uppercase tracking-wide">Skipped</span>}
                  </div>

                  {isCurrent && execution.current_step && (
                    <p className="text-sm italic text-slate-600 mt-1">
                      "{execution.current_step.audio_mode === "clip" ? `[Clip: ${execution.current_step.title}]` : execution.current_step.message}"
                    </p>
                  )}

                  {isCurrent && isWaiting && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                      <Clock size={12} aria-hidden="true" />
                      Waiting {waitedSec}s / {timeoutSec}s for acknowledgement
                      {overdue && <span className="text-amber-600 font-semibold">— replay imminent</span>}
                    </div>
                  )}

                  {isCurrent && canAck && isWaiting && (
                    <div className="flex gap-3 pt-2">
                      <button type="button" onClick={() => onAck(execution.id)} disabled={busy}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                        <CheckCircle2 size={14} aria-hidden="true" /> Acknowledge
                      </button>
                      <button type="button" onClick={() => onRepeat(execution.id)} disabled={busy}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-50">
                        <RotateCcw size={14} aria-hidden="true" /> Repeat
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canRun && (isWaiting || execution.status === "PLAYING_STEP") && (
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={() => onCancel(execution.id)} disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-semibold disabled:opacity-50">
            <XCircle size={14} aria-hidden="true" /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function Sop() {
  const [tab, setTab] = useState("manage");
  const { sops, loading, load, create, update, remove } = useSops();
  const canEdit = useCan("aa.sop.edit");
  const canDelete = useCan("aa.sop.delete");
  const canRun = useCan("aa.sop.run");
  const canAck = useCan("aa.sop.ack");
  const showToast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { executions, loading: execLoading, reload: loadExecutions } = useSopExecutions({ activeOnly: true });
  const [historyExecutions, setHistoryExecutions] = useState([]);
  const [auditExpanded, setAuditExpanded] = useState(null);
  const [auditRows, setAuditRows] = useState([]);

  const stepsBySopId = useMemo(
    () => Object.fromEntries(sops.map((s) => [s.id, s.steps || []])),
    [sops]
  );

  useEffect(() => { load(); }, [load]);

  const loadHistory = useCallback(async () => {
    const res = await getSopExecutions(false, 100);
    if (res.ok) setHistoryExecutions(res.data);
  }, []);

  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  // The shared hook already keeps `executions` in sync with the live
  // "sop_execution" event stream — this is a small extra local subscription
  // just to refresh the History tab while it's the one open.
  useDashboardEvents(useCallback((event) => {
    if (event.type !== "sop_execution") return;
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]));

  const handleSave = async (payload) => {
    const res = editTarget ? await update(editTarget.id, payload) : await create(payload);
    if (res.ok) {
      showToast(editTarget ? "SOP updated" : "SOP created", "success");
      setShowForm(false);
      setEditTarget(null);
    }
    return res;
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await remove(deleteTarget.id);
    if (res.ok) showToast("SOP deleted", "success");
    else showToast(res.error || "Failed to delete SOP", "error");
    setDeleteTarget(null);
  };

  const handleStart = async (sop) => {
    setBusyId(sop.id);
    try {
      const res = await startSop(sop.id);
      if (res.ok) {
        showToast(`SOP started — step 1 of ${sop.step_count}`, "success");
        setTab("run");
        loadExecutions();
      } else {
        showToast(res.error || "Failed to start SOP", "error");
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleAck = async (executionId) => {
    setBusyId(executionId);
    try {
      const res = await acknowledgeSopStep(executionId);
      if (!res.ok) showToast(res.error || "Failed to acknowledge", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleRepeat = async (executionId) => {
    setBusyId(executionId);
    try {
      const res = await repeatSopStep(executionId);
      if (res.ok) showToast("Step repeated", "success");
      else showToast(res.error || "Failed to repeat step", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (executionId) => {
    setBusyId(executionId);
    try {
      const res = await cancelSopExecution(executionId);
      if (res.ok) showToast("SOP execution cancelled", "success");
      else showToast(res.error || "Failed to cancel", "error");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAudit = async (executionId) => {
    if (auditExpanded === executionId) { setAuditExpanded(null); return; }
    setAuditExpanded(executionId);
    const res = await getSopExecutionAudit(executionId);
    if (res.ok) setAuditRows(res.data);
  };

  if (showForm) {
    return (
      <SopForm
        initialSop={editTarget}
        onSave={handleSave}
        onCancel={() => { setShowForm(false); setEditTarget(null); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex border-b border-slate-100" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors focus:outline-none ${tab === t.id ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}>
                <Icon size={14} aria-hidden="true" />
                {t.label}
                {t.id === "run" && executions.length > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold">{executions.length}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Manage */}
        {tab === "manage" && (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex justify-end gap-2">
              <RefreshButton onClick={load} loading={loading} title="Refresh SOP list" />
              {canEdit && (
                <button type="button" onClick={() => { setEditTarget(null); setShowForm(true); }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold">
                  <Plus size={15} aria-hidden="true" /> New SOP
                </button>
              )}
            </div>
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
            ) : sops.length === 0 ? (
              <EmptyState icon={ListChecks} title="No SOPs configured" message="Create a step-by-step audio guidance procedure for furnace startup, mould changeover, or operator training." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      {["Name", "Target", "Steps", "Ack Timeout", "Active", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sops.map((sop) => (
                      <tr key={sop.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800 max-w-[220px]">
                          <span className="truncate block" title={sop.name}>{sop.name}</span>
                          {sop.description && <span className="block text-[11px] text-slate-400 truncate" title={sop.description}>{sop.description}</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs max-w-[140px]">
                          <span className="truncate block">{targetLabel(sop)}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-semibold text-xs">{sop.step_count}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{sop.ack_timeout_sec}s</td>
                        <td className="px-4 py-3">
                          <span className={sop.is_active ? "text-emerald-600 text-xs font-semibold" : "text-slate-400 text-xs"}>{sop.is_active ? "Active" : "Inactive"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {canRun && sop.is_active && (
                              <button type="button" onClick={() => handleStart(sop)} disabled={busyId === sop.id}
                                className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 transition-colors disabled:opacity-40" title="Start SOP">
                                {busyId === sop.id ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} aria-hidden="true" />}
                              </button>
                            )}
                            {canEdit && (
                              <button type="button" onClick={() => { setEditTarget(sop); setShowForm(true); }} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Edit">
                                <Edit2 size={13} aria-hidden="true" />
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" onClick={() => setDeleteTarget(sop)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Live Executions */}
        {tab === "run" && (
          <div className="p-4 flex flex-col gap-4">
            {execLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
            ) : executions.length === 0 ? (
              <EmptyState icon={PlayCircle} title="No SOP currently running" message="Start an SOP from the Manage tab to walk an operator through it step by step." />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {executions.map((execution) => (
                  <ExecutionCard
                    key={execution.id} execution={execution}
                    steps={stepsBySopId[execution.sop_id] || null}
                    canAck={canAck} canRun={canRun}
                    onAck={handleAck} onCancel={handleCancel} onRepeat={handleRepeat}
                    busy={busyId === execution.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* History & Audit */}
        {tab === "history" && (
          <div className="p-4 flex flex-col gap-4">
            {historyExecutions.length === 0 ? (
              <EmptyState icon={History} title="No SOP executions yet" message="Every SOP run — completed, cancelled, or failed — will appear here with its full audit trail." />
            ) : (
              <div className="flex flex-col gap-2">
                {historyExecutions.map((execution) => (
                  <div key={execution.id} className="border border-slate-200 rounded-lg overflow-hidden">
                    <button type="button" onClick={() => toggleAudit(execution.id)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[execution.status] ?? "bg-slate-100 text-slate-600"}`}>
                          {execution.status.replace(/_/g, " ")}
                        </span>
                        <span className="text-sm font-medium text-slate-800">{execution.sop_name}</span>
                        <span className="text-xs text-slate-400">{targetLabel(execution)}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-mono">{formatTimestamp(execution.started_at)}</span>
                    </button>
                    {auditExpanded === execution.id && (
                      <div className="border-t border-slate-100 p-3 bg-slate-50/50">
                        {auditRows.length === 0 ? (
                          <p className="text-xs text-slate-400 py-2">No audit events recorded.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400 text-[10px] uppercase">
                                <th className="text-left py-1 pr-3">Timestamp</th>
                                <th className="text-left py-1 pr-3">Step</th>
                                <th className="text-left py-1 pr-3">Event</th>
                                <th className="text-left py-1 pr-3">Zone</th>
                                <th className="text-left py-1 pr-3">Operator</th>
                                <th className="text-left py-1">Retry</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {auditRows.map((row) => (
                                <tr key={row.id}>
                                  <td className="py-1.5 pr-3 font-mono text-slate-500">{formatTimestamp(row.created_at)}</td>
                                  <td className="py-1.5 pr-3 text-slate-700">{row.step_number}</td>
                                  <td className="py-1.5 pr-3">
                                    <span className="capitalize text-slate-600">{row.event_type?.replace(/_/g, " ")}</span>
                                    {row.event_type === "timeout_replay" && <AlertTriangle size={10} className="inline ml-1 text-amber-500" aria-hidden="true" />}
                                  </td>
                                  <td className="py-1.5 pr-3 text-slate-500">{row.zone_code || "—"}</td>
                                  <td className="py-1.5 pr-3 text-slate-500">{row.operator || "—"}</td>
                                  <td className="py-1.5 text-slate-500">{row.retry_count || 0}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete SOP"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
