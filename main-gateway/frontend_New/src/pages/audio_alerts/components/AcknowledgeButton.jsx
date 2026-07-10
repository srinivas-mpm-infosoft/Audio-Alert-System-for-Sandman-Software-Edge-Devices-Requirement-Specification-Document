import React, { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";

export default function AcknowledgeButton({ alert, onAck, size = "md" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setOpen(false);
    setBusy(true);
    try {
      await onAck(alert.alert_id);
    } finally {
      setBusy(false);
    }
  };

  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 ${pad}`}
        aria-label={`Acknowledge alert ${alert.alert_code}`}
      >
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
        {size !== "sm" && "Acknowledge"}
      </button>

      <ConfirmDialog
        open={open}
        title="Acknowledge Alert"
        message={`Acknowledge "${alert.alert_code}"? By confirming, you indicate that corrective action has been taken.`}
        confirmLabel="Yes, Acknowledge"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
        variant="primary"
      />
    </>
  );
}
