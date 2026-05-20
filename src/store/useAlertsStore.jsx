import { create } from "zustand";

export const useAlertsStore = create((set, get) => ({
  alerts: [],
  activeCount: 0,
  criticalCount: 0,
  unackedCount: 0,
  speakersUp: 0,
  speakersTotal: 0,
  gatewaysUp: 0,
  gatewaysTotal: 0,
  engineStatus: "unknown",
  lastSync: null,
  nowPlaying: null,

  setAlerts: (alerts) => {
    const active = alerts.filter((a) => a.status === "Active");
    const critical = active.filter((a) => a.priority === "CRITICAL");
    const unacked = active.filter((a) => a.ack_required && !a.ack_time);
    const playing = active.find((a) => a.playback_status === "playing") ?? null;
    set({
      alerts,
      activeCount: active.length,
      criticalCount: critical.length,
      unackedCount: unacked.length,
      nowPlaying: playing,
    });
  },

  addAlert: (alert) => {
    const current = get().alerts;
    const updated = [alert, ...current];
    get().setAlerts(updated);
  },

  ackAlert: (alert_id) => {
    const updated = get().alerts.map((a) =>
      a.alert_id === alert_id
        ? { ...a, status: "Acknowledged", ack_time: new Date().toISOString() }
        : a
    );
    get().setAlerts(updated);
  },

  setSystemStatus: ({ speakers_up, speakers_total, gateways_up, gateways_total, engine_status, last_sync }) => {
    set({
      speakersUp: speakers_up ?? 0,
      speakersTotal: speakers_total ?? 0,
      gatewaysUp: gateways_up ?? 0,
      gatewaysTotal: gateways_total ?? 0,
      engineStatus: engine_status ?? "unknown",
      lastSync: last_sync ?? null,
    });
  },
}));
