import { targetUrl } from "../../../config";

export async function getActiveAlerts(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(`${targetUrl}/audio-alerts/active${params ? `?${params}` : ""}`, { credentials: "include" });
  return res.json();
}

export async function acknowledgeAlert(alert_id, note = "") {
  const res = await fetch(`${targetUrl}/audio-alerts/ack`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alert_id, note }),
  });
  return res.json();
}

export async function acknowledgeBroadcastAlert(alert_id) {
  const res = await fetch(`${targetUrl}/audio-alerts/broadcast/${alert_id}/ack`, {
    method: "POST", credentials: "include",
  });
  return res.json();
}

export async function broadcastManual(payload) {
  const res = await fetch(`${targetUrl}/audio-alerts/broadcast`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getAudioAlertConfig() {
  const res = await fetch(`${targetUrl}/audio-alerts/config`, { credentials: "include" });
  return res.json();
}
