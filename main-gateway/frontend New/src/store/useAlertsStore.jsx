import { create } from "zustand";

function alertKey(a) {
  return a.alert_id ?? a.id;
}

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

  setAlerts: (alertsOrObj) => {
    // Accept either a plain array or the {alerts, stats, engine} shape from /audio-alerts/active
    let alerts, stats;
    if (Array.isArray(alertsOrObj)) {
      alerts = alertsOrObj;
      stats  = null;
    } else {
      alerts = alertsOrObj.alerts ?? [];
      stats  = alertsOrObj.stats ?? null;
    }

    const active   = alerts.filter((a) => a.status === "Active");
    const critical = active.filter((a) => a.priority === "CRITICAL");
    // ack_time (mock) or ack_at (DB) — either indicates it has been acknowledged
    const unacked  = active.filter((a) => a.ack_required && !a.ack_time && !a.ack_at);
    const playing  = active.find((a) => a.playback_status === "playing") ?? null;

    set({
      alerts,
      activeCount:   stats?.active   ?? active.length,
      criticalCount: stats?.critical ?? critical.length,
      unackedCount:  stats?.unacked  ?? unacked.length,
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
      alertKey(a) === alert_id
        ? { ...a, status: "Acknowledged", ack_time: new Date().toISOString(), ack_at: new Date().toISOString() }
        : a
    );
    get().setAlerts(updated);
  },

  setSystemStatus: ({ speakers_up, speakers_total, gateways_up, gateways_total, engine_status, last_sync } = {}) => {
    set({
      speakersUp:    speakers_up    ?? 0,
      speakersTotal: speakers_total ?? 0,
      gatewaysUp:    gateways_up    ?? 0,
      gatewaysTotal: gateways_total ?? 0,
      engineStatus:  engine_status  ?? "unknown",
      lastSync:      last_sync      ?? null,
    });
  },
}));
