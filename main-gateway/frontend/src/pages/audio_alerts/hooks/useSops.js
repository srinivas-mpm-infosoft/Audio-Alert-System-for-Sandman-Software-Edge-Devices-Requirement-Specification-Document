import { useState, useCallback } from "react";
import {
  getSops, createSop, updateSop, deleteSop, deleteSopStep, startSop,
} from "../api/sop.api";

export function useSops() {
  const [sops, setSops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSops();
      if (res.ok) setSops(res.data);
      else setError(res.error || "Failed to load SOPs");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (sop) => {
    const res = await createSop(sop);
    if (res.ok) await load();
    return res;
  }, [load]);

  const update = useCallback(async (id, updates) => {
    const res = await updateSop(id, updates);
    if (res.ok) await load();
    return res;
  }, [load]);

  const remove = useCallback(async (id) => {
    const res = await deleteSop(id);
    if (res.ok) await load();
    return res;
  }, [load]);

  const removeStep = useCallback(async (sopId, stepId) => {
    const res = await deleteSopStep(sopId, stepId);
    if (res.ok) await load();
    return res;
  }, [load]);

  const start = useCallback(async (id) => startSop(id), []);

  return { sops, loading, error, load, create, update, remove, removeStep, start };
}
