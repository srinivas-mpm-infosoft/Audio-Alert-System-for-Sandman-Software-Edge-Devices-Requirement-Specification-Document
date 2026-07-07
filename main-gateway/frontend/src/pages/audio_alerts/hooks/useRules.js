import { useState, useCallback } from "react";
import { getRules, createRule, updateRule, deleteRule, enableRule, disableRule, testRule } from "../api/rules.api";
import { useAuthStore } from "../../../store/useAuthStore";

export function useRules() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const user = useAuthStore((s) => s.user);

  const load = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRules(filters);
      if (res.ok) setRules(res.data);
      else setError(res.error || "Failed to load rules");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (rule) => {
    const res = await createRule(rule, user?.username);
    if (res.ok) await load();
    return res;
  }, [load, user]);

  const update = useCallback(async (id, updates) => {
    const res = await updateRule(id, updates, user?.username);
    if (res.ok) await load();
    return res;
  }, [load, user]);

  const remove = useCallback(async (id) => {
    const res = await deleteRule(id, user?.username);
    if (res.ok) await load();
    return res;
  }, [load, user]);

  const enable = useCallback(async (id) => {
    const res = await enableRule(id);
    if (res.ok) setRules((prev) => prev.map((r) => r.id === id ? { ...r, status: "Active" } : r));
    return res;
  }, []);

  const disable = useCallback(async (id) => {
    const res = await disableRule(id);
    if (res.ok) setRules((prev) => prev.map((r) => r.id === id ? { ...r, status: "Disabled" } : r));
    return res;
  }, []);

  const test = useCallback(async (id, duration) => {
    const res = await testRule(id, duration);
    if (res.ok) setRules((prev) => prev.map((r) => r.id === id ? { ...r, status: "Test Mode" } : r));
    return res;
  }, []);

  return { rules, loading, error, load, create, update, remove, enable, disable, test };
}
