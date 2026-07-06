import { useEffect, useRef } from "react";
import { targetUrl } from "../../../config";

function wsUrl(path) {
  if (/^https?:\/\//i.test(targetUrl)) return targetUrl.replace(/^http/i, "ws") + path;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${targetUrl}${path}`;
}

// A single shared WebSocket serves every component that calls
// useDashboardEvents() — avoids opening one connection per widget for a
// feed everyone on the page wants (device_status, announcement,
// paging_session, sop_execution events pushed from events_bus.py).
let sharedSocket = null;
let reconnectTimer = null;
const listeners = new Set();

function ensureSocket() {
  if (sharedSocket && (sharedSocket.readyState === WebSocket.OPEN || sharedSocket.readyState === WebSocket.CONNECTING)) return;
  const ws = new WebSocket(wsUrl("/audio-alerts/dashboard/ws"));
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      listeners.forEach((fn) => { try { fn(data); } catch { /* ignore */ } });
    } catch { /* ignore non-JSON frames */ }
  };
  ws.onclose = () => {
    sharedSocket = null;
    if (listeners.size > 0 && !reconnectTimer) {
      reconnectTimer = setTimeout(() => { reconnectTimer = null; ensureSocket(); }, 3000);
    }
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  sharedSocket = ws;
}

/** Subscribe to real-time dashboard events. onEvent(event) fires for every
 * push from the backend — filter by event.type in the caller. */
export function useDashboardEvents(onEvent) {
  const cbRef = useRef(onEvent);
  useEffect(() => { cbRef.current = onEvent; });

  useEffect(() => {
    const listener = (data) => cbRef.current?.(data);
    listeners.add(listener);
    ensureSocket();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && sharedSocket) {
        sharedSocket.close();
        sharedSocket = null;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }
    };
  }, []);
}
