import React from "react";
import { PRIORITY_CONFIG } from "../utils/priorityConfig";

export default function PriorityBadge({ priority, size = "sm" }) {
  const cfg = PRIORITY_CONFIG[priority];
  if (!cfg) return null;

  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${pad}`}
      style={{ background: cfg.badgeBg, color: cfg.badgeText }}
      aria-label={`Priority: ${cfg.label}`}
    >
      <span
        className="rounded-full flex-shrink-0"
        style={{ width: 6, height: 6, background: cfg.dot }}
        aria-hidden="true"
      />
      {cfg.label}
    </span>
  );
}
