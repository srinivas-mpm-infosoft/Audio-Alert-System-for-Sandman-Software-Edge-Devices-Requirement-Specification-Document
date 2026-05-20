import { generateUUID } from "../utils/formatters";

const now = new Date();
const daysAgo = (d) => new Date(now - d * 86400 * 1000).toISOString();
const hrAgo = (h) => new Date(now - h * 3600 * 1000).toISOString();

export let MOCK_USERS = [
  {
    id: "u001",
    username: "superadmin",
    role: "administrator",
    plant_scope: ["plant-1", "plant-2", "plant-3"],
    line_scope: [],
    zone_scope: [],
    shift_scope: ["Morning", "Afternoon", "Night"],
    last_login: hrAgo(1),
    status: "Active",
    created_at: daysAgo(365),
  },
  {
    id: "u002",
    username: "admin",
    role: "plant_manager",
    plant_scope: ["plant-1", "plant-2"],
    line_scope: [],
    zone_scope: [],
    shift_scope: ["Morning", "Afternoon", "Night"],
    last_login: hrAgo(3),
    status: "Active",
    created_at: daysAgo(200),
  },
  {
    id: "u003",
    username: "engineer1",
    role: "process_engineer",
    plant_scope: ["plant-1"],
    line_scope: ["l1-1", "l1-2"],
    zone_scope: [],
    shift_scope: ["Morning", "Afternoon"],
    last_login: hrAgo(5),
    status: "Active",
    created_at: daysAgo(150),
  },
  {
    id: "u004",
    username: "supervisor1",
    role: "shift_supervisor",
    plant_scope: ["plant-1"],
    line_scope: ["l1-1"],
    zone_scope: ["z002", "z003", "z004"],
    shift_scope: ["Morning"],
    last_login: daysAgo(1),
    status: "Active",
    created_at: daysAgo(120),
  },
  {
    id: "u005",
    username: "operator1",
    role: "operator",
    plant_scope: ["plant-1"],
    line_scope: ["l1-1"],
    zone_scope: ["z002", "z003"],
    shift_scope: ["Morning"],
    last_login: hrAgo(2),
    status: "Active",
    created_at: daysAgo(90),
  },
  {
    id: "u006",
    username: "operator2",
    role: "operator",
    plant_scope: ["plant-2"],
    line_scope: ["l2-1"],
    zone_scope: ["z009", "z010"],
    shift_scope: ["Afternoon"],
    last_login: daysAgo(2),
    status: "Active",
    created_at: daysAgo(85),
  },
  {
    id: "u007",
    username: "tech1",
    role: "maintenance_technician",
    plant_scope: ["plant-1", "plant-2"],
    line_scope: [],
    zone_scope: [],
    shift_scope: ["Morning", "Afternoon", "Night"],
    last_login: daysAgo(3),
    status: "Active",
    created_at: daysAgo(60),
  },
  {
    id: "u008",
    username: "auditor1",
    role: "auditor",
    plant_scope: ["plant-1", "plant-2", "plant-3"],
    line_scope: [],
    zone_scope: [],
    shift_scope: ["Morning", "Afternoon", "Night"],
    last_login: daysAgo(7),
    status: "Active",
    created_at: daysAgo(45),
  },
];

export let MOCK_SECURITY = {
  password_min_length: 8,
  password_complexity: true,
  password_rotation_days: 90,
  password_history_count: 5,
  mfa_required: { administrator: true, plant_manager: false, process_engineer: false, shift_supervisor: false, operator: false, maintenance_technician: false, auditor: false },
  session_timeout_min: { administrator: 480, plant_manager: 480, process_engineer: 480, shift_supervisor: 60, operator: 30, maintenance_technician: 60, auditor: 480 },
  ip_allowlist: ["192.168.1.0/24", "192.168.2.0/24"],
  api_tokens: [
    { id: "tok-001", name: "Gateway-P1L1 Token", created_at: daysAgo(30), last_used: hrAgo(1), status: "Active" },
    { id: "tok-002", name: "Gateway-P2L1 Token", created_at: daysAgo(20), last_used: hrAgo(2), status: "Active" },
    { id: "tok-003", name: "Gateway-P3L1 Token (revoked)", created_at: daysAgo(90), last_used: daysAgo(10), status: "Revoked" },
  ],
};

export function addMockUser(user) {
  const newUser = { ...user, id: generateUUID(), created_at: new Date().toISOString() };
  MOCK_USERS = [newUser, ...MOCK_USERS];
  return newUser;
}

export function updateMockUser(id, updates) {
  MOCK_USERS = MOCK_USERS.map((u) => (u.id === id ? { ...u, ...updates } : u));
}

export function deleteMockUser(id) {
  MOCK_USERS = MOCK_USERS.filter((u) => u.id !== id);
}
