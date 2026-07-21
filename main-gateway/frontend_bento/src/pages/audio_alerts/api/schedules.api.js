import { targetUrl } from "../../../config";

export async function getSchedules() {
  const res = await fetch(`${targetUrl}/audio-alerts/schedules`, { credentials: "include" });
  return res.json();
}

export async function createSchedule(schedule) {
  const res = await fetch(`${targetUrl}/audio-alerts/schedules`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schedule),
  });
  return res.json();
}

export async function updateSchedule(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/schedules/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteSchedule(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/schedules/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

export async function enableSchedule(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/schedules/${id}/enable`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function disableSchedule(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/schedules/${id}/disable`, { method: "POST", credentials: "include" });
  return res.json();
}
