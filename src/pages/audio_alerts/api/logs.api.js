import { targetUrl } from "../../../config";

function buildParams(obj) {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""))
  ).toString();
}

export async function getAlertLogs(filters = {}, page = 1, pageSize = 50) {
  const params = buildParams({ ...filters, page, page_size: pageSize });
  const res = await fetch(`${targetUrl}/audio-alerts/logs/alerts?${params}`, { credentials: "include" });
  return res.json();
}

export async function getAuditLogs(filters = {}, page = 1, pageSize = 50) {
  const params = buildParams({ ...filters, page, page_size: pageSize });
  const res = await fetch(`${targetUrl}/audio-alerts/logs/audit?${params}`, { credentials: "include" });
  return res.json();
}
