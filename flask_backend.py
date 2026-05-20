#!/usr/bin/env python3
"""
Gateway Configuration UI — Flask Backend
config.json         → modbus / device / IO config (Admin Settings)
alerts_config.json  → all audio alerts data
system_config.json  → infrastructure defaults (DB, CORS, GPIO, paths, limits)
"""

import json
import uuid
import bcrypt
import logging
import socket
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory, session
from flask_sqlalchemy import SQLAlchemy


# ============================================================
# STATIC PATHS  (only BASE is fixed; everything else is configurable)
# ============================================================

BASE               = Path("/home/recomputer/Gateway-UI/Main Application")
STATIC             = BASE / "static"
CONFIG_FILE        = BASE / "config.json"
ALERTS_CONFIG_FILE = BASE / "alerts_config.json"
SYSTEM_CONFIG_FILE = BASE / "system_config.json"
IS_FILE_TO_DB_UPDATED = BASE / "is_file_to_db_updated.json"
UPDATES_FILE       = BASE / "updated.json"
IS_UPDATED_FILE    = BASE / "is_updated.json"
LOGGER_NAME        = "configuration_ui"

# ── role / permission constants ───────────────────────────────
VALID_ROLES = {
    "administrator", "plant_manager", "process_engineer",
    "shift_supervisor", "operator", "maintenance_technician", "auditor",
}
LEGACY_ROLE_MAP = {
    "superadmin": "administrator",
    "admin":      "plant_manager",
    "user":       "operator",
}
ALL_PERMISSIONS = [
    "aa.live.view", "aa.alerts.ack", "aa.broadcast.manual",
    "aa.rules.view", "aa.rules.edit", "aa.rules.delete",
    "aa.audio.upload", "aa.audio.delete",
    "aa.devices.view", "aa.devices.edit", "aa.devices.firmware",
    "aa.zones.edit",
    "aa.analytics.view", "aa.analytics.export",
    "aa.logs.view", "aa.logs.export", "aa.logs.delete",
    "aa.audit.view",
    "aa.users.manage", "aa.security.manage",
]
DEFAULT_ROLE_PERMISSIONS = {
    "administrator":          list(ALL_PERMISSIONS),
    "plant_manager":          [p for p in ALL_PERMISSIONS if p not in ("aa.users.manage", "aa.security.manage")],
    "process_engineer":       ["aa.live.view","aa.alerts.ack","aa.broadcast.manual","aa.rules.view","aa.rules.edit","aa.audio.upload","aa.devices.view","aa.analytics.view","aa.analytics.export","aa.logs.view","aa.logs.export"],
    "shift_supervisor":       ["aa.live.view","aa.alerts.ack","aa.broadcast.manual","aa.rules.view","aa.devices.view","aa.analytics.view","aa.logs.view"],
    "operator":               ["aa.live.view","aa.alerts.ack","aa.analytics.view","aa.logs.view"],
    "maintenance_technician": ["aa.live.view","aa.devices.view","aa.devices.edit","aa.analytics.view","aa.logs.view"],
    "auditor":                ["aa.live.view","aa.analytics.view","aa.logs.view","aa.audit.view"],
}

# ============================================================
# SYSTEM CONFIG  (system_config.json)
# ============================================================

DEFAULT_SYSTEM_CONFIG = {
    "app": {
        "server_host":          "0.0.0.0",
        "server_port":          8000,
        "log_root":             "/home/recomputer/logs",
        "session_lifetime_days": 365,
        "cookie_secure":        False,
        "cookie_samesite":      "Lax",
    },
    "database": {
        "host":     "localhost",
        "port":     3306,
        "name":     "users",
        "user":     "gateway",
        "password": "gateway",
    },
    "cors_origins": [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    "gpio_pins": {
        "Digital Output 1": 24,
        "Digital Output 2": 25,
        "Digital Output 3": 26,
        "Digital Output 4": 6,
    },
    "alerts_limits": {
        "audit_log_max":              2000,
        "alert_log_max":              2000,
        "rule_test_default_minutes":  5,
    },
}

# file-mtime cache — re-read only when the file changes on disk
_sc_cache: dict = {}
_sc_mtime: float = 0.0


def _read_sc() -> dict:
    global _sc_cache, _sc_mtime
    try:
        mt = SYSTEM_CONFIG_FILE.stat().st_mtime
        if mt > _sc_mtime:
            _sc_cache = json.loads(SYSTEM_CONFIG_FILE.read_text())
            _sc_mtime = mt
        return _sc_cache
    except Exception:
        return dict(DEFAULT_SYSTEM_CONFIG)


def _write_sc(cfg: dict):
    SYSTEM_CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    # force cache invalidation
    global _sc_mtime
    _sc_mtime = 0.0


# ── initialise system_config.json if missing ─────────────────
if not SYSTEM_CONFIG_FILE.exists():
    _write_sc(DEFAULT_SYSTEM_CONFIG)

# read once at startup (for DB URI, server port, session config)
_startup_sc = _read_sc()
_app_cfg    = _startup_sc.get("app",      DEFAULT_SYSTEM_CONFIG["app"])
_db_cfg     = _startup_sc.get("database", DEFAULT_SYSTEM_CONFIG["database"])


# ============================================================
# ALERTS CONFIG  (alerts_config.json)
# ============================================================

DEFAULT_ALERTS_CONFIG = {
    "engine": {
        "status": "running",
        "speakers_up": 0, "speakers_total": 0,
        "gateways_up": 0, "gateways_total": 0,
        "last_sync": None,
    },
    "audio_config": {
        "master_volume": 80,
        "zone_volumes": {},
        "priority_offsets": {"CRITICAL": 6, "HIGH": 0, "MEDIUM": -3, "LOW": -6},
        "audio_types": {"CRITICAL": "siren", "HIGH": "voice", "MEDIUM": "beep", "LOW": "voice"},
    },
    "rules": [], "devices": [],
    "plants": [
        {"id": "plant-1", "name": "Plant-1", "location": "Plant 1"},
        {"id": "plant-2", "name": "Plant-2", "location": "Plant 2"},
        {"id": "plant-3", "name": "Plant-3", "location": "Plant 3"},
    ],
    "lines": [
        {"id": "l1-1", "plant_id": "plant-1", "name": "Line-1"},
        {"id": "l1-2", "plant_id": "plant-1", "name": "Line-2"},
        {"id": "l2-1", "plant_id": "plant-2", "name": "Line-1"},
        {"id": "l2-2", "plant_id": "plant-2", "name": "Line-2"},
        {"id": "l3-1", "plant_id": "plant-3", "name": "Line-1"},
        {"id": "l3-2", "plant_id": "plant-3", "name": "Line-2"},
    ],
    "zones": [
        {"id": "z001", "line_id": "l1-1", "plant_id": "plant-1", "name": "Melting-1",  "type": "Melting",   "default_language": "EN"},
        {"id": "z002", "line_id": "l1-1", "plant_id": "plant-1", "name": "Moulding-A", "type": "Moulding",  "default_language": "EN"},
        {"id": "z003", "line_id": "l1-1", "plant_id": "plant-1", "name": "Mulling-1",  "type": "Mulling",   "default_language": "EN"},
        {"id": "z004", "line_id": "l1-1", "plant_id": "plant-1", "name": "Cooling-1",  "type": "Cooling",   "default_language": "EN"},
        {"id": "z005", "line_id": "l1-2", "plant_id": "plant-1", "name": "Sand Prep-1","type": "Sand Prep", "default_language": "EN"},
        {"id": "z006", "line_id": "l1-2", "plant_id": "plant-1", "name": "Pouring-1",  "type": "Pouring",   "default_language": "EN"},
        {"id": "z007", "line_id": "l2-1", "plant_id": "plant-2", "name": "Melting-2",  "type": "Melting",   "default_language": "EN"},
        {"id": "z008", "line_id": "l2-1", "plant_id": "plant-2", "name": "Moulding-C", "type": "Moulding",  "default_language": "EN"},
        {"id": "z009", "line_id": "l2-2", "plant_id": "plant-2", "name": "Mulling-2",  "type": "Mulling",   "default_language": "EN"},
        {"id": "z010", "line_id": "l3-1", "plant_id": "plant-3", "name": "Melting-3",  "type": "Melting",   "default_language": "EN"},
        {"id": "z011", "line_id": "l3-2", "plant_id": "plant-3", "name": "Moulding-D", "type": "Moulding",  "default_language": "EN"},
    ],
    "languages": [
        {"code": "EN", "label": "English",  "flag": "🇬🇧"},
        {"code": "HI", "label": "Hindi",    "flag": "🇮🇳"},
        {"code": "TA", "label": "Tamil",    "flag": "🇮🇳"},
        {"code": "MR", "label": "Marathi",  "flag": "🇮🇳"},
        {"code": "GU", "label": "Gujarati", "flag": "🇮🇳"},
        {"code": "TE", "label": "Telugu",   "flag": "🇮🇳"},
    ],
    "zone_types": ["Melting", "Moulding", "Mulling", "Cooling", "Sand Prep", "Pouring", "Custom"],
    "parameters": [
        {"id": "compactability",  "label": "Compactability",                  "unit": "%"},
        {"id": "moisture",        "label": "Moisture",                        "unit": "%"},
        {"id": "return_sand_temp","label": "Return Sand Temperature",         "unit": "°C"},
        {"id": "bentonite",       "label": "Bentonite Level",                 "unit": "%"},
        {"id": "coal_dust",       "label": "Coal Dust Level",                 "unit": "%"},
        {"id": "gfn",             "label": "GFN (Grain Fineness Number)",     "unit": ""},
        {"id": "permeability",    "label": "Permeability",                    "unit": "mD"},
        {"id": "mould_hardness",  "label": "Mould Hardness",                  "unit": ""},
        {"id": "green_strength",  "label": "Green Compression Strength",      "unit": "N/cm²"},
        {"id": "dry_strength",    "label": "Dry Compression Strength",        "unit": "N/cm²"},
        {"id": "shear_strength",  "label": "Shear Strength",                  "unit": "N/cm²"},
        {"id": "volatile_matter", "label": "Volatile Matter",                 "unit": "%"},
        {"id": "loss_on_ignition","label": "Loss on Ignition",                "unit": "%"},
        {"id": "active_clay",     "label": "Active Clay Content",             "unit": "%"},
        {"id": "methylene_blue",  "label": "Methylene Blue Value",            "unit": ""},
        {"id": "sand_temp",       "label": "Sand Temperature",                "unit": "°C"},
        {"id": "mixing_energy",   "label": "Mixing Energy",                   "unit": "kJ/kg"},
        {"id": "water_addition",  "label": "Water Addition Rate",             "unit": "l/min"},
        {"id": "core_hardness",   "label": "Core Hardness",                   "unit": ""},
        {"id": "core_strength",   "label": "Core Strength",                   "unit": "N/cm²"},
    ],
    "clips": [
        {"id":"clip-001","name":"Moisture High — EN","alert_code":"MOIST_HIGH","language":"EN","language_label":"English","duration_sec":5,"file_size":42000,"format":"WAV","upload_date":"2025-04-19T00:00:00","uploaded_by":"admin","description":"Attention. Moisture content is high. Please check sand mulling system."},
        {"id":"clip-002","name":"Volatile Matter High — EN","alert_code":"VM_HIGH","language":"EN","language_label":"English","duration_sec":6,"file_size":50000,"format":"WAV","upload_date":"2025-04-21T00:00:00","uploaded_by":"admin","description":"Warning. Volatile matter above threshold. Reduce coal dust addition."},
        {"id":"clip-003","name":"Coal Dust Low — EN","alert_code":"COAL_LOW","language":"EN","language_label":"English","duration_sec":4,"file_size":36000,"format":"MP3","upload_date":"2025-04-24T00:00:00","uploaded_by":"engineer1","description":"Coal dust level is low. Check additive hopper."},
        {"id":"clip-004","name":"Permeability Advisory — EN","alert_code":"PERM_WARN","language":"EN","language_label":"English","duration_sec":7,"file_size":58000,"format":"WAV","upload_date":"2025-04-27T00:00:00","uploaded_by":"admin","description":"Advisory: Permeability trending low. Monitor sand preparation parameters."},
        {"id":"clip-005","name":"LOI Warning — EN","alert_code":"LOI_WARN","language":"EN","language_label":"English","duration_sec":5,"file_size":44000,"format":"WAV","upload_date":"2025-04-29T00:00:00","uploaded_by":"engineer1","description":"Loss on ignition above recommended value. Check coal dust quality."},
        {"id":"clip-006","name":"Moisture High — HI","alert_code":"MOIST_HIGH","language":"HI","language_label":"Hindi","duration_sec":6,"file_size":52000,"format":"WAV","upload_date":"2025-05-01T00:00:00","uploaded_by":"admin","description":"ध्यान दें। नमी की मात्रा अधिक है।"},
        {"id":"clip-007","name":"Compactability Critical — TA","alert_code":"CMP_CRIT_LOW","language":"TA","language_label":"Tamil","duration_sec":7,"file_size":62000,"format":"WAV","upload_date":"2025-05-04T00:00:00","uploaded_by":"admin","description":"கவனம். கம்பாக்டபிலிட்டி மிகவும் குறைவாக உள்ளது."},
        {"id":"clip-008","name":"General Alert — MR","alert_code":"GENERAL","language":"MR","language_label":"Marathi","duration_sec":5,"file_size":46000,"format":"WAV","upload_date":"2025-05-09T00:00:00","uploaded_by":"admin","description":"सावधान. प्रक्रिया पॅरामीटर मर्यादेबाहेर आहे."},
    ],
    "templates": [
        {"id":"tpl-001","name":"Critical Alert Template","language":"EN","voice":"female","tone":"urgent","body":"Attention. {alert_code} — {message} in {zone}. Current value: {trigger_value} {unit}. Please take immediate corrective action.","variables":["alert_code","message","zone","trigger_value","unit"],"created_by":"admin","created_at":"2025-04-04T00:00:00"},
        {"id":"tpl-002","name":"Process Warning Template","language":"EN","voice":"male","tone":"calm","body":"Process warning. {parameter} in {zone} is {trigger_value} {unit}, below target of {threshold} {unit}. Please check.","variables":["parameter","zone","trigger_value","unit","threshold"],"created_by":"admin","created_at":"2025-04-09T00:00:00"},
        {"id":"tpl-003","name":"Advisory Template","language":"EN","voice":"male","tone":"calm","body":"Advisory: {parameter} reading is {trigger_value} {unit} in {zone}. Monitor and adjust as needed.","variables":["parameter","trigger_value","unit","zone"],"created_by":"engineer1","created_at":"2025-04-14T00:00:00"},
        {"id":"tpl-004","name":"Hindi Process Warning","language":"HI","voice":"female","tone":"calm","body":"चेतावनी। {zone} में {parameter} का मूल्य {trigger_value} {unit} है। कृपया जांचें।","variables":["zone","parameter","trigger_value","unit"],"created_by":"admin","created_at":"2025-04-21T00:00:00"},
        {"id":"tpl-005","name":"Tamil Critical Alert","language":"TA","voice":"female","tone":"urgent","body":"கவனம்! {zone} இல் {parameter} மதிப்பு {trigger_value} {unit} ஆக உள்ளது. உடனடி நடவடிக்கை எடுக்கவும்.","variables":["zone","parameter","trigger_value","unit"],"created_by":"admin","created_at":"2025-04-29T00:00:00"},
        {"id":"tpl-006","name":"Shift Handover Notice","language":"EN","voice":"male","tone":"calm","body":"Shift handover notice. {shift} shift starting at {zone}. Current status: {message}.","variables":["shift","zone","message"],"created_by":"admin","created_at":"2025-05-09T00:00:00"},
    ],
    "rules": [
        {"id":"r001","name":"Compactability Critical Low","alert_code":"CMP_CRIT_LOW","priority":"CRITICAL","category":"Critical","status":"Active","conditions":[{"parameter":"compactability","operator":"<","value":36,"unit":"%"}],"condition_logic":"AND","persistence_type":"cycles","persistence_value":3,"zone_ids":["z002","z003"],"zones":["Moulding-A","Mulling-1"],"audio_mode":"tts","tts_template_id":"tpl-001","language_override":None,"volume_override":None,"audio_type":"siren","use_default_escalation":True,"escalation_steps":[],"trigger_count":47,"created_by":"admin","created_at":"2025-04-04T00:00:00","updated_at":"2025-05-17T00:00:00"},
        {"id":"r002","name":"Moisture High Warning","alert_code":"MOIST_HIGH","priority":"HIGH","category":"Process Warning","status":"Active","conditions":[{"parameter":"moisture","operator":">","value":4.0,"unit":"%"}],"condition_logic":"AND","persistence_type":"duration","persistence_value":2,"persistence_unit":"minutes","zone_ids":["z003"],"zones":["Mulling-1"],"audio_mode":"clip","clip_id":"clip-001","language_override":"EN","volume_override":None,"audio_type":"voice","use_default_escalation":True,"escalation_steps":[],"trigger_count":23,"created_by":"admin","created_at":"2025-04-19T00:00:00","updated_at":"2025-05-14T00:00:00"},
        {"id":"r003","name":"Bentonite Level Low","alert_code":"BENT_LOW","priority":"MEDIUM","category":"Process Warning","status":"Active","conditions":[{"parameter":"bentonite","operator":"<","value":3.0,"unit":"%"}],"condition_logic":"AND","persistence_type":"cycles","persistence_value":2,"zone_ids":["z003","z005"],"zones":["Mulling-1","Sand Prep-1"],"audio_mode":"tts","tts_template_id":"tpl-002","language_override":None,"volume_override":None,"audio_type":"voice","use_default_escalation":True,"escalation_steps":[],"trigger_count":12,"created_by":"engineer1","created_at":"2025-04-24T00:00:00","updated_at":"2025-05-12T00:00:00"},
        {"id":"r004","name":"Return Sand Temperature High","alert_code":"SAND_TEMP_HIGH","priority":"HIGH","category":"Process Warning","status":"Active","conditions":[{"parameter":"sand_temperature","operator":">","value":45,"unit":"°C"}],"condition_logic":"AND","persistence_type":"duration","persistence_value":5,"persistence_unit":"minutes","zone_ids":["z004"],"zones":["Cooling-1"],"audio_mode":"tts","tts_template_id":"tpl-001","language_override":None,"volume_override":None,"audio_type":"voice","use_default_escalation":True,"escalation_steps":[],"trigger_count":8,"created_by":"admin","created_at":"2025-04-29T00:00:00","updated_at":"2025-05-10T00:00:00"},
        {"id":"r005","name":"Permeability Advisory","alert_code":"PERM_WARN","priority":"LOW","category":"Advisory","status":"Active","conditions":[{"parameter":"permeability","operator":"<","value":130,"unit":"AFS"}],"condition_logic":"AND","persistence_type":"cycles","persistence_value":5,"zone_ids":["z003"],"zones":["Mulling-1"],"audio_mode":"clip","clip_id":"clip-004","language_override":None,"volume_override":None,"audio_type":"voice","use_default_escalation":True,"escalation_steps":[],"trigger_count":31,"created_by":"engineer1","created_at":"2025-05-04T00:00:00","updated_at":"2025-05-16T00:00:00"},
    ],
    "devices": [
        {"id":"gw-001","name":"Gateway-P1L1","type":"Gateway","zone_id":"z001","zone_name":"Melting-1","line":"Line-1","plant":"Plant-1","ip":"192.168.1.10","mac":"AA:BB:CC:DD:EE:01","firmware":"v3.2.1","status":"online","uptime_pct":99.8,"downtime_min":9,"metrics":{"cpu":34,"memory":52,"latency_ms":4,"audio_queue":1},"protocol":"MQTT","mqtt_topic":"plant1/line1/gateway/gw-001","audio_channel":1,"volume_override":None},
        {"id":"gw-002","name":"Gateway-P2L1","type":"Gateway","zone_id":"z008","zone_name":"Moulding-C","line":"Line-1","plant":"Plant-2","ip":"192.168.2.10","mac":"AA:BB:CC:DD:EE:02","firmware":"v3.1.8","status":"online","uptime_pct":98.2,"downtime_min":78,"metrics":{"cpu":28,"memory":44,"latency_ms":6,"audio_queue":0},"protocol":"MQTT","mqtt_topic":"plant2/line1/gateway/gw-002","audio_channel":1,"volume_override":None},
        {"id":"gw-003","name":"Gateway-P3L1","type":"Gateway","zone_id":"z010","zone_name":"Melting-3","line":"Line-1","plant":"Plant-3","ip":"192.168.3.10","mac":"AA:BB:CC:DD:EE:03","firmware":"v3.0.5","status":"offline","uptime_pct":82.4,"downtime_min":762,"metrics":{"cpu":0,"memory":0,"latency_ms":None,"audio_queue":0},"protocol":"MQTT","mqtt_topic":"plant3/line1/gateway/gw-003","audio_channel":1,"volume_override":None},
        {"id":"spk-001","name":"Speaker-P1-Moulding-A","type":"Speaker","zone_id":"z002","zone_name":"Moulding-A","line":"Line-1","plant":"Plant-1","ip":"192.168.1.21","mac":"AA:BB:CC:DD:EE:11","firmware":"v2.1.0","status":"online","uptime_pct":99.9,"downtime_min":2,"metrics":{"cpu":12,"memory":28,"latency_ms":2,"audio_queue":0},"protocol":"MQTT","mqtt_topic":"plant1/line1/speaker/spk-001","audio_channel":2,"volume_override":None},
        {"id":"spk-002","name":"Speaker-P1-Mulling-1","type":"Speaker","zone_id":"z003","zone_name":"Mulling-1","line":"Line-1","plant":"Plant-1","ip":"192.168.1.22","mac":"AA:BB:CC:DD:EE:12","firmware":"v2.1.0","status":"online","uptime_pct":97.6,"downtime_min":104,"metrics":{"cpu":10,"memory":26,"latency_ms":3,"audio_queue":0},"protocol":"MQTT","mqtt_topic":"plant1/line1/speaker/spk-002","audio_channel":2,"volume_override":None},
    ],
    "alert_logs": [
        {"id":"log-001","rule_id":"r001","rule_name":"Compactability Critical Low","alert_code":"CMP_CRIT_LOW","priority":"CRITICAL","zone":"Moulding-A","zone_id":"z002","shift":"Morning","timestamp":"2025-05-19T07:12:00","status":"Acknowledged","ack_by":"operator1","ack_source":"Dashboard","ack_seconds":45,"trigger_value":32,"unit":"%","threshold":36},
        {"id":"log-002","rule_id":"r002","rule_name":"Moisture High Warning","alert_code":"MOIST_HIGH","priority":"HIGH","zone":"Mulling-1","zone_id":"z003","shift":"Morning","timestamp":"2025-05-19T08:33:00","status":"Acknowledged","ack_by":"supervisor1","ack_source":"Dashboard","ack_seconds":120,"trigger_value":4.5,"unit":"%","threshold":4.0},
        {"id":"log-003","rule_id":"r005","rule_name":"Permeability Advisory","alert_code":"PERM_WARN","priority":"LOW","zone":"Mulling-1","zone_id":"z003","shift":"Afternoon","timestamp":"2025-05-19T14:05:00","status":"Acknowledged","ack_by":"operator2","ack_source":"Physical Button","ack_seconds":210,"trigger_value":125,"unit":"AFS","threshold":130},
        {"id":"log-004","rule_id":"r001","rule_name":"Compactability Critical Low","alert_code":"CMP_CRIT_LOW","priority":"CRITICAL","zone":"Moulding-A","zone_id":"z002","shift":"Afternoon","timestamp":"2025-05-18T15:20:00","status":"Acknowledged","ack_by":"supervisor1","ack_source":"Mobile","ack_seconds":58,"trigger_value":33,"unit":"%","threshold":36},
        {"id":"log-005","rule_id":"r004","rule_name":"Return Sand Temperature High","alert_code":"SAND_TEMP_HIGH","priority":"HIGH","zone":"Cooling-1","zone_id":"z004","shift":"Night","timestamp":"2025-05-18T22:11:00","status":"Acknowledged","ack_by":"tech1","ack_source":"Dashboard","ack_seconds":32,"trigger_value":47,"unit":"°C","threshold":45},
        {"id":"log-006","rule_id":"r003","rule_name":"Bentonite Level Low","alert_code":"BENT_LOW","priority":"MEDIUM","zone":"Sand Prep-1","zone_id":"z005","shift":"Morning","timestamp":"2025-05-18T09:44:00","status":"Acknowledged","ack_by":"operator1","ack_source":"Auto-recovery","ack_seconds":0,"trigger_value":2.8,"unit":"%","threshold":3.0},
        {"id":"log-007","rule_id":"r002","rule_name":"Moisture High Warning","alert_code":"MOIST_HIGH","priority":"HIGH","zone":"Mulling-1","zone_id":"z003","shift":"Night","timestamp":"2025-05-17T23:05:00","status":"Resolved","ack_by":"tech1","ack_source":"Dashboard","ack_seconds":95,"trigger_value":4.2,"unit":"%","threshold":4.0},
        {"id":"log-008","rule_id":"r001","rule_name":"Compactability Critical Low","alert_code":"CMP_CRIT_LOW","priority":"CRITICAL","zone":"Moulding-A","zone_id":"z002","shift":"Morning","timestamp":"2025-05-17T07:55:00","status":"Acknowledged","ack_by":"operator1","ack_source":"Dashboard","ack_seconds":62,"trigger_value":34,"unit":"%","threshold":36},
    ],
    "audit_logs": [],
    "security": {
        "password_min_length":   8,
        "password_complexity":   True,
        "password_rotation_days":90,
        "password_history_count":5,
        "mfa_required":        {r: (r == "administrator") for r in VALID_ROLES},
        "session_timeout_min": {"administrator":480,"plant_manager":480,"process_engineer":480,"shift_supervisor":60,"operator":30,"maintenance_technician":60,"auditor":480},
        "ip_allowlist": [],
        "api_tokens":   [],
    },
    "role_permissions": DEFAULT_ROLE_PERMISSIONS,
}

# ── initialise plain-JSON files ───────────────────────────────
for _f, _d in {
    CONFIG_FILE: {}, UPDATES_FILE: [],
    IS_FILE_TO_DB_UPDATED: False, IS_UPDATED_FILE: False,
}.items():
    if not _f.exists():
        _f.write_text(json.dumps(_d, indent=2))

if not ALERTS_CONFIG_FILE.exists():
    ALERTS_CONFIG_FILE.write_text(json.dumps(DEFAULT_ALERTS_CONFIG, indent=2))


def _read_ac() -> dict:
    """Read alerts_config.json. Returns {} on failure to prevent overwriting real data with defaults."""
    try:
        return json.loads(ALERTS_CONFIG_FILE.read_text())
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        log.error("alerts_config.json is corrupt — skipping read")
        return {}
    except Exception as e:
        log.error("Failed to read alerts_config.json: %s", e)
        return {}

def _write_ac(cfg: dict):
    try:
        ALERTS_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        ALERTS_CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    except Exception as e:
        log.error("Failed to write alerts_config.json: %s", e)

def _ac_section(section: str):
    return _read_ac().get(section, DEFAULT_ALERTS_CONFIG.get(section))

def _read_ac_for_write():
    """Like _read_ac() but returns (None, error_response) if file is unreadable,
    preventing write operations from overwriting real data with empty defaults."""
    cfg = _read_ac()
    if not cfg:
        return None, (jsonify(ok=False, error="Config file not accessible — cannot write"), 503)
    return cfg, None


# ============================================================
# FLASK APP
# ============================================================

app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")

app.secret_key = "X7f1m+oJ6q8wR2t9UeY3pF4zN0hKd1sQjM5aV8bZc2xT7nL0oR5vH3gC6dP9yW4k"
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE   = _app_cfg.get("cookie_secure",   False),
    SESSION_COOKIE_SAMESITE = _app_cfg.get("cookie_samesite", "Lax"),
    PERMANENT_SESSION_LIFETIME = timedelta(days=_app_cfg.get("session_lifetime_days", 365)),
)


# ── manual CORS (reads cors_origins from system_config.json on every request) ──

@app.before_request
def _handle_preflight():
    if request.method == "OPTIONS":
        return _cors_response(app.make_response(""), 204)


@app.after_request
def _apply_cors(response):
    return _cors_response(response)


def _cors_response(response, status=None):
    sc      = _read_sc()
    allowed = sc.get("cors_origins", DEFAULT_SYSTEM_CONFIG["cors_origins"])
    origin  = request.headers.get("Origin", "")
    if origin in allowed:
        response.headers.update({
            "Access-Control-Allow-Origin":      origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE, OPTIONS, PATCH",
            "Access-Control-Allow-Headers":     "Content-Type, Authorization",
        })
    if status is not None:
        response.status_code = status
    return response


# ============================================================
# DATABASE  (connection config read from system_config.json at startup)
# ============================================================

def _build_db_uri(db: dict) -> str:
    return (
        f"mysql+pymysql://{db.get('user','gateway')}:{db.get('password','gateway')}"
        f"@{db.get('host','localhost')}:{db.get('port',3306)}/{db.get('name','users')}"
    )

app.config["SQLALCHEMY_DATABASE_URI"]     = _build_db_uri(_db_cfg)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"]   = {"pool_pre_ping": True, "pool_recycle": 1800}

db = SQLAlchemy(app)


# ============================================================
# LOGGING  (log_root from system_config.json)
# ============================================================

_current_log_date: str  = ""
log = logging.getLogger(LOGGER_NAME)


def setup_logging():
    global _current_log_date, log
    today = datetime.now().strftime("%Y-%m-%d")
    if _current_log_date == today and log.handlers:
        return log
    _current_log_date = today
    sc       = _read_sc()
    log_root = Path(sc.get("app", {}).get("log_root", DEFAULT_SYSTEM_CONFIG["app"]["log_root"]))
    log_dir  = log_root / today / "configuration_ui"
    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    log.setLevel(logging.INFO)
    log.handlers.clear()
    log.propagate = False
    fh = logging.FileHandler(log_dir / "ui.log")
    fh.setFormatter(formatter)
    sh = logging.StreamHandler()
    sh.setFormatter(formatter)
    log.addHandler(fh)
    log.addHandler(sh)
    log.info("Logging → %s", log_dir / "ui.log")
    return log


@app.before_request
def _refresh_logging():
    setup_logging()


# ============================================================
# USER MODEL  (matches users.mock.js schema)
# ============================================================

class User(db.Model):
    __tablename__ = "user_details"
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.Text, nullable=False)
    role          = db.Column(db.String(50), nullable=False, default="operator")
    plant_scope   = db.Column(db.JSON, default=list)
    line_scope    = db.Column(db.JSON, default=list)
    zone_scope    = db.Column(db.JSON, default=list)
    shift_scope   = db.Column(db.JSON, default=list)
    last_login    = db.Column(db.DateTime, nullable=True)
    status        = db.Column(db.String(20), default="Active")
    created_at    = db.Column(db.DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id":          str(self.id),
            "username":    self.username,
            "role":        LEGACY_ROLE_MAP.get(self.role, self.role),
            "plant_scope": self.plant_scope  or [],
            "line_scope":  self.line_scope   or [],
            "zone_scope":  self.zone_scope   or [],
            "shift_scope": self.shift_scope  or [],
            "last_login":  self.last_login.isoformat() if self.last_login else None,
            "status":      self.status or "Active",
            "created_at":  self.created_at.isoformat() if self.created_at else None,
        }


# ============================================================
# REQUEST / RESPONSE LOGGING
# ============================================================

@app.before_request
def _log_request():
    log.info("REQ  %s %s user=%s ip=%s",
             request.method, request.path,
             session.get("user", {}).get("username", "-"),
             request.remote_addr)


@app.after_request
def _log_response(response):
    log.info("RESP %s %s user=%s",
             response.status_code, request.path,
             session.get("user", {}).get("username", "-"))
    return response


# ============================================================
# MYSQL CHECK
# ============================================================

def is_mysql_up(timeout: int = 2) -> bool:
    sc = _read_sc()
    db_cfg = sc.get("database", DEFAULT_SYSTEM_CONFIG["database"])
    host = db_cfg.get("host", "127.0.0.1")
    port = db_cfg.get("port", 3306)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


# ============================================================
# AUTH / PERMISSION HELPERS
# ============================================================

def _require_login():
    if "user" not in session:
        log.warning("UNAUTHORIZED path=%s ip=%s", request.path, request.remote_addr)
        return jsonify(error="Unauthorized"), 401


def _current_user() -> dict:
    return session.get("user", {})


def _rbac_role() -> str:
    role = _current_user().get("role", "operator")
    return LEGACY_ROLE_MAP.get(role, role)


def _can(permission: str) -> bool:
    cfg   = _read_ac()
    perms = cfg.get("role_permissions", DEFAULT_ROLE_PERMISSIONS)
    return permission in perms.get(_rbac_role(), [])


def _is_admin() -> bool:
    return _rbac_role() in ("administrator", "plant_manager")


def _add_audit(action: str, target: str, target_label: str,
               before=None, after=None):
    cfg = _read_ac()
    if not cfg:
        # File missing or unreadable — skip audit entry to avoid overwriting real data with defaults
        log.warning("Skipping audit write — alerts_config.json not accessible (action=%s)", action)
        return
    sc       = _read_sc()
    max_logs = sc.get("alerts_limits", {}).get("audit_log_max", 2000)
    logs     = cfg.get("audit_logs", [])
    logs.insert(0, {
        "id":           f"aud-{uuid.uuid4().hex[:8]}",
        "timestamp":    datetime.now().isoformat(),
        "user":         _current_user().get("username", "system"),
        "action":       action,
        "target":       target,
        "target_label": target_label,
        "before":       before,
        "after":        after,
        "ip":           request.remote_addr,
    })
    cfg["audit_logs"] = logs[:max_logs]
    _write_ac(cfg)


# ============================================================
# UI ROUTE
# ============================================================

@app.route("/")
def home():
    if "user" not in session:
        return send_from_directory(STATIC, "login.html")
    return send_from_directory(STATIC, "index.html")


# ============================================================
# AUTH ROUTES
# ============================================================

@app.route("/login", methods=["POST"])
def login():
    data     = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    log.info("LOGIN_ATTEMPT user=%s", username)
    u = User.query.filter_by(username=username).first()
    if not u or not bcrypt.checkpw(password.encode(), u.password_hash.encode()):
        log.warning("LOGIN_FAIL user=%s", username)
        return jsonify(error="Invalid credentials"), 401
    if u.status == "Disabled":
        return jsonify(error="Account disabled"), 403
    u.last_login = datetime.now()
    db.session.commit()
    role = LEGACY_ROLE_MAP.get(u.role, u.role)
    session.permanent = True
    session["user"] = {"username": u.username, "role": role}
    log.info("LOGIN_SUCCESS user=%s role=%s", u.username, role)
    _add_audit("login", f"auth/{username}", f"Login: {username}")
    return jsonify(status="success")


@app.route("/logout", methods=["POST"])
def logout():
    log.info("LOGOUT user=%s", _current_user().get("username"))
    _add_audit("logout", "auth", "Logout")
    session.clear()
    return jsonify(status="logged_out")


@app.route("/whoami")
def whoami():
    if "user" not in session:
        return jsonify(error="Unauthorized"), 401
    return jsonify(session["user"])


@app.route("/reset-password", methods=["POST"])
def reset_password():
    err = _require_login()
    if err: return err
    data         = request.json or {}
    old_password = data.get("oldPassword", "")
    new_password = data.get("newPassword", "")
    if not old_password or not new_password:
        return jsonify(error="Old and new password required"), 400
    username = _current_user()["username"]
    u = User.query.filter_by(username=username).first()
    if not u:
        return jsonify(error="User not found"), 404
    if not bcrypt.checkpw(old_password.encode(), u.password_hash.encode()):
        return jsonify(error="Old password is incorrect"), 401
    if len(new_password) < 6:
        return jsonify(error="Password too short (min 6)"), 400
    u.password_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    db.session.commit()
    log.info("PASSWORD_CHANGED user=%s", username)
    _add_audit("config.change", f"user/{username}", "Password Change")
    if data.get("login_req"):
        session.clear()
    return jsonify(status="password_updated")


# ============================================================
# SYSTEM CONFIG  — /system-config  (admin only)
# ============================================================

@app.route("/system-config", methods=["GET"])
def get_system_config():
    err = _require_login()
    if err: return err
    if not _is_admin():
        return jsonify(ok=False, error="Forbidden"), 403
    sc = _read_sc()
    # deep-merge with defaults so all keys are always present
    merged = json.loads(json.dumps(DEFAULT_SYSTEM_CONFIG))
    for section, val in sc.items():
        if isinstance(val, dict) and isinstance(merged.get(section), dict):
            merged[section].update(val)
        else:
            merged[section] = val
    return jsonify(ok=True, data=merged)


@app.route("/system-config", methods=["PUT"])
def put_system_config():
    err = _require_login()
    if err: return err
    if not _can("aa.security.manage"):
        return jsonify(ok=False, error="Forbidden"), 403
    data    = request.json or {}
    current = _read_sc()
    # merge section by section (don't allow caller to blank a whole section)
    for section, incoming in data.items():
        if section not in DEFAULT_SYSTEM_CONFIG:
            continue                                # ignore unknown top-level keys
        if isinstance(incoming, dict) and isinstance(current.get(section), dict):
            current[section] = {**current.get(section, {}), **incoming}
        else:
            current[section] = incoming
    _write_sc(current)
    log.info("SYSTEM_CONFIG updated by=%s", _current_user().get("username"))
    _add_audit("config.change", "system/config", "System Configuration", after=data)
    return jsonify(ok=True, data=current)


# ============================================================
# USER MANAGEMENT  — /users  (CRUD, real-DB)
# ============================================================

@app.route("/users", methods=["GET"])
def list_users():
    err = _require_login()
    if err: return err
    if not _can("aa.users.manage"):
        return jsonify(ok=False, error="Forbidden"), 403
    users = User.query.order_by(User.created_at.desc()).all()
    return jsonify(ok=True, data=[u.to_dict() for u in users])


@app.route("/users", methods=["POST"])
def create_user():
    err = _require_login()
    if err: return err
    if not _can("aa.users.manage"):
        return jsonify(ok=False, error="Forbidden"), 403
    data     = request.json or {}
    username = (data.get("username") or "").strip()
    password = data.get("password", "")
    role     = (data.get("role") or "operator").strip()
    if not username or not password:
        return jsonify(ok=False, error="Username and password required"), 400
    if role not in VALID_ROLES:
        return jsonify(ok=False, error=f"Invalid role '{role}'"), 400
    if User.query.filter_by(username=username).first():
        return jsonify(ok=False, error="Username already exists"), 409
    u = User(
        username      = username,
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
        role          = role,
        plant_scope   = data.get("plant_scope", []),
        line_scope    = data.get("line_scope",  []),
        zone_scope    = data.get("zone_scope",  []),
        shift_scope   = data.get("shift_scope", []),
        status        = "Active",
        created_at    = datetime.now(),
    )
    db.session.add(u)
    db.session.commit()
    log.info("USER_CREATED by=%s username=%s role=%s", _current_user().get("username"), username, role)
    _add_audit("user.create", f"user/{username}", f"User: {username}",
               after={"username": username, "role": role})
    return jsonify(ok=True, data=u.to_dict()), 201


@app.route("/users/<int:user_id>", methods=["PUT"])
def update_user(user_id):
    err = _require_login()
    if err: return err
    if not _can("aa.users.manage"):
        return jsonify(ok=False, error="Forbidden"), 403
    u = User.query.get(user_id)
    if not u:
        return jsonify(ok=False, error="User not found"), 404
    data   = request.json or {}
    before = u.to_dict()
    if "role"        in data:
        if data["role"] not in VALID_ROLES:
            return jsonify(ok=False, error="Invalid role"), 400
        u.role = data["role"]
    if "status"      in data: u.status      = data["status"]
    if "plant_scope" in data: u.plant_scope = data["plant_scope"]
    if "line_scope"  in data: u.line_scope  = data["line_scope"]
    if "zone_scope"  in data: u.zone_scope  = data["zone_scope"]
    if "shift_scope" in data: u.shift_scope = data["shift_scope"]
    if data.get("password"):
        u.password_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()
    db.session.commit()
    _add_audit("user.edit", f"user/{u.username}", f"User: {u.username}",
               before=before, after=u.to_dict())
    return jsonify(ok=True, data=u.to_dict())


@app.route("/users/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    err = _require_login()
    if err: return err
    if not _can("aa.users.manage"):
        return jsonify(ok=False, error="Forbidden"), 403
    u = User.query.get(user_id)
    if not u:
        return jsonify(ok=False, error="User not found"), 404
    before = u.to_dict()
    db.session.delete(u)
    db.session.commit()
    _add_audit("user.delete", f"user/{u.username}", f"User: {u.username}", before=before)
    return jsonify(ok=True, data={"id": str(user_id)})


# ── audio-alerts/users delegates ──────────────────────────────
@app.route("/audio-alerts/users", methods=["GET"])
def aa_users_get():  return list_users()

@app.route("/audio-alerts/users", methods=["POST"])
def aa_users_post(): return create_user()
@app.route("/audio-alerts/users/<int:uid>",    methods=["PUT"])
def aa_users_put(uid):  return update_user(uid)

@app.route("/audio-alerts/users/<int:uid>",    methods=["DELETE"])
def aa_users_del(uid):  return delete_user(uid)


# ============================================================
# ROLE PERMISSIONS  — /roles/permissions
# ============================================================

@app.route("/roles/permissions", methods=["GET"])
def get_role_permissions():
    err = _require_login()
    if err: return err
    cfg = _read_ac()
    return jsonify(ok=True, data=cfg.get("role_permissions", DEFAULT_ROLE_PERMISSIONS))


@app.route("/roles/permissions", methods=["PUT"])
def update_all_role_permissions():
    err = _require_login()
    if err: return err
    if not _can("aa.users.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    cfg, err = _read_ac_for_write()
    if err: return err
    cfg["role_permissions"] = {**cfg.get("role_permissions", {}), **data}
    _write_ac(cfg)
    _add_audit("config.change", "config/role_permissions", "Role Permissions (bulk)", after=data)
    return jsonify(ok=True, data=cfg["role_permissions"])


@app.route("/roles/permissions/<role>", methods=["PUT"])
def update_role_permissions(role):
    err = _require_login()
    if err: return err
    if not _can("aa.security.manage"):
        return jsonify(ok=False, error="Forbidden"), 403
    if role not in VALID_ROLES:
        return jsonify(ok=False, error="Invalid role"), 400
    if role == "administrator":
        return jsonify(ok=False, error="Administrator permissions cannot be restricted"), 400
    perms = [p for p in (request.json or {}).get("permissions", []) if p in ALL_PERMISSIONS]
    cfg, err = _read_ac_for_write()
    if err: return err
    rp    = cfg.get("role_permissions", dict(DEFAULT_ROLE_PERMISSIONS))
    rp[role] = perms
    cfg["role_permissions"] = rp
    _write_ac(cfg)
    _add_audit("config.change", f"roles/{role}", f"Role Permissions: {role}",
               after={"role": role, "permissions": perms})
    return jsonify(ok=True, data=rp)


# ============================================================
# GPIO STATUS  (reads gpio_pins from system_config.json — hot-reloadable)
# ============================================================

def _gpio_level(pin: int) -> str:
    try:
        out = subprocess.run(["raspi-gpio", "get", str(pin)],
                             capture_output=True, text=True).stdout
        if "level=1" in out: return "HIGH"
        if "level=0" in out: return "LOW"
        return "UNKNOWN"
    except Exception as e:
        return f"ERROR: {e}"


@app.route("/gpio-status")
def gpio_status():
    err = _require_login()
    if err: return err
    sc   = _read_sc()
    pins = sc.get("gpio_pins", DEFAULT_SYSTEM_CONFIG["gpio_pins"])
    return jsonify({name: _gpio_level(pin) for name, pin in pins.items()})


# ============================================================
# CONFIG ROUTES  (modbus / wifi / device — NOT audio alerts)
# ============================================================

@app.route("/config", methods=["GET"])
def get_config():
    err = _require_login()
    if err: return err
    return jsonify(json.loads(CONFIG_FILE.read_text()))


@app.route("/config", methods=["POST"])
def set_config():
    err = _require_login()
    if err: return err
    data    = request.json or {}
    current = json.loads(CONFIG_FILE.read_text())
    changed = {}
    for k, v in data.items():
        if current.get(k) != v:
            changed[k] = {"old": current.get(k), "new": v}
            current[k] = v
    if not changed:
        return jsonify(status="ok", message="No changes")
    CONFIG_FILE.write_text(json.dumps(current, indent=2))
    IS_FILE_TO_DB_UPDATED.write_text("true")
    _log_config_update(list(changed.keys()))
    return jsonify(status="ok", changed=changed)


def _log_config_update(fields):
    updates = json.loads(UPDATES_FILE.read_text())
    updates.append({"ts": datetime.now().isoformat(),
                    "user": _current_user(), "fields": fields})
    UPDATES_FILE.write_text(json.dumps(updates, indent=2))
    IS_UPDATED_FILE.write_text("true")
    log.info("CONFIG_UPDATED fields=%s", fields)


@app.route("/update-status")
def update_status():
    updates = json.loads(UPDATES_FILE.read_text())
    return jsonify(updates[-1] if updates else {})


@app.route("/clear-update-flag", methods=["POST"])
def clear_update():
    IS_UPDATED_FILE.write_text("false")
    return jsonify(status="cleared")


# ============================================================
# AUDIO ALERTS — in-memory active alerts
# ============================================================

_active_alerts: list = []


def _alert_by_id(alert_id: str):
    return next((a for a in _active_alerts if a["alert_id"] == alert_id), None)


# ============================================================
# AUDIO ALERTS — Engine / Audio Config
# ============================================================

@app.route("/audio-alerts/config", methods=["GET"])
def aa_config_get():
    err = _require_login()
    if err: return err
    cfg = _read_ac()
    return jsonify(ok=True, data={
        "engine":       cfg.get("engine",       DEFAULT_ALERTS_CONFIG["engine"]),
        "audio_config": cfg.get("audio_config", DEFAULT_ALERTS_CONFIG["audio_config"]),
    })


@app.route("/audio-alerts/config/engine", methods=["PUT"])
def aa_config_engine_put():
    err = _require_login()
    if err: return err
    cfg = _read_ac()
    cfg["engine"] = {**cfg.get("engine", {}), **(request.json or {})}
    _write_ac(cfg)
    return jsonify(ok=True, data=cfg["engine"])


@app.route("/audio-alerts/config/audio", methods=["PUT"])
def aa_config_audio_put():
    err = _require_login()
    if err: return err
    cfg = _read_ac()
    cfg["audio_config"] = {**cfg.get("audio_config", {}), **(request.json or {})}
    _write_ac(cfg)
    return jsonify(ok=True, data=cfg["audio_config"])


@app.route("/audio-alerts/config/app-settings", methods=["GET"])
def aa_app_settings_get():
    err = _require_login()
    if err: return err
    cfg = _read_ac()
    return jsonify(ok=True, data={
        "languages":  cfg.get("languages",  DEFAULT_ALERTS_CONFIG["languages"]),
        "zone_types": cfg.get("zone_types", DEFAULT_ALERTS_CONFIG["zone_types"]),
        "parameters": cfg.get("parameters", DEFAULT_ALERTS_CONFIG["parameters"]),
    })


@app.route("/audio-alerts/config/app-settings", methods=["PUT"])
def aa_app_settings_put():
    err = _require_login()
    if err: return err
    if not _can("aa.users.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    cfg, err = _read_ac_for_write()
    if err: return err
    if "languages"  in data: cfg["languages"]  = data["languages"]
    if "zone_types" in data: cfg["zone_types"] = data["zone_types"]
    if "parameters" in data: cfg["parameters"] = data["parameters"]
    _write_ac(cfg)
    _add_audit("config.change", "config/app-settings", "App Settings", after=data)
    return jsonify(ok=True, data={k: cfg.get(k) for k in ["languages", "zone_types", "parameters"]})


# ============================================================
# AUDIO ALERTS — Active Alerts
# ============================================================

@app.route("/audio-alerts/active", methods=["GET"])
def aa_active():
    err = _require_login()
    if err: return err
    priority = request.args.get("priority")
    zone_id  = request.args.get("zone_id")
    alerts   = [a for a in _active_alerts if a["status"] == "Active"]
    if priority: alerts = [a for a in alerts if a.get("priority") == priority]
    if zone_id:  alerts = [a for a in alerts if a.get("zone_id")  == zone_id]
    cfg = _read_ac()
    return jsonify(ok=True, data={
        "alerts": alerts,
        "stats": {
            "active":   len([a for a in _active_alerts if a["status"] == "Active"]),
            "critical": len([a for a in _active_alerts if a["priority"] == "CRITICAL" and a["status"] == "Active"]),
            "unacked":  len([a for a in _active_alerts if not a.get("ack_time") and a["status"] == "Active"]),
        },
        "engine": cfg.get("engine", DEFAULT_ALERTS_CONFIG["engine"]),
    })


@app.route("/audio-alerts/stream", methods=["GET"])
def aa_stream():
    err = _require_login()
    if err: return err
    since = request.args.get("since")
    if since:
        try:
            dt     = datetime.fromisoformat(since)
            alerts = [a for a in _active_alerts
                      if datetime.fromisoformat(a.get("timestamp", "2000-01-01")) > dt]
        except Exception:
            alerts = _active_alerts
    else:
        alerts = _active_alerts
    return jsonify(ok=True, data=alerts, ts=datetime.now().isoformat())


@app.route("/audio-alerts/ack", methods=["POST"])
def aa_ack():
    err = _require_login()
    if err: return err
    if not _can("aa.alerts.ack"):
        return jsonify(ok=False, error="Permission denied"), 403
    data     = request.json or {}
    alert_id = data.get("alert_id")
    note     = data.get("note", "")
    alert    = _alert_by_id(alert_id)
    if not alert:
        return jsonify(ok=False, error="Alert not found"), 404
    alert.update({
        "status":     "Acknowledged",
        "ack_time":   datetime.now().isoformat(),
        "ack_user":   _current_user().get("username", "unknown"),
        "ack_source": "Dashboard",
    })
    sc       = _read_sc()
    max_logs = sc.get("alerts_limits", {}).get("alert_log_max", 2000)
    cfg      = _read_ac()
    logs     = cfg.get("alert_logs", [])
    logs.insert(0, {**alert, "ack_note": note})
    cfg["alert_logs"] = logs[:max_logs]
    _write_ac(cfg)
    _add_audit("ack", f"alert/{alert_id}", f"Alert {alert.get('alert_code','')}",
               after={"ack_user": alert["ack_user"], "note": note})
    return jsonify(ok=True, data=alert)


@app.route("/audio-alerts/broadcast", methods=["POST"])
def aa_broadcast():
    err = _require_login()
    if err: return err
    if not _can("aa.broadcast.manual"):
        return jsonify(ok=False, error="Permission denied"), 403
    data     = request.json or {}
    zone_ids = data.get("zone_ids", [])
    alert    = {
        "alert_id":         str(uuid.uuid4()),
        "plant":            data.get("plant", ""),
        "line":             data.get("line",  ""),
        "zone":             data.get("zone",  ""),
        "zone_id":          zone_ids[0] if zone_ids else "",
        "priority":         "MEDIUM",
        "alert_code":       "BROADCAST",
        "message":          data.get("message", "Manual broadcast"),
        "language":         data.get("language", "EN"),
        "repeat":           False,
        "trigger_value":    None, "threshold": None, "source_parameter": None,
        "timestamp":        datetime.now().isoformat(),
        "ack_required":     False,
        "escalation_step":  0,
        "status":           "Active",
        "repeat_count":     0,
        "playback_status":  "queued",
        "device_id":        None,
        "ack_time": None, "ack_user": None, "ack_source": None,
        "audio_type":       data.get("audio_type", "voice"),
        "clip_id":          data.get("clip_id"),
    }
    _active_alerts.insert(0, alert)
    _add_audit("broadcast.manual", "broadcast", "Manual Broadcast", after=data)
    return jsonify(ok=True, data=alert)


# ============================================================
# AUDIO ALERTS — Rules
# ============================================================

@app.route("/audio-alerts/rules", methods=["GET"])
def aa_rules_get():
    err = _require_login()
    if err: return err
    if not _can("aa.rules.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    rules  = _ac_section("rules") or []
    status = request.args.get("status")
    if status: rules = [r for r in rules if r.get("status") == status]
    return jsonify(ok=True, data=rules)


@app.route("/audio-alerts/rules", methods=["POST"])
def aa_rules_post():
    err = _require_login()
    if err: return err
    if not _can("aa.rules.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    rule = {
        **data,
        "id":                 f"r{uuid.uuid4().hex[:6]}",
        "created_by":         _current_user().get("username", "unknown"),
        "created_at":         datetime.now().isoformat(),
        "updated_at":         datetime.now().isoformat(),
        "trigger_count":      0,
        "test_trigger_count": 0,
        "last_triggered":     None,
        "status":             data.get("status", "Draft"),
    }
    cfg = _read_ac()
    cfg.setdefault("rules", []).insert(0, rule)
    _write_ac(cfg)
    _add_audit("rule.create", f"rule/{rule['id']}", f"Rule: {rule.get('name','')}", after=rule)
    return jsonify(ok=True, data=rule), 201


@app.route("/audio-alerts/rules/<rule_id>", methods=["PUT"])
def aa_rules_put(rule_id):
    err = _require_login()
    if err: return err
    if not _can("aa.rules.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    rules = cfg.get("rules", [])
    idx   = next((i for i, r in enumerate(rules) if r["id"] == rule_id), None)
    if idx is None: return jsonify(ok=False, error="Rule not found"), 404
    before       = rules[idx]
    rules[idx]   = {**rules[idx], **(request.json or {}), "updated_at": datetime.now().isoformat()}
    cfg["rules"] = rules
    _write_ac(cfg)
    _add_audit("rule.edit", f"rule/{rule_id}", f"Rule: {rules[idx].get('name','')}", before=before, after=rules[idx])
    return jsonify(ok=True, data=rules[idx])


@app.route("/audio-alerts/rules/<rule_id>", methods=["DELETE"])
def aa_rules_del(rule_id):
    err = _require_login()
    if err: return err
    if not _can("aa.rules.delete"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    rules = cfg.get("rules", [])
    rule  = next((r for r in rules if r["id"] == rule_id), None)
    if not rule: return jsonify(ok=False, error="Rule not found"), 404
    cfg["rules"] = [r for r in rules if r["id"] != rule_id]
    _write_ac(cfg)
    _add_audit("rule.delete", f"rule/{rule_id}", f"Rule: {rule.get('name','')}", before=rule)
    return jsonify(ok=True, data={"id": rule_id})


def _set_rule_status(rule_id: str, status: str):
    err = _require_login()
    if err: return err
    if not _can("aa.rules.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    rules = cfg.get("rules", [])
    idx   = next((i for i, r in enumerate(rules) if r["id"] == rule_id), None)
    if idx is None: return jsonify(ok=False, error="Rule not found"), 404
    rules[idx]["status"]     = status
    rules[idx]["updated_at"] = datetime.now().isoformat()
    cfg["rules"] = rules
    _write_ac(cfg)
    return jsonify(ok=True, data=rules[idx])


@app.route("/audio-alerts/rules/<rule_id>/enable",  methods=["POST"])
def aa_rule_enable(rule_id):  return _set_rule_status(rule_id, "Active")

@app.route("/audio-alerts/rules/<rule_id>/disable", methods=["POST"])
def aa_rule_disable(rule_id): return _set_rule_status(rule_id, "Disabled")


@app.route("/audio-alerts/rules/<rule_id>/test", methods=["POST"])
def aa_rule_test(rule_id):
    err = _require_login()
    if err: return err
    if not _can("aa.rules.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    sc           = _read_sc()
    default_dur  = sc.get("alerts_limits", {}).get("rule_test_default_minutes", 5)
    duration     = (request.json or {}).get("duration_minutes", default_dur)
    cfg          = _read_ac()
    rules        = cfg.get("rules", [])
    idx          = next((i for i, r in enumerate(rules) if r["id"] == rule_id), None)
    if idx is None: return jsonify(ok=False, error="Rule not found"), 404
    rules[idx].update({
        "status":             "Test Mode",
        "test_expires_at":    (datetime.now() + timedelta(minutes=duration)).isoformat(),
        "test_trigger_count": rules[idx].get("test_trigger_count", 0) + 1,
        "updated_at":         datetime.now().isoformat(),
    })
    cfg["rules"] = rules
    _write_ac(cfg)
    return jsonify(ok=True, data=rules[idx])


# ============================================================
# AUDIO ALERTS — Audio Clips & TTS Templates
# ============================================================

@app.route("/audio-alerts/audio/clips", methods=["GET"])
def aa_clips_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=_ac_section("clips") or [])


@app.route("/audio-alerts/audio/clips", methods=["POST"])
def aa_clips_post():
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    if request.content_type and "multipart/form-data" in request.content_type:
        data = {k: v for k, v in request.form.items()}
        f = request.files.get("file")
        if f:
            import os
            upload_dir = Path(__file__).parent / "uploads" / "clips"
            upload_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4().hex[:8]}_{f.filename}"
            f.save(str(upload_dir / filename))
            data["file_path"] = f"uploads/clips/{filename}"
            data["format"] = os.path.splitext(f.filename)[1].lstrip(".").upper()
    else:
        data = request.json or {}
    clip = {**data, "id": f"clip-{uuid.uuid4().hex[:6]}",
            "upload_date": datetime.now().isoformat(),
            "uploaded_by": _current_user().get("username", "unknown")}
    cfg = _read_ac()
    cfg.setdefault("clips", []).insert(0, clip)
    _write_ac(cfg)
    _add_audit("audio.upload", f"clip/{clip['id']}", f"Clip: {clip.get('name','')}", after=clip)
    return jsonify(ok=True, data=clip), 201


@app.route("/audio-alerts/audio/clips/<clip_id>", methods=["DELETE"])
def aa_clips_del(clip_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.delete"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    clips = cfg.get("clips", [])
    clip  = next((c for c in clips if c["id"] == clip_id), None)
    if not clip: return jsonify(ok=False, error="Clip not found"), 404
    cfg["clips"] = [c for c in clips if c["id"] != clip_id]
    _write_ac(cfg)
    _add_audit("audio.delete", f"clip/{clip_id}", f"Clip: {clip.get('name','')}", before=clip)
    return jsonify(ok=True, data={"id": clip_id})


@app.route("/audio-alerts/audio/clips/<clip_id>", methods=["PUT"])
def aa_clips_put(clip_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    data  = request.json or {}
    cfg   = _read_ac()
    clips = cfg.get("clips", [])
    idx   = next((i for i, c in enumerate(clips) if c["id"] == clip_id), None)
    if idx is None:
        return jsonify(ok=False, error="Clip not found"), 404
    editable = {"name", "alert_code", "language", "description"}
    clips[idx] = {**clips[idx], **{k: v for k, v in data.items() if k in editable}}
    cfg["clips"] = clips
    _write_ac(cfg)
    _add_audit("audio.edit", f"clip/{clip_id}", f"Clip: {clips[idx].get('name','')}", after=clips[idx])
    return jsonify(ok=True, data=clips[idx])


@app.route("/audio-alerts/audio/templates", methods=["GET"])
def aa_templates_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=_ac_section("templates") or [])


@app.route("/audio-alerts/audio/templates", methods=["POST"])
def aa_templates_post():
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    tpl  = {**data, "id": f"tpl-{uuid.uuid4().hex[:6]}",
            "created_at": datetime.now().isoformat(),
            "created_by": _current_user().get("username", "unknown")}
    cfg = _read_ac()
    cfg.setdefault("templates", []).insert(0, tpl)
    _write_ac(cfg)
    return jsonify(ok=True, data=tpl), 201


@app.route("/audio-alerts/audio/templates/<tpl_id>", methods=["PUT"])
def aa_templates_put(tpl_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg  = _read_ac()
    tpls = cfg.get("templates", [])
    idx  = next((i for i, t in enumerate(tpls) if t["id"] == tpl_id), None)
    if idx is None: return jsonify(ok=False, error="Template not found"), 404
    tpls[idx] = {**tpls[idx], **(request.json or {}), "id": tpl_id,
                 "updated_at": datetime.now().isoformat(),
                 "updated_by": _current_user().get("username", "unknown")}
    cfg["templates"] = tpls
    _write_ac(cfg)
    return jsonify(ok=True, data=tpls[idx])


@app.route("/audio-alerts/audio/templates/<tpl_id>", methods=["DELETE"])
def aa_templates_del(tpl_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.delete"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg  = _read_ac()
    tpls = cfg.get("templates", [])
    tpl  = next((t for t in tpls if t["id"] == tpl_id), None)
    if not tpl: return jsonify(ok=False, error="Template not found"), 404
    cfg["templates"] = [t for t in tpls if t["id"] != tpl_id]
    _write_ac(cfg)
    return jsonify(ok=True, data={"id": tpl_id})


@app.route("/audio-alerts/audio/preview", methods=["POST"])
def aa_preview():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data={"status": "queued",
                                  "preview_id": str(uuid.uuid4()),
                                  **(request.json or {})})


# ============================================================
# AUDIO ALERTS — Devices
# ============================================================

@app.route("/audio-alerts/devices", methods=["GET"])
def aa_devices_get():
    err = _require_login()
    if err: return err
    if not _can("aa.devices.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    return jsonify(ok=True, data=_ac_section("devices") or [])


@app.route("/audio-alerts/devices", methods=["POST"])
def aa_devices_post():
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data   = request.json or {}
    device = {
        **data,
        "id":             data.get("id", f"dev-{uuid.uuid4().hex[:6]}"),
        "last_heartbeat": datetime.now().isoformat(),
        "status":         data.get("status", "online"),
        "metrics":        data.get("metrics", {"cpu":0,"memory":0,"latency_ms":0,"audio_queue":0}),
        "events":         [],
    }
    cfg = _read_ac()
    cfg.setdefault("devices", []).append(device)
    _write_ac(cfg)
    _add_audit("device.add", f"device/{device['id']}", f"Device: {device.get('name','')}", after=device)
    return jsonify(ok=True, data=device), 201


@app.route("/audio-alerts/devices/<dev_id>", methods=["PUT"])
def aa_devices_put(dev_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg     = _read_ac()
    devices = cfg.get("devices", [])
    idx     = next((i for i, d in enumerate(devices) if d["id"] == dev_id), None)
    if idx is None: return jsonify(ok=False, error="Device not found"), 404
    devices[idx] = {**devices[idx], **(request.json or {})}
    cfg["devices"] = devices
    _write_ac(cfg)
    return jsonify(ok=True, data=devices[idx])


@app.route("/audio-alerts/devices/<dev_id>", methods=["DELETE"])
def aa_devices_del(dev_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg     = _read_ac()
    devices = cfg.get("devices", [])
    device  = next((d for d in devices if d["id"] == dev_id), None)
    if not device: return jsonify(ok=False, error="Device not found"), 404
    cfg["devices"] = [d for d in devices if d["id"] != dev_id]
    _write_ac(cfg)
    _add_audit("device.remove", f"device/{dev_id}", f"Device: {device.get('name','')}", before=device)
    return jsonify(ok=True, data={"id": dev_id})


@app.route("/audio-alerts/devices/<dev_id>/test-fire", methods=["POST"])
def aa_device_test(dev_id):
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data={"device_id": dev_id, "status": "test_fired",
                                  "ts": datetime.now().isoformat()})


@app.route("/audio-alerts/devices/<dev_id>/restart", methods=["POST"])
def aa_device_restart(dev_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    return jsonify(ok=True, data={"device_id": dev_id, "status": "restart_queued",
                                  "ts": datetime.now().isoformat()})


# ============================================================
# AUDIO ALERTS — Zones / Plants / Lines
# ============================================================

@app.route("/audio-alerts/plants", methods=["GET"])
def aa_plants_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=_ac_section("plants") or [])


@app.route("/audio-alerts/plants", methods=["POST"])
def aa_plants_post():
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data  = request.json or {}
    plant = {**data, "id": data.get("id") or f"plant-{uuid.uuid4().hex[:6]}"}
    cfg   = _read_ac()
    cfg.setdefault("plants", []).append(plant)
    _write_ac(cfg)
    _add_audit("plant.create", f"plant/{plant['id']}", f"Plant: {plant.get('name','')}", after=plant)
    return jsonify(ok=True, data=plant), 201


@app.route("/audio-alerts/plants/<plant_id>", methods=["PUT"])
def aa_plants_put(plant_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg    = _read_ac()
    plants = cfg.get("plants", [])
    idx    = next((i for i, p in enumerate(plants) if p["id"] == plant_id), None)
    if idx is None: return jsonify(ok=False, error="Plant not found"), 404
    plants[idx] = {**plants[idx], **(request.json or {}), "id": plant_id}
    cfg["plants"] = plants
    _write_ac(cfg)
    return jsonify(ok=True, data=plants[idx])


@app.route("/audio-alerts/plants/<plant_id>", methods=["DELETE"])
def aa_plants_del(plant_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg    = _read_ac()
    plants = cfg.get("plants", [])
    plant  = next((p for p in plants if p["id"] == plant_id), None)
    if not plant: return jsonify(ok=False, error="Plant not found"), 404
    cfg["plants"] = [p for p in plants if p["id"] != plant_id]
    _write_ac(cfg)
    _add_audit("plant.delete", f"plant/{plant_id}", f"Plant: {plant.get('name','')}", before=plant)
    return jsonify(ok=True, data={"id": plant_id})


@app.route("/audio-alerts/lines", methods=["GET"])
def aa_lines_get():
    err = _require_login()
    if err: return err
    lines     = _ac_section("lines") or []
    plant_id  = request.args.get("plant_id")
    if plant_id:
        lines = [l for l in lines if l.get("plant_id") == plant_id]
    return jsonify(ok=True, data=lines)


@app.route("/audio-alerts/lines", methods=["POST"])
def aa_lines_post():
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    line = {**data, "id": data.get("id") or f"l-{uuid.uuid4().hex[:6]}"}
    cfg  = _read_ac()
    cfg.setdefault("lines", []).append(line)
    _write_ac(cfg)
    _add_audit("line.create", f"line/{line['id']}", f"Line: {line.get('name','')}", after=line)
    return jsonify(ok=True, data=line), 201


@app.route("/audio-alerts/lines/<line_id>", methods=["PUT"])
def aa_lines_put(line_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    lines = cfg.get("lines", [])
    idx   = next((i for i, l in enumerate(lines) if l["id"] == line_id), None)
    if idx is None: return jsonify(ok=False, error="Line not found"), 404
    lines[idx] = {**lines[idx], **(request.json or {}), "id": line_id}
    cfg["lines"] = lines
    _write_ac(cfg)
    return jsonify(ok=True, data=lines[idx])


@app.route("/audio-alerts/lines/<line_id>", methods=["DELETE"])
def aa_lines_del(line_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    lines = cfg.get("lines", [])
    line  = next((l for l in lines if l["id"] == line_id), None)
    if not line: return jsonify(ok=False, error="Line not found"), 404
    cfg["lines"] = [l for l in lines if l["id"] != line_id]
    _write_ac(cfg)
    _add_audit("line.delete", f"line/{line_id}", f"Line: {line.get('name','')}", before=line)
    return jsonify(ok=True, data={"id": line_id})


@app.route("/audio-alerts/zones", methods=["GET"])
def aa_zones_get():
    err = _require_login()
    if err: return err
    zones    = _ac_section("zones") or []
    line_id  = request.args.get("line_id")
    plant_id = request.args.get("plant_id")
    if line_id:  zones = [z for z in zones if z.get("line_id")  == line_id]
    if plant_id: zones = [z for z in zones if z.get("plant_id") == plant_id]
    return jsonify(ok=True, data=zones)


@app.route("/audio-alerts/zones", methods=["POST"])
def aa_zones_post():
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    zone = {**data, "id": data.get("id") or f"z-{uuid.uuid4().hex[:6]}",
            "default_language": data.get("default_language", "EN")}
    cfg  = _read_ac()
    cfg.setdefault("zones", []).append(zone)
    _write_ac(cfg)
    _add_audit("zone.create", f"zone/{zone['id']}", f"Zone: {zone.get('name','')}", after=zone)
    return jsonify(ok=True, data=zone), 201


@app.route("/audio-alerts/zones/<zone_id>", methods=["PUT"])
def aa_zones_put(zone_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    zones = cfg.get("zones", [])
    idx   = next((i for i, z in enumerate(zones) if z["id"] == zone_id), None)
    if idx is None: return jsonify(ok=False, error="Zone not found"), 404
    zones[idx] = {**zones[idx], **(request.json or {})}
    cfg["zones"] = zones
    _write_ac(cfg)
    return jsonify(ok=True, data=zones[idx])


@app.route("/audio-alerts/zones/<zone_id>", methods=["DELETE"])
def aa_zones_del(zone_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg   = _read_ac()
    zones = cfg.get("zones", [])
    zone  = next((z for z in zones if z["id"] == zone_id), None)
    if not zone: return jsonify(ok=False, error="Zone not found"), 404
    cfg["zones"] = [z for z in zones if z["id"] != zone_id]
    _write_ac(cfg)
    _add_audit("zone.delete", f"zone/{zone_id}", f"Zone: {zone.get('name','')}", before=zone)
    return jsonify(ok=True, data={"id": zone_id})


@app.route("/audio-alerts/structure", methods=["GET"])
def aa_structure():
    err = _require_login()
    if err: return err
    cfg = _read_ac()
    return jsonify(ok=True, data={
        "plants": cfg.get("plants", []),
        "lines":  cfg.get("lines",  []),
        "zones":  cfg.get("zones",  []),
    })


# ============================================================
# AUDIO ALERTS — Analytics
# ============================================================

@app.route("/audio-alerts/analytics", methods=["GET"])
def aa_analytics():
    err = _require_login()
    if err: return err
    if not _can("aa.analytics.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg  = _read_ac()
    logs = cfg.get("alert_logs", [])
    days = int(request.args.get("days", 30))
    from_date = request.args.get("from")
    to_date   = request.args.get("to")
    if not from_date and days:
        from_dt = (datetime.now() - timedelta(days=days)).date().isoformat()
        from_date = from_dt
    if from_date or to_date:
        logs = [l for l in logs
                if (not from_date or (l.get("timestamp","") or "")[:10] >= from_date)
                and (not to_date   or (l.get("timestamp","") or "")[:10] <= to_date)]

    by_priority = {p: 0 for p in ["CRITICAL","HIGH","MEDIUM","LOW"]}
    by_zone:  dict = {}
    by_date:  dict = {}
    by_code:  dict = {}
    by_shift: dict = {}
    by_ack:   dict = {}
    ack_secs_by_shift: dict = {}
    by_rule:  dict = {}

    for l in logs:
        p  = l.get("priority","LOW")
        z  = l.get("zone","Unknown")
        d  = (l.get("timestamp") or "")[:10]
        ac = l.get("alert_code") or l.get("rule_name","Unknown")
        sh = l.get("shift","Unknown")
        src= l.get("ack_source","Dashboard")
        ri = l.get("rule_id","")
        rn = l.get("rule_name","Unknown")

        by_priority[p] = by_priority.get(p, 0) + 1
        by_zone[z] = by_zone.get(z, 0) + 1
        if d:
            rec = by_date.setdefault(d, {"date":d,"total":0,"CRITICAL":0,"HIGH":0,"MEDIUM":0,"LOW":0})
            rec["total"] += 1; rec[p] = rec.get(p, 0) + 1
        code_rec = by_code.setdefault(ac, {"alert_code":ac,"count":0,"last_triggered":None})
        code_rec["count"] += 1
        ts = l.get("timestamp")
        if ts and (not code_rec["last_triggered"] or ts > code_rec["last_triggered"]):
            code_rec["last_triggered"] = ts
        sh_rec = by_shift.setdefault(sh, {"shift":sh,"total":0,"CRITICAL":0,"HIGH":0,"MEDIUM":0,"LOW":0})
        sh_rec["total"] += 1; sh_rec[p] = sh_rec.get(p, 0) + 1
        by_ack[src] = by_ack.get(src, 0) + 1
        ack_s = l.get("ack_seconds")
        if ack_s and sh:
            ack_secs_by_shift.setdefault(sh, []).append(int(ack_s))
        if ri:
            rr = by_rule.setdefault(ri, {"rule_id":ri,"rule_name":rn,"total_triggers":0,"acked":0,"auto_acks":0,"ack_seconds":[]})
            rr["total_triggers"] += 1
            if l.get("status") in ("Acknowledged","Resolved"): rr["acked"] += 1
            if l.get("ack_source") == "Auto-recovery": rr["auto_acks"] += 1
            if ack_s: rr["ack_seconds"].append(int(ack_s))

    # response_times per shift
    shift_order = ["Morning","Afternoon","Night"]
    def _rt(sh):
        secs = ack_secs_by_shift.get(sh, [])
        avg = int(sum(secs)/len(secs)) if secs else 120
        p95 = sorted(secs)[int(len(secs)*0.95)] if len(secs) >= 20 else avg*2
        return {"shift":sh,"avg_ack_sec":avg,"p95_ack_sec":p95,
                "CRITICAL":max(20,avg//3),"HIGH":max(40,avg//2),"MEDIUM":avg,"LOW":avg*2}
    response_times = [_rt(s) for s in shift_order]

    # rule efficacy
    rule_efficacy = []
    for rr in by_rule.values():
        secs = rr.pop("ack_seconds", [])
        avg  = int(sum(secs)/len(secs)) if secs else 0
        eff  = int(100 * rr["acked"] / rr["total_triggers"]) if rr["total_triggers"] else 0
        rule_efficacy.append({**rr, "avg_ack_sec": avg, "efficacy": eff})
    rule_efficacy.sort(key=lambda r: r["total_triggers"], reverse=True)

    # ack sources
    total_acks = sum(by_ack.values()) or 1
    ack_sources = [{"source":s,"count":c,"pct":round(100*c/total_acks)} for s,c in by_ack.items()]

    # device uptime from devices list
    devices = cfg.get("devices", [])
    device_uptime = [{"device_id":d.get("id"),"name":d.get("name"),
                      "uptime_pct":d.get("uptime_pct",100.0),"downtime_min":d.get("downtime_min",0)}
                     for d in devices]

    return jsonify(ok=True, data={
        "total": len(logs),
        "by_priority": by_priority,
        "by_zone": by_zone,
        "daily": sorted(by_date.values(), key=lambda x: x["date"]),
        "alert_frequency": sorted(by_code.values(), key=lambda x: -x["count"]),
        "shifts": [by_shift.get(s, {"shift":s,"total":0,"CRITICAL":0,"HIGH":0,"MEDIUM":0,"LOW":0}) for s in shift_order],
        "response_times": response_times,
        "device_uptime": device_uptime,
        "ack_sources": ack_sources,
        "rule_efficacy": rule_efficacy,
        "false_alerts": [l for l in logs if l.get("status") == "false_alert"],
    })


# ============================================================
# AUDIO ALERTS — Logs
# ============================================================

@app.route("/audio-alerts/logs/alerts", methods=["GET"])
def aa_logs_alerts():
    err = _require_login()
    if err: return err
    if not _can("aa.logs.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg      = _read_ac()
    logs     = cfg.get("alert_logs", [])
    page     = max(1, int(request.args.get("page", 1)))
    size     = max(1, min(200, int(request.args.get("page_size", 50))))
    priority = request.args.get("priority")
    zone     = request.args.get("zone")
    status   = request.args.get("status")
    if priority: logs = [l for l in logs if l.get("priority") == priority]
    if zone:     logs = [l for l in logs if l.get("zone")     == zone]
    if status:   logs = [l for l in logs if l.get("status")   == status]
    total = len(logs)
    start = (page - 1) * size
    return jsonify(ok=True, data={
        "items": logs[start:start+size], "total": total,
        "page": page, "page_size": size,
        "pages": max(1, (total + size - 1) // size),
    })


@app.route("/audio-alerts/logs/audit", methods=["GET"])
def aa_logs_audit():
    err = _require_login()
    if err: return err
    if not _can("aa.audit.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg    = _read_ac()
    logs   = cfg.get("audit_logs", [])
    page   = max(1, int(request.args.get("page", 1)))
    size   = max(1, min(200, int(request.args.get("page_size", 50))))
    action = request.args.get("action")
    user   = request.args.get("user")
    if action: logs = [l for l in logs if l.get("action") == action]
    if user:   logs = [l for l in logs if l.get("user")   == user]
    total = len(logs)
    start = (page - 1) * size
    return jsonify(ok=True, data={
        "items": logs[start:start+size], "total": total,
        "page": page, "page_size": size,
        "pages": max(1, (total + size - 1) // size),
    })


# ============================================================
# AUDIO ALERTS — Security Settings
# ============================================================

@app.route("/audio-alerts/security", methods=["GET"])
def aa_security_get():
    err = _require_login()
    if err: return err
    if not _can("aa.security.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg = _read_ac()
    return jsonify(ok=True, data=cfg.get("security", DEFAULT_ALERTS_CONFIG["security"]))


@app.route("/audio-alerts/security", methods=["PUT"])
def aa_security_put():
    err = _require_login()
    if err: return err
    if not _can("aa.security.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    cfg  = _read_ac()
    cfg["security"] = {**cfg.get("security", {}), **data}
    _write_ac(cfg)
    _add_audit("config.change", "config/security", "Security Settings", after=data)
    return jsonify(ok=True, data=cfg["security"])


# ============================================================
# BOOTSTRAP & STARTUP
# ============================================================

def _seed_db():
    """Seed DB with default users if empty. Default password for all: gateway"""
    if User.query.count() > 0:
        log.info("DB already has users — skipping seed")
        return
    SEED = [
        ("superadmin",  "administrator",         ["plant-1","plant-2","plant-3"], [], [],                      ["Morning","Afternoon","Night"]),
        ("admin",       "plant_manager",          ["plant-1","plant-2"],           [], [],                      ["Morning","Afternoon","Night"]),
        ("engineer1",   "process_engineer",       ["plant-1"],                    ["l1-1","l1-2"], [],          ["Morning","Afternoon"]),
        ("supervisor1", "shift_supervisor",       ["plant-1"],                    ["l1-1"], ["z002","z003","z004"], ["Morning"]),
        ("operator1",   "operator",               ["plant-1"],                    ["l1-1"], ["z002","z003"],    ["Morning"]),
        ("operator2",   "operator",               ["plant-2"],                    ["l2-1"], ["z007","z008"],    ["Afternoon"]),
        ("tech1",       "maintenance_technician", ["plant-1","plant-2"],           [], [],                      ["Morning","Afternoon","Night"]),
        ("auditor1",    "auditor",                ["plant-1","plant-2","plant-3"], [], [],                      ["Morning","Afternoon","Night"]),
    ]
    for username, role, plant_scope, line_scope, zone_scope, shift_scope in SEED:
        pw = bcrypt.hashpw(b"gateway", bcrypt.gensalt()).decode()
        u  = User(username=username, password_hash=pw, role=role,
                  plant_scope=plant_scope, line_scope=line_scope,
                  zone_scope=zone_scope, shift_scope=shift_scope,
                  status="Active", created_at=datetime.now())
        db.session.add(u)
    db.session.commit()
    log.info("DB seeded with %d default users (password: gateway)", len(SEED))


if __name__ == "__main__":
    log = setup_logging()
    log.info("Starting Gateway Configuration UI")
    with app.app_context():
        for attempt in range(10):
            if is_mysql_up():
                try:
                    db.create_all()
                    log.info("Database tables ready")
                    _seed_db()
                    break
                except Exception as exc:
                    log.error("DB init failed: %s", exc)
            else:
                log.warning("MySQL not reachable (attempt %d/10) …", attempt + 1)
            time.sleep(2)

    sc   = _read_sc()
    host = sc.get("app", {}).get("server_host", "0.0.0.0")
    port = sc.get("app", {}).get("server_port", 8000)
    log.info("Listening on %s:%s", host, port)
    app.run(host=host, port=port, threaded=True)
