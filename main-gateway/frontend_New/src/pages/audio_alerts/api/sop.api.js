import { targetUrl } from "../../../config";

export async function getSops() {
  const res = await fetch(`${targetUrl}/audio-alerts/sops`, { credentials: "include" });
  return res.json();
}

export async function getSop(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/${id}`, { credentials: "include" });
  return res.json();
}

export async function createSop(sop) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sop),
  });
  return res.json();
}

export async function updateSop(id, updates) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/${id}`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function deleteSop(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/${id}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

export async function deleteSopStep(sopId, stepId) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/${sopId}/steps/${stepId}`, { method: "DELETE", credentials: "include" });
  return res.json();
}

export async function startSop(id) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/${id}/start`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function getSopExecutions(activeOnly = false, limit = 50) {
  const params = new URLSearchParams({ ...(activeOnly ? { active: "1" } : {}), limit });
  const res = await fetch(`${targetUrl}/audio-alerts/sops/executions?${params}`, { credentials: "include" });
  return res.json();
}

export async function getSopExecution(executionId) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/executions/${executionId}`, { credentials: "include" });
  return res.json();
}

export async function getSopExecutionAudit(executionId) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/executions/${executionId}/audit`, { credentials: "include" });
  return res.json();
}

export async function acknowledgeSopStep(executionId) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/executions/${executionId}/acknowledge`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function cancelSopExecution(executionId) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/executions/${executionId}/cancel`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function repeatSopStep(executionId) {
  const res = await fetch(`${targetUrl}/audio-alerts/sops/executions/${executionId}/repeat`, { method: "POST", credentials: "include" });
  return res.json();
}
