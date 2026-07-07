import React, { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Loader2, CalendarClock, Clock } from "lucide-react";
import { useSchedules } from "./hooks/useSchedules";
import { useCan } from "./hooks/useCan";
import { useToast } from "../../components/ToastContext";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import ScheduleForm from "./ScheduleForm";
import { formatTimestamp } from "./utils/formatters";

const STATUS_STYLE = {
  success: "text-emerald-700 bg-emerald-50",
  partial: "text-amber-700 bg-amber-50",
  failed:  "text-red-700 bg-red-50",
};

function scheduleSummary(s) {
  if (s.schedule_type === "once") return s.scheduled_at ? `Once — ${formatTimestamp(s.scheduled_at)}` : "Once";
  if (s.schedule_type === "daily") return `Daily @ ${s.time_of_day || "—"}`;
  if (s.schedule_type === "weekly") {
    const names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    const days = (s.days_of_week || []).map((d) => names[d]).join(", ");
    return `Weekly (${days || "—"}) @ ${s.time_of_day || "—"}`;
  }
  return s.schedule_type;
}

export default function Schedule() {
  const { schedules, loading, load, create, update, remove, enable, disable } = useSchedules();
  const canEdit = useCan("aa.schedule.edit");
  const showToast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    const res = editTarget ? await update(editTarget.id, payload) : await create(payload);
    if (res.ok) {
      showToast(editTarget ? "Schedule updated" : "Schedule created", "success");
      setShowForm(false);
      setEditTarget(null);
    }
    return res;
  };

  const handleToggle = async (s) => {
    setBusyId(s.id);
    try {
      const res = s.is_enabled ? await disable(s.id) : await enable(s.id);
      if (res.ok) showToast(`Schedule ${s.is_enabled ? "disabled" : "enabled"}`, "success");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await remove(deleteTarget.id);
    if (res.ok) showToast("Schedule deleted", "success");
    setDeleteTarget(null);
  };

  if (showForm) {
    return (
      <ScheduleForm
        initialSchedule={editTarget}
        onSave={handleSave}
        onCancel={() => { setShowForm(false); setEditTarget(null); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-600">
          <CalendarClock size={16} className="text-indigo-600" aria-hidden="true" />
          <span className="text-sm font-semibold">Scheduled Announcements</span>
          <span className="text-xs text-slate-400">— shift reminders, safety messages, recurring PA announcements</span>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
          >
            <Plus size={15} aria-hidden="true" /> New Schedule
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
          </div>
        )}
        {!loading && schedules.length === 0 && (
          <EmptyState icon={CalendarClock} title="No scheduled announcements" message="Create a schedule for shift reminders, safety messages, or recurring PA announcements." />
        )}
        {!loading && schedules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Target</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Schedule</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Next Run</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Last Run</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Enabled</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {schedules.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[220px]">
                      <span className="truncate block" title={s.name}>{s.name}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[160px]">
                      <span className="truncate block">{s.plant_wide ? "Plant-wide" : (s.zone_ids || []).join(", ") || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{scheduleSummary(s)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {s.next_run_at ? formatTimestamp(s.next_run_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {s.last_run_at ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[s.last_run_status] || "text-slate-500 bg-slate-100"}`}>
                          <Clock size={10} aria-hidden="true" /> {formatTimestamp(s.last_run_at)}
                        </span>
                      ) : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <button
                          type="button" onClick={() => handleToggle(s)} disabled={busyId === s.id}
                          className="text-slate-400 hover:text-indigo-600 disabled:opacity-40 transition-colors"
                          aria-label={s.is_enabled ? "Disable schedule" : "Enable schedule"}
                        >
                          {busyId === s.id ? <Loader2 size={16} className="animate-spin" /> : s.is_enabled ? <ToggleRight size={20} className="text-emerald-600" /> : <ToggleLeft size={20} />}
                        </button>
                      ) : (
                        <span className={s.is_enabled ? "text-emerald-600 text-xs font-semibold" : "text-slate-400 text-xs"}>{s.is_enabled ? "Enabled" : "Disabled"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => { setEditTarget(s); setShowForm(true); }} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" aria-label={`Edit ${s.name}`} title="Edit">
                            <Edit2 size={13} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(s)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" aria-label={`Delete ${s.name}`} title="Delete">
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Schedule"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
