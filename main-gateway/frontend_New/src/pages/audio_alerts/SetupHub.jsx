import { useState } from "react";
import { Cpu, Sliders, Volume2, Settings2 } from "lucide-react";
import DevicesZones from "./DevicesZones";
import AlertTypeSettings from "./AlertTypeSettings";
import AudioConfig from "./AudioConfig";
import AppSettings from "./AppSettings";
import TabStrip from "./components/TabStrip";
import { useCan } from "./hooks/useCan";
import { AccessDenied } from "./components/EmptyState";

const TABS = [
  { key: "devices",    label: "Devices & Zones", icon: Cpu,      perm: "aa.devices.view",    Component: DevicesZones },
  { key: "alerttypes", label: "Alert Types",      icon: Sliders,  perm: "aa.alerttypes.view", Component: AlertTypeSettings },
  { key: "audio",      label: "Audio Config",     icon: Volume2,  perm: "aa.audio.upload",    Component: AudioConfig },
  { key: "settings",   label: "App Settings",     icon: Settings2,perm: "aa.users.manage",    Component: AppSettings },
];

export default function SetupHub() {
  const canDevices    = useCan(TABS[0].perm);
  const canAlertTypes = useCan(TABS[1].perm);
  const canAudio      = useCan(TABS[2].perm);
  const canSettings   = useCan(TABS[3].perm);
  const canByKey = { devices: canDevices, alerttypes: canAlertTypes, audio: canAudio, settings: canSettings };
  const allowed = TABS.filter((t) => canByKey[t.key]);
  const [active, setActive] = useState(null);

  if (!allowed.length) return <AccessDenied resource="Setup" />;

  const activeKey = allowed.some((t) => t.key === active) ? active : allowed[0].key;
  const ActiveComponent = allowed.find((t) => t.key === activeKey).Component;

  return (
    <div className="flex flex-col gap-4">
      <TabStrip tabs={allowed} active={activeKey} onChange={setActive} />
      <ActiveComponent />
    </div>
  );
}
