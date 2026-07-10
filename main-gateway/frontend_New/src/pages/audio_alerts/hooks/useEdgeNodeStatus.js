import { useState, useEffect, useCallback, useRef } from "react";
import { getDevices } from "../api/devices.api";
import { useDashboardEvents } from "./useDashboardEvents";

// Same "real hardware" filter DevicesZones.jsx applies — excludes Modbus
// TCP/RTU devices (managed on the Modbus config pages) so this hook and
// the Devices & Zones page report consistent counts from the same data.
function filterEdgeNodes(devices) {
  return devices.filter((d) => !d.type?.toLowerCase().includes("modbus"));
}

export function useEdgeNodeStatus() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDevices();
      if (res.ok) setDevices(filterEdgeNodes(res.data));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Debounced device_status refresh — mirrors the pattern used in
  // DevicesZones.jsx so both pages settle on the same numbers.
  const refreshTimerRef = useRef(null);
  useDashboardEvents(useCallback((event) => {
    if (event.type !== "device_status") return;
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refresh();
    }, 500);
  }, [refresh]));

  const onlineCount = devices.filter((d) => d.status === "online").length;
  const totalCount = devices.length;

  return { devices, onlineCount, totalCount, loading, refresh };
}
