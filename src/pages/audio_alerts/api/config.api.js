import { targetUrl } from "../../../config";

export async function getAppSettings() {
  const res = await fetch(`${targetUrl}/audio-alerts/config/app-settings`, { credentials: "include" });
  return res.json();
}

export async function saveAppSettings(data) {
  const res = await fetch(`${targetUrl}/audio-alerts/config/app-settings`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function saveAllRolePermissions(permissions) {
  const res = await fetch(`${targetUrl}/roles/permissions`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(permissions),
  });
  return res.json();
}
