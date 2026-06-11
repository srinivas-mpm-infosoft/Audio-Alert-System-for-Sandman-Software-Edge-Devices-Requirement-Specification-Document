export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export const CATEGORIES = ["Critical", "Process Warning", "Advisory", "Information"];

export const LANGUAGES = [
  { code: "EN", label: "English", flag: "🇬🇧" },
  { code: "HI", label: "Hindi", flag: "🇮🇳" },
  { code: "TA", label: "Tamil", flag: "🇮🇳" },
  { code: "MR", label: "Marathi", flag: "🇮🇳" },
  { code: "GU", label: "Gujarati", flag: "🇮🇳" },
  { code: "TE", label: "Telugu", flag: "🇮🇳" },
];

export const ZONE_TYPES = ["Melting", "Moulding", "Mulling", "Cooling", "Sand Prep", "Pouring", "Custom"];

export const ALERT_STATUSES = ["Active", "Acknowledged", "Auto-closed"];

export const RULE_STATUSES = ["Active", "Disabled", "Draft", "Test Mode"];

export const DEVICE_TYPES = ["Edge Node"];

export const DEVICE_STATUSES = ["online", "offline", "fault"];

export const SHIFTS = ["Morning", "Afternoon", "Night"];

export const AUDIO_TYPES = ["voice", "beep", "siren", "escalation"];

export const OPERATORS = ["<", ">", "=", "≠", "between", "outside range"];

export const PARAMETERS = [
  { id: "compactability", label: "Compactability", unit: "%" },
  { id: "moisture", label: "Moisture", unit: "%" },
  { id: "return_sand_temp", label: "Return Sand Temperature", unit: "°C" },
  { id: "bentonite", label: "Bentonite Level", unit: "%" },
  { id: "coal_dust", label: "Coal Dust Level", unit: "%" },
  { id: "gfn", label: "GFN (Grain Fineness Number)", unit: "" },
  { id: "permeability", label: "Permeability", unit: "mD" },
  { id: "mould_hardness", label: "Mould Hardness", unit: "" },
  { id: "green_strength", label: "Green Compression Strength", unit: "N/cm²" },
  { id: "dry_strength", label: "Dry Compression Strength", unit: "N/cm²" },
  { id: "shear_strength", label: "Shear Strength", unit: "N/cm²" },
  { id: "volatile_matter", label: "Volatile Matter", unit: "%" },
  { id: "loss_on_ignition", label: "Loss on Ignition", unit: "%" },
  { id: "active_clay", label: "Active Clay Content", unit: "%" },
  { id: "methylene_blue", label: "Methylene Blue Value", unit: "" },
  { id: "sand_temp", label: "Sand Temperature", unit: "°C" },
  { id: "mixing_energy", label: "Mixing Energy", unit: "kJ/kg" },
  { id: "water_addition", label: "Water Addition Rate", unit: "l/min" },
  { id: "core_hardness", label: "Core Hardness", unit: "" },
  { id: "core_strength", label: "Core Strength", unit: "N/cm²" },
];

export const ROLES = [
  { id: "administrator", label: "Administrator" },
  { id: "plant_manager", label: "Plant Manager" },
  { id: "process_engineer", label: "Process Engineer" },
  { id: "shift_supervisor", label: "Shift Supervisor" },
  { id: "operator", label: "Operator" },
  { id: "maintenance_technician", label: "Maintenance Technician" },
  { id: "auditor", label: "Auditor" },
];

export const PERMISSIONS = [
  { id: "aa.live.view", label: "View live monitor", category: "Monitoring" },
  { id: "aa.alerts.ack", label: "Acknowledge alerts", category: "Monitoring" },
  { id: "aa.broadcast.manual", label: "Trigger manual broadcast", category: "Monitoring" },
  { id: "aa.rules.view", label: "View rules", category: "Rules" },
  { id: "aa.rules.edit", label: "Create / edit rules", category: "Rules" },
  { id: "aa.rules.delete", label: "Delete rules", category: "Rules" },
  { id: "aa.audio.upload", label: "Upload audio clips", category: "Audio" },
  { id: "aa.audio.delete", label: "Delete audio clips", category: "Audio" },
  { id: "aa.devices.view", label: "View devices", category: "Devices" },
  { id: "aa.devices.edit", label: "Add / remove devices", category: "Devices" },
  { id: "aa.devices.firmware", label: "Update firmware", category: "Devices" },
  { id: "aa.zones.edit", label: "Configure zones", category: "Devices" },
  { id: "aa.analytics.view", label: "View analytics", category: "Analytics" },
  { id: "aa.analytics.export", label: "Export analytics", category: "Analytics" },
  { id: "aa.logs.view", label: "View logs", category: "Logs" },
  { id: "aa.logs.export", label: "Export logs", category: "Logs" },
  { id: "aa.logs.delete", label: "Delete logs", category: "Logs" },
  { id: "aa.audit.view", label: "View audit log", category: "Logs" },
  { id: "aa.users.manage", label: "Manage users", category: "Admin" },
  { id: "aa.security.manage", label: "Change security settings", category: "Admin" },
];

export const ROLE_PERMISSIONS = {
  administrator: new Set(PERMISSIONS.map((p) => p.id)),
  plant_manager: new Set([
    "aa.live.view", "aa.alerts.ack", "aa.broadcast.manual",
    "aa.rules.view", "aa.rules.edit", "aa.rules.delete",
    "aa.audio.upload", "aa.audio.delete",
    "aa.devices.view", "aa.devices.edit", "aa.devices.firmware",
    "aa.zones.edit", "aa.analytics.view", "aa.analytics.export",
    "aa.logs.view", "aa.logs.export", "aa.audit.view",
  ]),
  process_engineer: new Set([
    "aa.live.view", "aa.alerts.ack", "aa.broadcast.manual",
    "aa.rules.view", "aa.rules.edit",
    "aa.audio.upload",
    "aa.devices.view",
    "aa.analytics.view", "aa.analytics.export",
    "aa.logs.view", "aa.logs.export",
  ]),
  shift_supervisor: new Set([
    "aa.live.view", "aa.alerts.ack", "aa.broadcast.manual",
    "aa.rules.view",
    "aa.devices.view",
    "aa.analytics.view",
    "aa.logs.view",
  ]),
  operator: new Set([
    "aa.live.view", "aa.alerts.ack",
    "aa.analytics.view",
    "aa.logs.view",
  ]),
  maintenance_technician: new Set([
    "aa.live.view",
    "aa.devices.view", "aa.devices.edit",
    "aa.analytics.view",
    "aa.logs.view",
  ]),
  auditor: new Set([
    "aa.live.view",
    "aa.analytics.view",
    "aa.logs.view",
    "aa.audit.view",
  ]),
};

export const EXISTING_ROLE_MAP = {
  superadmin: "administrator",
  admin: "plant_manager",
  user: "operator",
};
