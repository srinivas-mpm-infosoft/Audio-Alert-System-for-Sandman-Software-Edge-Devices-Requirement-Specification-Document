import React, { useState, useEffect, useCallback } from "react";
import {
  Users, Shield, Settings, Plus, Edit2, Trash2, Loader2,
  Eye, EyeOff, Check, X, Save, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp, Key,
} from "lucide-react";
import { targetUrl } from "../config";
import { useToast } from "../components/ToastContext";
import { ROLES, PERMISSIONS } from "./audio_alerts/utils/constants";
import { useAuthStore } from "../store/useAuthStore";

// ─── shared style tokens ────────────────────────────────────
const LABEL = "text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block";
const INPUT = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-gray-700";
const BTN_PRIMARY = "inline-flex items-center gap-2 px-4 py-2 bg-emerald-800 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors";
const BTN_SECONDARY = "inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors";
const BTN_DANGER = "inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors";

const ROLE_BADGES = {
  administrator: "bg-red-100 text-red-700",
  plant_manager: "bg-orange-100 text-orange-700",
  process_engineer: "bg-amber-100 text-amber-700",
  shift_supervisor: "bg-blue-100 text-blue-700",
  operator: "bg-emerald-100 text-emerald-700",
  maintenance_technician: "bg-purple-100 text-purple-700",
  auditor: "bg-gray-100 text-gray-600",
};

const SHIFTS = ["Morning", "Afternoon", "Night"];

const BLANK_USER = {
  username: "", password: "", confirm_password: "",
  role: "operator",
  plant_scope: [], line_scope: [], zone_scope: [], shift_scope: [],
  status: "Active",
};

// ─── helpers ────────────────────────────────────────────────
function apiFetch(path, opts = {}) {
  return fetch(`${targetUrl}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  }).then((r) => r.json());
}

function RoleBadge({ role }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${ROLE_BADGES[role] ?? "bg-gray-100 text-gray-600"}`}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

function ConfirmModal({ open, title, message, confirmLabel = "Confirm", onConfirm, onCancel, danger = true }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 z-10">
        <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-5">{message}</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>Cancel</button>
          <button type="button" onClick={onConfirm} className={danger ? BTN_DANGER : BTN_PRIMARY}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── multi-select list (plant / line / zone) ─────────────────
function ScopeSelect({ label, items, value, onChange, getLabel }) {
  const [open, setOpen] = useState(false);
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const displayLabel = value.length ? `${value.length} selected` : "All (no restriction)";
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white hover:border-gray-300 text-gray-700"
        >
          <span className={value.length ? "text-gray-700" : "text-gray-400"}>{displayLabel}</span>
          {open ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {items.length === 0
              ? <p className="px-3 py-2 text-xs text-gray-400">No options available</p>
              : items.map((item) => (
                <label key={item.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={value.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-800"
                  />
                  <span>{getLabel ? getLabel(item) : item.name}</span>
                </label>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

const TABS = [
  { id: "users", label: "Users", icon: Users },
  { id: "roles", label: "Roles & Permissions", icon: Shield },
  // { id: "security", label: "Security Settings",    icon: Settings },
];

export default function UserManagement({ user }) {
  const showToast = useToast();
  const setRolePermissions = useAuthStore((s) => s.setRolePermissions);

  // only administrator can access
  const userRole = user?.role ?? "";
  const isAdmin = userRole === "administrator" || userRole === "superadmin";

  const [tab, setTab] = useState("users");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [zones, setZones] = useState({ plants: [], lines: [], zones: [] });
  const [rolePerms, setRolePerms] = useState(null);    // { role: [perms] }
  const [dirtyRoles, setDirtyRoles] = useState(new Set());
  const [security, setSecurity] = useState(null);
  const [saving, setSaving] = useState(false);

  // user wizard / edit modal
  const [modal, setModal] = useState(null);   // null | { mode:'create'|'edit', data: {...} }
  const [wizardStep, setWizardStep] = useState(1);
  const [formData, setFormData] = useState({ ...BLANK_USER });
  const [formErrors, setFormErrors] = useState({});
  const [showPw, setShowPw] = useState(false);

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null);  // user id

  // ── load everything ────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, zRes, rpRes, sRes] = await Promise.all([
        apiFetch("/users"),
        apiFetch("/audio-alerts/structure"),
        apiFetch("/roles/permissions"),
        apiFetch("/audio-alerts/security"),
      ]);
      if (uRes.ok) setUsers(uRes.data);
      if (zRes.ok) setZones(zRes.data);
      if (rpRes.ok) setRolePerms(rpRes.data);
      if (sRes.ok) setSecurity(sRes.data);
    } catch {
      showToast("Failed to connect to backend", "error");
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { if (isAdmin) loadAll(); }, [isAdmin, loadAll]);

  // ── close modal helper ────────────────────────────────────
  const closeModal = () => {
    setModal(null);
    setWizardStep(1);
    setFormData({ ...BLANK_USER });
    setFormErrors({});
    setShowPw(false);
  };

  // ── open create ────────────────────────────────────────────
  const openCreate = () => {
    setFormData({ ...BLANK_USER });
    setModal({ mode: "create" });
    setWizardStep(1);
  };

  // ── open edit ─────────────────────────────────────────────
  const openEdit = (u) => {
    setFormData({
      username: u.username,
      password: "",
      confirm_password: "",
      role: u.role,
      plant_scope: u.plant_scope ?? [],
      line_scope: u.line_scope ?? [],
      zone_scope: u.zone_scope ?? [],
      shift_scope: u.shift_scope ?? [],
      status: u.status,
      _id: u.id,
    });
    setModal({ mode: "edit" });
    setWizardStep(1);
  };

  // ── form field setter ─────────────────────────────────────
  const setField = (k, v) => setFormData((p) => ({ ...p, [k]: v }));

  // ── validate step 1 ───────────────────────────────────────
  const validateStep1 = () => {
    const errs = {};
    if (!formData.username.trim()) errs.username = "Username required";
    if (modal?.mode === "create") {
      if (!formData.password) errs.password = "Password required";
      if (formData.password !== formData.confirm_password)
        errs.confirm = "Passwords do not match";
    } else if (formData.password && formData.password !== formData.confirm_password) {
      errs.confirm = "Passwords do not match";
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── create user ───────────────────────────────────────────
  const handleCreate = async () => {
    const { confirm_password, _id, ...payload } = formData;
    const res = await apiFetch("/users", { method: "POST", body: JSON.stringify(payload) });
    if (res.ok) {
      setUsers((prev) => [res.data, ...prev]);
      showToast("User created", "success");
      closeModal();
    } else {
      showToast(res.error || "Failed to create user", "error");
    }
  };

  // ── update user ───────────────────────────────────────────
  const handleUpdate = async () => {
    const { username, confirm_password, _id, ...payload } = formData;
    if (!payload.password) delete payload.password;
    const res = await apiFetch(`/users/${_id}`, { method: "PUT", body: JSON.stringify(payload) });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === _id ? res.data : u));
      showToast("User updated", "success");
      closeModal();
    } else {
      showToast(res.error || "Failed to update user", "error");
    }
  };

  // ── delete user ───────────────────────────────────────────
  const handleDelete = async () => {
    const res = await apiFetch(`/users/${deleteTarget}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget));
      showToast("User deleted", "success");
    } else {
      showToast("Delete failed", "error");
    }
    setDeleteTarget(null);
  };

  // ── toggle status ─────────────────────────────────────────
  const toggleStatus = async (u) => {
    const newStatus = u.status === "Active" ? "Disabled" : "Active";
    const res = await apiFetch(`/users/${u.id}`, {
      method: "PUT", body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok)
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, status: newStatus } : x));
  };

  // ── role permissions: toggle permission for a role ─────────
  const togglePerm = (role, permId) => {
    if (role === "administrator") return; // always full
    setRolePerms((prev) => {
      const current = prev[role] ?? [];
      const next = current.includes(permId)
        ? current.filter((p) => p !== permId)
        : [...current, permId];
      return { ...prev, [role]: next };
    });
    setDirtyRoles((s) => new Set([...s, role]));
  };

  // ── save role permissions ─────────────────────────────────
  const saveRolePerms = async () => {
    setSaving(true);
    let ok = true;
    for (const role of dirtyRoles) {
      const res = await apiFetch(`/roles/permissions/${role}`, {
        method: "PUT", body: JSON.stringify({ permissions: rolePerms[role] }),
      });
      if (!res.ok) { ok = false; showToast(`Failed to save ${role}`, "error"); }
    }
    if (ok) {
      showToast("Role permissions saved", "success");
      setDirtyRoles(new Set());
      setRolePermissions(rolePerms);
    }
    setSaving(false);
  };

  // ── save security settings ────────────────────────────────
  const saveSecurity = async () => {
    setSaving(true);
    const res = await apiFetch("/audio-alerts/security", {
      method: "PUT", body: JSON.stringify(security),
    });
    if (res.ok) showToast("Security settings saved", "success");
    else showToast("Failed to save", "error");
    setSaving(false);
  };

  // ─── access gate ──────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-xl">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-4 text-red-700">
          <AlertCircle size={24} />
          <div>
            <h3 className="font-bold">Access Denied</h3>
            <p className="text-sm">User Management is restricted to administrators.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── wizard step navigator ─────────────────────────────────
  const maxStep = modal?.mode === "create" ? 3 : 2;
  const stepNext = () => {
    if (wizardStep === 1 && !validateStep1()) return;
    setWizardStep((s) => Math.min(s + 1, maxStep));
  };
  const stepBack = () => setWizardStep((s) => Math.max(s - 1, 1));

  const filteredLines = (zones.lines ?? []).filter((l) =>
    formData.plant_scope.length === 0 || formData.plant_scope.includes(l.plant_id)
  );
  const filteredZones = (zones.zones ?? []).filter((z) =>
    (formData.plant_scope.length === 0 || formData.plant_scope.includes(z.plant_id)) &&
    (formData.line_scope.length === 0 || formData.line_scope.includes(z.line_id))
  );

  // ─────────────────────────────────────────────────────────
  return (
    <div className="p-6 flex flex-col gap-5 min-h-full">
      {/* Page header */}
      <div className="border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="h-6 w-6 text-emerald-800" />
          User Management
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage users, roles, permissions, and security settings</p>
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex border-b border-gray-100" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            const dirty = t.id === "roles" && dirtyRoles.size > 0;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors focus:outline-none ${tab === t.id ? "border-b-2 border-emerald-800 text-emerald-800" : "text-gray-500 hover:text-gray-700"
                  }`}
              >
                <Icon size={14} />
                {t.label}
                {dirty && <span className="w-2 h-2 rounded-full bg-amber-500 ml-0.5" title="Unsaved changes" />}
              </button>
            );
          })}
        </div>

        {/* ══ USERS TAB ═══════════════════════════════════════ */}
        {tab === "users" && (
          <div className="p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{users.length} user{users.length !== 1 ? "s" : ""} total</p>
              <div className="flex gap-2">
                <button type="button" onClick={loadAll} className={BTN_SECONDARY}>
                  <RefreshCw size={13} />Refresh
                </button>
                <button type="button" onClick={openCreate} className={BTN_PRIMARY}>
                  <Plus size={14} />New User
                </button>
              </div>
            </div>

            {loading
              ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-emerald-800" /></div>
              : (
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        {["Username", "Role", "Plant Scope", "Line", "Zone", "Shift", "Last Login", "Status", "Actions"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {users.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">No users found</td></tr>
                      )}
                      {users.map((u) => (
                        <tr key={u.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-800">{u.username}</td>
                          <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {(u.plant_scope ?? []).length ? u.plant_scope.join(", ") : "All"}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {(() => {
                              const ids = u.line_scope ?? [];
                              if (!ids.length) return "All";
                              const names = ids.map((id) => zones.lines.find((l) => l.id === id)?.name ?? id);
                              return names.length > 3 ? `${names.slice(0, 3).join(", ")} …+${names.length - 3} more` : names.join(", ");
                            })()}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {(() => {
                              const ids = u.zone_scope ?? [];
                              if (!ids.length) return "All";
                              const names = ids.map((id) => zones.zones.find((z) => z.id === id)?.name ?? id);
                              return names.length > 3 ? `${names.slice(0, 3).join(", ")} …+${names.length - 3} more` : names.join(", ");
                            })()}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {(u.shift_scope ?? []).length ? u.shift_scope.join(", ") : "All"}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {u.last_login ? new Date(u.last_login).toLocaleString() : "Never"}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => toggleStatus(u)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition-colors ${u.status === "Active"
                                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                }`}
                            >
                              {u.status}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => openEdit(u)}
                                className="p-1.5 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                                title="Edit user"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(u.id)}
                                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600"
                                title="Delete user"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </div>
        )}

        {/* ══ ROLES & PERMISSIONS TAB ══════════════════════════ */}
        {tab === "roles" && (
          <div className="p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-gray-700">Click a cell to toggle. Administrator always has full access.</p>
                {dirtyRoles.size > 0 && (
                  <p className="text-xs text-amber-600 mt-0.5">{dirtyRoles.size} role{dirtyRoles.size > 1 ? "s" : ""} with unsaved changes</p>
                )}
              </div>
              <button type="button" onClick={saveRolePerms} disabled={dirtyRoles.size === 0 || saving} className={BTN_PRIMARY}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? "Saving…" : "Save Permissions"}
              </button>
            </div>

            {!rolePerms
              ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>
              : (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-100 border-b-2 border-gray-200">
                        <th className="px-4 py-3 text-left font-bold text-gray-700 text-[11px] uppercase tracking-wide w-56 sticky left-0 bg-gray-100">
                          Permission
                        </th>
                        {ROLES.map((r) => (
                          <th key={r.id} className="px-2 py-3 text-center text-[10px] uppercase tracking-wide whitespace-nowrap min-w-[90px]">
                            <div className="flex flex-col items-center gap-1.5">
                              <RoleBadge role={r.id} />
                              {dirtyRoles.has(r.id) && (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" title="Unsaved changes" />
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        let lastCat = null;
                        return PERMISSIONS.map((perm) => {
                          const catHeader = perm.category !== lastCat;
                          lastCat = perm.category;
                          return (
                            <React.Fragment key={perm.id}>
                              {catHeader && (
                                <tr className="bg-gray-50">
                                  <td colSpan={ROLES.length + 1} className="px-4 py-2">
                                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{perm.category}</span>
                                  </td>
                                </tr>
                              )}
                              <tr className="hover:bg-emerald-50/30 transition-colors">
                                <td className="px-4 py-2.5 text-gray-800 font-medium sticky left-0 bg-white">
                                  {perm.label}
                                </td>
                                {ROLES.map((role) => {
                                  const has      = (rolePerms[role.id] ?? []).includes(perm.id);
                                  const isLocked = role.id === "administrator";
                                  return (
                                    <td key={role.id} className="px-2 py-2.5 text-center">
                                      <button
                                        type="button"
                                        onClick={() => togglePerm(role.id, perm.id)}
                                        disabled={isLocked}
                                        className={`mx-auto flex items-center justify-center w-6 h-6 rounded-md border-2 transition-all ${
                                          isLocked
                                            ? "bg-blue-600 border-blue-600 text-white cursor-default"
                                            : has
                                              ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600 cursor-pointer shadow-sm"
                                              : "border-gray-300 bg-white text-gray-300 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-400 cursor-pointer"
                                        }`}
                                        title={isLocked ? "Always granted (Administrator)" : (has ? "Click to revoke" : "Click to grant")}
                                        aria-pressed={has}
                                      >
                                        {(has || isLocked) ? <Check size={12} strokeWidth={3} /> : <X size={11} strokeWidth={2.5} />}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            </React.Fragment>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              )
            }

            {/* Legend */}
            <div className="flex items-center gap-5 text-xs text-gray-500 pt-1 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-md bg-blue-600 border-2 border-blue-600 inline-flex items-center justify-center"><Check size={10} className="text-white" strokeWidth={3} /></span>
                Admin (locked)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-md bg-emerald-500 border-2 border-emerald-500 inline-flex items-center justify-center"><Check size={10} className="text-white" strokeWidth={3} /></span>
                Granted
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-md bg-white border-2 border-gray-300 inline-flex items-center justify-center"><X size={10} className="text-gray-400" strokeWidth={2.5} /></span>
                Not granted
              </span>
            </div>
          </div>
        )}

        {/* ══ SECURITY SETTINGS TAB ════════════════════════════ */}
        {tab === "security" && (
          <div className="p-5 flex flex-col gap-6">
            {!security
              ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>
              : (
                <>
                  {/* Password Policy */}
                  <section>
                    <p className="font-semibold text-gray-800 mb-3">Password Policy</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={LABEL} htmlFor="sec-minlen">Minimum Length</label>
                        <input id="sec-minlen" type="number" min={4} max={64} className={INPUT}
                          value={security.password_min_length ?? 8}
                          onChange={(e) => setSecurity((s) => ({ ...s, password_min_length: +e.target.value }))} />
                      </div>
                      <div>
                        <label className={LABEL} htmlFor="sec-rotation">Rotation Period (days, 0 = never)</label>
                        <input id="sec-rotation" type="number" min={0} max={365} className={INPUT}
                          value={security.password_rotation_days ?? 90}
                          onChange={(e) => setSecurity((s) => ({ ...s, password_rotation_days: +e.target.value }))} />
                      </div>
                      <div>
                        <label className={LABEL} htmlFor="sec-history">History Count (prevent reuse)</label>
                        <input id="sec-history" type="number" min={0} max={24} className={INPUT}
                          value={security.password_history_count ?? 5}
                          onChange={(e) => setSecurity((s) => ({ ...s, password_history_count: +e.target.value }))} />
                      </div>
                      <div className="flex items-center gap-3 pt-5">
                        <input id="sec-complexity" type="checkbox" className="h-4 w-4 rounded border-gray-300 text-emerald-800"
                          checked={security.password_complexity ?? true}
                          onChange={(e) => setSecurity((s) => ({ ...s, password_complexity: e.target.checked }))} />
                        <label htmlFor="sec-complexity" className="text-sm text-gray-700">
                          Require complexity (uppercase, number, symbol)
                        </label>
                      </div>
                    </div>
                  </section>

                  {/* Session Timeouts */}
                  <section>
                    <p className="font-semibold text-gray-800 mb-3">Session Timeout per Role (minutes)</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {ROLES.map((r) => (
                        <div key={r.id}>
                          <label className={LABEL} htmlFor={`sec-to-${r.id}`}>{r.label}</label>
                          <input id={`sec-to-${r.id}`} type="number" min={5} max={1440} className={INPUT}
                            value={security.session_timeout_min?.[r.id] ?? 60}
                            onChange={(e) => setSecurity((s) => ({
                              ...s,
                              session_timeout_min: { ...s.session_timeout_min, [r.id]: +e.target.value },
                            }))} />
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* MFA Required */}
                  <section>
                    <p className="font-semibold text-gray-800 mb-3">Require MFA</p>
                    <div className="flex flex-wrap gap-4">
                      {ROLES.map((r) => (
                        <label key={r.id} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-emerald-800"
                            checked={security.mfa_required?.[r.id] ?? false}
                            onChange={(e) => setSecurity((s) => ({
                              ...s,
                              mfa_required: { ...s.mfa_required, [r.id]: e.target.checked },
                            }))} />
                          <span className="text-sm text-gray-700">{r.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  {/* IP Allowlist */}
                  <section>
                    <p className="font-semibold text-gray-800 mb-1">IP Allowlist</p>
                    <p className="text-xs text-gray-400 mb-2">One CIDR per line (e.g. 192.168.1.0/24). Empty = allow all.</p>
                    <textarea
                      className={`${INPUT} h-24 resize-none font-mono text-xs`}
                      value={(security.ip_allowlist ?? []).join("\n")}
                      onChange={(e) => setSecurity((s) => ({
                        ...s,
                        ip_allowlist: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                      }))}
                    />
                  </section>

                  {/* API Tokens */}
                  {(security.api_tokens ?? []).length > 0 && (
                    <section>
                      <p className="font-semibold text-gray-800 mb-3">API Tokens</p>
                      <div className="space-y-2">
                        {security.api_tokens.map((tok) => (
                          <div key={tok.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                            <div>
                              <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                                <Key size={12} className="text-gray-400" />{tok.name}
                              </p>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                Created: {new Date(tok.created_at).toLocaleDateString()} ·
                                Last used: {new Date(tok.last_used).toLocaleDateString()}
                              </p>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tok.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                              }`}>{tok.status}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <div className="flex justify-end pt-2 border-t border-gray-100">
                    <button type="button" onClick={saveSecurity} disabled={saving} className={BTN_PRIMARY}>
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      Save Security Settings
                    </button>
                  </div>
                </>
              )
            }
          </div>
        )}
      </div>

      {/* ══ CREATE / EDIT USER MODAL ══════════════════════════ */}
      {modal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 z-10 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">
                  {modal.mode === "create" ? "New User" : `Edit: ${formData.username}`}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Step {wizardStep} of {maxStep}
                  {modal.mode === "create" ? " — Credentials · Role · Scope" : " — Role & Scope · Review"}
                </p>
              </div>
              <button type="button" onClick={closeModal} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
            </div>

            {/* Progress dots */}
            <div className="flex gap-1.5">
              {Array.from({ length: maxStep }).map((_, i) => (
                <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < wizardStep ? "bg-emerald-600" : "bg-gray-200"}`} />
              ))}
            </div>

            {/* ── STEP 1 — Credentials ──────────────────────────────── */}
            {wizardStep === 1 && (
              <div className="flex flex-col gap-4">
                {modal.mode === "edit" && (
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    Leave password blank to keep the current password.
                  </p>
                )}
                {modal.mode === "create" && (
                  <div>
                    <label className={LABEL} htmlFor="mu-user">Username</label>
                    <input id="mu-user" className={INPUT} value={formData.username}
                      onChange={(e) => setField("username", e.target.value)} placeholder="jsmith" />
                    {formErrors.username && <p className="text-red-500 text-xs mt-1">{formErrors.username}</p>}
                  </div>
                )}
                <div>
                  <label className={LABEL} htmlFor="mu-pw">{modal.mode === "edit" ? "New Password (optional)" : "Password"}</label>
                  <div className="relative">
                    <input id="mu-pw" type={showPw ? "text" : "password"} className={INPUT}
                      value={formData.password}
                      onChange={(e) => setField("password", e.target.value)}
                      placeholder={modal.mode === "edit" ? "Leave blank to keep current" : "Min 8 characters"} />
                    <button type="button" onClick={() => setShowPw((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {formErrors.password && <p className="text-red-500 text-xs mt-1">{formErrors.password}</p>}
                </div>
                <div>
                  <label className={LABEL} htmlFor="mu-confirm">Confirm Password</label>
                  <input id="mu-confirm" type="password" className={INPUT}
                    value={formData.confirm_password}
                    onChange={(e) => setField("confirm_password", e.target.value)} />
                  {formErrors.confirm && <p className="text-red-500 text-xs mt-1">{formErrors.confirm}</p>}
                </div>
                {modal.mode === "edit" && (
                  <div>
                    <label className={LABEL}>Status</label>
                    <div className="flex gap-3">
                      {["Active", "Disabled"].map((s) => (
                        <label key={s} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="mu-status" value={s}
                            checked={formData.status === s}
                            onChange={() => setField("status", s)}
                            className="text-emerald-800" />
                          <span className="text-sm text-gray-700">{s}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2 — Role & Scope ─────────────────────────────── */}
            {wizardStep === 2 && (
              <div className="flex flex-col gap-5">
                {/* Role */}
                <div>
                  <label className={LABEL}>Role</label>
                  <div className="space-y-1.5">
                    {ROLES.map((r) => (
                      <label key={r.id} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg border border-transparent hover:border-gray-200 hover:bg-gray-50">
                        <input type="radio" name="mu-role" value={r.id}
                          checked={formData.role === r.id}
                          onChange={() => setField("role", r.id)}
                          className="text-emerald-800" />
                        <RoleBadge role={r.id} />
                        <span className="text-sm text-gray-600">{r.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Shift scope */}
                <div>
                  <label className={LABEL}>Shift Access</label>
                  <div className="flex gap-4">
                    {SHIFTS.map((s) => (
                      <label key={s} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox"
                          checked={formData.shift_scope.includes(s)}
                          onChange={() => {
                            const cur = formData.shift_scope;
                            setField("shift_scope", cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);
                          }}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-800" />
                        <span className="text-sm text-gray-700">{s}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Leave unchecked for all shifts.</p>
                </div>

                {/* Plant / Line / Zone scope */}
                <ScopeSelect
                  label="Plant Scope (blank = all plants)"
                  items={zones.plants ?? []}
                  value={formData.plant_scope}
                  onChange={(v) => {
                    setField("plant_scope", v);
                    setField("line_scope", []);
                    setField("zone_scope", []);
                  }}
                />
                <ScopeSelect
                  label="Line Scope (blank = all lines in selected plants)"
                  items={filteredLines}
                  value={formData.line_scope}
                  onChange={(v) => { setField("line_scope", v); setField("zone_scope", []); }}
                  getLabel={(l) => {
                    const plant = (zones.plants ?? []).find((p) => p.id === l.plant_id);
                    return `${plant?.name ?? l.plant_id} / ${l.name}`;
                  }}
                />
                <ScopeSelect
                  label="Zone Scope (blank = all zones in selected lines)"
                  items={filteredZones}
                  value={formData.zone_scope}
                  onChange={(v) => setField("zone_scope", v)}
                  getLabel={(z) => {
                    const plant = (zones.plants ?? []).find((p) => p.id === z.plant_id);
                    return `${plant?.name ?? z.plant_id} / ${z.name}`;
                  }}
                />
              </div>
            )}

            {/* ── STEP 3 — Review (create only) ─────────────────────── */}
            {wizardStep === 3 && modal.mode === "create" && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-gray-500">Review details before creating.</p>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm border border-gray-100">
                  {[
                    ["Username", formData.username],
                    ["Role", <RoleBadge key="r" role={formData.role} />],
                    ["Plants", formData.plant_scope.length ? formData.plant_scope.join(", ") : "All"],
                    ["Lines", formData.line_scope.length ? formData.line_scope.join(", ") : "All"],
                    ["Zones", formData.zone_scope.length ? formData.zone_scope.join(", ") : "All"],
                    ["Shifts", formData.shift_scope.length ? formData.shift_scope.join(", ") : "All"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between items-center">
                      <span className="text-gray-500">{k}:</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-2 border-t border-gray-100">
              <button type="button" onClick={wizardStep > 1 ? stepBack : closeModal} className={BTN_SECONDARY}>
                {wizardStep === 1 ? "Cancel" : "Back"}
              </button>
              {wizardStep < maxStep
                ? <button type="button" onClick={stepNext} className={BTN_PRIMARY}>Next</button>
                : (
                  <button type="button"
                    onClick={modal.mode === "create" ? handleCreate : handleUpdate}
                    className={BTN_PRIMARY}>
                    {modal.mode === "create" ? "Create User" : "Save Changes"}
                  </button>
                )
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────── */}
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete User"
        message="This user will immediately lose all access. This cannot be undone."
        confirmLabel="Delete User"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
