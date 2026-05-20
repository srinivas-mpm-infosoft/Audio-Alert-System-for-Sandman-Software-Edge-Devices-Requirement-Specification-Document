import React, { useState } from "react";
import { Play, Loader2, Volume2 } from "lucide-react";
import { previewAudio } from "../api/audio.api";

export default function AudioPreviewButton({ payload, label = "Preview", disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const handlePreview = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await previewAudio(payload);
      if (res.ok) {
        setMsg(res.data.message ?? "Preview sent to zone speakers.");
        setTimeout(() => setMsg(null), 4000);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handlePreview}
        disabled={disabled || busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-sm font-medium disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
        aria-label={label}
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        {label}
      </button>
      {msg && (
        <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
          <Volume2 size={12} aria-hidden="true" /> {msg}
        </span>
      )}
    </div>
  );
}
