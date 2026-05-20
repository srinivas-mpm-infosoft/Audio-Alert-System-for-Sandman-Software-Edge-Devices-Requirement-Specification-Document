import React, { useState } from "react";
import { UserPlus, ShieldCheck, User, Lock, Save, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "../components/ToastContext";
import { targetUrl } from "../config";

const allowedRolesByCreator = {
  superadmin: ["superadmin", "admin", "user"],
  admin: ["user"],
  user: [],
};

export default function AddUser({ currentRole = "superadmin" }) {
  const allowed = allowedRolesByCreator[currentRole] || [];
  const showToast = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(allowed[0] || "user");
  const [isPending, setIsPending] = useState(false);

  const createUser = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      showToast("Username and password required", "error");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(`${targetUrl}/create-user`, {
        method: "POST",
        credentials: 'include',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Failed to create user", "error");
        return;
      }

      showToast(`User ${username} created as ${role}`, "success");
      setUsername("");
      setPassword("");
      setRole(allowed[0] || "user");
    } catch (err) {
      showToast("Network error occurred", "error");
    } finally {
      setIsPending(false);
    }
  };

  if (allowed.length === 0) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-4 text-red-700">
          <AlertCircle size={24} />
          <div>
            <h3 className="font-bold">Access Denied</h3>
            <p className="text-sm">You do not have the required permissions to create new users.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-xl animate-in fade-in duration-500">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
            <UserPlus size={20} />
          </div>
          <h2 className="font-bold text-slate-800 text-lg">Create New Account</h2>
        </div>

        <div className="p-8">
          <form onSubmit={createUser} className="space-y-5">
            {/* Username Field */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 flex items-center gap-2">
                <User size={14} /> Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="j.doe"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 flex items-center gap-2">
                <Lock size={14} /> Initial Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
              />
            </div>

            {/* Role Selection */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 flex items-center gap-2">
                <ShieldCheck size={14} /> Access Level
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none appearance-none cursor-pointer"
              >
                {allowed.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Action Buttons */}
            <div className="pt-6 border-t border-slate-100 flex items-center gap-4">
              <button
                disabled={isPending}
                type="submit"
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg shadow-sm transition-all shadow-indigo-100"
              >
                {isPending ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                {isPending ? "Creating..." : "Save User"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setUsername("");
                  setPassword("");
                }}
                className="px-4 py-2.5 text-slate-500 font-medium hover:text-slate-800 transition-colors"
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}