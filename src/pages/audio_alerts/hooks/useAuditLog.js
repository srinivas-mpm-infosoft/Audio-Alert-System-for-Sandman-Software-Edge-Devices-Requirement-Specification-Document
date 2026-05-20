import { useState, useCallback } from "react";
import { getAlertLogs, getAuditLogs } from "../api/logs.api";

export function useAuditLog() {
  const [alertLogs, setAlertLogs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [alertTotal, setAlertTotal] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadAlertLogs = useCallback(async (filters = {}, page = 1, pageSize = 50) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAlertLogs(filters, page, pageSize);
      if (res.ok) {
        setAlertLogs(Array.isArray(res.data) ? res.data : []);
        setAlertTotal(res.total ?? 0);
      } else {
        setError(res.error || "Failed to load logs");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAuditLogs = useCallback(async (filters = {}, page = 1, pageSize = 50) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLogs(filters, page, pageSize);
      if (res.ok) {
        setAuditLogs(Array.isArray(res.data) ? res.data : []);
        setAuditTotal(res.total ?? 0);
      } else {
        setError(res.error || "Failed to load audit logs");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  return { alertLogs, auditLogs, alertTotal, auditTotal, loading, error, loadAlertLogs, loadAuditLogs };
}
