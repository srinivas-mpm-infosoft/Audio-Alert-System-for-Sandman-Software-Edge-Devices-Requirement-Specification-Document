import { useEffect, useRef, useCallback } from "react";
import { useAlertsStore } from "../../../store/useAlertsStore";
import { getActiveAlerts, getAudioAlertConfig } from "../api/alerts.api";
import { generateRandomAlert } from "../mocks/alerts.mock";

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const POLL_INTERVAL = 3000;
const MOCK_NEW_ALERT_MIN_MS = 8000;
const MOCK_NEW_ALERT_MAX_MS = 20000;

export function useAlerts() {
  const { setAlerts, addAlert, setSystemStatus } = useAlertsStore();
  const pollRef = useRef(null);
  const wsRef = useRef(null);
  const mockTimerRef = useRef(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await getActiveAlerts();
      if (res.ok) setAlerts(res.data);

      const configRes = await getAudioAlertConfig();
      if (configRes.ok) setSystemStatus(configRes.data);
    } catch {
      // silent — polling will retry
    }
  }, [setAlerts, setSystemStatus]);

  const scheduleMockAlert = useCallback(() => {
    const ms = MOCK_NEW_ALERT_MIN_MS + Math.random() * (MOCK_NEW_ALERT_MAX_MS - MOCK_NEW_ALERT_MIN_MS);
    mockTimerRef.current = setTimeout(() => {
      const alert = generateRandomAlert();
      addAlert(alert);
      scheduleMockAlert();
    }, ms);
  }, [addAlert]);

  useEffect(() => {
    fetchAlerts();

    if (!USE_MOCKS) {
      try {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const host = window.location.hostname;
        const port = 8000;
        const ws = new WebSocket(`${protocol}://${host}:${port}/audio-alerts/stream`);
        ws.onmessage = (ev) => {
          try {
            const alert = JSON.parse(ev.data);
            addAlert(alert);
          } catch {}
        };
        ws.onerror = () => {
          ws.close();
          pollRef.current = setInterval(fetchAlerts, POLL_INTERVAL);
        };
        wsRef.current = ws;
      } catch {
        pollRef.current = setInterval(fetchAlerts, POLL_INTERVAL);
      }
    } else {
      pollRef.current = setInterval(fetchAlerts, POLL_INTERVAL);
      scheduleMockAlert();
    }

    return () => {
      clearInterval(pollRef.current);
      clearTimeout(mockTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchAlerts, addAlert, scheduleMockAlert]);
}
