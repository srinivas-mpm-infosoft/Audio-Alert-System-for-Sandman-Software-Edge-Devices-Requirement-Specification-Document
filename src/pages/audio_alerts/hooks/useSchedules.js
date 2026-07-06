import { useState, useCallback } from "react";
import {
  getSchedules, createSchedule, updateSchedule, deleteSchedule,
  enableSchedule, disableSchedule,
} from "../api/schedules.api";

export function useSchedules() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSchedules();
      if (res.ok) setSchedules(res.data);
      else setError(res.error || "Failed to load schedules");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (schedule) => {
    const res = await createSchedule(schedule);
    if (res.ok) await load();
    return res;
  }, [load]);

  const update = useCallback(async (id, updates) => {
    const res = await updateSchedule(id, updates);
    if (res.ok) await load();
    return res;
  }, [load]);

  const remove = useCallback(async (id) => {
    const res = await deleteSchedule(id);
    if (res.ok) await load();
    return res;
  }, [load]);

  const enable = useCallback(async (id) => {
    const res = await enableSchedule(id);
    if (res.ok) setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, is_enabled: true } : s));
    return res;
  }, []);

  const disable = useCallback(async (id) => {
    const res = await disableSchedule(id);
    if (res.ok) setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, is_enabled: false } : s));
    return res;
  }, []);

  return { schedules, loading, error, load, create, update, remove, enable, disable };
}
