import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle, Volume2, Wifi, Radio, Clock } from "lucide-react";
import { getAudioAlertConfig } from "./api/alerts.api";
import { useAlertsStore } from "../../store/useAlertsStore";
import StatusPill from "./components/StatusPill";

import LiveMonitor from "./LiveMonitor";
import RuleBuilder from "./RuleBuilder";
import AudioConfig from "./AudioConfig";
import DevicesZones from "./DevicesZones";
import Analytics from "./Analytics";
import LogsAudit from "./LogsAudit";
import AppSettings from "./AppSettings";
import { formatTimestamp } from "./utils/formatters";
import { useCan } from "./hooks/useCan";
import { AccessDenied } from "./components/EmptyState";

// access tab removed — User Management is now a top-level gateway page
const SUB_TAB_MAP = {
  live:      LiveMonitor,
  rules:     RuleBuilder,
  audio:     AudioConfig,
  devices:   DevicesZones,
  analytics: Analytics,
  logs:      LogsAudit,
  settings:  AppSettings,
};

export default function AudioAlerts({ subTab = "live", user }) {
  const { activeCount, criticalCount, unackedCount, speakersUp, speakersTotal, gatewaysUp, gatewaysTotal, engineStatus, lastSync, setSystemStatus } = useAlertsStore();
  const [configLoaded, setConfigLoaded] = useState(false);
  const canViewLive = useCan("aa.live.view");

  useEffect(() => {
    getAudioAlertConfig().then((res) => {
      if (res.ok) setSystemStatus(res.data);
      setConfigLoaded(true);
    });
  }, [setSystemStatus]);

  const PageComponent = SUB_TAB_MAP[subTab] ?? LiveMonitor;

  // Gate full-page access by permission
  const permMap = {
    live:      "aa.live.view",
    rules:     "aa.rules.view",
    audio:     "aa.audio.upload",
    devices:   "aa.devices.view",
    analytics: "aa.analytics.view",
    logs:      "aa.logs.view",
    settings:  "aa.users.manage",
  };
  const requiredPerm = permMap[subTab];
  const canAccess = !requiredPerm || useCan(requiredPerm);

  return (
    <div className="p-6 flex flex-col gap-4 min-h-full">
      {/* Page header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Volume2 className="h-6 w-6 text-indigo-600" aria-hidden="true" />
              Audio Alerts
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">Real-time voice and audio alerts for foundry operations</p>
          </div>
        </div>

        {/* Status strip */}
        {/* <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Engine</span>
            <StatusPill status={engineStatus === "running" ? "running" : "stopped"} />
          </div>
          <div className="h-4 w-px bg-slate-200" aria-hidden="true" />
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
              <AlertCircle size={14} aria-hidden="true" />
              <span className="text-[11px]">{criticalCount} Critical</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-600 font-medium">{unackedCount} Unacknowledged</span>
          </div>
          <div className="h-4 w-px bg-slate-200" aria-hidden="true" />
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <Volume2 size={12} aria-hidden="true" />
            <span>{speakersUp}/{speakersTotal} Speakers up</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <Wifi size={12} aria-hidden="true" />
            <span>{gatewaysUp}/{gatewaysTotal} Gateways up</span>
          </div>
          {lastSync && (
            <>
              <div className="h-4 w-px bg-slate-200" aria-hidden="true" />
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <Clock size={11} aria-hidden="true" />
                <span>Synced {formatTimestamp(lastSync)}</span>
              </div>
            </>
          )}
        </div> */}
      </div>

      {/* Page content */}
      {!canAccess ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <AccessDenied resource={subTab} />
        </div>
      ) : (
        <PageComponent user={user} />
      )}
    </div>
  );
}
