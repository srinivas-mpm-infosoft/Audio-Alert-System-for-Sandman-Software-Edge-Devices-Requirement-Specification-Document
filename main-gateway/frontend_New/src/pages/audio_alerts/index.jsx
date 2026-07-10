import React, { useEffect, useState } from "react";
import { Volume2, Cpu, Clock } from "lucide-react";
import { getAudioAlertConfig } from "./api/alerts.api";
import { useAlertsStore } from "../../store/useAlertsStore";

import MonitorHub from "./MonitorHub";
import SendAlertHub from "./SendAlertHub";
import SetupHub from "./SetupHub";
import { formatTimestamp } from "./utils/formatters";
import { useCan } from "./hooks/useCan";
import { AccessDenied } from "./components/EmptyState";

// access tab removed — User Management is now a top-level gateway page
// Monitor / Send Alert / Setup each combine several formerly-separate pages
// behind an internal tab strip — see MonitorHub/SendAlertHub/SetupHub.jsx.
// Permission gating happens inside each hub (per inner tab), not here.
const SUB_TAB_MAP = {
  monitor: MonitorHub,
  send:    SendAlertHub,
  setup:   SetupHub,
};

export default function AudioAlerts({ subTab = "monitor", user }) {
  const { gatewaysUp, gatewaysTotal, lastSync, setSystemStatus } = useAlertsStore();
  const [configLoaded, setConfigLoaded] = useState(false);
  const canViewLive = useCan("aa.live.view");

  useEffect(() => {
    getAudioAlertConfig().then((res) => {
      if (res.ok) setSystemStatus(res.data.engine);
      setConfigLoaded(true);
    });
  }, [setSystemStatus]);

  const PageComponent = SUB_TAB_MAP[subTab] ?? MonitorHub;
  const canAccess = true; // each hub gates its own inner tabs by permission

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
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">

          {lastSync && (
            <>
              <div className="h-4 w-px bg-slate-200" aria-hidden="true" />
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <Clock size={11} aria-hidden="true" />
                <span>Synced {formatTimestamp(lastSync)}</span>
              </div>
            </>
          )}
        </div>
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
