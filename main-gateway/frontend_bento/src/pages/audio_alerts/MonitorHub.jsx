import { useState } from "react";
import { Activity, FileText } from "lucide-react";
import LiveMonitor from "./LiveMonitor";
import LogsAudit from "./LogsAudit";
import TabStrip from "./components/TabStrip";
import { useCan } from "./hooks/useCan";
import { AccessDenied } from "./components/EmptyState";

const TABS = [
  { key: "live", label: "Live", icon: Activity, perm: "aa.live.view", Component: LiveMonitor },
  { key: "logs", label: "Logs", icon: FileText, perm: "aa.logs.view", Component: LogsAudit },
];

export default function MonitorHub() {
  const canLive = useCan(TABS[0].perm);
  const canLogs = useCan(TABS[1].perm);
  const allowed = TABS.filter((t) => (t.key === "live" ? canLive : canLogs));
  const [active, setActive] = useState(null);

  if (!allowed.length) return <AccessDenied resource="Monitor" />;

  const activeKey = allowed.some((t) => t.key === active) ? active : allowed[0].key;
  const ActiveComponent = allowed.find((t) => t.key === activeKey).Component;

  return (
    <div className="flex flex-col gap-4">
      <TabStrip tabs={allowed} active={activeKey} onChange={setActive} />
      <ActiveComponent />
    </div>
  );
}
