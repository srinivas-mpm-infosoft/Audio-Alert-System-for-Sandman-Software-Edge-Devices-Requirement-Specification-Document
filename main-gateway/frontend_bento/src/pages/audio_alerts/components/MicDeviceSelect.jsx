import { useState, useEffect, useCallback } from "react";
import { inputCls } from "../../../components/ui/Bento";

// Device labels are only populated by the browser once mic permission has
// been granted at least once for this origin — callers should call
// `refresh()` again right after a successful getUserMedia() grant so the
// dropdown fills in real labels instead of generic "Microphone N" ones.
export function useAudioInputDevices() {
  const [devices, setDevices] = useState([]);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list.filter((d) => d.kind === "audioinput"));
  }, []);

  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  return { devices, refresh };
}

export default function MicDeviceSelect({ value, onChange, disabled, label = "Microphone" }) {
  const { devices } = useAudioInputDevices();

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} className={inputCls}>
        <option value="">Default microphone</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}
