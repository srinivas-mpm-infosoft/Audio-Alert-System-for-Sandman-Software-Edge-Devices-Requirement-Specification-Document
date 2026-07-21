import React, { useState, useRef, useCallback } from "react";
import { Mic, MicOff, ChevronDown, ChevronUp, Radio, Loader2, AlertTriangle } from "lucide-react";
import ZonePicker from "./ZonePicker";
import MicDeviceSelect, { useAudioInputDevices } from "./MicDeviceSelect";
import { targetUrl } from "../../../config";

function pagingWsUrl() {
  if (/^https?:\/\//i.test(targetUrl)) {
    return targetUrl.replace(/^http/i, "ws") + "/audio-alerts/paging/ws";
  }
  // targetUrl is a relative path (e.g. "/api") — build from the current page origin
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${targetUrl}/audio-alerts/paging/ws`;
}

// Five explicit states required by spec: Idle, Connecting, Live, Stopping, Error.
const STATE = { IDLE: "idle", CONNECTING: "connecting", LIVE: "live", STOPPING: "stopping", ERROR: "error" };

const STATE_LABEL = {
  [STATE.IDLE]: "Hold to Talk",
  [STATE.CONNECTING]: "Connecting…",
  [STATE.LIVE]: "Release to Stop",
  [STATE.STOPPING]: "Stopping…",
  [STATE.ERROR]: "Hold to Talk",
};

export default function PagingPanel({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [zoneIds, setZoneIds] = useState([]);
  const [plantWide, setPlantWide] = useState(false);
  const [micDeviceId, setMicDeviceId] = useState(null);
  const [state, setState] = useState(STATE.IDLE);
  const [deviceCount, setDeviceCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const { refresh: refreshMicDevices } = useAudioInputDevices();

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const stateRef = useRef(STATE.IDLE);       // avoids stale-closure reads inside WS callbacks
  const stopFallbackRef = useRef(null);

  const applyState = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Streams the mic as raw 16kHz mono PCM (320 samples / 640 bytes / 20ms
  // chunks) instead of MediaRecorder's WebM/Opus — the edge node plays this
  // straight through aplay with no decoder in the loop, which is what
  // actually keeps live-paging latency low end to end.
  const startPcmStreaming = useCallback((stream, ws) => {
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    sourceRef.current = source;

    const processor = audioContext.createScriptProcessor(1024, 1, 1);
    processorRef.current = processor;

    const inputRate = audioContext.sampleRate;
    const outputRate = 16000;
    let pcmBuffer = [];

    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const input = event.inputBuffer.getChannelData(0);

      // Resample browser microphone rate (usually 48 kHz) to 16 kHz
      const ratio = inputRate / outputRate;
      const outputLength = Math.floor(input.length / ratio);
      const resampled = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        resampled[i] = input[Math.floor(i * ratio)];
      }

      for (let i = 0; i < resampled.length; i++) {
        pcmBuffer.push(resampled[i]);
      }

      // Exactly 320 samples = 20ms at 16kHz
      while (pcmBuffer.length >= 320) {
        const chunk = pcmBuffer.splice(0, 320);
        const pcm16 = new Int16Array(320);
        for (let i = 0; i < 320; i++) {
          const sample = Math.max(-1, Math.min(1, chunk[i]));
          pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        ws.send(pcm16.buffer);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }, []);

  const cleanup = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    try { audioContextRef.current?.close(); } catch { /* ignore */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { wsRef.current?.close(); } catch { /* ignore */ }
    processorRef.current = null;
    sourceRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    wsRef.current = null;
  }, []);

  const startTalking = useCallback(async () => {
    // Guards against a second accidental session from this operator/tab —
    // the backend also rejects a concurrent session for the same user.
    if (stateRef.current !== STATE.IDLE && stateRef.current !== STATE.ERROR) return;
    if (!plantWide && zoneIds.length === 0) {
      setErrorMsg("Select at least one zone, or choose plant-wide");
      applyState(STATE.ERROR);
      return;
    }
    setErrorMsg("");
    applyState(STATE.CONNECTING);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      });
      streamRef.current = stream;
      refreshMicDevices(); // labels only populate once permission has been granted

      const ws = new WebSocket(pagingWsUrl());
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws.send(JSON.stringify({ zone_ids: zoneIds, plant_wide: plantWide }));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "ready") {
            setDeviceCount(msg.devices || 0);
            applyState(STATE.LIVE);
            startPcmStreaming(stream, ws);
          } else if (msg.type === "device_disconnected") {
            setDeviceCount(msg.remaining ?? 0);
            setErrorMsg(`A target node disconnected — ${msg.remaining} device(s) still receiving`);
          } else if (msg.type === "error") {
            const friendly = msg.code === "already_active"
              ? "You already have an active paging session"
              : msg.message || "Paging failed";
            setErrorMsg(friendly);
            applyState(STATE.ERROR);
            cleanup();
          }
        } catch { /* ignore non-JSON control frames */ }
      };

      ws.onerror = () => {
        setErrorMsg("Connection to paging service failed");
        applyState(STATE.ERROR);
        cleanup();
      };
      ws.onclose = () => {
        if (stopFallbackRef.current) { clearTimeout(stopFallbackRef.current); stopFallbackRef.current = null; }
        if (stateRef.current !== STATE.ERROR) applyState(STATE.IDLE);
      };
    } catch (e) {
      setErrorMsg(e?.message?.includes("Permission") ? "Microphone permission denied" : "Could not access microphone");
      applyState(STATE.ERROR);
      cleanup();
    }
  }, [zoneIds, plantWide, micDeviceId, refreshMicDevices, cleanup, applyState, startPcmStreaming]);

  const stopTalking = useCallback(() => {
    if (stateRef.current !== STATE.LIVE && stateRef.current !== STATE.CONNECTING) return;
    applyState(STATE.STOPPING);
    cleanup();
    // Safety net: land on Idle even if the socket never fires onclose (e.g.
    // it never fully opened before release).
    stopFallbackRef.current = setTimeout(() => {
      if (stateRef.current === STATE.STOPPING) applyState(STATE.IDLE);
    }, 1500);
  }, [cleanup, applyState]);

  const isBusy = state === STATE.CONNECTING || state === STATE.STOPPING;
  const isLive = state === STATE.LIVE || isBusy;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full p-4 flex items-center justify-between text-left focus:outline-none focus:ring-2 focus:ring-emerald-400 rounded-2xl"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-emerald-700" aria-hidden="true" />
          <span className="font-semibold text-gray-700">Live Voice Paging</span>
          <span className="text-xs text-gray-400">— push-to-talk announcement to zone speakers</span>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" aria-hidden="true" /> : <ChevronDown size={16} className="text-gray-400" aria-hidden="true" />}
      </button>

      {open && (
        <div className="px-4 pb-5 border-t border-gray-100 pt-4 flex flex-col gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input type="checkbox" checked={plantWide} onChange={(e) => setPlantWide(e.target.checked)} disabled={isLive} className="rounded border-gray-300 text-emerald-700" />
                <span className="text-sm text-gray-700 font-medium">Plant-wide (all zones)</span>
              </label>
              {!plantWide && (
                <ZonePicker selected={zoneIds} onChange={setZoneIds} label="Target Zones / Group" disabled={isLive} />
              )}
            </div>
            <MicDeviceSelect value={micDeviceId} onChange={setMicDeviceId} disabled={isLive} />
          </div>

          {errorMsg && (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertTriangle size={13} aria-hidden="true" /> {errorMsg}
            </p>
          )}

          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={isBusy}
              onMouseDown={startTalking}
              onMouseUp={stopTalking}
              onMouseLeave={() => state === STATE.LIVE && stopTalking()}
              onTouchStart={(e) => { e.preventDefault(); startTalking(); }}
              onTouchEnd={(e) => { e.preventDefault(); stopTalking(); }}
              aria-label={STATE_LABEL[state]}
              className={`inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold select-none transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-70 ${
                state === STATE.LIVE ? "bg-red-600 text-white animate-pulse focus:ring-red-500" : "bg-emerald-800 hover:bg-emerald-900 text-white focus:ring-emerald-600"
              }`}
            >
              {isBusy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : state === STATE.LIVE ? <Radio size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
              {STATE_LABEL[state]}
            </button>
            {state === STATE.LIVE && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <MicOff size={12} className="hidden" aria-hidden="true" />
                Live — streaming to {deviceCount} device{deviceCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400">
            Hold the button and speak. Audio streams live to the selected zone speakers and stops
            as soon as you release — no typing or translation, just your voice. Only one paging
            session per operator is allowed at a time.
          </p>
        </div>
      )}
    </div>
  );
}
