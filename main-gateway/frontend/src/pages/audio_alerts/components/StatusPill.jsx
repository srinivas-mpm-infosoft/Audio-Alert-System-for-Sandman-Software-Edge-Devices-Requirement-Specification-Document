import React from "react";

const STATUS_MAP = {
  online:   { bg: "#dcfce7", text: "#15803d", dot: "#22c55e", label: "Online" },
  offline:  { bg: "#fee2e2", text: "#b91c1c", dot: "#ef4444", label: "Offline" },
  fault:    { bg: "#ffedd5", text: "#c2410c", dot: "#f97316", label: "Fault" },
  Active:   { bg: "#dcfce7", text: "#15803d", dot: "#22c55e", label: "Active" },
  Disabled: { bg: "#f1f5f9", text: "#64748b", dot: "#94a3b8", label: "Disabled" },
  Draft:    { bg: "#fef9c3", text: "#a16207", dot: "#eab308", label: "Draft" },
  "Test Mode": { bg: "#ede9fe", text: "#6d28d9", dot: "#7c3aed", label: "Test Mode" },
  running:  { bg: "#dcfce7", text: "#15803d", dot: "#22c55e", label: "Running" },
  stopped:  { bg: "#fee2e2", text: "#b91c1c", dot: "#ef4444", label: "Stopped" },
  unknown:  { bg: "#f1f5f9", text: "#64748b", dot: "#94a3b8", label: "Unknown" },
};

export default function StatusPill({ status }) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.unknown;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: cfg.bg, color: cfg.text }}
      aria-label={`Status: ${cfg.label}`}
    >
      <span className="rounded-full" style={{ width: 6, height: 6, background: cfg.dot }} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}
