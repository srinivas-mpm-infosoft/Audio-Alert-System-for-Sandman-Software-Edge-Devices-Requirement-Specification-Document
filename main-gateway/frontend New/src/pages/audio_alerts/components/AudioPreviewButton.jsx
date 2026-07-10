import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Loader2, Volume2 } from "lucide-react";
import { previewAudio, getClipFileUrl } from "../api/audio.api";

// Plays real audio in the browser for a pre-recorded clip (payload.clip_id).
// Falls back to the old "queued on device" stub behaviour for TTS template
// previews (payload.template_id), which have no static file to stream.
export default function AudioPreviewButton({ payload, label = "Preview", disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const handleClipPreview = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    setBusy(true);
    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    audio.src = getClipFileUrl(payload.clip_id);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => { setBusy(false); setPlaying(false); setMsg("Could not play audio"); setTimeout(() => setMsg(null), 3000); };
    audio.play()
      .then(() => { setBusy(false); setPlaying(true); })
      .catch(() => { setBusy(false); setMsg("Could not play audio"); setTimeout(() => setMsg(null), 3000); });
  };

  const handleTemplatePreview = async () => {
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

  const isClip = !!payload?.clip_id;
  const handlePreview = isClip ? handleClipPreview : handleTemplatePreview;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handlePreview}
        disabled={disabled || busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-sm font-medium disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
        aria-label={playing ? `Stop ${label}` : label}
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        {playing ? "Playing…" : label}
      </button>
      {msg && (
        <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
          <Volume2 size={12} aria-hidden="true" /> {msg}
        </span>
      )}
    </div>
  );
}
