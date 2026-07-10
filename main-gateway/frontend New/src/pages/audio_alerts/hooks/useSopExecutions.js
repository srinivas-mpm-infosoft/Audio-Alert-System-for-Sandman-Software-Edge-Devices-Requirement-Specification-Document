import { useState, useEffect, useCallback } from "react";
import { getSopExecutions } from "../api/sop.api";
import { useDashboardEvents } from "./useDashboardEvents";

// Shared "live executions" list — fetches eagerly on mount (rather than
// lazily on first tab-visit) and merges the "sop_execution" event stream
// (played/acknowledged/timeout-replay/completed/etc.) pushed over the same
// real-time channel device-status uses, so any consumer stays in sync
// without polling.
export function useSopExecutions({ activeOnly = true, limit = 50 } = {}) {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSopExecutions(activeOnly, limit);
      if (res.ok) setExecutions(res.data);
    } finally {
      setLoading(false);
    }
  }, [activeOnly, limit]);

  useEffect(() => { reload(); }, [reload]);

  useDashboardEvents(useCallback((event) => {
    if (event.type !== "sop_execution") return;
    setExecutions((prev) => {
      const isTerminal = ["COMPLETED", "CANCELLED", "FAILED"].includes(event.status);
      const exists = prev.some((e) => e.id === event.id);
      if (isTerminal) return prev.filter((e) => e.id !== event.id);
      if (exists) return prev.map((e) => e.id === event.id ? event : e);
      return [event, ...prev];
    });
  }, []));

  return { executions, loading, reload };
}
