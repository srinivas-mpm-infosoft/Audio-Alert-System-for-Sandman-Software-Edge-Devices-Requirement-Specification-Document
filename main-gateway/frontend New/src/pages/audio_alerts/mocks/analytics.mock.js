// 30 days of synthetic analytics data
const DAYS = 30;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function seeded(seed, min, max) {
  const x = Math.sin(seed) * 10000;
  const r = x - Math.floor(x);
  return Math.floor(r * (max - min + 1)) + min;
}

const ALERT_CODES = ["CMP_CRIT_LOW", "MOIST_HIGH", "BENT_LOW", "SAND_TEMP_HIGH", "PERM_WARN", "GFN_OOR", "MOULD_HARD_LOW", "COAL_LOW", "CLAY_WARN", "VM_HIGH"];
const ZONES = ["Moulding-A", "Mulling-1", "Cooling-1", "Sand Prep-1", "Melting-1", "Pouring-1"];
const SHIFTS = ["Morning", "Afternoon", "Night"];
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function generateDailyData() {
  const days = [];
  const now = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    days.push({
      date: dateStr,
      total: seeded(i * 7, 8, 35),
      CRITICAL: seeded(i * 3, 0, 5),
      HIGH: seeded(i * 5, 2, 8),
      MEDIUM: seeded(i * 11, 3, 12),
      LOW: seeded(i * 13, 1, 10),
    });
  }
  return days;
}

export function generateShiftData() {
  return SHIFTS.map((shift, si) => ({
    shift,
    total: seeded(si * 31, 20, 60),
    CRITICAL: seeded(si * 7, 2, 8),
    HIGH: seeded(si * 11, 5, 15),
    MEDIUM: seeded(si * 17, 8, 20),
    LOW: seeded(si * 23, 3, 12),
  }));
}

export function generateAlertFrequency() {
  return ALERT_CODES.map((code, i) => ({
    alert_code: code,
    count: seeded(i * 41, 5, 80),
    last_triggered: new Date(Date.now() - seeded(i * 13, 1, 72) * 3600 * 1000).toISOString(),
  })).sort((a, b) => b.count - a.count);
}

export function generateResponseTimes() {
  return SHIFTS.map((shift, si) => ({
    shift,
    avg_ack_sec: seeded(si * 29, 45, 300),
    p95_ack_sec: seeded(si * 37, 120, 600),
    CRITICAL: seeded(si * 11, 20, 90),
    HIGH: seeded(si * 17, 40, 180),
    MEDIUM: seeded(si * 23, 60, 240),
    LOW: seeded(si * 31, 90, 360),
  }));
}

export function generateDeviceUptime() {
  return [
    { device_id: "gw-001", name: "Gateway-P1L1", uptime_pct: 99.8, downtime_min: 9 },
    { device_id: "gw-002", name: "Gateway-P2L1", uptime_pct: 98.2, downtime_min: 78 },
    { device_id: "gw-003", name: "Gateway-P3L1", uptime_pct: 82.4, downtime_min: 762 },
    { device_id: "spk-001", name: "Speaker-P1-Moulding-A", uptime_pct: 99.9, downtime_min: 2 },
    { device_id: "spk-002", name: "Speaker-P1-Mulling-1", uptime_pct: 97.6, downtime_min: 104 },
    { device_id: "spk-003", name: "Speaker-P1-Cooling-1", uptime_pct: 94.1, downtime_min: 254 },
    { device_id: "spk-004", name: "Speaker-P2-Melting-2", uptime_pct: 87.3, downtime_min: 546 },
    { device_id: "spk-005", name: "Speaker-P2-Moulding-C", uptime_pct: 99.5, downtime_min: 22 },
    { device_id: "spk-006", name: "Speaker-P3-Moulding-D", uptime_pct: 99.1, downtime_min: 39 },
    { device_id: "amp-001", name: "Amplifier-P1-Main", uptime_pct: 100, downtime_min: 0 },
  ].sort((a, b) => a.uptime_pct - b.uptime_pct);
}

export function generateAckSourceBreakdown() {
  return [
    { source: "Dashboard", count: 145, pct: 48 },
    { source: "Physical Button", count: 72, pct: 24 },
    { source: "Mobile", count: 54, pct: 18 },
    { source: "Auto-recovery", count: 30, pct: 10 },
  ];
}

export function generateRuleEfficacy() {
  return [
    { rule_id: "r001", rule_name: "Compactability Critical Low", total_triggers: 47, acked: 41, auto_acks: 6, avg_ack_sec: 58, efficacy: 87 },
    { rule_id: "r002", rule_name: "Moisture High Warning", total_triggers: 23, acked: 20, auto_acks: 3, avg_ack_sec: 124, efficacy: 78 },
    { rule_id: "r004", rule_name: "Return Sand Temperature High", total_triggers: 8, acked: 8, auto_acks: 0, avg_ack_sec: 32, efficacy: 96 },
    { rule_id: "r005", rule_name: "Permeability Advisory", total_triggers: 31, acked: 18, auto_acks: 13, avg_ack_sec: 245, efficacy: 52 },
    { rule_id: "r006", rule_name: "GFN Out of Range", total_triggers: 15, acked: 13, auto_acks: 2, avg_ack_sec: 98, efficacy: 81 },
    { rule_id: "r007", rule_name: "Mould Hardness Critical", total_triggers: 19, acked: 19, auto_acks: 0, avg_ack_sec: 44, efficacy: 94 },
    { rule_id: "r013", rule_name: "Sand Temperature Critical", total_triggers: 3, acked: 3, auto_acks: 0, avg_ack_sec: 28, efficacy: 98 },
  ];
}

export function generateFalseAlerts() {
  return [
    { rule_id: "r005", rule_name: "Permeability Advisory", auto_ack_count: 13, total: 31, auto_ack_pct: 42, avg_recovery_sec: 18, suggested_threshold: 115 },
    { rule_id: "r009", rule_name: "Active Clay Advisory", auto_ack_count: 4, total: 9, auto_ack_pct: 44, avg_recovery_sec: 22, suggested_threshold: 8.0 },
    { rule_id: "r014", rule_name: "Loss on Ignition Warning", auto_ack_count: 3, total: 7, auto_ack_pct: 43, avg_recovery_sec: 30, suggested_threshold: 6.5 },
  ];
}
