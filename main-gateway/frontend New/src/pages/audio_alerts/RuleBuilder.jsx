import React, { useState, useEffect, useCallback } from "react";
import { Plus, Search, Edit2, Trash2, Copy, Play, ToggleLeft, ToggleRight, Loader2, History } from "lucide-react";
import { useRules } from "./hooks/useRules";
import { useCan } from "./hooks/useCan";
import { useToast } from "../../components/ToastContext";
import PriorityBadge from "./components/PriorityBadge";
import StatusPill from "./components/StatusPill";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import RuleForm from "./RuleForm";
import { PRIORITIES, RULE_STATUSES } from "./utils/constants";
import { timeAgo, formatTimestamp } from "./utils/formatters";

const INPUT = "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700";

export default function RuleBuilder() {
  const { rules, loading, error, load, enable, disable, remove, create, update } = useRules();
  const canEdit = useCan("aa.rules.edit");
  const canDelete = useCan("aa.rules.delete");
  const showToast = useToast();

  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editRule, setEditRule] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { load(); }, [load]);

  const filtered = rules.filter((r) => {
    if (filterPriority && r.priority !== filterPriority) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.alert_code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handleToggle = async (rule) => {
    setBusyId(rule.id);
    try {
      const res = rule.status === "Active" ? await disable(rule.id) : await enable(rule.id);
      if (res.ok) showToast(`Rule ${rule.status === "Active" ? "disabled" : "enabled"}`, "success");
      else showToast("Failed to update rule status", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await remove(deleteTarget.id);
    if (res.ok) showToast("Rule deleted", "success");
    else showToast("Failed to delete rule", "error");
    setDeleteTarget(null);
  };

  const handleSaveRule = async (ruleData) => {
    const res = editRule?.id ? await update(editRule.id, ruleData) : await create(ruleData);
    if (res.ok) {
      showToast(editRule?.id ? "Rule updated" : "Rule created", "success");
      setShowForm(false);
      setEditRule(null);
    } else {
      showToast("Failed to save rule", "error");
    }
    return res;
  };

  const handleDuplicate = async (rule) => {
    const copy = { ...rule, id: undefined, name: `${rule.name} (Copy)`, status: "Draft", trigger_count: 0, last_triggered: null };
    delete copy.id;
    const res = await create(copy);
    if (res.ok) showToast("Rule duplicated as draft", "success");
    else showToast("Failed to duplicate rule", "error");
  };

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  };

  if (showForm) {
    return (
      <RuleForm
        initialRule={editRule}
        onSave={handleSaveRule}
        onCancel={() => { setShowForm(false); setEditRule(null); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rules…"
            className={`${INPUT} pl-9 w-full`}
            aria-label="Search rules"
          />
        </div>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className={INPUT} aria-label="Filter by priority">
          <option value="">Priority: All</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={INPUT} aria-label="Filter by status">
          <option value="">Status: All</option>
          {RULE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && canEdit && (
            <button
              type="button"
              onClick={async () => {
                for (const id of selected) await disable(id);
                showToast(`${selected.size} rules disabled`, "success");
                setSelected(new Set());
              }}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Disable selected
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => { setEditRule(null); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
            >
              <Plus size={15} aria-hidden="true" /> New Rule
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <EmptyState title="No rules found" message={search || filterPriority || filterStatus ? "Try adjusting your filters." : "Create your first alert rule to get started."} action={canEdit ? <button type="button" onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold">New Rule</button> : null} />
        )}
        {!loading && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all rules" className="rounded border-slate-300 text-indigo-600" />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Code</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Priority</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Zones</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Last Triggered</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Triggers</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(rule.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          e.target.checked ? next.add(rule.id) : next.delete(rule.id);
                          setSelected(next);
                        }}
                        aria-label={`Select rule ${rule.name}`}
                        className="rounded border-slate-300 text-indigo-600"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px]">
                      <span className="truncate block" title={rule.name}>{rule.name}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{rule.alert_code}</td>
                    <td className="px-4 py-3"><PriorityBadge priority={rule.priority} size="xs" /></td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{rule.category}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[120px]">
                      <span className="truncate block" title={(rule.zones || []).join(", ")}>{(rule.zones || []).join(", ") || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{rule.last_triggered ? timeAgo(rule.last_triggered) : "Never"}</td>
                    <td className="px-4 py-3 text-slate-700 font-semibold text-xs">{rule.trigger_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <StatusPill status={rule.status} />
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleToggle(rule)}
                            disabled={busyId === rule.id}
                            className="text-slate-400 hover:text-indigo-600 disabled:opacity-40 transition-colors"
                            aria-label={rule.status === "Active" ? "Disable rule" : "Enable rule"}
                            title={rule.status === "Active" ? "Disable rule" : "Enable rule"}
                          >
                            {busyId === rule.id ? <Loader2 size={15} className="animate-spin" /> : rule.status === "Active" ? <ToggleRight size={18} className="text-emerald-600" /> : <ToggleLeft size={18} />}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <>
                            <button type="button" onClick={() => { setEditRule(rule); setShowForm(true); }} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" aria-label={`Edit rule ${rule.name}`} title="Edit">
                              <Edit2 size={13} aria-hidden="true" />
                            </button>
                            <button type="button" onClick={() => handleDuplicate(rule)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" aria-label={`Duplicate rule ${rule.name}`} title="Duplicate">
                              <Copy size={13} aria-hidden="true" />
                            </button>
                          </>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => setDeleteTarget(rule)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" aria-label={`Delete rule ${rule.name}`} title="Delete">
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Rule"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
