import { targetUrl } from "../../../config";

export async function getAnalytics(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  const res = await fetch(`${targetUrl}/audio-alerts/analytics${params ? `?${params}` : ""}`, { credentials: "include" });
  return res.json();
}
