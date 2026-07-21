import { useState } from "react";
import { Megaphone, Mic, ListChecks, CalendarClock } from "lucide-react";
import ManualBroadcast from "./ManualBroadcast";
import LivePaging from "./LivePaging";
import Sop from "./Sop";
import Schedule from "./Schedule";
import TabStrip from "./components/TabStrip";
import { useCan } from "./hooks/useCan";
import { AccessDenied } from "./components/EmptyState";

const TABS = [
  { key: "broadcast", label: "Broadcast",     icon: Megaphone,    perm: "aa.broadcast.manual", Component: ManualBroadcast },
  { key: "paging",    label: "Live Paging",   icon: Mic,          perm: "aa.paging.use",       Component: LivePaging },
  { key: "sop",       label: "SOP Guidance",  icon: ListChecks,   perm: "aa.sop.view",         Component: Sop },
  { key: "schedule",  label: "Schedule",      icon: CalendarClock,perm: "aa.schedule.view",    Component: Schedule },
];

export default function SendAlertHub() {
  const canBroadcast = useCan(TABS[0].perm);
  const canPaging    = useCan(TABS[1].perm);
  const canSop       = useCan(TABS[2].perm);
  const canSchedule  = useCan(TABS[3].perm);
  const canByKey = { broadcast: canBroadcast, paging: canPaging, sop: canSop, schedule: canSchedule };
  const allowed = TABS.filter((t) => canByKey[t.key]);
  const [active, setActive] = useState(null);

  if (!allowed.length) return <AccessDenied resource="Send Alert" />;

  const activeKey = allowed.some((t) => t.key === active) ? active : allowed[0].key;
  const ActiveComponent = allowed.find((t) => t.key === activeKey).Component;

  return (
    <div className="flex flex-col gap-4">
      <TabStrip tabs={allowed} active={activeKey} onChange={setActive} />
      <ActiveComponent />
    </div>
  );
}
