import React, { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Loader2, ShieldAlert, Repeat, Lock, Info, AlertTriangle } from "lucide-react";
import { getAlertTypes, createAlertType, updateAlertType, deleteAlertType } from "./api/audio.api";
import { useCan } from "./hooks/useCan";
import { useToast } from "../../components/ToastContext";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import RefreshButton from "./components/RefreshButton";

const INPUT = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-gray-700";
const LABEL = "text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block";

const BLANK_FORM = {
  label: "", category: "alert", is_blocking: false, requires_ack: false, unlimited: false,
  initial_play_count: 1, repeat_interval_sec: 60, reduction_step_sec: 0,
  min_interval_sec: 10, sort_order: 100,
};

export default function AlertTypeSettings() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // type_code being edited, or null for "new"
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const canManage = useCan("aa.alerttypes.manage");
  const showToast = useToast();

  const loadTypes = useCallback(() => {
    setLoading(true);
    getAlertTypes().then((res) => {
      if (res.ok) setTypes(res.data);
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadTypes(); }, [loadTypes]);

  const openNew = () => { setEditing(null); setForm(BLANK_FORM); setFormOpen(true); };
  const openEdit = (t) => {
    setEditing(t.id);
    setForm({
      label: t.label, category: t.category || "alert", is_blocking: t.is_blocking, requires_ack: t.requires_ack,
      unlimited: t.initial_play_count === null,
      initial_play_count: t.initial_play_count ?? 1,
      repeat_interval_sec: t.repeat_interval_sec, reduction_step_sec: t.reduction_step_sec,
      min_interval_sec: t.min_interval_sec, sort_order: t.sort_order,
    });
    setFormOpen(true);
  };

  const setUnlimited = (unlimited) =>
    setForm((f) => ({ ...f, unlimited, requires_ack: unlimited ? true : f.requires_ack }));

  const handleSave = async () => {
    if (!form.label.trim()) { showToast("Name is required", "error"); return; }
    const payload = {
      label: form.label.trim(),
      category: form.category,
      is_blocking: form.is_blocking,
      requires_ack: form.requires_ack,
      initial_play_count: form.unlimited ? null : Math.max(1, +form.initial_play_count || 1),
      repeat_interval_sec: Math.max(0, +form.repeat_interval_sec || 0),
      reduction_step_sec: Math.max(0, +form.reduction_step_sec || 0),
      min_interval_sec: Math.max(0, +form.min_interval_sec || 0),
      sort_order: +form.sort_order || 100,
    };
    setSaving(true);
    const res = editing ? await updateAlertType(editing, payload) : await createAlertType(payload);
    setSaving(false);
    if (!res.ok) { showToast(res.error || "Save failed", "error"); return; }
    setTypes((ts) => editing ? ts.map((t) => t.id === editing ? res.data : t) : [...ts, res.data].sort((a, b) => a.sort_order - b.sort_order));
    showToast(editing ? "Alert type updated" : "Alert type created", "success");
    setFormOpen(false);
  };

  const handleDelete = async () => {
    const res = await deleteAlertType(deleteTarget);
    if (res.ok) { setTypes((ts) => ts.filter((t) => t.id !== deleteTarget)); showToast("Alert type deleted", "success"); }
    else showToast(res.error || "Delete failed", "error");
    setDeleteTarget(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Alert Type Settings</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Configure how each type plays back — repeat count, replay interval, and whether it requires acknowledgement.
            Each type is either an <b>Alert</b> (urgent, needs attention) or <b>Information</b> (routine, non-urgent) —
            Manual Broadcast, SOP, and Scheduled alerts pick one of these when sent.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
        <RefreshButton onClick={loadTypes} loading={loading} title="Refresh alert types" />
        {canManage && (
          <button type="button" onClick={openNew}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-sm font-semibold whitespace-nowrap">
            <Plus size={14} /> New Alert Type
          </button>
        )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-emerald-800" /></div>
      ) : types.length === 0 ? (
        <EmptyState title="No alert types configured" message="Alert types define playback behavior for Critical/High/Normal/Low and any custom types you add." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {["Type", "Category", "Behavior", "Plays", "Repeat Interval", "Order", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600 text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {types.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{t.label}</span>
                      {t.is_builtin && (
                        <span title="Built-in — cannot be deleted" className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          <Lock size={9} /> Built-in
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {t.category === "information" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full">
                        <Info size={10} /> Information
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                        <AlertTriangle size={10} /> Alert
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {t.is_blocking && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                          <ShieldAlert size={10} /> Blocks other alerts
                        </span>
                      )}
                      {t.requires_ack && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          <Repeat size={10} /> Needs acknowledgement
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                    {t.initial_play_count === null ? "Unlimited" : `${t.initial_play_count}x`}
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                    {t.repeat_interval_sec}s
                    {t.reduction_step_sec > 0 && <span className="text-gray-400"> −{t.reduction_step_sec}s/replay, floor {t.min_interval_sec}s</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{t.sort_order}</td>
                  <td className="px-4 py-3">
                    {canManage && (
                      <div className="flex items-center gap-1 justify-end">
                        <button type="button" onClick={() => openEdit(t)}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-emerald-50 hover:text-emerald-800 transition-colors">
                          <Pencil size={13} />
                        </button>
                        {!t.is_builtin && (
                          <button type="button" onClick={() => setDeleteTarget(t.id)}
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setFormOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-gray-900">{editing ? "Edit Alert Type" : "New Alert Type"}</h3>

            <div>
              <label className={LABEL} htmlFor="at-label">Name *</label>
              <input id="at-label" className={INPUT} value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Fire Emergency" />
            </div>

            <div>
              <label className={LABEL}>Category</label>
              <div className="flex gap-2">
                {[
                  { value: "alert", label: "Alert", desc: "Urgent — needs the operator's attention", Icon: AlertTriangle },
                  { value: "information", label: "Information", desc: "Routine — non-urgent announcement", Icon: Info },
                ].map(({ value, label, desc, Icon }) => (
                  <button key={value} type="button" onClick={() => setForm((f) => ({ ...f, category: value }))}
                    className={`flex-1 flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-colors ${
                      form.category === value ? "border-emerald-500 bg-emerald-50" : "border-gray-200 hover:bg-gray-50"
                    }`}>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><Icon size={13} />{label}</span>
                    <span className="text-[11px] text-gray-400">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" className="mt-0.5" checked={form.is_blocking}
                onChange={(e) => setForm((f) => ({ ...f, is_blocking: e.target.checked }))} />
              <span>
                <span className="text-sm font-medium text-gray-800 block">Blocks all other alerts</span>
                <span className="text-xs text-gray-400">Nothing else plays on the edge node until every alert of this type is acknowledged (like Critical).</span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" className="mt-0.5" checked={form.requires_ack} disabled={form.unlimited}
                onChange={(e) => setForm((f) => ({ ...f, requires_ack: e.target.checked }))} />
              <span>
                <span className="text-sm font-medium text-gray-800 block">Requires acknowledgement</span>
                <span className="text-xs text-gray-400">If unchecked, it auto-acknowledges itself once it has played out its play count.</span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="at-plays">Initial Play Count</label>
                <input id="at-plays" type="number" min={1} className={INPUT} disabled={form.unlimited}
                  value={form.unlimited ? "" : form.initial_play_count}
                  onChange={(e) => setForm((f) => ({ ...f, initial_play_count: e.target.value }))}
                  placeholder={form.unlimited ? "Unlimited" : ""} />
              </div>
              <div className="flex items-end pb-2.5">
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={form.unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
                  Unlimited (repeat until acknowledged)
                </label>
              </div>

              <div>
                <label className={LABEL} htmlFor="at-interval">Repeat Interval (sec)</label>
                <input id="at-interval" type="number" min={0} className={INPUT} value={form.repeat_interval_sec}
                  onChange={(e) => setForm((f) => ({ ...f, repeat_interval_sec: e.target.value }))} />
              </div>
              <div>
                <label className={LABEL} htmlFor="at-sort">Priority Order</label>
                <input id="at-sort" type="number" className={INPUT} value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} />
                <p className="text-[10px] text-gray-400 mt-1">Lower plays first when multiple types are queued together.</p>
              </div>

              <div>
                <label className={LABEL} htmlFor="at-reduction">Reduction Step (sec)</label>
                <input id="at-reduction" type="number" min={0} className={INPUT} value={form.reduction_step_sec}
                  onChange={(e) => setForm((f) => ({ ...f, reduction_step_sec: e.target.value }))} />
                <p className="text-[10px] text-gray-400 mt-1">Interval shrinks by this much after every unacknowledged replay.</p>
              </div>
              <div>
                <label className={LABEL} htmlFor="at-min">Minimum Interval (sec)</label>
                <input id="at-min" type="number" min={0} className={INPUT} value={form.min_interval_sec}
                  onChange={(e) => setForm((f) => ({ ...f, min_interval_sec: e.target.value }))} />
                <p className="text-[10px] text-gray-400 mt-1">Floor — the interval never drops below this.</p>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
              <button type="button" onClick={() => setFormOpen(false)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving || !form.label.trim()}
                className="px-3 py-1.5 bg-emerald-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {editing ? "Save Changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Alert Type"
        message="This action cannot be undone. Alerts already using this type keep playing under whatever settings were resolved at dispatch time."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
