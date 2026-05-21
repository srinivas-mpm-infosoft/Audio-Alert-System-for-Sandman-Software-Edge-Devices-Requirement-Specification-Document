#!/usr/bin/env python3
"""
Gateway Configuration UI — Flask Backend (SQL-backed)

This version replaces alerts_config.json as the source of truth for everything
operational (rules, devices, channels, readings, alert events, audit logs).

Files still used:
  - config.json          : Modbus / gateway / IO config (Admin Settings page)
  - system_config.json   : Infrastructure (DB creds, CORS, GPIO pins, log paths)

All audio-alerts data now lives in MariaDB. See schema.sql for DDL.
"""

import json
import os
import uuid
import bcrypt
import logging
import socket
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path
from decimal import Decimal

from flask import Flask, request, jsonify, send_from_directory, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import (
    text, func, and_, or_, desc, asc, Index,
    Column, Integer, BigInteger, String, Text, DateTime, Boolean, JSON,
    ForeignKey, Enum, Numeric, SmallInteger,
)
from sqlalchemy.orm import relationship


# ============================================================
# STATIC PATHS  (only BASE is fixed; everything else is configurable)
# ============================================================

BASE               = Path("/home/srinivas/ReComputer-r1125-Gateway-UI-All-test/Main Application")
STATIC             = BASE / "static"
CONFIG_FILE        = BASE / "config.json"
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

# Static catalogues (these never change at runtime — kept in code)
LANGUAGES = [
    {"code": "EN", "label": "English",  "flag": "🇬🇧"},
    {"code": "HI", "label": "Hindi",    "flag": "🇮🇳"},
    {"code": "TA", "label": "Tamil",    "flag": "🇮🇳"},
    {"code": "MR", "label": "Marathi",  "flag": "🇮🇳"},
    {"code": "GU", "label": "Gujarati", "flag": "🇮🇳"},
    {"code": "TE", "label": "Telugu",   "flag": "🇮🇳"},
]
ZONE_TYPES = ["Melting", "Moulding", "Mulling", "Cooling", "Sand Prep", "Pouring", "Custom"]

# Parameter catalogue — units / labels for the channel_key namespace
PARAMETER_CATALOG = [
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
]

# Audio / engine defaults (in-memory; admin can override via /audio-alerts/config/audio)
_audio_config_runtime = {
    "master_volume": 80,
    "zone_volumes": {},
    "priority_offsets": {"CRITICAL": 6, "HIGH": 0, "MEDIUM": -3, "LOW": -6},
    "audio_types": {"CRITICAL": "siren", "HIGH": "voice", "MEDIUM": "beep", "LOW": "voice"},
}
_engine_runtime = {
    "status": "running",
    "speakers_up": 0, "speakers_total": 0,
    "gateways_up": 0, "gateways_total": 0,
    "last_sync": None,
}
# In-memory role permissions cache (loaded from DB-backed config if present)
_role_permissions_runtime = dict(DEFAULT_ROLE_PERMISSIONS)
_security_runtime = {
    "password_min_length":   8,
    "password_complexity":   True,
    "password_rotation_days":90,
    "password_history_count":5,
    "mfa_required":        {r: (r == "administrator") for r in VALID_ROLES},
    "session_timeout_min": {"administrator":480,"plant_manager":480,"process_engineer":480,"shift_supervisor":60,"operator":30,"maintenance_technician":60,"auditor":480},
    "ip_allowlist": [],
    "api_tokens":   [],
}

# ============================================================
# SYSTEM CONFIG  (system_config.json)
# ============================================================

DEFAULT_SYSTEM_CONFIG = {
    "app": {
        "server_host":          "0.0.0.0",
        "server_port":          8000,
        "log_root":             "/home/srinivas/logs",
        "session_lifetime_days": 365,
        "cookie_secure":        False,
        "cookie_samesite":      "Lax",
    },
    "database": {
        "host":     "localhost",
        "port":     3306,
        "name":     "gateway",
        "user":     "gateway",
        "password": "Gateway%402025",
    },
    "cors_origins": [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174"
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
        "reading_freshness_sec":      30,
    },
}

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
    global _sc_mtime
    _sc_mtime = 0.0


if not SYSTEM_CONFIG_FILE.exists():
    _write_sc(DEFAULT_SYSTEM_CONFIG)

_startup_sc = _read_sc()
_app_cfg    = _startup_sc.get("app",      DEFAULT_SYSTEM_CONFIG["app"])
_db_cfg     = _startup_sc.get("database", DEFAULT_SYSTEM_CONFIG["database"])

# Initialise legacy config-files (untouched logic from original)
for _f, _d in {
    CONFIG_FILE: {}, UPDATES_FILE: [],
    IS_FILE_TO_DB_UPDATED: False, IS_UPDATED_FILE: False,
}.items():
    if not _f.exists():
        _f.write_text(json.dumps(_d, indent=2))


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
# DATABASE
# ============================================================

def _build_db_uri(db: dict) -> str:
    return (
        f"mysql+pymysql://{db.get('user','gateway')}:{db.get('password','gateway')}"
        f"@{db.get('host','localhost')}:{db.get('port',3306)}/{db.get('name','gateway')}"
        f"?charset=utf8mb4"          # ← this is the only addition
    )


app.config["SQLALCHEMY_DATABASE_URI"]        = _build_db_uri(_db_cfg)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"]      = {"pool_pre_ping": True, "pool_recycle": 1800}

db = SQLAlchemy(app)


# ============================================================
# LOGGING
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
# MODELS
# ============================================================

class User(db.Model):
    __tablename__ = "user_details"
    id            = Column(Integer, primary_key=True)
    username      = Column(String(255), unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    role          = Column(String(50), nullable=False, default="operator")
    plant_scope   = Column(JSON, default=list)
    line_scope    = Column(JSON, default=list)
    zone_scope    = Column(JSON, default=list)
    shift_scope   = Column(JSON, default=list)
    last_login    = Column(DateTime, nullable=True)
    status        = Column(String(20), default="Active")
    created_at    = Column(DateTime, default=datetime.now)

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


class DataSource(db.Model):
    __tablename__ = "data_sources"
    id          = Column(Integer, primary_key=True)
    code        = Column(String(32), unique=True, nullable=False)
    label       = Column(String(128), nullable=False)
    transport   = Column(String(32), nullable=False)
    config      = Column(JSON)
    is_enabled  = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id": self.id, "code": self.code, "label": self.label,
            "transport": self.transport, "config": self.config or {},
            "is_enabled": bool(self.is_enabled),
        }


class Plant(db.Model):
    __tablename__ = "plants"
    id       = Column(String(32), primary_key=True)
    name     = Column(String(128), nullable=False)
    location = Column(String(255))

    def to_dict(self):
        return {"id": self.id, "name": self.name, "location": self.location or ""}


class Line(db.Model):
    __tablename__ = "production_lines"
    id        = Column(String(32), primary_key=True)
    plant_id  = Column(String(32), ForeignKey("plants.id", ondelete="CASCADE"), nullable=False)
    name      = Column(String(128), nullable=False)

    def to_dict(self):
        return {"id": self.id, "plant_id": self.plant_id, "name": self.name}


class Zone(db.Model):
    __tablename__ = "zones"
    id               = Column(Integer, primary_key=True)
    zone_code        = Column(String(32), unique=True, nullable=False)
    line_id          = Column(String(32), ForeignKey("production_lines.id", ondelete="CASCADE"), nullable=False)
    plant_id         = Column(String(32), ForeignKey("plants.id", ondelete="CASCADE"), nullable=False)
    name             = Column(String(128), nullable=False)
    zone_type        = Column(String(64))
    default_language = Column(String(8), default="EN")

    def to_dict(self):
        return {
            "id": self.zone_code, "db_id": self.id,
            "line_id": self.line_id, "plant_id": self.plant_id,
            "name": self.name, "type": self.zone_type,
            "default_language": self.default_language or "EN",
        }


class Device(db.Model):
    __tablename__ = "devices"
    id             = Column(Integer, primary_key=True)
    data_source_id = Column(Integer, ForeignKey("data_sources.id"), nullable=False)
    name           = Column(String(128), unique=True, nullable=False)
    label          = Column(String(255), nullable=False)
    device_type    = Column(String(64))
    address        = Column(String(128))
    slave_id       = Column(Integer)
    zone_id        = Column(Integer, ForeignKey("zones.id", ondelete="SET NULL"))
    firmware       = Column(String(32))
    status         = Column(String(16), default="unknown")
    last_seen      = Column(DateTime)
    device_metadata= Column("metadata", JSON)
    created_at     = Column(DateTime, default=datetime.now)
    updated_at     = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    zone           = relationship("Zone", foreign_keys=[zone_id])

    def to_dict(self):
        zone_obj = self.zone
        meta = self.device_metadata or {}
        return {
            "id":            f"dev-{self.id}",
            "db_id":         self.id,
            "name":          self.label,
            "type":          self.device_type or "Device",
            "data_source_id":self.data_source_id,
            "zone_id":       zone_obj.zone_code if zone_obj else None,
            "zone_name":     zone_obj.name if zone_obj else None,
            "address":       self.address,
            "slave_id":      self.slave_id,
            "firmware":      self.firmware,
            "status":        self.status,
            "last_seen":     self.last_seen.isoformat() if self.last_seen else None,
            "uptime_pct":    meta.get("uptime_pct", 100.0),
            "downtime_min":  meta.get("downtime_min", 0),
            "metrics":       meta.get("metrics", {"cpu":0,"memory":0,"latency_ms":0,"audio_queue":0}),
            "protocol":      meta.get("protocol"),
            "mqtt_topic":    meta.get("mqtt_topic"),
            "audio_channel": meta.get("audio_channel"),
            "volume_override": meta.get("volume_override"),
            "plant":         zone_obj.plant_id if zone_obj else None,
            "line":          zone_obj.line_id  if zone_obj else None,
        }


class Channel(db.Model):
    __tablename__ = "channels"
    id              = Column(Integer, primary_key=True)
    device_id       = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    channel_key     = Column(String(64), unique=True, nullable=False)
    channel_name    = Column(String(128), nullable=False)
    tag             = Column(String(128))
    sensor_type     = Column(String(64))
    unit            = Column(String(32))
    register_type   = Column(String(32))
    register_addr   = Column(Integer)
    mqtt_topic      = Column(String(255))
    process_min     = Column(Numeric(15,4))
    process_max     = Column(Numeric(15,4))
    scale_factor    = Column(Numeric(15,6), default=1)
    offset_value    = Column(Numeric(15,4), default=0)
    poll_interval_ms= Column(Integer, default=1000)
    is_enabled      = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.now)
    updated_at      = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self):
        return {
            "id":             self.id,
            "device_id":      self.device_id,
            "channel_key":    self.channel_key,
            "channel_name":   self.channel_name,
            "tag":            self.tag,
            "sensor_type":    self.sensor_type,
            "unit":           self.unit,
            "register_type":  self.register_type,
            "register_addr":  self.register_addr,
            "mqtt_topic":     self.mqtt_topic,
            "process_min":    float(self.process_min) if self.process_min is not None else None,
            "process_max":    float(self.process_max) if self.process_max is not None else None,
            "scale_factor":   float(self.scale_factor) if self.scale_factor is not None else 1,
            "offset_value":   float(self.offset_value) if self.offset_value is not None else 0,
            "poll_interval_ms": self.poll_interval_ms,
            "is_enabled":     bool(self.is_enabled),
        }


class SensorReading(db.Model):
    __tablename__ = "sensor_readings"
    id         = Column(BigInteger, primary_key=True)
    channel_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    value      = Column(Numeric(15,4), nullable=False)
    quality    = Column(SmallInteger, default=1)
    ts         = Column(DateTime, default=datetime.now)


class ChannelLatest(db.Model):
    __tablename__ = "channel_latest"
    channel_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True)
    value      = Column(Numeric(15,4), nullable=False)
    quality    = Column(SmallInteger, default=1)
    ts         = Column(DateTime, nullable=False)


class AudioClip(db.Model):
    __tablename__ = "audio_clips"
    id             = Column(Integer, primary_key=True)
    clip_code      = Column(String(32), unique=True, nullable=False)
    name           = Column(String(255), nullable=False)
    alert_code     = Column(String(64))
    language       = Column(String(8), nullable=False)
    language_label = Column(String(64))
    duration_sec   = Column(Integer)
    file_size      = Column(Integer)
    format         = Column(String(16))
    file_path      = Column(String(512))
    description    = Column(Text)
    uploaded_by    = Column(String(64))
    upload_date    = Column(DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id":             self.clip_code,
            "db_id":          self.id,
            "name":           self.name,
            "alert_code":     self.alert_code,
            "language":       self.language,
            "language_label": self.language_label,
            "duration_sec":   self.duration_sec,
            "file_size":      self.file_size,
            "format":         self.format,
            "file_path":      self.file_path,
            "description":    self.description,
            "uploaded_by":    self.uploaded_by,
            "upload_date":    self.upload_date.isoformat() if self.upload_date else None,
        }


class TtsTemplate(db.Model):
    __tablename__ = "tts_templates"
    id            = Column(Integer, primary_key=True)
    template_code = Column(String(32), unique=True, nullable=False)
    name          = Column(String(255), nullable=False)
    alert_code    = Column(String(64))
    language      = Column(String(8), nullable=False)
    voice         = Column(String(32))
    tone          = Column(String(32))
    body          = Column(Text, nullable=False)
    variables     = Column(JSON)
    created_by    = Column(String(64))
    created_at    = Column(DateTime, default=datetime.now)
    updated_at    = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self):
        return {
            "id":         self.template_code,
            "db_id":      self.id,
            "name":       self.name,
            "alert_code": self.alert_code,
            "language":   self.language,
            "voice":      self.voice,
            "tone":       self.tone,
            "body":       self.body,
            "variables":  self.variables or [],
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AlertRule(db.Model):
    __tablename__ = "alert_rules"
    id                       = Column(Integer, primary_key=True)
    rule_code                = Column(String(32), unique=True, nullable=False)
    name                     = Column(String(255), nullable=False)
    alert_code               = Column(String(64), nullable=False)
    priority                 = Column(String(16), nullable=False)
    category                 = Column(String(64))
    status                   = Column(String(16), default="Draft")
    condition_logic          = Column(String(8), default="AND")
    persistence_type         = Column(String(16), default="cycles")
    persistence_value        = Column(Integer, default=1)
    persistence_unit         = Column(String(16))
    freshness_max_age_sec    = Column(Integer, default=30)
    audio_mode               = Column(String(16), default="tts")
    tts_template_id          = Column(Integer, ForeignKey("tts_templates.id", ondelete="SET NULL"))
    clip_id                  = Column(Integer, ForeignKey("audio_clips.id",   ondelete="SET NULL"))
    language_override        = Column(String(8))
    volume_override          = Column(Integer)
    audio_type               = Column(String(16))
    use_default_escalation   = Column(Boolean, default=True)
    escalation_steps         = Column(JSON)
    notify_emails            = Column(JSON)
    trigger_count            = Column(Integer, default=0)
    test_trigger_count       = Column(Integer, default=0)
    test_expires_at          = Column(DateTime)
    last_triggered           = Column(DateTime)
    created_by               = Column(String(64))
    created_at               = Column(DateTime, default=datetime.now)
    updated_at               = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    conditions   = relationship("AlertRuleCondition", backref="rule", cascade="all, delete-orphan", lazy="joined")
    zone_links   = relationship("AlertRuleZone",      backref="rule", cascade="all, delete-orphan", lazy="joined")
    tts_template = relationship("TtsTemplate", foreign_keys=[tts_template_id])
    clip         = relationship("AudioClip",   foreign_keys=[clip_id])

    def to_dict(self):
        # Resolve zone codes & names from the joined zones
        zone_ids   = []
        zone_names = []
        for link in self.zone_links:
            z = link.zone
            if z:
                zone_ids.append(z.zone_code)
                zone_names.append(z.name)
        return {
            "id":                     self.rule_code,
            "db_id":                  self.id,
            "name":                   self.name,
            "alert_code":             self.alert_code,
            "priority":               self.priority,
            "category":               self.category,
            "status":                 self.status,
            "conditions":             [c.to_dict() for c in self.conditions],
            "condition_logic":        self.condition_logic,
            "persistence_type":       self.persistence_type,
            "persistence_value":      self.persistence_value,
            "persistence_unit":       self.persistence_unit,
            "freshness_max_age_sec":  self.freshness_max_age_sec,
            "zone_ids":               zone_ids,
            "zones":                  zone_names,
            "audio_mode":             self.audio_mode,
            "tts_template_id":        self.tts_template.template_code if self.tts_template else None,
            "clip_id":                self.clip.clip_code if self.clip else None,
            "language_override":      self.language_override,
            "volume_override":        self.volume_override,
            "audio_type":             self.audio_type,
            "use_default_escalation": bool(self.use_default_escalation),
            "escalation_steps":       self.escalation_steps or [],
            "notify_emails":          self.notify_emails or [],
            "trigger_count":          self.trigger_count or 0,
            "test_trigger_count":     self.test_trigger_count or 0,
            "test_expires_at":        self.test_expires_at.isoformat() if self.test_expires_at else None,
            "last_triggered":         self.last_triggered.isoformat() if self.last_triggered else None,
            "created_by":             self.created_by,
            "created_at":             self.created_at.isoformat() if self.created_at else None,
            "updated_at":             self.updated_at.isoformat() if self.updated_at else None,
        }


class AlertRuleCondition(db.Model):
    __tablename__ = "alert_rule_conditions"
    id          = Column(Integer, primary_key=True)
    rule_id     = Column(Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False)
    channel_key = Column(String(64), nullable=False)
    operator    = Column(String(8), nullable=False)
    value_low   = Column(Numeric(15,4))
    value_high  = Column(Numeric(15,4))
    unit        = Column(String(32))
    seq         = Column(Integer, default=0)

    def to_dict(self):
        d = {
            "parameter":  self.channel_key,
            "operator":   self.operator,
            "value":      float(self.value_low) if self.value_low is not None else None,
            "unit":       self.unit,
            "seq":        self.seq or 0,
        }
        if self.operator in ("between", "outside") and self.value_high is not None:
            d["value_high"] = float(self.value_high)
        return d


class AlertRuleZone(db.Model):
    __tablename__ = "alert_rule_zones"
    rule_id = Column(Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), primary_key=True)
    zone_id = Column(Integer, ForeignKey("zones.id",       ondelete="CASCADE"), primary_key=True)
    zone    = relationship("Zone", foreign_keys=[zone_id])


class AlertEvent(db.Model):
    __tablename__ = "alert_events"
    id                = Column(BigInteger, primary_key=True)
    rule_id           = Column(Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False)
    rule_code         = Column(String(32), nullable=False)
    rule_name         = Column(String(255))
    alert_code        = Column(String(64))
    priority          = Column(String(16))
    zone_id           = Column(Integer, ForeignKey("zones.id", ondelete="SET NULL"))
    zone_name         = Column(String(128))
    shift             = Column(String(16))
    status            = Column(String(16), default="Active")
    triggered_at      = Column(DateTime, default=datetime.now)
    ack_by            = Column(String(64))
    ack_source        = Column(String(32))
    ack_at            = Column(DateTime)
    ack_seconds       = Column(Integer)
    resolved_at       = Column(DateTime)
    trigger_snapshot  = Column(JSON)

    def to_dict(self):
        snap = self.trigger_snapshot or {}
        event_id = f"log-{self.id}"
        return {
            # ID fields — alert_id is the primary key used by frontend components
            "id":              event_id,
            "alert_id":        event_id,
            "db_id":           self.id,
            # Rule / alert identity
            "rule_id":         self.rule_code,
            "rule_name":       self.rule_name,
            "alert_code":      self.alert_code or self.rule_code,
            "message":         self.rule_name or "",
            "priority":        self.priority,
            # Location
            "zone":            self.zone_name or "",
            "zone_id":         self.zone_id,
            "plant":           "",
            "line":            "",
            "shift":           self.shift,
            # Timing / status
            "status":          self.status,
            "timestamp":       self.triggered_at.isoformat() if self.triggered_at else None,
            "escalation_step": 0,
            "repeat_count":    0,
            "playback_status": "idle",
            # Ack fields — ack_time is used by store/UI, ack_at is DB column
            "ack_required":    True,
            "ack_time":        self.ack_at.isoformat() if self.ack_at else None,
            "ack_by":          self.ack_by,
            "ack_source":      self.ack_source,
            "ack_at":          self.ack_at.isoformat() if self.ack_at else None,
            "ack_seconds":     self.ack_seconds,
            "resolved_at":     self.resolved_at.isoformat() if self.resolved_at else None,
            # Trigger data from snapshot
            "trigger_value":    snap.get("trigger_value"),
            "threshold":        snap.get("threshold"),
            "unit":             snap.get("unit", ""),
            "source_parameter": next(
                (k for k, v in snap.items()
                 if isinstance(v, dict) and v.get("hit") and k not in ("trigger_value","threshold","unit")),
                None
            ),
            "snapshot":         snap,
        }


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id           = Column(BigInteger, primary_key=True)
    event_code   = Column(String(32))
    user         = Column(String(64))
    action       = Column(String(64), nullable=False)
    target       = Column(String(255))
    target_label = Column(String(255))
    before_data  = Column(JSON)
    after_data   = Column(JSON)
    ip           = Column(String(45))
    ts           = Column(DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id":           self.event_code or f"aud-{self.id}",
            "db_id":        self.id,
            "timestamp":    self.ts.isoformat() if self.ts else None,
            "user":         self.user,
            "action":       self.action,
            "target":       self.target,
            "target_label": self.target_label,
            "before":       self.before_data,
            "after":        self.after_data,
            "ip":           self.ip,
        }



class AppLanguage(db.Model):
    __tablename__ = "app_languages"
    __table_args__ = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}
 
    id    = Column(Integer, primary_key=True)
    code  = Column(String(8),  unique=True, nullable=False)
    label = Column(String(64), nullable=False)
    flag  = Column(String(16), nullable=True)   # wider + nullable so legacy rows don't break
 
    def to_dict(self):
        return {
            "id":    self.id,
            "code":  self.code,
            "label": self.label,
            "flag":  self.flag or "🌐",
        }

 
 
class AppZoneType(db.Model):
    __tablename__ = "app_zone_types"
    id    = Column(Integer, primary_key=True)
    label = Column(String(64), unique=True, nullable=False)
 
    def to_dict(self):
        return {"id": self.id, "label": self.label}

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
    return permission in _role_permissions_runtime.get(_rbac_role(), [])


def _is_admin() -> bool:
    return _rbac_role() in ("administrator", "plant_manager")


def _add_audit(action: str, target: str, target_label: str,
               before=None, after=None):
    try:
        entry = AuditLog(
            event_code   = f"aud-{uuid.uuid4().hex[:8]}",
            user         = _current_user().get("username", "system"),
            action       = action,
            target       = target,
            target_label = target_label,
            before_data  = before,
            after_data   = after,
            ip           = request.remote_addr,
            ts           = datetime.now(),
        )
        db.session.add(entry)
        db.session.commit()

        # Cap audit log size
        sc       = _read_sc()
        max_logs = sc.get("alerts_limits", {}).get("audit_log_max", 2000)
        count = db.session.query(func.count(AuditLog.id)).scalar() or 0
        if count > max_logs:
            cutoff = db.session.query(AuditLog.id).order_by(AuditLog.ts.desc()).offset(max_logs).limit(1).scalar()
            if cutoff:
                db.session.query(AuditLog).filter(AuditLog.id <= cutoff).delete(synchronize_session=False)
                db.session.commit()
    except Exception as e:
        log.error("Audit write failed: %s", e)
        db.session.rollback()


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
# SYSTEM CONFIG
# ============================================================

@app.route("/system-config", methods=["GET"])
def get_system_config():
    err = _require_login()
    if err: return err
    if not _is_admin():
        return jsonify(ok=False, error="Forbidden"), 403
    sc = _read_sc()
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
    for section, incoming in data.items():
        if section not in DEFAULT_SYSTEM_CONFIG:
            continue
        if isinstance(incoming, dict) and isinstance(current.get(section), dict):
            current[section] = {**current.get(section, {}), **incoming}
        else:
            current[section] = incoming
    _write_sc(current)
    log.info("SYSTEM_CONFIG updated by=%s", _current_user().get("username"))
    _add_audit("config.change", "system/config", "System Configuration", after=data)
    return jsonify(ok=True, data=current)


# ============================================================
# USERS
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
    if "role" in data:
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


@app.route("/audio-alerts/users", methods=["GET"])
def aa_users_get():  return list_users()
@app.route("/audio-alerts/users", methods=["POST"])
def aa_users_post(): return create_user()
@app.route("/audio-alerts/users/<int:uid>", methods=["PUT"])
def aa_users_put(uid):  return update_user(uid)
@app.route("/audio-alerts/users/<int:uid>", methods=["DELETE"])
def aa_users_del(uid):  return delete_user(uid)


# ============================================================
# ROLE PERMISSIONS  (in-memory, defaults are stable)
# ============================================================

@app.route("/roles/permissions", methods=["GET"])
def get_role_permissions():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=_role_permissions_runtime)


@app.route("/roles/permissions", methods=["PUT"])
def update_all_role_permissions():
    err = _require_login()
    if err: return err
    if not _can("aa.users.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    _role_permissions_runtime.update(data)
    _add_audit("config.change", "config/role_permissions", "Role Permissions (bulk)", after=data)
    return jsonify(ok=True, data=_role_permissions_runtime)


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
    _role_permissions_runtime[role] = perms
    _add_audit("config.change", f"roles/{role}", f"Role Permissions: {role}",
               after={"role": role, "permissions": perms})
    return jsonify(ok=True, data=_role_permissions_runtime)


# ============================================================
# GPIO STATUS
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
# LEGACY CONFIG (Modbus / IO via config.json)
# ============================================================


# ============================================================
# CONFIG.JSON ➜ DEVICES + CHANNELS SYNC
# ============================================================

import re as _re_sync


def _slugify(s: str) -> str:
    """'Analog Input 1' -> 'analog_input_1'"""
    s = _re_sync.sub(r"[^A-Za-z0-9]+", "_", str(s).strip().lower())
    return s.strip("_")


def _cfg_float(v, default=None):
    if v in (None, "", "null"): return default
    try: return float(v)
    except (TypeError, ValueError): return default


def _cfg_int(v, default=None):
    if v in (None, "", "null"): return default
    try: return int(v)
    except (TypeError, ValueError): return default


def _sync_rtu_devices(cfg: dict, ds_id: int, seen_keys: set) -> tuple[int, int]:
    """Walk ModbusRTU.Devices.brands and upsert devices+channels."""
    brands = cfg.get("ModbusRTU", {}).get("Devices", {}).get("brands", {}) or {}
    dev_count = ch_count = 0

    for brand_key, brand in brands.items():
        label         = brand.get("label", brand_key.replace("_", " ").title())
        regs_by_slave = brand.get("registersBySlave", {}) or {}
        slaves_meta   = {str(s.get("id")): s for s in (brand.get("slaves") or [])}

        for slave_id_str, regs in regs_by_slave.items():
            slave_id   = _cfg_int(slave_id_str)
            slave_meta = slaves_meta.get(slave_id_str, {})
            poll_sec   = _cfg_int(slave_meta.get("pollingInterval"), 1)
            poll_unit  = (slave_meta.get("pollingIntervalUnit") or "Sec").lower()
            poll_ms    = (poll_sec * 1000 if poll_unit.startswith("sec")
                          else poll_sec * 60_000 if poll_unit.startswith("min")
                          else poll_sec)

            dev_name = f"{brand_key}_s{slave_id}"

            # Upsert device by unique `name`
            device = Device.query.filter_by(name=dev_name).first()
            if not device:
                device = Device(name=dev_name)
                db.session.add(device)
            device.data_source_id = ds_id
            device.label          = f"{label} (Slave {slave_id})"
            device.device_type    = "Modbus RTU Slave"
            device.address        = slave_meta.get("rs485_port")
            device.slave_id       = slave_id
            device.device_metadata = {
                "brand_key":   brand_key,
                "rs485_port":  slave_meta.get("rs485_port"),
                "baudRate":    slave_meta.get("baudRate"),
                "parity":      slave_meta.get("parity"),
                "stopBits":    slave_meta.get("stopBits"),
                "table_name":  slave_meta.get("table_name"),
                "polling_sec": poll_sec,
            }
            db.session.flush()   # we need device.id below
            dev_count += 1

            for reg in regs or []:
                rname = reg.get("name") or f"reg_{reg.get('start')}"
                key   = f"{brand_key}_s{slave_id}_{_slugify(rname)}"
                seen_keys.add(key)

                ch = Channel.query.filter_by(channel_key=key).first()
                if not ch:
                    ch = Channel(channel_key=key)
                    db.session.add(ch)
                ch.device_id        = device.id
                ch.channel_name     = rname
                ch.tag              = reg.get("sensor_type")
                ch.sensor_type      = reg.get("sensor_type")
                ch.unit             = reg.get("eng_symbol")
                ch.register_type    = reg.get("type")
                ch.register_addr    = _cfg_int(reg.get("start"))
                ch.process_min      = _cfg_float(reg.get("process_min"))
                ch.process_max      = _cfg_float(reg.get("process_max"))
                mul = _cfg_float(reg.get("multiply"), 1)
                div = _cfg_float(reg.get("divide"), 1) or 1
                ch.scale_factor     = mul / div
                ch.offset_value     = _cfg_float(reg.get("offset"), 0)
                ch.poll_interval_ms = poll_ms
                ch.is_enabled       = bool(reg.get("enabled", True))
                ch_count += 1

    return dev_count, ch_count


def _sync_tcp_plcs(cfg: dict, ds_id: int, seen_keys: set) -> tuple[int, int]:
    """Walk plc_configurations[] and upsert devices+channels."""
    dev_count = ch_count = 0
    for plc in cfg.get("plc_configurations", []) or []:
        if not plc.get("enabled", True):
            continue
        plc_type  = plc.get("plcType", "PLC")
        cred      = plc.get("PLC", {}).get("cred", {}) or {}
        ip        = cred.get("ip", "")
        access    = plc.get("PLC", {}).get("address_access", {}) or {}
        freq_sec  = _cfg_int(plc.get("PLC", {}).get("data_freq_sec"), 5)
        brand_key = _slugify(plc_type)

        dev_name = f"plc_{brand_key}_{_slugify(ip) or 'na'}"

        device = Device.query.filter_by(name=dev_name).first()
        if not device:
            device = Device(name=dev_name)
            db.session.add(device)
        device.data_source_id  = ds_id
        device.label           = f"{plc_type} PLC ({ip})"
        device.device_type     = "Modbus TCP PLC"
        device.address         = ip
        device.slave_id        = None
        device.device_metadata = {
            "plc_type":    plc_type,
            "brand_key":   brand_key,
            "rack":        cred.get("rack"),
            "slot":        cred.get("slot"),
            "port":        cred.get("port", 502),
            "polling_sec": freq_sec,
            "table_name":  plc.get("PLC", {}).get("Database", {}).get("table_name"),
        }
        db.session.flush()
        dev_count += 1

        for reg in access.get("read", []) or []:
            if not reg.get("read", True):
                continue
            tag = reg.get("tag") or reg.get("content") or f"addr_{reg.get('address')}"
            key = f"plc_{brand_key}_{_slugify(tag)}"
            seen_keys.add(key)

            ch = Channel.query.filter_by(channel_key=key).first()
            if not ch:
                ch = Channel(channel_key=key)
                db.session.add(ch)
            ch.device_id        = device.id
            ch.channel_name     = tag
            ch.tag              = tag
            ch.sensor_type      = reg.get("datatype") or reg.get("type")
            ch.unit             = None
            ch.register_type    = "Holding Register"
            ch.register_addr    = _cfg_int(reg.get("address"))
            ch.process_min      = _cfg_float(reg.get("min"))
            ch.process_max      = _cfg_float(reg.get("max"))
            ch.scale_factor     = 1
            ch.offset_value     = 0
            ch.poll_interval_ms = freq_sec * 1000
            ch.is_enabled       = True
            ch_count += 1

    return dev_count, ch_count


def sync_config_to_db(cfg: dict | None = None) -> dict:
    """
    Sync config.json -> devices + channels.
    Called automatically after /config POST, and once on startup.
    Returns a summary dict.
    """
    if cfg is None:
        cfg = json.loads(CONFIG_FILE.read_text())

    ds_rtu = DataSource.query.filter_by(code="MODBUS_RTU").first()
    ds_tcp = DataSource.query.filter_by(code="MODBUS_TCP").first()
    if not ds_rtu or not ds_tcp:
        log.warning("sync_config_to_db: data_sources not seeded yet — skipping")
        return {"skipped": True}

    seen_keys: set[str] = set()
    try:
        rtu_d, rtu_c = _sync_rtu_devices(cfg, ds_rtu.id, seen_keys)
        tcp_d, tcp_c = _sync_tcp_plcs(cfg, ds_tcp.id, seen_keys)

        # Soft-disable channels no longer present in config.json
        disabled = 0
        if seen_keys:
            stale = Channel.query.filter(
                Channel.is_enabled.is_(True),
                ~Channel.channel_key.in_(seen_keys)
            ).all()
            for ch in stale:
                ch.is_enabled = False
                disabled += 1

        db.session.commit()
        summary = {
            "rtu_devices":  rtu_d, "rtu_channels": rtu_c,
            "tcp_devices":  tcp_d, "tcp_channels": tcp_c,
            "disabled":     disabled,
        }
        log.info("CONFIG_SYNC %s", summary)
        return summary
    except Exception as exc:
        db.session.rollback()
        log.error("CONFIG_SYNC failed: %s", exc)
        return {"error": str(exc)}

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

    # Re-sync devices + channels from the new config
    sync_summary = sync_config_to_db(current)

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
# AUDIO ALERTS — Engine / Audio Config (in-memory; small)
# ============================================================

@app.route("/audio-alerts/config", methods=["GET"])
def aa_config_get():
    err = _require_login()
    if err: return err
    # refresh engine counts from DB
    speakers_total = Device.query.filter_by(device_type="Speaker").count()
    speakers_up    = Device.query.filter_by(device_type="Speaker", status="online").count()
    gateways_total = Device.query.filter_by(device_type="Gateway").count()
    gateways_up    = Device.query.filter_by(device_type="Gateway", status="online").count()
    _engine_runtime.update({
        "speakers_total": speakers_total, "speakers_up": speakers_up,
        "gateways_total": gateways_total, "gateways_up": gateways_up,
        "last_sync": datetime.now().isoformat(),
    })
    return jsonify(ok=True, data={
        "engine":       _engine_runtime,
        "audio_config": _audio_config_runtime,
    })


@app.route("/audio-alerts/config/engine", methods=["PUT"])
def aa_config_engine_put():
    err = _require_login()
    if err: return err
    _engine_runtime.update(request.json or {})
    return jsonify(ok=True, data=_engine_runtime)


@app.route("/audio-alerts/config/audio", methods=["PUT"])
def aa_config_audio_put():
    err = _require_login()
    if err: return err
    _audio_config_runtime.update(request.json or {})
    return jsonify(ok=True, data=_audio_config_runtime)



@app.route("/audio-alerts/config/app-settings", methods=["GET"])
def aa_app_settings_get():
    err = _require_login()
    if err: return err
 
    languages  = [l.to_dict() for l in AppLanguage.query.order_by(AppLanguage.id).all()]
    zone_types = [z.to_dict() for z in AppZoneType.query.order_by(AppZoneType.id).all()]
 
    # Parameters from channels table — distinct channel_name + unit, enabled only
    rows = db.session.execute(text(
        "SELECT DISTINCT channel_name, unit FROM channels WHERE is_enabled = 1 ORDER BY channel_name"
    )).mappings().all()
    parameters = [{"label": r["channel_name"], "unit": r["unit"] or ""} for r in rows]
 
    return jsonify(ok=True, data={
        "languages":         languages,
        "zone_types":        [z["label"] for z in zone_types],
        "zone_type_objects": zone_types,
        "parameters":        parameters,
    })



@app.route("/audio-alerts/config/languages", methods=["GET"])
def aa_languages_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=[l.to_dict() for l in AppLanguage.query.order_by(AppLanguage.id).all()])
 
 
@app.route("/audio-alerts/config/languages", methods=["POST"])
def aa_languages_post():
    err = _require_login()
    if err: return err
    data = request.json or {}
    code = (data.get("code") or "").strip().upper()
    if not code:
        return jsonify(ok=False, error="code required"), 400
    if AppLanguage.query.filter_by(code=code).first():
        return jsonify(ok=False, error="Language code already exists"), 409
    lang = AppLanguage(code=code, label=data.get("label", code), flag=data.get("flag", "🌐"))
    db.session.add(lang)
    db.session.commit()
    _add_audit("config.change", f"language/{code}", f"Language added: {code}")
    return jsonify(ok=True, data=lang.to_dict()), 201
 
 
@app.route("/audio-alerts/config/languages/<int:lang_id>", methods=["PUT"])
def aa_languages_put(lang_id):
    err = _require_login()
    if err: return err
    lang = AppLanguage.query.get(lang_id)
    if not lang:
        return jsonify(ok=False, error="Language not found"), 404
    data = request.json or {}
    if "label" in data: lang.label = data["label"]
    if "flag"  in data: lang.flag  = data["flag"]
    db.session.commit()
    return jsonify(ok=True, data=lang.to_dict())
 
 
@app.route("/audio-alerts/config/languages/<int:lang_id>", methods=["DELETE"])
def aa_languages_del(lang_id):
    err = _require_login()
    if err: return err
    lang = AppLanguage.query.get(lang_id)
    if not lang:
        return jsonify(ok=False, error="Language not found"), 404
    before = lang.to_dict()
    db.session.delete(lang)
    db.session.commit()
    _add_audit("config.change", f"language/{lang.code}", f"Language removed: {lang.code}", before=before)
    return jsonify(ok=True, data={"id": lang_id})



# ── Zone Type CRUD ─────────────────────────────────────────────────────────────
 
@app.route("/audio-alerts/config/zone-types", methods=["GET"])
def aa_zone_types_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=[z.to_dict() for z in AppZoneType.query.order_by(AppZoneType.id).all()])
 
 
@app.route("/audio-alerts/config/zone-types", methods=["POST"])
def aa_zone_types_post():
    err = _require_login()
    if err: return err
    data  = request.json or {}
    label = (data.get("label") or "").strip()
    if not label:
        return jsonify(ok=False, error="label required"), 400
    if AppZoneType.query.filter_by(label=label).first():
        return jsonify(ok=False, error="Zone type already exists"), 409
    zt = AppZoneType(label=label)
    db.session.add(zt)
    db.session.commit()
    _add_audit("config.change", f"zone_type/{label}", f"Zone type added: {label}")
    return jsonify(ok=True, data=zt.to_dict()), 201
 
 
@app.route("/audio-alerts/config/zone-types/<int:zt_id>", methods=["PUT"])
def aa_zone_types_put(zt_id):
    err = _require_login()
    if err: return err
    zt = AppZoneType.query.get(zt_id)
    if not zt:
        return jsonify(ok=False, error="Zone type not found"), 404
    data = request.json or {}
    if "label" in data: zt.label = data["label"]
    db.session.commit()
    return jsonify(ok=True, data=zt.to_dict())
 
 
@app.route("/audio-alerts/config/zone-types/<int:zt_id>", methods=["DELETE"])
def aa_zone_types_del(zt_id):
    err = _require_login()
    if err: return err
    zt = AppZoneType.query.get(zt_id)
    if not zt:
        return jsonify(ok=False, error="Zone type not found"), 404
    before = zt.to_dict()
    db.session.delete(zt)
    db.session.commit()
    _add_audit("config.change", f"zone_type/{zt.label}", f"Zone type removed: {zt.label}", before=before)
    return jsonify(ok=True, data={"id": zt_id})
 



# ══════════════════════════════════════════════════════════════════════
# E) SEED BLOCK — add this INSIDE _seed_lookups(), after the Zone seed block
#    (before the closing of the function)
# ══════════════════════════════════════════════════════════════════════
 
    # Seed app_languages from the LANGUAGES constant (runs once)
    if AppLanguage.query.count() == 0:
        for lang in LANGUAGES:
            db.session.add(AppLanguage(
                code  = lang["code"],
                label = lang["label"],
                flag  = lang["flag"],
            ))
        db.session.commit()
        log.info("Seeded app_languages")
 
    # Seed app_zone_types from the ZONE_TYPES constant (runs once)
    if AppZoneType.query.count() == 0:
        for zt in ZONE_TYPES:
            db.session.add(AppZoneType(label=zt))
        db.session.commit()
        log.info("Seeded app_zone_types")
 



# ============================================================
# AUDIO ALERTS — Active Alerts (read from DB)
# ============================================================

@app.route("/audio-alerts/active", methods=["GET"])
def aa_active():
    err = _require_login()
    if err: return err
    priority = request.args.get("priority")
    zone_id  = request.args.get("zone_id")
    q = AlertEvent.query.filter(AlertEvent.status == "Active")
    if priority:
        q = q.filter(AlertEvent.priority == priority)
    if zone_id:
        z = Zone.query.filter_by(zone_code=zone_id).first()
        if z: q = q.filter(AlertEvent.zone_id == z.id)
    alerts = [e.to_dict() for e in q.order_by(AlertEvent.triggered_at.desc()).all()]

    total_active   = AlertEvent.query.filter_by(status="Active").count()
    total_critical = AlertEvent.query.filter_by(status="Active", priority="CRITICAL").count()
    total_unacked  = AlertEvent.query.filter(AlertEvent.status == "Active",
                                             AlertEvent.ack_at.is_(None)).count()

    speakers_total = Device.query.filter_by(device_type="Speaker").count()
    speakers_up    = Device.query.filter_by(device_type="Speaker", status="online").count()
    gateways_total = Device.query.filter_by(device_type="Gateway").count()
    gateways_up    = Device.query.filter_by(device_type="Gateway", status="online").count()
    engine = {**_engine_runtime,
              "speakers_total": speakers_total, "speakers_up": speakers_up,
              "gateways_total": gateways_total, "gateways_up": gateways_up,
              "last_sync": datetime.now().isoformat()}

    return jsonify(ok=True, data={
        "alerts": alerts,
        "stats": {"active": total_active, "critical": total_critical, "unacked": total_unacked},
        "engine": engine,
    })


@app.route("/audio-alerts/stream", methods=["GET"])
def aa_stream():
    err = _require_login()
    if err: return err
    since = request.args.get("since")
    q = AlertEvent.query
    if since:
        try:
            dt = datetime.fromisoformat(since)
            q  = q.filter(AlertEvent.triggered_at > dt)
        except Exception:
            pass
    rows = q.order_by(AlertEvent.triggered_at.desc()).limit(200).all()
    return jsonify(ok=True, data=[r.to_dict() for r in rows],
                   ts=datetime.now().isoformat())


@app.route("/audio-alerts/ack", methods=["POST"])
def aa_ack():
    err = _require_login()
    if err: return err
    if not _can("aa.alerts.ack"):
        return jsonify(ok=False, error="Permission denied"), 403
    data     = request.json or {}
    alert_id = data.get("alert_id", "")
    note     = data.get("note", "")

    # Accept "log-123" or numeric
    db_id = None
    if isinstance(alert_id, str) and alert_id.startswith("log-"):
        try: db_id = int(alert_id[4:])
        except Exception: pass
    else:
        try: db_id = int(alert_id)
        except Exception: pass

    event = AlertEvent.query.get(db_id) if db_id else None
    if not event:
        return jsonify(ok=False, error="Alert not found"), 404

    now = datetime.now()
    event.status      = "Acknowledged"
    event.ack_at      = now
    event.ack_by      = _current_user().get("username", "unknown")
    event.ack_source  = data.get("ack_source", "Dashboard")
    event.ack_seconds = int((now - event.triggered_at).total_seconds()) if event.triggered_at else 0
    if note:
        snap = event.trigger_snapshot or {}
        snap["ack_note"] = note
        event.trigger_snapshot = snap
    db.session.commit()
    _add_audit("ack", f"alert/{event.id}",
               f"Alert {event.alert_code or ''}",
               after={"ack_user": event.ack_by, "note": note})
    return jsonify(ok=True, data=event.to_dict())


@app.route("/audio-alerts/broadcast", methods=["POST"])
def aa_broadcast():
    err = _require_login()
    if err: return err
    if not _can("aa.broadcast.manual"):
        return jsonify(ok=False, error="Permission denied"), 403
    data     = request.json or {}
    zone_ids = data.get("zone_ids", [])
    z_db_id  = None
    z_name   = data.get("zone", "")
    if zone_ids:
        z = Zone.query.filter_by(zone_code=zone_ids[0]).first()
        if z:
            z_db_id = z.id
            z_name  = z.name
    # Create a "broadcast" alert_event row using a placeholder rule (id=0 won't satisfy FK).
    # We allow broadcasts as a separate concept — return synthesized object.
    snapshot = {
        "message":    data.get("message", "Manual broadcast"),
        "language":   data.get("language", "EN"),
        "audio_type": data.get("audio_type", "voice"),
        "clip_id":    data.get("clip_id"),
        "plant":      data.get("plant", ""),
        "line":       data.get("line", ""),
    }
    fake = {
        "alert_id":   str(uuid.uuid4()),
        "priority":   "MEDIUM",
        "alert_code": "BROADCAST",
        "zone":       z_name,
        "zone_id":    zone_ids[0] if zone_ids else "",
        "timestamp":  datetime.now().isoformat(),
        "status":     "Active",
        "playback_status": "queued",
        **snapshot,
    }
    _add_audit("broadcast.manual", "broadcast", "Manual Broadcast", after=data)
    return jsonify(ok=True, data=fake)


# ============================================================
# AUDIO ALERTS — Rules (DB-backed, multi-condition)
# ============================================================

def _rule_code_new() -> str:
    last = AlertRule.query.order_by(AlertRule.id.desc()).first()
    n = (last.id + 1) if last else 1
    return f"r{n:03d}"


def _resolve_rule(rule_id_or_code):
    if isinstance(rule_id_or_code, int):
        return AlertRule.query.get(rule_id_or_code)
    if isinstance(rule_id_or_code, str):
        if rule_id_or_code.startswith("r") and rule_id_or_code[1:].isdigit():
            return AlertRule.query.filter_by(rule_code=rule_id_or_code).first()
        if rule_id_or_code.isdigit():
            return AlertRule.query.get(int(rule_id_or_code))
    return None


def _apply_rule_payload(rule: AlertRule, data: dict):
    """Mutate rule + conditions + zone links from incoming payload."""
    # Basic fields
    for f in ("name","alert_code","priority","category","status","condition_logic",
              "persistence_type","persistence_value","persistence_unit",
              "freshness_max_age_sec","audio_mode","language_override",
              "volume_override","audio_type"):
        if f in data:
            setattr(rule, f, data[f])
    if "use_default_escalation" in data:
        rule.use_default_escalation = bool(data["use_default_escalation"])
    if "escalation_steps" in data:
        rule.escalation_steps = data["escalation_steps"]
    if "notify_emails" in data:
        rule.notify_emails = data["notify_emails"] or []

    # tts_template_id / clip_id come in as codes (tpl-001 / clip-001)
    if "tts_template_id" in data:
        code = data["tts_template_id"]
        if code:
            tpl = TtsTemplate.query.filter_by(template_code=code).first()
            rule.tts_template_id = tpl.id if tpl else None
        else:
            rule.tts_template_id = None
    if "clip_id" in data:
        code = data["clip_id"]
        if code:
            c = AudioClip.query.filter_by(clip_code=code).first()
            rule.clip_id = c.id if c else None
        else:
            rule.clip_id = None

    # Conditions — replace wholesale
    if "conditions" in data:
        # purge old
        for c in list(rule.conditions):
            db.session.delete(c)
        rule.conditions = []
        for i, cond in enumerate(data["conditions"] or []):
            rule.conditions.append(AlertRuleCondition(
                channel_key = cond.get("parameter") or cond.get("channel_key"),
                operator    = cond.get("operator", "<"),
                value_low   = cond.get("value"),
                value_high  = cond.get("value_high"),
                unit        = cond.get("unit"),
                seq         = i,
            ))

    # Zones — replace wholesale, accept zone codes
    if "zone_ids" in data:
        for z in list(rule.zone_links):
            db.session.delete(z)
        rule.zone_links = []
        for zc in data["zone_ids"] or []:
            z = Zone.query.filter_by(zone_code=zc).first()
            if z:
                rule.zone_links.append(AlertRuleZone(zone_id=z.id))


@app.route("/audio-alerts/rules", methods=["GET"])
def aa_rules_get():
    err = _require_login()
    if err: return err
    if not _can("aa.rules.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    q = AlertRule.query
    status = request.args.get("status")
    if status:
        q = q.filter(AlertRule.status == status)
    rules = q.order_by(AlertRule.id.desc()).all()
    return jsonify(ok=True, data=[r.to_dict() for r in rules])


@app.route("/audio-alerts/rules", methods=["POST"])
def aa_rules_post():
    err = _require_login()
    if err: return err
    if not _can("aa.rules.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    rule = AlertRule(
        rule_code  = _rule_code_new(),
        name       = data.get("name", "Untitled Rule"),
        alert_code = data.get("alert_code", "UNTITLED"),
        priority   = data.get("priority", "MEDIUM"),
        status     = data.get("status", "Draft"),
        created_by = _current_user().get("username", "unknown"),
    )
    db.session.add(rule)
    db.session.flush()  # need rule.id
    _apply_rule_payload(rule, data)
    db.session.commit()
    out = rule.to_dict()
    _add_audit("rule.create", f"rule/{rule.rule_code}",
               f"Rule: {rule.name}", after=out)
    return jsonify(ok=True, data=out), 201


@app.route("/audio-alerts/rules/<rule_id>", methods=["PUT"])
def aa_rules_put(rule_id):
    err = _require_login()
    if err: return err
    if not _can("aa.rules.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    rule = _resolve_rule(rule_id)
    if not rule:
        return jsonify(ok=False, error="Rule not found"), 404
    before = rule.to_dict()
    _apply_rule_payload(rule, request.json or {})
    db.session.commit()
    after = rule.to_dict()
    _add_audit("rule.edit", f"rule/{rule.rule_code}",
               f"Rule: {rule.name}", before=before, after=after)
    return jsonify(ok=True, data=after)


@app.route("/audio-alerts/rules/<rule_id>", methods=["DELETE"])
def aa_rules_del(rule_id):
    err = _require_login()
    if err: return err
    if not _can("aa.rules.delete"):
        return jsonify(ok=False, error="Permission denied"), 403
    rule = _resolve_rule(rule_id)
    if not rule:
        return jsonify(ok=False, error="Rule not found"), 404
    before = rule.to_dict()
    code = rule.rule_code
    db.session.delete(rule)
    db.session.commit()
    _add_audit("rule.delete", f"rule/{code}",
               f"Rule: {rule.name}", before=before)
    return jsonify(ok=True, data={"id": code})


def _set_rule_status(rule_id, status):
    err = _require_login()
    if err: return err
    if not _can("aa.rules.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    rule = _resolve_rule(rule_id)
    if not rule:
        return jsonify(ok=False, error="Rule not found"), 404
    rule.status = status
    db.session.commit()
    return jsonify(ok=True, data=rule.to_dict())


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
    sc          = _read_sc()
    default_dur = sc.get("alerts_limits", {}).get("rule_test_default_minutes", 5)
    duration    = (request.json or {}).get("duration_minutes", default_dur)
    rule = _resolve_rule(rule_id)
    if not rule:
        return jsonify(ok=False, error="Rule not found"), 404
    rule.status             = "Test Mode"
    rule.test_expires_at    = datetime.now() + timedelta(minutes=duration)
    rule.test_trigger_count = (rule.test_trigger_count or 0) + 1
    db.session.commit()
    return jsonify(ok=True, data=rule.to_dict())


# ============================================================
# AUDIO ALERTS — Rule Evaluation (the hot path)
# ============================================================

def _eval_op(op: str, value: float, low: float, high: float | None) -> bool:
    if value is None or low is None:
        return False
    if op == "<":   return value <  float(low)
    if op == "<=":  return value <= float(low)
    if op == "=":   return value == float(low)
    if op == "!=":  return value != float(low)
    if op == ">=":  return value >= float(low)
    if op == ">":   return value >  float(low)
    if op == "between":
        return high is not None and float(low) <= value <= float(high)
    if op == "outside":
        return high is not None and (value < float(low) or value > float(high))
    return False


def evaluate_rule(rule: AlertRule):
    """Evaluate one rule against channel_latest. Returns (fires: bool, snapshot: dict)."""
    if not rule.conditions:
        return False, {}
    keys = [c.channel_key for c in rule.conditions]
    rows = db.session.execute(text("""
        SELECT c.channel_key, c.unit, cl.value, cl.ts,
               TIMESTAMPDIFF(SECOND, cl.ts, NOW()) AS age_sec
        FROM channels c
        LEFT JOIN channel_latest cl ON cl.channel_id = c.id
        WHERE c.channel_key IN :keys
          AND c.is_enabled = 1
    """).bindparams(__import__("sqlalchemy").bindparam("keys", expanding=True)), {"keys": keys}).mappings().all()
    by_key = {r["channel_key"]: r for r in rows}

    snap = {}
    results = []
    fresh_limit = rule.freshness_max_age_sec or 30
    for cond in rule.conditions:
        row = by_key.get(cond.channel_key)
        if not row or row["value"] is None:
            results.append(False)
            snap[cond.channel_key] = {"value": None, "stale": True}
            continue
        age = row["age_sec"] or 0
        if age > fresh_limit:
            results.append(False)
            snap[cond.channel_key] = {"value": float(row["value"]), "stale": True, "age_sec": age}
            continue
        v   = float(row["value"])
        lo  = float(cond.value_low)  if cond.value_low  is not None else None
        hi  = float(cond.value_high) if cond.value_high is not None else None
        hit = _eval_op(cond.operator, v, lo, hi)
        results.append(hit)
        snap[cond.channel_key] = {
            "value": v, "threshold": lo, "value_high": hi,
            "operator": cond.operator, "unit": cond.unit,
            "ts": row["ts"].isoformat() if row["ts"] else None,
            "hit": hit, "age_sec": age,
        }

    fires = all(results) if rule.condition_logic == "AND" else any(results)
    return fires, snap


@app.route("/audio-alerts/rules/<rule_id>/evaluate", methods=["GET"])
def aa_rule_evaluate(rule_id):
    """Live debug endpoint — evaluates a rule against current readings."""
    err = _require_login()
    if err: return err
    if not _can("aa.rules.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    rule = _resolve_rule(rule_id)
    if not rule:
        return jsonify(ok=False, error="Rule not found"), 404
    fires, snap = evaluate_rule(rule)
    return jsonify(ok=True, data={"rule_id": rule.rule_code, "fires": fires, "snapshot": snap})


# ============================================================
# READINGS API  (write from pollers, read for engine)
# ============================================================

@app.route("/readings", methods=["POST"])
def ingest_reading():
    """
    Poller endpoint — called by Modbus RTU / TCP / MQTT poller processes.
    Accepts one or many readings; updates both sensor_readings and channel_latest.
    Body: { "channel_key": "compactability", "value": 33.4, "quality": 1, "ts": "..." }
       or { "readings": [ {...}, {...} ] }
    """
    err = _require_login()
    if err: return err
    data = request.json or {}
    if "readings" in data and isinstance(data["readings"], list):
        items = data["readings"]
    else:
        items = [data]
    inserted = 0
    now = datetime.now()
    for item in items:
        key = item.get("channel_key")
        val = item.get("value")
        if key is None or val is None:
            continue
        ch = Channel.query.filter_by(channel_key=key).first()
        if not ch:
            continue
        ts = item.get("ts")
        ts = datetime.fromisoformat(ts) if ts else now
        q  = int(item.get("quality", 1))
        db.session.add(SensorReading(channel_id=ch.id, value=val, quality=q, ts=ts))
        # upsert channel_latest
        latest = ChannelLatest.query.get(ch.id)
        if latest:
            latest.value = val; latest.quality = q; latest.ts = ts
        else:
            db.session.add(ChannelLatest(channel_id=ch.id, value=val, quality=q, ts=ts))
        inserted += 1
    db.session.commit()
    return jsonify(ok=True, inserted=inserted)


@app.route("/readings/latest", methods=["GET"])
def readings_latest():
    err = _require_login()
    if err: return err
    keys = request.args.get("keys", "")
    q = db.session.query(Channel, ChannelLatest).outerjoin(
        ChannelLatest, ChannelLatest.channel_id == Channel.id
    ).filter(Channel.is_enabled.is_(True))
    if keys:
        key_list = [k.strip() for k in keys.split(",") if k.strip()]
        q = q.filter(Channel.channel_key.in_(key_list))
    out = []
    for ch, latest in q.all():
        out.append({
            "channel_key": ch.channel_key,
            "tag":         ch.tag,
            "unit":        ch.unit,
            "value":       float(latest.value) if latest else None,
            "ts":          latest.ts.isoformat() if latest else None,
            "quality":     latest.quality if latest else 0,
        })
    return jsonify(ok=True, data=out)


@app.route("/readings/history", methods=["GET"])
def readings_history():
    err = _require_login()
    if err: return err
    key   = request.args.get("channel_key")
    limit = min(int(request.args.get("limit", 200)), 5000)
    if not key:
        return jsonify(ok=False, error="channel_key required"), 400
    ch = Channel.query.filter_by(channel_key=key).first()
    if not ch:
        return jsonify(ok=False, error="Unknown channel_key"), 404
    rows = (SensorReading.query
            .filter_by(channel_id=ch.id)
            .order_by(SensorReading.ts.desc())
            .limit(limit).all())
    return jsonify(ok=True, data=[{
        "value": float(r.value), "ts": r.ts.isoformat(), "quality": r.quality
    } for r in rows])


@app.route("/audio-alerts/events", methods=["POST"])
def aa_events_post():
    """
    Engine endpoint — called when a rule fires.
    Body: { "rule_id": "r001", "snapshot": {...}, "shift": "Morning" }
    """
    err = _require_login()
    if err: return err
    data = request.json or {}
    rule = _resolve_rule(data.get("rule_id", ""))
    if not rule:
        return jsonify(ok=False, error="Rule not found"), 404
    zone_db_id   = None
    zone_name    = None
    if rule.zone_links:
        z = rule.zone_links[0].zone
        if z:
            zone_db_id = z.id
            zone_name  = z.name
    snap = data.get("snapshot", {})
    # Pull first hit's value into denormalised columns
    first_hit_val = None; first_hit_thr = None; first_hit_unit = None
    for k, v in snap.items():
        if isinstance(v, dict) and v.get("hit"):
            first_hit_val  = v.get("value")
            first_hit_thr  = v.get("threshold")
            first_hit_unit = v.get("unit")
            break
    snap_to_store = {**snap,
                     "trigger_value": first_hit_val,
                     "threshold":     first_hit_thr,
                     "unit":          first_hit_unit}
    event = AlertEvent(
        rule_id          = rule.id,
        rule_code        = rule.rule_code,
        rule_name        = rule.name,
        alert_code       = rule.alert_code,
        priority         = rule.priority,
        zone_id          = zone_db_id,
        zone_name        = zone_name,
        shift            = data.get("shift", _detect_shift()),
        status           = "Active",
        triggered_at     = datetime.now(),
        trigger_snapshot = snap_to_store,
    )
    db.session.add(event)
    rule.trigger_count   = (rule.trigger_count or 0) + 1
    rule.last_triggered  = event.triggered_at
    db.session.commit()
    return jsonify(ok=True, data=event.to_dict()), 201


def _detect_shift() -> str:
    h = datetime.now().hour
    if 6  <= h < 14: return "Morning"
    if 14 <= h < 22: return "Afternoon"
    return "Night"


# ============================================================
# AUDIO ALERTS — Audio Clips & TTS Templates
# ============================================================

@app.route("/audio-alerts/audio/clips", methods=["GET"])
def aa_clips_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=[c.to_dict() for c in AudioClip.query.order_by(AudioClip.id.desc()).all()])


@app.route("/audio-alerts/audio/clips", methods=["POST"])
def aa_clips_post():
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = {}
    if request.content_type and "multipart/form-data" in request.content_type:
        data = {k: v for k, v in request.form.items()}
        f = request.files.get("file")
        if f:
            upload_dir = Path(__file__).parent / "uploads" / "clips"
            upload_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4().hex[:8]}_{f.filename}"
            filepath = upload_dir / filename
            f.save(str(filepath))
            data["file_path"] = str(filepath.resolve())
            data["format"]    = os.path.splitext(f.filename)[1].lstrip(".").upper()
    else:
        data = request.json or {}

    name = data.get("name", "Unnamed Clip").strip()
    alert_code = data.get("alert_code", "").strip() or None

    # Uniqueness: name must be unique
    if AudioClip.query.filter(func.lower(AudioClip.name) == name.lower()).first():
        return jsonify(ok=False, error=f"A clip named '{name}' already exists"), 409
    # Uniqueness: alert_code must be unique if provided
    if alert_code and AudioClip.query.filter(func.lower(AudioClip.alert_code) == alert_code.lower()).first():
        return jsonify(ok=False, error=f"Alert code '{alert_code}' is already used by another clip"), 409

    last = AudioClip.query.order_by(AudioClip.id.desc()).first()
    n = (last.id + 1) if last else 1
    clip = AudioClip(
        clip_code      = f"clip-{n:03d}",
        name           = name,
        alert_code     = alert_code,
        language       = data.get("language", "EN"),
        language_label = data.get("language_label"),
        duration_sec   = int(data["duration_sec"]) if data.get("duration_sec") else None,
        file_size      = int(data["file_size"])    if data.get("file_size")    else None,
        format         = data.get("format"),
        file_path      = data.get("file_path"),
        description    = data.get("description"),
        uploaded_by    = _current_user().get("username", "unknown"),
    )
    db.session.add(clip)
    db.session.commit()
    _add_audit("audio.upload", f"clip/{clip.clip_code}", f"Clip: {clip.name}", after=clip.to_dict())
    return jsonify(ok=True, data=clip.to_dict()), 201


@app.route("/audio-alerts/audio/clips/<clip_id>", methods=["PUT"])
def aa_clips_put(clip_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    clip = AudioClip.query.filter_by(clip_code=clip_id).first()
    if not clip:
        return jsonify(ok=False, error="Clip not found"), 404
    before = clip.to_dict()

    data = {}
    if request.content_type and "multipart/form-data" in request.content_type:
        data = {k: v for k, v in request.form.items()}
        f = request.files.get("file")
        if f:
            upload_dir = Path(__file__).parent / "uploads" / "clips"
            upload_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4().hex[:8]}_{f.filename}"
            filepath = upload_dir / filename
            f.save(str(filepath))
            data["file_path"] = str(filepath.resolve())
            data["format"]    = os.path.splitext(f.filename)[1].lstrip(".").upper()
    else:
        data = request.json or {}

    new_name = data.get("name", clip.name).strip()
    new_alert_code = data.get("alert_code", clip.alert_code or "").strip() or None

    # Uniqueness checks (exclude self)
    dup_name = AudioClip.query.filter(
        func.lower(AudioClip.name) == new_name.lower(), AudioClip.clip_code != clip_id
    ).first()
    if dup_name:
        return jsonify(ok=False, error=f"A clip named '{new_name}' already exists"), 409
    if new_alert_code:
        dup_code = AudioClip.query.filter(
            func.lower(AudioClip.alert_code) == new_alert_code.lower(), AudioClip.clip_code != clip_id
        ).first()
        if dup_code:
            return jsonify(ok=False, error=f"Alert code '{new_alert_code}' is already used by another clip"), 409

    clip.name           = new_name
    clip.alert_code     = new_alert_code
    clip.language       = data.get("language", clip.language)
    clip.language_label = data.get("language_label", clip.language_label)
    clip.description    = data.get("description", clip.description)
    if "file_path" in data: clip.file_path = data["file_path"]
    if "format"    in data: clip.format    = data["format"]
    if "duration_sec" in data and data["duration_sec"]:
        clip.duration_sec = int(data["duration_sec"])
    if "file_size" in data and data["file_size"]:
        clip.file_size = int(data["file_size"])

    db.session.commit()
    _add_audit("audio.edit", f"clip/{clip.clip_code}", f"Clip: {clip.name}", before=before, after=clip.to_dict())
    return jsonify(ok=True, data=clip.to_dict())


@app.route("/audio-alerts/audio/clips/<clip_id>", methods=["DELETE"])
def aa_clips_del(clip_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.delete"):
        return jsonify(ok=False, error="Permission denied"), 403
    clip = AudioClip.query.filter_by(clip_code=clip_id).first()
    if not clip:
        return jsonify(ok=False, error="Clip not found"), 404
    before = clip.to_dict()
    db.session.delete(clip)
    db.session.commit()
    _add_audit("audio.delete", f"clip/{clip_id}", f"Clip: {before.get('name')}", before=before)
    return jsonify(ok=True, data={"id": clip_id})


@app.route("/audio-alerts/audio/templates", methods=["GET"])
def aa_templates_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=[t.to_dict() for t in TtsTemplate.query.order_by(TtsTemplate.id.desc()).all()])


@app.route("/audio-alerts/audio/templates", methods=["POST"])
def aa_templates_post():
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    name       = (data.get("name") or "Untitled Template").strip()
    alert_code = (data.get("alert_code") or "").strip() or None

    # Uniqueness
    if TtsTemplate.query.filter(func.lower(TtsTemplate.name) == name.lower()).first():
        return jsonify(ok=False, error=f"A template named '{name}' already exists"), 409
    if alert_code and TtsTemplate.query.filter(func.lower(TtsTemplate.alert_code) == alert_code.lower()).first():
        return jsonify(ok=False, error=f"Alert code '{alert_code}' is already used by another template"), 409

    last = TtsTemplate.query.order_by(TtsTemplate.id.desc()).first()
    n = (last.id + 1) if last else 1
    tpl = TtsTemplate(
        template_code = f"tpl-{n:03d}",
        name          = name,
        alert_code    = alert_code,
        language      = data.get("language", "EN"),
        voice         = data.get("voice"),
        tone          = data.get("tone"),
        body          = data.get("body", ""),
        variables     = data.get("variables", []),
        created_by    = _current_user().get("username", "unknown"),
    )
    db.session.add(tpl)
    db.session.commit()
    _add_audit("template.create", f"template/{tpl.template_code}", f"Template: {tpl.name}", after=tpl.to_dict())
    return jsonify(ok=True, data=tpl.to_dict()), 201


@app.route("/audio-alerts/audio/templates/<tpl_id>", methods=["PUT"])
def aa_templates_put(tpl_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    tpl = TtsTemplate.query.filter_by(template_code=tpl_id).first()
    if not tpl:
        return jsonify(ok=False, error="Template not found"), 404
    before = tpl.to_dict()
    data = request.json or {}

    new_name       = (data.get("name") or tpl.name).strip()
    new_alert_code = (data.get("alert_code") or "").strip() or None

    # Uniqueness (exclude self)
    dup_name = TtsTemplate.query.filter(
        func.lower(TtsTemplate.name) == new_name.lower(), TtsTemplate.template_code != tpl_id
    ).first()
    if dup_name:
        return jsonify(ok=False, error=f"A template named '{new_name}' already exists"), 409
    if new_alert_code:
        dup_code = TtsTemplate.query.filter(
            func.lower(TtsTemplate.alert_code) == new_alert_code.lower(), TtsTemplate.template_code != tpl_id
        ).first()
        if dup_code:
            return jsonify(ok=False, error=f"Alert code '{new_alert_code}' is already used by another template"), 409

    tpl.name       = new_name
    tpl.alert_code = new_alert_code
    for f in ("language","voice","tone","body","variables"):
        if f in data: setattr(tpl, f, data[f])
    db.session.commit()
    _add_audit("template.edit", f"template/{tpl.template_code}", f"Template: {tpl.name}", before=before, after=tpl.to_dict())
    return jsonify(ok=True, data=tpl.to_dict())


@app.route("/audio-alerts/audio/templates/<tpl_id>", methods=["DELETE"])
def aa_templates_del(tpl_id):
    err = _require_login()
    if err: return err
    if not _can("aa.audio.delete"):
        return jsonify(ok=False, error="Permission denied"), 403
    tpl = TtsTemplate.query.filter_by(template_code=tpl_id).first()
    if not tpl:
        return jsonify(ok=False, error="Template not found"), 404
    before = tpl.to_dict()
    db.session.delete(tpl)
    db.session.commit()
    _add_audit("template.delete", f"template/{tpl_id}", f"Template: {before.get('name')}", before=before)
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
    return jsonify(ok=True, data=[d.to_dict() for d in Device.query.order_by(Device.id.asc()).all()])


@app.route("/audio-alerts/devices", methods=["POST"])
def aa_devices_post():
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    # Resolve data source by code
    ds_code = data.get("data_source", "MODBUS_TCP")
    ds = DataSource.query.filter_by(code=ds_code).first()
    if not ds:
        return jsonify(ok=False, error=f"Unknown data_source '{ds_code}'"), 400
    # Resolve zone by code
    zone_db_id = None
    zone_code = data.get("zone_id")
    if zone_code:
        z = Zone.query.filter_by(zone_code=zone_code).first()
        zone_db_id = z.id if z else None
    device = Device(
        data_source_id = ds.id,
        name           = data.get("name") or f"device_{uuid.uuid4().hex[:6]}",
        label          = data.get("label") or data.get("name") or "Unnamed Device",
        device_type    = data.get("type", "Device"),
        address        = data.get("address") or data.get("ip"),
        slave_id       = data.get("slave_id"),
        zone_id        = zone_db_id,
        firmware       = data.get("firmware"),
        status         = data.get("status", "unknown"),
        device_metadata= data.get("metadata") or {
            k: data[k] for k in ("uptime_pct","downtime_min","metrics","protocol",
                                 "mqtt_topic","audio_channel","volume_override") if k in data
        },
    )
    db.session.add(device)
    db.session.commit()
    _add_audit("device.add", f"device/{device.id}", f"Device: {device.label}", after=device.to_dict())
    return jsonify(ok=True, data=device.to_dict()), 201


def _resolve_device(dev_id):
    if isinstance(dev_id, str) and dev_id.startswith("dev-"):
        try: return Device.query.get(int(dev_id[4:]))
        except Exception: return None
    try: return Device.query.get(int(dev_id))
    except Exception: return None


@app.route("/audio-alerts/devices/<dev_id>", methods=["PUT"])
def aa_devices_put(dev_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    device = _resolve_device(dev_id)
    if not device:
        return jsonify(ok=False, error="Device not found"), 404
    data = request.json or {}
    for f in ("label","device_type","address","slave_id","firmware","status"):
        if f in data: setattr(device, f, data[f])
    if "zone_id" in data:
        z = Zone.query.filter_by(zone_code=data["zone_id"]).first() if data["zone_id"] else None
        device.zone_id = z.id if z else None
    if "metadata" in data:
        device.device_metadata = data["metadata"]
    db.session.commit()
    return jsonify(ok=True, data=device.to_dict())


@app.route("/audio-alerts/devices/<dev_id>", methods=["DELETE"])
def aa_devices_del(dev_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    device = _resolve_device(dev_id)
    if not device:
        return jsonify(ok=False, error="Device not found"), 404
    before = device.to_dict()
    db.session.delete(device)
    db.session.commit()
    _add_audit("device.remove", f"device/{dev_id}", f"Device: {before.get('name')}", before=before)
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
# AUDIO ALERTS — Channels (NEW)
# ============================================================

@app.route("/audio-alerts/channels", methods=["GET"])
def aa_channels_get():
    err = _require_login()
    if err: return err
    device_id = request.args.get("device_id")
    q = Channel.query
    if device_id:
        d = _resolve_device(device_id)
        if d:
            q = q.filter_by(device_id=d.id)
    return jsonify(ok=True, data=[c.to_dict() for c in q.order_by(Channel.id.asc()).all()])


@app.route("/audio-alerts/channels", methods=["POST"])
def aa_channels_post():
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    device = _resolve_device(data.get("device_id"))
    if not device:
        return jsonify(ok=False, error="Unknown device"), 400
    ch = Channel(
        device_id      = device.id,
        channel_key    = data["channel_key"],
        channel_name   = data.get("channel_name", data["channel_key"]),
        tag            = data.get("tag"),
        sensor_type    = data.get("sensor_type"),
        unit           = data.get("unit"),
        register_type  = data.get("register_type"),
        register_addr  = data.get("register_addr"),
        mqtt_topic     = data.get("mqtt_topic"),
        process_min    = data.get("process_min"),
        process_max    = data.get("process_max"),
        scale_factor   = data.get("scale_factor", 1),
        offset_value   = data.get("offset_value", 0),
        poll_interval_ms = data.get("poll_interval_ms", 1000),
        is_enabled     = data.get("is_enabled", True),
    )
    db.session.add(ch)
    db.session.commit()
    return jsonify(ok=True, data=ch.to_dict()), 201


@app.route("/audio-alerts/channels/<int:ch_id>", methods=["PUT"])
def aa_channels_put(ch_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    ch = Channel.query.get(ch_id)
    if not ch:
        return jsonify(ok=False, error="Channel not found"), 404
    data = request.json or {}
    for f in ("channel_name","tag","sensor_type","unit","register_type","register_addr",
              "mqtt_topic","process_min","process_max","scale_factor","offset_value",
              "poll_interval_ms","is_enabled"):
        if f in data: setattr(ch, f, data[f])
    db.session.commit()
    return jsonify(ok=True, data=ch.to_dict())


@app.route("/audio-alerts/channels/<int:ch_id>", methods=["DELETE"])
def aa_channels_del(ch_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    ch = Channel.query.get(ch_id)
    if not ch:
        return jsonify(ok=False, error="Channel not found"), 404
    db.session.delete(ch)
    db.session.commit()
    return jsonify(ok=True, data={"id": ch_id})


# ============================================================
# AUDIO ALERTS — Data Sources
# ============================================================

@app.route("/audio-alerts/data-sources", methods=["GET"])
def aa_data_sources_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=[d.to_dict() for d in DataSource.query.all()])


# ============================================================
# AUDIO ALERTS — Plants / Lines / Zones
# ============================================================

@app.route("/audio-alerts/plants", methods=["GET"])
def aa_plants_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=[p.to_dict() for p in Plant.query.all()])


@app.route("/audio-alerts/plants", methods=["POST"])
def aa_plants_post():
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    p = Plant(id       = data.get("id") or f"plant-{uuid.uuid4().hex[:6]}",
              name     = data.get("name", "Unnamed Plant"),
              location = data.get("location"))
    db.session.add(p)
    db.session.commit()
    _add_audit("plant.create", f"plant/{p.id}", f"Plant: {p.name}", after=p.to_dict())
    return jsonify(ok=True, data=p.to_dict()), 201


@app.route("/audio-alerts/plants/<plant_id>", methods=["PUT"])
def aa_plants_put(plant_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    p = Plant.query.get(plant_id)
    if not p: return jsonify(ok=False, error="Plant not found"), 404
    data = request.json or {}
    if "name"     in data: p.name     = data["name"]
    if "location" in data: p.location = data["location"]
    db.session.commit()
    return jsonify(ok=True, data=p.to_dict())


@app.route("/audio-alerts/plants/<plant_id>", methods=["DELETE"])
def aa_plants_del(plant_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    p = Plant.query.get(plant_id)
    if not p: return jsonify(ok=False, error="Plant not found"), 404
    before = p.to_dict()
    db.session.delete(p)
    db.session.commit()
    _add_audit("plant.delete", f"plant/{plant_id}", f"Plant: {before.get('name')}", before=before)
    return jsonify(ok=True, data={"id": plant_id})


@app.route("/audio-alerts/lines", methods=["GET"])
def aa_lines_get():
    err = _require_login()
    if err: return err
    q = Line.query
    plant_id = request.args.get("plant_id")
    if plant_id:
        q = q.filter_by(plant_id=plant_id)
    return jsonify(ok=True, data=[l.to_dict() for l in q.all()])


@app.route("/audio-alerts/lines", methods=["POST"])
def aa_lines_post():
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    line = Line(id       = data.get("id") or f"l-{uuid.uuid4().hex[:6]}",
                plant_id = data["plant_id"],
                name     = data.get("name", "Unnamed Line"))
    db.session.add(line)
    db.session.commit()
    _add_audit("line.create", f"line/{line.id}", f"Line: {line.name}", after=line.to_dict())
    return jsonify(ok=True, data=line.to_dict()), 201


@app.route("/audio-alerts/lines/<line_id>", methods=["PUT"])
def aa_lines_put(line_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    line = Line.query.get(line_id)
    if not line: return jsonify(ok=False, error="Line not found"), 404
    data = request.json or {}
    if "name"     in data: line.name     = data["name"]
    if "plant_id" in data: line.plant_id = data["plant_id"]
    db.session.commit()
    return jsonify(ok=True, data=line.to_dict())


@app.route("/audio-alerts/lines/<line_id>", methods=["DELETE"])
def aa_lines_del(line_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    line = Line.query.get(line_id)
    if not line: return jsonify(ok=False, error="Line not found"), 404
    before = line.to_dict()
    db.session.delete(line)
    db.session.commit()
    _add_audit("line.delete", f"line/{line_id}", f"Line: {before.get('name')}", before=before)
    return jsonify(ok=True, data={"id": line_id})


@app.route("/audio-alerts/zones", methods=["GET"])
def aa_zones_get():
    err = _require_login()
    if err: return err
    q = Zone.query
    line_id  = request.args.get("line_id")
    plant_id = request.args.get("plant_id")
    if line_id:  q = q.filter_by(line_id=line_id)
    if plant_id: q = q.filter_by(plant_id=plant_id)
    return jsonify(ok=True, data=[z.to_dict() for z in q.all()])


@app.route("/audio-alerts/zones", methods=["POST"])
def aa_zones_post():
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    z = Zone(zone_code        = data.get("id") or f"z-{uuid.uuid4().hex[:6]}",
             line_id          = data["line_id"],
             plant_id         = data["plant_id"],
             name             = data.get("name", "Unnamed Zone"),
             zone_type        = data.get("type"),
             default_language = data.get("default_language", "EN"))
    db.session.add(z)
    db.session.commit()
    _add_audit("zone.create", f"zone/{z.zone_code}", f"Zone: {z.name}", after=z.to_dict())
    return jsonify(ok=True, data=z.to_dict()), 201


@app.route("/audio-alerts/zones/<zone_id>", methods=["PUT"])
def aa_zones_put(zone_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    z = Zone.query.filter_by(zone_code=zone_id).first()
    if not z: return jsonify(ok=False, error="Zone not found"), 404
    data = request.json or {}
    if "name"             in data: z.name             = data["name"]
    if "type"             in data: z.zone_type        = data["type"]
    if "default_language" in data: z.default_language = data["default_language"]
    if "line_id"          in data: z.line_id          = data["line_id"]
    if "plant_id"         in data: z.plant_id         = data["plant_id"]
    db.session.commit()
    return jsonify(ok=True, data=z.to_dict())


@app.route("/audio-alerts/zones/<zone_id>", methods=["DELETE"])
def aa_zones_del(zone_id):
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    z = Zone.query.filter_by(zone_code=zone_id).first()
    if not z: return jsonify(ok=False, error="Zone not found"), 404
    before = z.to_dict()
    db.session.delete(z)
    db.session.commit()
    _add_audit("zone.delete", f"zone/{zone_id}", f"Zone: {before.get('name')}", before=before)
    return jsonify(ok=True, data={"id": zone_id})


@app.route("/audio-alerts/structure", methods=["GET"])
def aa_structure():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data={
        "plants": [p.to_dict() for p in Plant.query.all()],
        "lines":  [l.to_dict() for l in Line.query.all()],
        "zones":  [z.to_dict() for z in Zone.query.all()],
    })


# ============================================================
# AUDIO ALERTS — Analytics  (computed from alert_events)
# ============================================================

@app.route("/audio-alerts/analytics", methods=["GET"])
def aa_analytics():
    err = _require_login()
    if err: return err
    if not _can("aa.analytics.view"):
        return jsonify(ok=False, error="Permission denied"), 403

    days = int(request.args.get("days", 30))
    from_date = request.args.get("from")
    to_date   = request.args.get("to")

    q = AlertEvent.query
    if from_date:
        try: q = q.filter(AlertEvent.triggered_at >= datetime.fromisoformat(from_date))
        except Exception: pass
    elif days:
        q = q.filter(AlertEvent.triggered_at >= datetime.now() - timedelta(days=days))
    if to_date:
        try: q = q.filter(AlertEvent.triggered_at <= datetime.fromisoformat(to_date))
        except Exception: pass

    events = q.all()
    total = len(events)

    by_priority = {p: 0 for p in ["CRITICAL","HIGH","MEDIUM","LOW"]}
    by_zone:  dict = {}
    by_date:  dict = {}
    by_code:  dict = {}
    by_shift: dict = {}
    by_ack:   dict = {}
    ack_secs_by_shift: dict = {}
    by_rule:  dict = {}

    for e in events:
        p = e.priority or "LOW"
        z = e.zone_name or "Unknown"
        d = e.triggered_at.date().isoformat() if e.triggered_at else None
        ac = e.alert_code or e.rule_name or "Unknown"
        sh = e.shift or "Unknown"
        src = e.ack_source or "Dashboard"

        by_priority[p] = by_priority.get(p, 0) + 1
        by_zone[z] = by_zone.get(z, 0) + 1
        if d:
            rec = by_date.setdefault(d, {"date":d,"total":0,"CRITICAL":0,"HIGH":0,"MEDIUM":0,"LOW":0})
            rec["total"] += 1; rec[p] = rec.get(p, 0) + 1
        code_rec = by_code.setdefault(ac, {"alert_code":ac,"count":0,"last_triggered":None})
        code_rec["count"] += 1
        ts_iso = e.triggered_at.isoformat() if e.triggered_at else None
        if ts_iso and (not code_rec["last_triggered"] or ts_iso > code_rec["last_triggered"]):
            code_rec["last_triggered"] = ts_iso
        sh_rec = by_shift.setdefault(sh, {"shift":sh,"total":0,"CRITICAL":0,"HIGH":0,"MEDIUM":0,"LOW":0})
        sh_rec["total"] += 1; sh_rec[p] = sh_rec.get(p, 0) + 1
        by_ack[src] = by_ack.get(src, 0) + 1
        if e.ack_seconds and sh:
            ack_secs_by_shift.setdefault(sh, []).append(int(e.ack_seconds))
        if e.rule_id:
            rr = by_rule.setdefault(e.rule_code, {"rule_id":e.rule_code,"rule_name":e.rule_name,
                                                 "total_triggers":0,"acked":0,"auto_acks":0,"ack_seconds":[]})
            rr["total_triggers"] += 1
            if e.status in ("Acknowledged","Resolved"): rr["acked"] += 1
            if e.ack_source == "Auto-recovery": rr["auto_acks"] += 1
            if e.ack_seconds: rr["ack_seconds"].append(int(e.ack_seconds))

    shift_order = ["Morning","Afternoon","Night"]
    def _rt(sh):
        secs = ack_secs_by_shift.get(sh, [])
        avg = int(sum(secs)/len(secs)) if secs else 120
        p95 = sorted(secs)[int(len(secs)*0.95)] if len(secs) >= 20 else avg*2
        return {"shift":sh,"avg_ack_sec":avg,"p95_ack_sec":p95,
                "CRITICAL":max(20,avg//3),"HIGH":max(40,avg//2),"MEDIUM":avg,"LOW":avg*2}
    response_times = [_rt(s) for s in shift_order]

    rule_efficacy = []
    for rr in by_rule.values():
        secs = rr.pop("ack_seconds", [])
        avg  = int(sum(secs)/len(secs)) if secs else 0
        eff  = int(100 * rr["acked"] / rr["total_triggers"]) if rr["total_triggers"] else 0
        rule_efficacy.append({**rr, "avg_ack_sec": avg, "efficacy": eff})
    rule_efficacy.sort(key=lambda r: r["total_triggers"], reverse=True)

    total_acks = sum(by_ack.values()) or 1
    ack_sources = [{"source":s,"count":c,"pct":round(100*c/total_acks)} for s,c in by_ack.items()]

    device_uptime = []
    for d in Device.query.all():
        meta = d.device_metadata or {}
        device_uptime.append({
            "device_id":   d.id,
            "name":        d.label,
            "uptime_pct":  meta.get("uptime_pct", 100.0),
            "downtime_min":meta.get("downtime_min", 0),
        })

    return jsonify(ok=True, data={
        "total": total,
        "by_priority": by_priority,
        "by_zone": by_zone,
        "daily": sorted(by_date.values(), key=lambda x: x["date"]),
        "alert_frequency": sorted(by_code.values(), key=lambda x: -x["count"]),
        "shifts": [by_shift.get(s, {"shift":s,"total":0,"CRITICAL":0,"HIGH":0,"MEDIUM":0,"LOW":0}) for s in shift_order],
        "response_times": response_times,
        "device_uptime": device_uptime,
        "ack_sources": ack_sources,
        "rule_efficacy": rule_efficacy,
        "false_alerts": [e.to_dict() for e in events if e.status == "false_alert"],
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
    page     = max(1, int(request.args.get("page", 1)))
    size     = max(1, min(200, int(request.args.get("page_size", 50))))
    priority = request.args.get("priority")
    zone     = request.args.get("zone")
    status   = request.args.get("status")

    q = AlertEvent.query
    if priority: q = q.filter(AlertEvent.priority  == priority)
    if zone:     q = q.filter(AlertEvent.zone_name == zone)
    if status:   q = q.filter(AlertEvent.status    == status)

    total = q.count()
    rows  = q.order_by(AlertEvent.triggered_at.desc()).offset((page-1)*size).limit(size).all()
    return jsonify(ok=True, data={
        "items": [r.to_dict() for r in rows],
        "total": total, "page": page, "page_size": size,
        "pages": max(1, (total + size - 1) // size),
    })


@app.route("/audio-alerts/logs/audit", methods=["GET"])
def aa_logs_audit():
    err = _require_login()
    if err: return err
    if not _can("aa.audit.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    page   = max(1, int(request.args.get("page", 1)))
    size   = max(1, min(200, int(request.args.get("page_size", 50))))
    action = request.args.get("action")
    user   = request.args.get("user")
    q = AuditLog.query
    if action: q = q.filter(AuditLog.action == action)
    if user:   q = q.filter(AuditLog.user   == user)
    total = q.count()
    rows  = q.order_by(AuditLog.ts.desc()).offset((page-1)*size).limit(size).all()
    return jsonify(ok=True, data={
        "items": [r.to_dict() for r in rows],
        "total": total, "page": page, "page_size": size,
        "pages": max(1, (total + size - 1) // size),
    })


# ============================================================
# AUDIO ALERTS — Security Settings (in-memory; sensitive bits in system_config.json)
# ============================================================

@app.route("/audio-alerts/security", methods=["GET"])
def aa_security_get():
    err = _require_login()
    if err: return err
    if not _can("aa.security.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    return jsonify(ok=True, data=_security_runtime)


@app.route("/audio-alerts/security", methods=["PUT"])
def aa_security_put():
    err = _require_login()
    if err: return err
    if not _can("aa.security.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    _security_runtime.update(request.json or {})
    _add_audit("config.change", "config/security", "Security Settings", after=request.json or {})
    return jsonify(ok=True, data=_security_runtime)


# ============================================================
# BOOTSTRAP & STARTUP
# ============================================================

def _run_migrations():
    """Apply safe ALTER TABLE migrations for columns added after initial schema."""
    migrations = [
        "ALTER TABLE tts_templates ADD COLUMN IF NOT EXISTS alert_code VARCHAR(64)",
        "ALTER TABLE alert_rules    ADD COLUMN IF NOT EXISTS notify_emails JSON",
    ]
    with db.engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception as e:
                log.warning("Migration skipped (%s): %s", sql[:60], e)


def _seed_users():
    if User.query.count() > 0:
        log.info("DB already has users — skipping seed")
        return
    SEED = [
        ("superadmin",  "administrator",         ["plant-1","plant-2","plant-3"], [], [],["Morning","Afternoon","Night"])
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


def _seed_lookups():
    """Seed data_sources / plants / lines / zones if empty."""
    if DataSource.query.count() == 0:
        for ds in [
            ("MODBUS_RTU", "Modbus RTU (Serial)",  "serial"),
            ("MODBUS_TCP", "Modbus TCP",            "tcp"),
            ("MQTT",       "MQTT (Cloud / Broker)", "mqtt"),
        ]:
            db.session.add(DataSource(code=ds[0], label=ds[1], transport=ds[2]))
        db.session.commit()
        log.info("Seeded data_sources")

    if Plant.query.count() == 0:
        for pid, pname in [("plant-1","Plant-1"),("plant-2","Plant-2"),("plant-3","Plant-3")]:
            db.session.add(Plant(id=pid, name=pname, location=pname))
        db.session.commit()
    if Line.query.count() == 0:
        for lid, pid, ln in [
            ("l1-1","plant-1","Line-1"),("l1-2","plant-1","Line-2"),
            ("l2-1","plant-2","Line-1"),("l2-2","plant-2","Line-2"),
            ("l3-1","plant-3","Line-1"),("l3-2","plant-3","Line-2"),
        ]:
            db.session.add(Line(id=lid, plant_id=pid, name=ln))
        db.session.commit()
    if Zone.query.count() == 0:
        for zc, lid, pid, zname, ztype in [
            ("z001","l1-1","plant-1","Melting-1",  "Melting"),
            ("z002","l1-1","plant-1","Moulding-A", "Moulding"),
            ("z003","l1-1","plant-1","Mulling-1",  "Mulling"),
            ("z004","l1-1","plant-1","Cooling-1",  "Cooling"),
            ("z005","l1-2","plant-1","Sand Prep-1","Sand Prep"),
            ("z006","l1-2","plant-1","Pouring-1",  "Pouring"),
            ("z007","l2-1","plant-2","Melting-2",  "Melting"),
            ("z008","l2-1","plant-2","Moulding-C", "Moulding"),
            ("z009","l2-2","plant-2","Mulling-2",  "Mulling"),
            ("z010","l3-1","plant-3","Melting-3",  "Melting"),
            ("z011","l3-2","plant-3","Moulding-D", "Moulding"),
        ]:
            db.session.add(Zone(zone_code=zc, line_id=lid, plant_id=pid,
                                name=zname, zone_type=ztype, default_language="EN"))
        db.session.commit()

    if AppLanguage.query.count() == 0:
        for lang in LANGUAGES:
            db.session.add(AppLanguage(
                code  = lang["code"],
                label = lang["label"],
                flag  = lang["flag"],
            ))
        db.session.commit()
        log.info("Seeded app_languages")
 
    if AppZoneType.query.count() == 0:
        for zt in ZONE_TYPES:
            db.session.add(AppZoneType(label=zt))
        db.session.commit()
        log.info("Seeded app_zone_types")

        log.info("Seeded plants/lines/zones")


if __name__ == "__main__":
    log = setup_logging()
    log.info("Starting Gateway Configuration UI (SQL backend)")
    with app.app_context():
        for attempt in range(10):
            if is_mysql_up():
                try:
                    db.create_all()
                    log.info("Database tables ready")
                    _run_migrations()
                    _seed_users()
                    _seed_lookups()
                    sync_config_to_db()
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