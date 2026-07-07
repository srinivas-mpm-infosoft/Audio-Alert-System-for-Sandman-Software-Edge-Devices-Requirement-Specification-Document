import { targetUrl } from "../../../config";

export async function getRules(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(`${targetUrl}/audio-alerts/rules${params ? `?${params}` : ""}`, { credentials: "include" });
  return res.json();
}

export async function getRule(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/rules/${id}`, { credentials: "include" });
  return res.json();
}

export async function createRule(rule) {
  const res = await fetch(`${targetUrl}/audio-alerts/rules`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  return res.json();
}

export async function updateRule(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/rules/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteRule(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/rules/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

export async function testRule(id, duration_minutes = 60) {
  const res = await fetch(`${targetUrl}/audio-alerts/rules/${id}/test`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duration_minutes }),
  });
  return res.json();
}

export async function enableRule(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/rules/${id}/enable`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function disableRule(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/rules/${id}/disable`, { method: "POST", credentials: "include" });
  return res.json();
}
