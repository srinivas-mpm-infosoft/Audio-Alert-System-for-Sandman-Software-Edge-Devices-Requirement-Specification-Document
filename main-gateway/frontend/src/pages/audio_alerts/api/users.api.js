import { targetUrl } from "../../../config";

export async function getUsers() {
  const res = await fetch(`${targetUrl}/audio-alerts/users`, { credentials: "include" });
  return res.json();
}

export async function createUser(user) {
  const res = await fetch(`${targetUrl}/audio-alerts/users`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  return res.json();
}

export async function updateUser(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/users/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteUser(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/users/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

export async function getSecuritySettings() {
  const res = await fetch(`${targetUrl}/audio-alerts/security`, { credentials: "include" });
  return res.json();
}

export async function updateSecuritySettings(settings) {
  const res = await fetch(`${targetUrl}/audio-alerts/security`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return res.json();
}
