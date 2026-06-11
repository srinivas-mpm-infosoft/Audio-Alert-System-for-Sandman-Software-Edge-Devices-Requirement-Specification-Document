import { useState, useCallback } from "react";
import { getAlertDeviceLogs, getAuditLogs } from "../api/logs.api";

export function useAuditLog() {
  const [alertLogs, setAlertLogs]       = useState([]);
  const [auditLogs, setAuditLogs]       = useState([]);
  const [alertTotal, setAlertTotal]     = useState(0);
  const [auditTotal, setAuditTotal]     = useState(0);
  const [alertColumns, setAlertColumns] = useState([]);
  const [alertMeta, setAlertMeta]       = useState({});
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  /**
   * Load alert logs from the external alert_logs table.
   * filters may include: search, priority, zone, sort_by, sort_dir
   */
  const loadAlertLogs = useCallback(async (filters = {}, page = 1, pageSize = 50) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAlertDeviceLogs(filters, page, pageSize);
      if (res.ok && res.data) {
        setAlertLogs(res.data.items ?? []);
        setAlertTotal(res.data.total ?? 0);
        setAlertColumns(res.data.columns ?? []);
        setAlertMeta(res.data.meta ?? {});
      } else {
        setAlertLogs([]);
        setAlertTotal(0);
        setError(res.error || "Failed to load alert logs");
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
      if (res.ok && res.data) {
        setAuditLogs(res.data.items ?? []);
        setAuditTotal(res.data.total ?? 0);
      } else {
        setError(res.error || "Failed to load audit logs");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    alertLogs, auditLogs,
    alertTotal, auditTotal,
    alertColumns, alertMeta,
    loading, error,
    loadAlertLogs, loadAuditLogs,
  };
}
