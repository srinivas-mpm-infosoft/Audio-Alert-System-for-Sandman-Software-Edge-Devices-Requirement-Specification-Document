import React from "react";
import { Bell, Zap, UserCheck, Smartphone, FileText } from "lucide-react";

const STEP_DEFAULTS = [
  { step: 1, action: "repeat",            label: "Repeat audio",      icon: Bell,       interval_sec: 30  },
  { step: 2, action: "repeat_faster",     label: "Faster repeat",     icon: Zap,        interval_sec: 15  },
  { step: 3, action: "notify_supervisor", label: "Notify supervisor",  icon: UserCheck,  interval_sec: 60  },
  { step: 4, action: "mobile_push",       label: "Mobile push",       icon: Smartphone, interval_sec: 120 },
  { step: 5, action: "log_only",          label: "Log & escalate",    icon: FileText,   interval_sec: 0   },
];

export default function EscalationEditor({ steps, onChange, zoneUsers = [] }) {
  const getStep = (n) => steps.find((s) => s.step === n) ?? STEP_DEFAULTS[n - 1];

  const updateStep = (n, patch) => {
    const updated = STEP_DEFAULTS.map((def) => {
      const current = getStep(def.step);
      return def.step === n ? { ...current, ...patch } : current;
    });
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Configure the 5-step escalation chain. Each step triggers if the alert remains unacknowledged after the specified interval.</p>
      {STEP_DEFAULTS.map((def) => {
        const Icon = def.icon;
        const current = getStep(def.step);
        const isLast = def.step === 5;
        const isSupervisor = def.action === "notify_supervisor";
        return (
          <div key={def.step} className={`p-3 bg-slate-50 rounded-lg border border-slate-100 ${isSupervisor ? "flex-col gap-3" : ""} flex gap-3`}>
            <div className="flex items-center gap-3 flex-1">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center">
                <Icon size={13} className="text-indigo-600" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700">Step {def.step}: {def.label}</p>
                {!isLast && (
                  <p className="text-xs text-slate-400">After step {def.step - 1 || 1} trigger</p>
                )}
              </div>
              {!isLast && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <label htmlFor={`step-${def.step}-interval`} className="text-xs text-slate-500">Wait</label>
                  <input
                    id={`step-${def.step}-interval`}
                    type="number" min={5} max={3600}
                    value={current.interval_sec ?? def.interval_sec}
                    onChange={(e) => updateStep(def.step, { interval_sec: +e.target.value })}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700 w-20"
                    aria-label={`Step ${def.step} interval in seconds`}
                  />
                  <span className="text-xs text-slate-400">sec</span>
                </div>
              )}
              {isLast && <span className="text-xs text-slate-400 italic">Automatic</span>}
            </div>

            {/* Supervisor picker — shown when zone users are available */}
            {isSupervisor && zoneUsers.length > 0 && (
              <div className="ml-10 flex items-center gap-2">
                <label htmlFor="supervisor-pick" className="text-xs text-slate-500 whitespace-nowrap">Notify:</label>
                <select
                  id="supervisor-pick"
                  value={current.supervisor_id ?? ""}
                  onChange={(e) => updateStep(def.step, { supervisor_id: e.target.value || null })}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 text-slate-700 flex-1"
                >
                  <option value="">Any available supervisor</option>
                  {zoneUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} — {u.role.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
