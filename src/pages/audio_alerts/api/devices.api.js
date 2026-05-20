import { targetUrl } from "../../../config";

// ── Devices ────────────────────────────────────────────────────

export async function getDevices(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(`${targetUrl}/audio-alerts/devices${params ? `?${params}` : ""}`, { credentials: "include" });
  return res.json();
}

export async function getDevice(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/devices/${id}`, { credentials: "include" });
  return res.json();
}

export async function testFireDevice(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/devices/${id}/test-fire`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function restartDevice(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/devices/${id}/restart`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function addDevice(device) {
  const res = await fetch(`${targetUrl}/audio-alerts/devices`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(device),
  });
  return res.json();
}

// ── Plants ─────────────────────────────────────────────────────

export async function getPlants() {
  const res = await fetch(`${targetUrl}/audio-alerts/plants`, { credentials: "include" });
  return res.json();
}

export async function createPlant(plant) {
  const res = await fetch(`${targetUrl}/audio-alerts/plants`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plant),
  });
  return res.json();
}

export async function updatePlant(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/plants/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deletePlant(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/plants/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

// ── Lines ──────────────────────────────────────────────────────

export async function getLines(plant_id) {
  const url = plant_id
    ? `${targetUrl}/audio-alerts/lines?plant_id=${plant_id}`
    : `${targetUrl}/audio-alerts/lines`;
  const res = await fetch(url, { credentials: "include" });
  return res.json();
}

export async function createLine(line) {
  const res = await fetch(`${targetUrl}/audio-alerts/lines`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line),
  });
  return res.json();
}

export async function updateLine(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/lines/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteLine(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/lines/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

// ── Zones ──────────────────────────────────────────────────────

export async function getZones(filters = {}) {
  const params = new URLSearchParams();
  if (filters.plant_id) params.set("plant_id", filters.plant_id);
  if (filters.line_id)  params.set("line_id",  filters.line_id);
  const qs  = params.toString();
  const res = await fetch(`${targetUrl}/audio-alerts/zones${qs ? "?" + qs : ""}`, { credentials: "include" });
  return res.json();
}

export async function createZone(zone) {
  const res = await fetch(`${targetUrl}/audio-alerts/zones`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(zone),
  });
  return res.json();
}

export async function updateZone(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/zones/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteZone(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/zones/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

// ── Combined structure (plants + lines + zones) ────────────────

export async function getStructure() {
  const res = await fetch(`${targetUrl}/audio-alerts/structure`, { credentials: "include" });
  return res.json();
}
