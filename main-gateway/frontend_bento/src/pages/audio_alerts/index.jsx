import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { getAudioAlertConfig } from "./api/alerts.api";
import { useAlertsStore } from "../../store/useAlertsStore";

import MonitorHub from "./MonitorHub";
import SendAlertHub from "./SendAlertHub";
import SetupHub from "./SetupHub";
import { formatTimestamp } from "./utils/formatters";
import { useCan } from "./hooks/useCan";
import { AccessDenied } from "./components/EmptyState";
import { PageHeader } from "../../components/ui/Bento";

const PAGE_COPY = {
  monitor: { title: "Monitor", desc: "Plan, track, and stay ahead of every zone alert." },
  send: { title: "Send alert", desc: "Broadcast, page, run SOPs, or schedule announcements." },
  setup: { title: "Setup", desc: "Devices, zones, alert types, audio and app configuration." },
};

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
  const copy = PAGE_COPY[subTab] ?? PAGE_COPY.monitor;

  return (
    <div className="p-7 flex flex-col gap-4 min-h-full">
      <PageHeader
        title={copy.title}
        desc={
          lastSync ? (
            <span className="inline-flex items-center gap-1.5">
              {copy.desc}
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 ml-2">
                <Clock size={11} aria-hidden="true" />
                Synced {formatTimestamp(lastSync)}
              </span>
            </span>
          ) : (
            copy.desc
          )
        }
      />

      {/* Page content */}
      {!canAccess ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <AccessDenied resource={subTab} />
        </div>
      ) : (
        <PageComponent user={user} />
      )}
    </div>
  );
}
