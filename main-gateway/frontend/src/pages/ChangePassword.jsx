import React, { useState } from "react";
import { KeyRound, CheckCircle, AlertTriangle, Save, Loader2 } from "lucide-react";
import { targetUrl } from "../config";

export default function ChangePassword() {
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState("");
    const [isPending, setIsPending] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setSuccess(false);
        setIsPending(true);

        if (newPassword !== confirmPassword) {
            setError("New passwords do not match!");
            setIsPending(false);
            return;
        }

        try {
            const res = await fetch(`${targetUrl}/reset-password`, {
                method: "POST",
                credentials: 'include',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ oldPassword, newPassword, login_req: false }),
            });

            if (res.ok) {
                setSuccess(true);
                setOldPassword("");
                setNewPassword("");
                setConfirmPassword("");
            } else {
                const data = await res.json();
                setError(data.error || "Current password incorrect or update failed.");
            }
        } catch (err) {
            setError("Network error. Please try again.");
        } finally {
            setIsPending(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-slate-50 ">
            {/* Header */}

            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3 ml-4 mt-5">
                <KeyRound size={20} />
                <h2 className="font-semibold text-slate-800 text-lg">Change Password</h2>
            </div>

            {/* Content Area */}
            <main className="flex-1 overflow-y-auto p-8 mt-[-10px]">
                <div className="max-w-xl">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">


                        <div className="p-8">
                            {/* Success Message */}
                            {success && (
                                <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-3 text-emerald-700 animate-in fade-in zoom-in duration-300">
                                    <CheckCircle size={20} />
                                    <span className="font-medium">Password updated successfully!</span>
                                </div>
                            )}

                            {/* Error Message */}
                            {error && (
                                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700 animate-in shake duration-300">
                                    <AlertTriangle size={20} />
                                    <span className="font-medium text-sm">{error}</span>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                                        Old Password
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        value={oldPassword}
                                        onChange={(e) => setOldPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                                        New Password
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="Enter new password"
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                                        Confirm New Password
                                    </label>
                                    <input
                                        type="password"
                                        required
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Repeat new password"
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                                    />
                                </div>

                                <div className="pt-4 border-t border-slate-100 flex items-center gap-4">
                                    <button
                                        disabled={isPending}
                                        type="submit"
                                        className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg shadow-sm transition-all"
                                    >
                                        {isPending ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                        {isPending ? "Updating..." : "Update Password"}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOldPassword("");
                                            setNewPassword("");
                                            setConfirmPassword("");
                                            setError("");
                                        }}
                                        className="px-4 py-2.5 text-slate-600 font-medium hover:text-slate-900 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    <div className="mt-6 flex items-start gap-3 p-4 bg-amber-50 rounded-lg border border-amber-200">
                        <AlertTriangle className="text-amber-600 flex-shrink-0" size={18} />
                        <p className="text-xs text-amber-800 leading-relaxed">
                            <strong>Tip:</strong> Ensure your new password is at least 8 characters long and contains a mix of letters, numbers, and symbols for maximum security.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}