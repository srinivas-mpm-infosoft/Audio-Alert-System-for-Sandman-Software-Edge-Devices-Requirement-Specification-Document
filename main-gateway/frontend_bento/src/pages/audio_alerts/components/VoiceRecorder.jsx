import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Play, Pause, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import MicDeviceSelect, { useAudioInputDevices } from "./MicDeviceSelect";
import { audioBufferToWavBlob } from "../utils/wavEncoder";

// Records the mic to a WAV file entirely client-side: MediaRecorder captures
// whatever container the browser natively supports (webm/ogg), then it's
// decoded and re-encoded to WAV so the result matches the same format the
// existing "Upload Clip" flow already expects and the backend already knows
// how to serve back with the right mimetype — no backend changes needed.
export default function VoiceRecorder({ onCapture, disabled }) {
  const [deviceId, setDeviceId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { refresh: refreshDevices } = useAudioInputDevices();
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioElRef = useRef(null);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => clearInterval(timerRef.current), []);

  const finalizeRecording = useCallback(async () => {
    const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType || "audio/webm" });
    const arrayBuf = await blob.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuf);
      const wavBlob = audioBufferToWavBlob(decoded);
      setPreviewUrl(URL.createObjectURL(wavBlob));
      onCapture(new File([wavBlob], `recording-${Date.now()}.wav`, { type: "audio/wav" }));
    } catch {
      setError("Could not process the recording — try again");
    } finally {
      ctx.close();
    }
  }, [onCapture]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      refreshDevices(); // labels only populate once permission has been granted
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setBusy(true);
        finalizeRecording().finally(() => setBusy(false));
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      setError(e?.message?.includes("Permission") || e?.name === "NotAllowedError" ? "Microphone permission denied" : "Could not access microphone");
    }
  }, [deviceId, refreshDevices, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearInterval(timerRef.current);
    setRecording(false);
    mediaRecorderRef.current?.stop();
  }, []);

  const reRecord = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPlaying(false);
    onCapture(null);
  }, [previewUrl, onCapture]);

  const togglePlay = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (playing) el.pause();
    else el.play();
  };

  return (
    <div className="flex flex-col gap-3">
      <MicDeviceSelect value={deviceId} onChange={setDeviceId} disabled={recording || busy || disabled} />

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} aria-hidden="true" /> {error}
        </p>
      )}

      {!previewUrl ? (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={recording ? stopRecording : startRecording}
          className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
            recording ? "bg-red-600 text-white animate-pulse" : "bg-emerald-800 text-white hover:bg-emerald-900"
          }`}
        >
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : recording ? <Square size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
          {busy ? "Processing…" : recording ? `Stop recording (${seconds}s)` : "Start recording"}
        </button>
      ) : (
        <div className="flex items-center gap-3 border border-gray-200 rounded-xl p-3">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioElRef}
            src={previewUrl}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="w-9 h-9 rounded-full bg-emerald-800 text-white flex items-center justify-center shrink-0 hover:bg-emerald-900"
          >
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          </button>
          <span className="text-sm text-gray-600 flex-1">Recorded clip — {seconds}s. Sounds good?</span>
          <button type="button" onClick={reRecord} disabled={disabled} className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 shrink-0">
            <RotateCcw size={12} aria-hidden="true" /> Re-record
          </button>
        </div>
      )}
    </div>
  );
}
