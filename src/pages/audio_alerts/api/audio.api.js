import { targetUrl } from "../../../config";

// ── Clips ──────────────────────────────────────────────────────

export async function getClips(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(`${targetUrl}/audio-alerts/audio/clips${params ? `?${params}` : ""}`, { credentials: "include" });
  return res.json();
}

// file: File object or null; if null → sends JSON metadata only
export async function uploadClip(clipData, file) {
  if (file) {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(clipData).forEach(([k, v]) => fd.append(k, v));
    const res = await fetch(`${targetUrl}/audio-alerts/audio/clips`, { method: "POST", credentials: "include", body: fd });
    return res.json();
  }
  const res = await fetch(`${targetUrl}/audio-alerts/audio/clips`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clipData),
  });
  return res.json();
}

export async function updateClip(id, updates, file) {
  if (file) {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(updates).forEach(([k, v]) => {
      if (v !== null && v !== undefined) fd.append(k, v);
    });
    const res = await fetch(`${targetUrl}/audio-alerts/audio/clips/${id}`, {
      method: "PUT", credentials: "include", body: fd,
    });
    return res.json();
  }
  const res = await fetch(`${targetUrl}/audio-alerts/audio/clips/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteClip(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/audio/clips/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

// ── TTS Templates ──────────────────────────────────────────────

export async function getTemplates(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(`${targetUrl}/audio-alerts/audio/templates${params ? `?${params}` : ""}`, { credentials: "include" });
  return res.json();
}

export async function createTemplate(tpl) {
  const res = await fetch(`${targetUrl}/audio-alerts/audio/templates`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tpl),
  });
  return res.json();
}

export async function updateTemplate(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/audio/templates/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteTemplate(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/audio/templates/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

// ── Audio Config ───────────────────────────────────────────────

export async function saveAudioConfig(config) {
  const res = await fetch(`${targetUrl}/audio-alerts/config/audio`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  return res.json();
}

// ── Preview ────────────────────────────────────────────────────

export async function previewAudio(payload) {
  const res = await fetch(`${targetUrl}/audio-alerts/audio/preview`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}
