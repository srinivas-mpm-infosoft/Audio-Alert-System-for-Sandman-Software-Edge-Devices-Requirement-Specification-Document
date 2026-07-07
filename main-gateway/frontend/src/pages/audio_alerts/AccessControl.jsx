import React, { useState, useEffect } from "react";
import { Users, Shield, Settings, Plus, Edit2, Trash2, Loader2, Eye, EyeOff, Check, X } from "lucide-react";
import { getUsers, createUser, updateUser, deleteUser, getSecuritySettings, updateSecuritySettings } from "./api/users.api";
import { useCan } from "./hooks/useCan";
import { useToast } from "../../components/ToastContext";
import { useAuthStore } from "../../store/useAuthStore";
import ConfirmDialog from "./components/ConfirmDialog";
import EmptyState from "./components/EmptyState";
import { ROLES, PERMISSIONS } from "./utils/constants";
import { formatTimestamp } from "./utils/formatters";

const TABS = [
  { id: "users", label: "Users", icon: Users },
  { id: "roles", label: "Roles & Permissions", icon: Shield },
  { id: "security", label: "Security Settings", icon: Settings },
];

const LABEL = "text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block";
const INPUT = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 text-slate-700";

const ROLE_BADGES = {
  administrator: "bg-red-100 text-red-700",
  plant_manager: "bg-orange-100 text-orange-700",
  process_engineer: "bg-amber-100 text-amber-700",
  shift_supervisor: "bg-blue-100 text-blue-700",
  operator: "bg-emerald-100 text-emerald-700",
  maintenance_technician: "bg-purple-100 text-purple-700",
  auditor: "bg-slate-100 text-slate-600",
};

const BLANK_USER = { username: "", password: "", confirm_password: "", role: "operator", plant_scope: [], line_scope: [], zone_scope: [], shift_scope: [], status: "Active" };

export default function AccessControl() {
  const canManage = useCan("aa.users.manage");
  const canSecurity = useCan("aa.security.manage");
  const showToast = useToast();
  const user = useAuthStore((s) => s.user);
  const rolePermissions = useAuthStore((s) => s.rolePermissions);

  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [security, setSecurity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [userWizardOpen, setUserWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [newUser, setNewUser] = useState({ ...BLANK_USER });
  const [showPw, setShowPw] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [savingSecurity, setSavingSecurity] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([getUsers(), getSecuritySettings()]).then(([ur, sr]) => {
      if (ur.ok) setUsers(ur.data);
      if (sr.ok) setSecurity(sr.data);
      setLoading(false);
    });
  }, []);

  const handleDeleteUser = async () => {
    const res = await deleteUser(deleteTarget, user?.username);
    if (res.ok) { setUsers((u) => u.filter((x) => x.id !== deleteTarget)); showToast("User deleted", "success"); }
    else showToast("Delete failed", "error");
    setDeleteTarget(null);
  };

  const validateUser = () => {
    const errs = {};
    if (!newUser.username.trim()) errs.username = "Username is required";
    if (!newUser.password) errs.password = "Password is required";
    if (newUser.password !== newUser.confirm_password) errs.confirm = "Passwords do not match";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateUser = async () => {
    if (!validateUser()) return;
    const { confirm_password, ...userData } = newUser;
    const res = await createUser(userData, user?.username);
    if (res.ok) {
      setUsers((u) => [res.data, ...u]);
      showToast("User created", "success");
      setUserWizardOpen(false);
      setWizardStep(1);
      setNewUser({ ...BLANK_USER });
    } else {
      showToast("Failed to create user", "error");
    }
  };

  const handleSaveSecurity = async () => {
    setSavingSecurity(true);
    const res = await updateSecuritySettings(security, user?.username);
    if (res.ok) showToast("Security settings saved", "success");
    else showToast("Failed to save security settings", "error");
    setSavingSecurity(false);
  };

  const toggleUserStatus = async (u) => {
    const newStatus = u.status === "Active" ? "Disabled" : "Active";
    const res = await updateUser(u.id, { status: newStatus }, user?.username);
    if (res.ok) setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, status: newStatus } : x));
  };

  if (!canManage) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <Shield className="h-12 w-12 text-slate-300 mx-auto mb-3" aria-hidden="true" />
        <p className="text-slate-500 font-medium">Access Control is restricted to superadmin users.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Tab bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex border-b border-slate-100" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-400 ${tab === t.id ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"}`}
              >
                <Icon size={14} aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* A. Users */}
        {tab === "users" && (
          <div className="p-5 flex flex-col gap-4">
            <div className="flex justify-end">
              <button type="button" onClick={() => setUserWizardOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1">
                <Plus size={14} aria-hidden="true" /> New User
              </button>
            </div>
            {loading ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      {["Username", "Role", "Plant Scope", "Last Login", "Status", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600 text-[11px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-slate-800">{u.username}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${ROLE_BADGES[u.role] ?? "bg-slate-100 text-slate-600"}`}>
                            {u.role.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {u.plant_scope.length ? u.plant_scope.join(", ") : "All plants"}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">{u.last_login ? formatTimestamp(u.last_login) : "Never"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => toggleUserStatus(u)}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer transition-colors ${u.status === "Active" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                            aria-label={u.status === "Active" ? `Disable ${u.username}` : `Enable ${u.username}`}
                          >
                            {u.status}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button type="button" onClick={() => setDeleteTarget(u.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete user ${u.username}`}>
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
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

        {/* B. Roles & Permissions Matrix */}
        {tab === "roles" && (
          <div className="p-5 flex flex-col gap-4">
            <p className="text-sm text-slate-500">Live view. Edit in <strong className="text-slate-700">User Management &#8594; Roles &amp; Permissions</strong>.</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs" role="table">
                <thead>
                  <tr className="bg-slate-100 border-b-2 border-slate-200">
                    <th className="px-4 py-3 text-left font-bold text-slate-700 text-[11px] uppercase tracking-wide w-56">Permission</th>
                    {ROLES.map((r) => (
                      <th key={r.id} className="px-2 py-3 text-center text-[10px] uppercase tracking-wide whitespace-nowrap min-w-[80px]">
                        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${ROLE_BADGES[r.id] ?? "bg-slate-100 text-slate-600"}`}>{r.label.split(" ").slice(0, 2).join(" ")}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(() => {
                    let lastCat = null;
                    return PERMISSIONS.map((perm) => {
                      const catRow = perm.category !== lastCat;
                      lastCat = perm.category;
                      return (
                        <React.Fragment key={perm.id}>
                          {catRow && (
                            <tr className="bg-slate-50">
                              <td colSpan={ROLES.length + 1} className="px-4 py-2">
                                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{perm.category}</span>
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-indigo-50/20 transition-colors">
                            <td className="px-4 py-2.5 text-slate-800 font-medium">{perm.label}</td>
                            {ROLES.map((role) => {
                              const has     = (rolePermissions?.[role.id] ?? []).includes(perm.id);
                              const isAdmin = role.id === "administrator";
                              return (
                                <td key={role.id} className="px-2 py-2.5 text-center">
                                  <span className={`mx-auto flex items-center justify-center w-5 h-5 rounded-md border-2 ${
                                    isAdmin
                                      ? "bg-indigo-600 border-indigo-600 text-white"
                                      : has
                                        ? "bg-emerald-500 border-emerald-500 text-white"
                                        : "bg-white border-slate-200 text-slate-300"
                                  }`}>
                                    {(has || isAdmin)
                                      ? <Check size={11} strokeWidth={3} aria-label="Allowed" />
                                      : <X size={10} strokeWidth={2.5} aria-label="Denied" />
                                    }
                                  </span>
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
          </div>
        )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(() => {
                  let lastCat = null;
                  return PERMISSIONS.map((perm) => {
                    const catRow = perm.category !== lastCat;
                    lastCat = perm.category;
                    return (
                      <React.Fragment key={perm.id}>
                        {catRow && (
                          <tr className="bg-slate-50">
                            <td colSpan={ROLES.length + 1} className="px-3 py-1.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{perm.category}</span>
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-slate-50/50">
                          <td className="px-3 py-2.5 text-slate-700 font-medium">{perm.label}</td>
                          {ROLES.map((role) => {
                            const has = (rolePermissions?.[role.id] ?? []).includes(perm.id);
                            return (
                              <td key={role.id} className="px-2 py-2.5 text-center">
                                {has
                                  ? <Check size={14} className="text-emerald-600 mx-auto" aria-label="Allowed" />
                                  : <X size={12} className="text-slate-200 mx-auto" aria-label="Not allowed" />
                                }
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
            <p className="text-xs text-slate-400 mt-4">Role permissions are predefined. Custom roles available in v2.</p>
          </div>
        )}

        {/* C. Security Settings */}
        {tab === "security" && canSecurity && security && (
          <div className="p-5 flex flex-col gap-6">
            {/* Password policy */}
            <div>
              <p className="font-semibold text-slate-800 mb-3">Password Policy</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL} htmlFor="pw-minlen">Min Length</label>
                  <input id="pw-minlen" type="number" min={6} max={32} className={INPUT} value={security.password_min_length ?? 8} onChange={(e) => setSecurity((s) => ({ ...s, password_min_length: +e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="pw-rotation">Rotation Period (days)</label>
                  <input id="pw-rotation" type="number" min={0} max={365} className={INPUT} value={security.password_rotation_days ?? 90} onChange={(e) => setSecurity((s) => ({ ...s, password_rotation_days: +e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="pw-history">History Count</label>
                  <input id="pw-history" type="number" min={0} max={24} className={INPUT} value={security.password_history_count ?? 5} onChange={(e) => setSecurity((s) => ({ ...s, password_history_count: +e.target.value }))} />
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <input id="pw-complexity" type="checkbox" className="h-4 w-4 rounded border-slate-300 text-indigo-600" checked={security.password_complexity ?? true} onChange={(e) => setSecurity((s) => ({ ...s, password_complexity: e.target.checked }))} />
                  <label htmlFor="pw-complexity" className="text-sm text-slate-700">Require complexity (uppercase, number, symbol)</label>
                </div>
              </div>
            </div>

            {/* Session timeouts */}
            <div>
              <p className="font-semibold text-slate-800 mb-3">Session Timeout (minutes)</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {ROLES.map((r) => (
                  <div key={r.id}>
                    <label className={LABEL} htmlFor={`timeout-${r.id}`}>{r.label}</label>
                    <input
                      id={`timeout-${r.id}`}
                      type="number" min={5} max={1440}
                      className={INPUT}
                      value={security.session_timeout_min?.[r.id] ?? 60}
                      onChange={(e) => setSecurity((s) => ({ ...s, session_timeout_min: { ...s.session_timeout_min, [r.id]: +e.target.value } }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* API Tokens */}
            <div>
              <p className="font-semibold text-slate-800 mb-3">API Tokens</p>
              <div className="space-y-2">
                {(security.api_tokens ?? []).map((tok) => (
                  <div key={tok.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{tok.name}</p>
                      <p className="text-[11px] text-slate-400">Created: {formatTimestamp(tok.created_at)} • Last used: {formatTimestamp(tok.last_used)}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tok.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{tok.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleSaveSecurity}
                disabled={savingSecurity}
                className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
              >
                {savingSecurity ? <Loader2 size={14} className="animate-spin" /> : null}
                Save Security Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User creation wizard */}
      {userWizardOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setUserWizardOpen(false); setWizardStep(1); }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 z-10 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">New User — Step {wizardStep}/3</h3>
              <button type="button" onClick={() => { setUserWizardOpen(false); setWizardStep(1); }} className="text-slate-400 hover:text-slate-600 text-xl" aria-label="Close wizard">×</button>
            </div>

            {wizardStep === 1 && (
              <div className="flex flex-col gap-4">
                <div><label className={LABEL} htmlFor="nu-user">Username</label><input id="nu-user" className={INPUT} value={newUser.username} onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))} placeholder="jsmith" />{formErrors.username && <p className="text-red-500 text-xs mt-1">{formErrors.username}</p>}</div>
                <div>
                  <label className={LABEL} htmlFor="nu-pw">Password</label>
                  <div className="relative">
                    <input id="nu-pw" type={showPw ? "text" : "password"} className={INPUT} value={newUser.password} onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))} placeholder="Min 8 chars" />
                    <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-label={showPw ? "Hide password" : "Show password"}>{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  </div>
                  {formErrors.password && <p className="text-red-500 text-xs mt-1">{formErrors.password}</p>}
                </div>
                <div><label className={LABEL} htmlFor="nu-confirm">Confirm Password</label><input id="nu-confirm" type="password" className={INPUT} value={newUser.confirm_password} onChange={(e) => setNewUser((u) => ({ ...u, confirm_password: e.target.value }))} />{formErrors.confirm && <p className="text-red-500 text-xs mt-1">{formErrors.confirm}</p>}</div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-500">Select the user's role.</p>
                <div className="space-y-2">
                  {ROLES.map((r) => (
                    <label key={r.id} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-lg border border-transparent hover:border-slate-200 hover:bg-slate-50">
                      <input type="radio" name="nu-role" value={r.id} checked={newUser.role === r.id} onChange={() => setNewUser((u) => ({ ...u, role: r.id }))} className="text-indigo-600" />
                      <span className="text-sm font-medium text-slate-700">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-slate-500">Review and create the user.</p>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Username:</span><span className="font-medium">{newUser.username}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Role:</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${ROLE_BADGES[newUser.role] ?? "bg-slate-100 text-slate-600"}`}>{newUser.role.replace("_", " ")}</span></div>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-slate-100">
              <button type="button" onClick={() => wizardStep > 1 ? setWizardStep((s) => s - 1) : (setUserWizardOpen(false), setWizardStep(1))} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                {wizardStep === 1 ? "Cancel" : "Back"}
              </button>
              {wizardStep < 3
                ? <button type="button" onClick={() => { if (wizardStep === 1 && !validateUser()) return; setWizardStep((s) => s + 1); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Next</button>
                : <button type="button" onClick={handleCreateUser} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Create User</button>
              }
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete User"
        message="Are you sure you want to delete this user? They will lose all access immediately."
        confirmLabel="Delete User"
        onConfirm={handleDeleteUser}
        onCancel={() => setDeleteTarget(null)}
        variant="danger"
      />
    </div>
  );
}
