import { generateUUID } from "../utils/formatters";

const daysAgo = (d) => new Date(Date.now() - d * 86400 * 1000).toISOString();

export let MOCK_CLIPS = [
  {
    id: "clip-001",
    name: "Moisture High — EN",
    alert_code: "MOIST_HIGH",
    language: "EN",
    language_label: "English",
    duration_sec: 5,
    file_size: 42000,
    format: "WAV",
    upload_date: daysAgo(30),
    uploaded_by: "admin",
    description: "Attention. Moisture content is high. Please check sand mulling system.",
  },
  {
    id: "clip-002",
    name: "Volatile Matter High — EN",
    alert_code: "VM_HIGH",
    language: "EN",
    language_label: "English",
    duration_sec: 6,
    file_size: 50000,
    format: "WAV",
    upload_date: daysAgo(28),
    uploaded_by: "admin",
    description: "Warning. Volatile matter above threshold. Reduce coal dust addition.",
  },
  {
    id: "clip-003",
    name: "Coal Dust Low — EN",
    alert_code: "COAL_LOW",
    language: "EN",
    language_label: "English",
    duration_sec: 4,
    file_size: 36000,
    format: "MP3",
    upload_date: daysAgo(25),
    uploaded_by: "engineer1",
    description: "Coal dust level is low. Check additive hopper.",
  },
  {
    id: "clip-004",
    name: "Permeability Advisory — EN",
    alert_code: "PERM_WARN",
    language: "EN",
    language_label: "English",
    duration_sec: 7,
    file_size: 58000,
    format: "WAV",
    upload_date: daysAgo(22),
    uploaded_by: "admin",
    description: "Advisory: Permeability trending low. Monitor sand preparation parameters.",
  },
  {
    id: "clip-005",
    name: "LOI Warning — EN",
    alert_code: "LOI_WARN",
    language: "EN",
    language_label: "English",
    duration_sec: 5,
    file_size: 44000,
    format: "WAV",
    upload_date: daysAgo(20),
    uploaded_by: "engineer1",
    description: "Loss on ignition above recommended value. Check coal dust quality.",
  },
  {
    id: "clip-006",
    name: "Moisture High — HI",
    alert_code: "MOIST_HIGH",
    language: "HI",
    language_label: "Hindi",
    duration_sec: 6,
    file_size: 52000,
    format: "WAV",
    upload_date: daysAgo(18),
    uploaded_by: "admin",
    description: "ध्यान दें। नमी की मात्रा अधिक है। कृपया रेत मलिंग प्रणाली जांचें।",
  },
  {
    id: "clip-007",
    name: "Compactability Critical — TA",
    alert_code: "CMP_CRIT_LOW",
    language: "TA",
    language_label: "Tamil",
    duration_sec: 7,
    file_size: 62000,
    format: "WAV",
    upload_date: daysAgo(15),
    uploaded_by: "admin",
    description: "கவனம். கம்பாக்டபிலிட்டி மிகவும் குறைவாக உள்ளது. நீர் சேர்க்கையை உடனடியாக சரிபார்க்கவும்.",
  },
  {
    id: "clip-008",
    name: "General Alert — MR",
    alert_code: "GENERAL",
    language: "MR",
    language_label: "Marathi",
    duration_sec: 5,
    file_size: 46000,
    format: "WAV",
    upload_date: daysAgo(10),
    uploaded_by: "admin",
    description: "सावधान. प्रक्रिया पॅरामीटर मर्यादेबाहेर आहे. कृपया तत्काळ तपासा.",
  },
];

export let MOCK_TTS_TEMPLATES = [
  {
    id: "tpl-001",
    name: "Critical Alert Template",
    language: "EN",
    voice: "female",
    tone: "urgent",
    body: "Attention. {alert_code} — {message} in {zone}. Current value: {trigger_value} {unit}. Please take immediate corrective action.",
    variables: ["alert_code", "message", "zone", "trigger_value", "unit"],
    created_by: "admin",
    created_at: new Date(Date.now() - 45 * 86400 * 1000).toISOString(),
  },
  {
    id: "tpl-002",
    name: "Process Warning Template",
    language: "EN",
    voice: "male",
    tone: "calm",
    body: "Process warning. {parameter} in {zone} is {trigger_value} {unit}, below target of {threshold} {unit}. Please check.",
    variables: ["parameter", "zone", "trigger_value", "unit", "threshold"],
    created_by: "admin",
    created_at: new Date(Date.now() - 40 * 86400 * 1000).toISOString(),
  },
  {
    id: "tpl-003",
    name: "Advisory Template",
    language: "EN",
    voice: "male",
    tone: "calm",
    body: "Advisory: {parameter} reading is {trigger_value} {unit} in {zone}. Monitor and adjust as needed.",
    variables: ["parameter", "trigger_value", "unit", "zone"],
    created_by: "engineer1",
    created_at: new Date(Date.now() - 35 * 86400 * 1000).toISOString(),
  },
  {
    id: "tpl-004",
    name: "Hindi Process Warning",
    language: "HI",
    voice: "female",
    tone: "calm",
    body: "चेतावनी। {zone} में {parameter} का मूल्य {trigger_value} {unit} है। कृपया जांचें।",
    variables: ["zone", "parameter", "trigger_value", "unit"],
    created_by: "admin",
    created_at: new Date(Date.now() - 28 * 86400 * 1000).toISOString(),
  },
  {
    id: "tpl-005",
    name: "Tamil Critical Alert",
    language: "TA",
    voice: "female",
    tone: "urgent",
    body: "கவனம்! {zone} இல் {parameter} மதிப்பு {trigger_value} {unit} ஆக உள்ளது. உடனடி நடவடிக்கை எடுக்கவும்.",
    variables: ["zone", "parameter", "trigger_value", "unit"],
    created_by: "admin",
    created_at: new Date(Date.now() - 20 * 86400 * 1000).toISOString(),
  },
  {
    id: "tpl-006",
    name: "Shift Handover Notice",
    language: "EN",
    voice: "male",
    tone: "calm",
    body: "Shift handover notice. {shift} shift starting at {zone}. Current status: {message}.",
    variables: ["shift", "zone", "message"],
    created_by: "admin",
    created_at: new Date(Date.now() - 10 * 86400 * 1000).toISOString(),
  },
];

export function addMockClip(clip) {
  const newClip = { ...clip, id: generateUUID(), upload_date: new Date().toISOString() };
  MOCK_CLIPS = [newClip, ...MOCK_CLIPS];
  return newClip;
}

export function deleteMockClip(id) {
  MOCK_CLIPS = MOCK_CLIPS.filter((c) => c.id !== id);
}

export function addMockTemplate(tpl) {
  const newTpl = { ...tpl, id: generateUUID(), created_at: new Date().toISOString() };
  MOCK_TTS_TEMPLATES = [newTpl, ...MOCK_TTS_TEMPLATES];
  return newTpl;
}

export function deleteMockTemplate(id) {
  MOCK_TTS_TEMPLATES = MOCK_TTS_TEMPLATES.filter((t) => t.id !== id);
}
