import { useState, useCallback } from "react";
import { getDevices, getZones, getPlants, getLines } from "../api/devices.api";

export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [zones, setZones] = useState([]);
  const [plants, setPlants] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const [devRes, zoneRes, plantRes, lineRes] = await Promise.all([
        getDevices(filters),
        getZones(),
        getPlants(),
        getLines(),
      ]);
      if (devRes.ok) setDevices(devRes.data);
      if (zoneRes.ok) setZones(zoneRes.data);
      if (plantRes.ok) setPlants(plantRes.data);
      if (lineRes.ok) setLines(lineRes.data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDevices = useCallback(async (filters = {}) => {
    const res = await getDevices(filters);
    if (res.ok) setDevices(res.data);
  }, []);

  return { devices, zones, plants, lines, loading, error, load, refreshDevices };
}
