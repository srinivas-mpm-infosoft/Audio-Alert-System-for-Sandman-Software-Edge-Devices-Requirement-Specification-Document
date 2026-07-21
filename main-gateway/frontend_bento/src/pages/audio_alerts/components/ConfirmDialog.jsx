import React, { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

export default function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, variant = "danger" }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onCancel?.();
    };
    document.addEventListener("keydown", handler);
    cancelRef.current?.focus();
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = variant === "danger";
  const confirmBg = isDanger ? "bg-red-600 hover:bg-red-700 focus:ring-red-500" : "bg-emerald-800 hover:bg-emerald-900 focus:ring-emerald-600";

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 z-10">
        <div className="flex items-start gap-4 mb-5">
          <div className={`p-2 rounded-full ${isDanger ? "bg-red-100" : "bg-emerald-50"}`}>
            <AlertTriangle className={`h-5 w-5 ${isDanger ? "text-red-600" : "text-emerald-700"}`} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="confirm-title" className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="mt-1 text-sm text-gray-400">{message}</p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 rounded-full border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-full text-sm font-medium text-white ${confirmBg} focus:outline-none focus:ring-2 focus:ring-offset-2`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
