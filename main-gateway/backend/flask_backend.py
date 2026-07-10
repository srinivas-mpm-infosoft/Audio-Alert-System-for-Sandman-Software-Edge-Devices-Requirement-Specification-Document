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
import hashlib
import bcrypt
import logging
import socket
import subprocess
import threading
import time
import urllib.request
import urllib.error
import requests
from datetime import datetime, timedelta
from pathlib import Path
from decimal import Decimal

from flask import Flask, request, jsonify, send_from_directory, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import (
    text, func, and_, or_, desc, asc, Index,
    Column, Integer, BigInteger, String, Text, DateTime, Boolean, JSON, Float,
    ForeignKey, Enum, Numeric, SmallInteger,
)
from sqlalchemy.orm import relationship

import websocket as ws_client
from flask_sock import Sock
from simple_websocket import ConnectionClosed

import dispatch_service
import heartbeat_service
import mqtt_service
import scheduler_service
import sop_service
import events_bus


# ============================================================
# STATIC PATHS  (only BASE is fixed; everything else is configurable)
# ============================================================

BASE               = Path("/home/recomputer/SSD-backup/Gateway-Backend/Main Application")
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
    "aa.schedule.view", "aa.schedule.edit",
    "aa.paging.use",
    "aa.sop.view", "aa.sop.edit", "aa.sop.delete", "aa.sop.run", "aa.sop.ack",
    "aa.alerttypes.view", "aa.alerttypes.manage",
]
DEFAULT_ROLE_PERMISSIONS = {
    "administrator":          list(ALL_PERMISSIONS),
    "plant_manager":          [p for p in ALL_PERMISSIONS if p not in ("aa.users.manage", "aa.security.manage")],
    "process_engineer":       ["aa.live.view","aa.alerts.ack","aa.broadcast.manual","aa.rules.view","aa.rules.edit","aa.audio.upload","aa.devices.view","aa.analytics.view","aa.analytics.export","aa.logs.view","aa.logs.export","aa.schedule.view","aa.schedule.edit","aa.paging.use","aa.sop.view","aa.sop.edit","aa.sop.delete","aa.sop.run","aa.sop.ack"],
    "shift_supervisor":       ["aa.live.view","aa.alerts.ack","aa.broadcast.manual","aa.rules.view","aa.devices.view","aa.analytics.view","aa.logs.view","aa.schedule.view","aa.paging.use","aa.sop.view","aa.sop.run","aa.sop.ack"],
    "operator":               ["aa.live.view","aa.alerts.ack","aa.analytics.view","aa.logs.view","aa.sop.view","aa.sop.run","aa.sop.ack"],
    "maintenance_technician": ["aa.live.view","aa.devices.view","aa.devices.edit","aa.analytics.view","aa.logs.view","aa.sop.view"],
    "auditor":                ["aa.live.view","aa.analytics.view","aa.logs.view","aa.audit.view","aa.sop.view"],
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

NO_TRANSLATE_PRESETS = {
    "foundry": [
        "Bentonite", "Compactability", "GFN", "Permeability", "Mulling",
        "Moulding", "Pouring", "Melting", "Cooling", "Sprue", "Riser",
        "Runner", "Cope", "Drag", "Flask", "Pattern", "Mould", "Ladle",
        "Furnace", "Cupola", "Laitance", "Fettling", "Sand Prep", "Knockout",
        "Shotblast", "Compactometer", "Thermocouple", "Pyrometer",
        "Bentonite Index", "Active Clay", "LOI", "Coal Dust",
    ],
    "basic": [
        "OK", "ID", "pH", "PPM", "PLC", "SCADA", "RTU", "TCP", "MQTT",
        "Modbus", "RPM", "Hz", "kW", "kPa", "MPa", "kN",
        "CRITICAL", "HIGH", "MEDIUM", "LOW", "ERROR", "WARNING",
        "ON", "OFF", "NULL", "NaN", "N/A",
    ],
}

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
        "log_root":             "/home/recomputer/logs",
        "session_lifetime_days": 365,
        "cookie_secure":        False,
        "cookie_samesite":      "Lax",
    },
    "database": {
        "host":     "localhost",
        "port":     3306,
        "name":     "gateway",
        "user":     "gateway",
        "password": "Gateway_2025",
    },
    "cors_origins": [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://10.42.0.1:5173"
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
    "shifts": {
        "Morning":   {"start": "06:00", "end": "14:00"},
        "Afternoon": {"start": "14:00", "end": "22:00"},
        "Night":     {"start": "22:00", "end": "06:00"},
    },
    "services": {
        "tts_server_url":  "http://localhost:6000",
        "edge_node_port":  5000,
        "heartbeat_interval_sec": 20,
        "heartbeat_offline_after_sec": 60,
        "mqtt_broker_host": "localhost",
        "mqtt_broker_port": 1883,
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

_startup_sc  = _read_sc()
_app_cfg     = _startup_sc.get("app",      DEFAULT_SYSTEM_CONFIG["app"])
_db_cfg      = _startup_sc.get("database", DEFAULT_SYSTEM_CONFIG["database"])
_svc_cfg     = _startup_sc.get("services", DEFAULT_SYSTEM_CONFIG["services"])

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
sock = Sock(app)


@app.before_request
def _disable_ws_permessage_deflate():
    # simple-websocket (used by flask-sock) always offers permessage-deflate
    # and its compressor/decompressor state is not safe against its own
    # per-connection background thread: a route that both receives a steady
    # stream of frames (filling that thread's read loop) and calls ws.send()
    # from the request thread — exactly /audio-alerts/paging/ws's pattern —
    # corrupts the deflate stream within a handful of messages, surfacing to
    # the browser as "WebSocket ... failed: Invalid frame header". Stripping
    # the client's offered extension here means the negotiation never
    # agrees to compress, so every frame is self-contained and immune to
    # this race. Confirmed with a live repro: identical concurrent
    # send+receive load corrupted messages with the header present, and ran
    # cleanly (600+ messages, zero failures) with it stripped.
    if request.environ.get("HTTP_UPGRADE", "").lower() == "websocket":
        request.environ.pop("HTTP_SEC_WEBSOCKET_EXTENSIONS", None)


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
        f"@localhost:{db.get('port',3306)}/{db.get('name','gateway')}"
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
        health = meta.get("health") or {}
        now_playing = None
        if health.get("paging_active"):
            now_playing = {"type": "paging", "name": "Live Voice Paging", "alert_id": None, "started_at": None}
        elif health.get("currently_playing"):
            now_playing = _alert_info(health["currently_playing"])
        playback_status = "playing" if now_playing else ("queued" if health.get("queue_depth") else "idle")
        return {
            "id":            f"dev-{self.id}",
            "db_id":         self.id,
            "name":          self.label,
            "type":          self.device_type or "Device",
            "data_source_id":self.data_source_id,
            "zone_id":       zone_obj.zone_code if zone_obj else None,
            "zone_name":     zone_obj.name if zone_obj else None,
            "address":       self.address,
            "ip":            self.address,
            "slave_id":      self.slave_id,
            "firmware":      self.firmware,
            "status":        self.status,
            "last_seen":     self.last_seen.isoformat() if self.last_seen else None,
            "last_heartbeat": self.last_seen.isoformat() if self.last_seen else None,
            "uptime_pct":    meta.get("uptime_pct", 100.0),
            "downtime_min":  meta.get("downtime_min", 0),
            "metrics":       meta.get("metrics", {"cpu":0,"memory":0,"latency_ms":0,"audio_queue":0}),
            "health":            meta.get("health"),
            "health_updated_at": meta.get("health_updated_at"),
            "protocol":         meta.get("protocol") or "http",
            "mqtt_broker_host": meta.get("mqtt_broker_host"),
            "mqtt_broker_port": meta.get("mqtt_broker_port"),
            "mqtt_username":    meta.get("mqtt_username"),
            "mqtt_password":    meta.get("mqtt_password"),
            "mqtt_client_id":   meta.get("mqtt_client_id"),
            "audio_channel": meta.get("audio_channel"),
            "volume_override": meta.get("volume_override"),
            "plant":         zone_obj.plant_id if zone_obj else None,
            "line":          zone_obj.line_id  if zone_obj else None,
            "now_playing":       now_playing,
            "playback_status":   playback_status,
        }



# Device.device_metadata keys settable directly (without a wholesale "metadata"
# replace) from the add/edit device UI — includes per-device transport config
# (protocol=http|mqtt + the MQTT broker fields) alongside the pre-existing keys.
_DEVICE_METADATA_KEYS = (
    "uptime_pct", "downtime_min", "metrics", "protocol",
    "mqtt_broker_host", "mqtt_broker_port", "mqtt_username", "mqtt_password",
    "mqtt_client_id", "audio_channel", "volume_override",
)


def _alert_info(alert_id) -> dict:
    """
    Resolve a bare alert_id (as reported by an edge node's /health
    currently_playing) into {type, name, category, zone_code, alert_id,
    started_at} by looking up the alert_logs row dispatch_service.py (or
    alert_poller.py, for cloud/rule alerts) already wrote at dispatch time.
    Reuses the same raw-SQL pattern as aa_announcement_history() below,
    since alert_logs has no SQLAlchemy model.
    """
    try:
        row = db.session.execute(text(
            "SELECT announcement_type, alert_source, alert_category, zone_code, alert_timestamp "
            "FROM alert_logs WHERE alert_id = :aid ORDER BY alert_timestamp DESC LIMIT 1"
        ), {"aid": alert_id}).mappings().first()
    except Exception as e:
        log.warning("_alert_info lookup failed for alert_id=%s: %s", alert_id, e)
        row = None
    if not row:
        return {"type": "alert", "name": "Alert", "category": None,
                "zone_code": None, "alert_id": alert_id, "started_at": None}
    category, zone_code = row["alert_category"], row["zone_code"]
    # Never show the raw alert_id to the operator — fall back to category/zone, not a number.
    fallback_name = " — ".join(p for p in (category, zone_code) if p) or "Alert"
    return {
        "type":       row["announcement_type"] or "alert",
        "name":       row["alert_source"] or fallback_name,
        "category":   category,
        "zone_code":  zone_code,
        "alert_id":   alert_id,
        "started_at": row["alert_timestamp"].isoformat() if row["alert_timestamp"] else None,
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
    file_hash      = Column(String(64))
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


class AlertTypeConfig(db.Model):
    """
    Configurable playback behavior per alert type (D7 — QOL). Critical/High/
    Normal/Low ship as built-in defaults matching edge_node.py's previous
    hardcoded behavior exactly, so nothing changes until an operator edits
    them; operators can also add their own custom types (e.g. "Fire
    Emergency"), which Manual/SOP/Scheduled dispatches can then pick.

    is_blocking:  round-robins with every other unacked "blocking" item
                  (regardless of type) and holds all non-blocking playback —
                  generalizes the old Critical-only round-robin/block rule.
    initial_play_count: None = unlimited (only valid together with
                  requires_ack=True — otherwise nothing would ever stop it).
    repeat_interval_sec / reduction_step_sec / min_interval_sec: each replay
                  shrinks the interval by reduction_step_sec, floored at
                  min_interval_sec — escalates urgency the longer it's ignored.
    """
    __tablename__ = "alert_type_configs"
    id                  = Column(Integer, primary_key=True)
    type_code           = Column(String(32), unique=True, nullable=False)
    label               = Column(String(64), nullable=False)
    # "alert" = urgent, needs the operator's attention (Critical/High/etc.).
    # "information" = routine, non-urgent announcements — same playback
    # engine, just a different default posture (see the seeded "information"
    # row below: not blocking, plays once, no ack required).
    category            = Column(String(16), default="alert")
    is_builtin          = Column(Boolean, default=False)
    sort_order          = Column(Integer, default=100)
    is_blocking         = Column(Boolean, default=False)
    initial_play_count  = Column(Integer)            # NULL = unlimited
    repeat_interval_sec = Column(Float, default=30.0)
    reduction_step_sec  = Column(Float, default=0.0)
    min_interval_sec    = Column(Float, default=5.0)
    requires_ack        = Column(Boolean, default=False)
    created_at          = Column(DateTime, default=datetime.now)
    updated_at          = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self):
        return {
            "id":                  self.type_code,
            "db_id":               self.id,
            "label":               self.label,
            "category":            self.category or "alert",
            "is_builtin":          bool(self.is_builtin),
            "sort_order":          self.sort_order,
            "is_blocking":         bool(self.is_blocking),
            "initial_play_count":  self.initial_play_count,
            "repeat_interval_sec": self.repeat_interval_sec,
            "reduction_step_sec":  self.reduction_step_sec,
            "min_interval_sec":    self.min_interval_sec,
            "requires_ack":        bool(self.requires_ack),
        }


class ScheduledAnnouncement(db.Model):
    __tablename__ = "scheduled_announcements"
    id               = Column(Integer, primary_key=True)
    schedule_code    = Column(String(32), unique=True, nullable=False)
    name             = Column(String(255), nullable=False)
    message          = Column(Text)
    clip_id          = Column(Integer, ForeignKey("audio_clips.id", ondelete="SET NULL"))
    language         = Column(String(8))                     # NULL = use each zone's configured default language
    type_code        = Column(String(32))                    # NULL = built-in "Normal" behavior (unchanged default)
    play_count_override   = Column(Integer)                  # NULL = use the alert type's configured play count
    requires_ack_override  = Column(Boolean)                  # NULL = use the alert type's configured ack requirement
    zone_ids         = Column(JSON)             # list of zone_code strings
    plant_wide       = Column(Boolean, default=False)
    schedule_type    = Column(String(16), default="once")   # once | daily | weekly | hourly | shift
    scheduled_at     = Column(DateTime)                       # for "once"
    days_of_week     = Column(JSON)                           # for "weekly": [0..6], Mon=0
    time_of_day      = Column(String(8))                      # "HH:MM" for daily/weekly; for "hourly" only the MM part is used (HH is ignored)
    interval_hours   = Column(Integer)                        # for "hourly": fire every N hours
    shift_name       = Column(String(64))                     # for "shift": key into the configured shifts dict
    shift_event      = Column(String(16))                     # for "shift": start | end | offset
    shift_offset_min = Column(Integer, default=0)             # for "shift" event=offset: minutes from shift start (negative = before)
    is_enabled       = Column(Boolean, default=True)
    next_run_at      = Column(DateTime)
    last_run_at      = Column(DateTime)
    last_run_status  = Column(String(16))                     # success | partial | failed
    created_by       = Column(String(64))
    created_at       = Column(DateTime, default=datetime.now)
    updated_at       = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    clip = relationship("AudioClip", foreign_keys=[clip_id])

    def to_dict(self):
        return {
            "id":              self.schedule_code,
            "db_id":           self.id,
            "name":            self.name,
            "message":         self.message,
            "clip_id":         self.clip.clip_code if self.clip else None,
            "language":        self.language,
            "type_code":       self.type_code,
            "play_count_override":   self.play_count_override,
            "requires_ack_override": self.requires_ack_override,
            "zone_ids":        self.zone_ids or [],
            "plant_wide":      bool(self.plant_wide),
            "schedule_type":   self.schedule_type,
            "scheduled_at":    self.scheduled_at.isoformat() if self.scheduled_at else None,
            "days_of_week":    self.days_of_week or [],
            "time_of_day":     self.time_of_day,
            "interval_hours":  self.interval_hours,
            "shift_name":      self.shift_name,
            "shift_event":     self.shift_event,
            "shift_offset_min": self.shift_offset_min or 0,
            "is_enabled":      bool(self.is_enabled),
            "next_run_at":     self.next_run_at.isoformat() if self.next_run_at else None,
            "last_run_at":     self.last_run_at.isoformat() if self.last_run_at else None,
            "last_run_status": self.last_run_status,
            "created_by":      self.created_by,
            "created_at":      self.created_at.isoformat() if self.created_at else None,
            "updated_at":      self.updated_at.isoformat() if self.updated_at else None,
        }


class PagingSession(db.Model):
    __tablename__ = "paging_sessions"
    id           = Column(Integer, primary_key=True)
    session_code = Column(String(32), unique=True, nullable=False)
    operator     = Column(String(64), nullable=False)
    zone_ids     = Column(JSON)             # list of zone_code strings targeted
    plant_wide   = Column(Boolean, default=False)
    device_ips   = Column(JSON)             # devices actually connected
    status       = Column(String(16), default="active")   # active | completed | error
    error        = Column(Text)
    started_at   = Column(DateTime, default=datetime.now)
    ended_at     = Column(DateTime)

    def to_dict(self):
        return {
            "id":          self.session_code,
            "db_id":       self.id,
            "operator":    self.operator,
            "zone_ids":    self.zone_ids or [],
            "plant_wide":  bool(self.plant_wide),
            "device_ips":  self.device_ips or [],
            "status":      self.status,
            "error":       self.error,
            "started_at":  self.started_at.isoformat() if self.started_at else None,
            "ended_at":    self.ended_at.isoformat() if self.ended_at else None,
            "duration_sec": (self.ended_at - self.started_at).total_seconds() if (self.ended_at and self.started_at) else None,
        }


# ============================================================
# SOP Step-by-Step Audio Guidance (D4)
# ============================================================

class Sop(db.Model):
    __tablename__ = "sops"
    id              = Column(Integer, primary_key=True)
    sop_code        = Column(String(32), unique=True, nullable=False)
    name            = Column(String(255), nullable=False)
    description     = Column(Text)
    zone_ids        = Column(JSON)               # list of zone_code strings
    plant_wide      = Column(Boolean, default=False)
    ack_timeout_sec = Column(Integer, default=120)
    is_active       = Column(Boolean, default=True)
    created_by      = Column(String(64))
    created_at      = Column(DateTime, default=datetime.now)
    updated_at      = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    steps = relationship("SopStep", backref="sop", cascade="all, delete-orphan",
                         order_by="SopStep.seq", lazy="joined")

    def to_dict(self, include_steps=True):
        d = {
            "id":              self.sop_code,
            "db_id":           self.id,
            "name":            self.name,
            "description":     self.description,
            "zone_ids":        self.zone_ids or [],
            "plant_wide":      bool(self.plant_wide),
            "ack_timeout_sec": self.ack_timeout_sec,
            "is_active":       bool(self.is_active),
            "step_count":      len(self.steps),
            "created_by":      self.created_by,
            "created_at":      self.created_at.isoformat() if self.created_at else None,
            "updated_at":      self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_steps:
            d["steps"] = [s.to_dict() for s in self.steps]
        return d


class SopStep(db.Model):
    __tablename__ = "sop_steps"
    id         = Column(Integer, primary_key=True)
    sop_id     = Column(Integer, ForeignKey("sops.id", ondelete="CASCADE"), nullable=False)
    seq        = Column(Integer, default=0)
    title      = Column(String(255), nullable=False)
    audio_mode = Column(String(16), default="text")     # text | clip
    message    = Column(Text)
    clip_id    = Column(Integer, ForeignKey("audio_clips.id", ondelete="SET NULL"))
    language   = Column(String(8))                     # NULL = use each zone's configured default language
    type_code  = Column(String(32))                    # NULL = built-in "High" behavior (unchanged default)
    play_count_override   = Column(Integer)             # NULL = use the alert type's configured play count
    requires_ack_override  = Column(Boolean)             # NULL = use the alert type's configured ack requirement

    clip = relationship("AudioClip", foreign_keys=[clip_id])

    def to_dict(self):
        return {
            "id":         self.id,
            "seq":        self.seq or 0,
            "title":      self.title,
            "audio_mode": self.audio_mode,
            "message":    self.message,
            "clip_id":    self.clip.clip_code if self.clip else None,
            "language":   self.language,
            "type_code":  self.type_code,
            "play_count_override":   self.play_count_override,
            "requires_ack_override": self.requires_ack_override,
        }


class SopExecution(db.Model):
    __tablename__ = "sop_executions"
    id                  = Column(BigInteger, primary_key=True)
    execution_code      = Column(String(32), unique=True, nullable=False)
    sop_id              = Column(Integer, ForeignKey("sops.id", ondelete="CASCADE"), nullable=False)
    sop_name            = Column(String(255))
    status              = Column(String(32), default="NOT_STARTED")
    # NOT_STARTED | PLAYING_STEP | WAITING_FOR_ACKNOWLEDGEMENT | COMPLETED | CANCELLED | FAILED
    # (WAITING_FOR_ACKNOWLEDGEMENT is 27 chars — column must stay >= 27; was VARCHAR(24) and truncation-rejected it)
    current_step_index  = Column(Integer, default=0)
    retry_count         = Column(Integer, default=0)
    zone_ids            = Column(JSON)
    plant_wide          = Column(Boolean, default=False)
    started_by          = Column(String(64))
    started_at          = Column(DateTime, default=datetime.now)
    step_started_at     = Column(DateTime)     # when the current step began waiting for ack
    completed_at        = Column(DateTime)
    error               = Column(Text)
    current_receipts    = Column(JSON)         # [{device_ip, alert_id}, ...] currently queued on edge
                                                # nodes for this step — needed so acknowledge/cancel/
                                                # timeout-replay can tell those edge nodes to stop
                                                # repeating it (High-priority items replay every 20s
                                                # on the edge node until it gets its own /acknowledge).

    sop = relationship("Sop", foreign_keys=[sop_id])

    def to_dict(self):
        total_steps  = len(self.sop.steps) if self.sop else 0
        current_step = None
        if self.sop and 0 <= self.current_step_index < len(self.sop.steps):
            current_step = self.sop.steps[self.current_step_index].to_dict()
        waited_sec = None
        if self.status == "WAITING_FOR_ACKNOWLEDGEMENT" and self.step_started_at:
            waited_sec = (datetime.now() - self.step_started_at).total_seconds()
        return {
            "id":                  self.execution_code,
            "db_id":               self.id,
            "sop_id":              self.sop.sop_code if self.sop else None,
            "sop_name":            self.sop_name,
            "status":              self.status,
            "current_step_index":  self.current_step_index,
            "current_step_number": self.current_step_index + 1,
            "total_steps":         total_steps,
            "current_step":        current_step,
            "retry_count":         self.retry_count or 0,
            "zone_ids":            self.zone_ids or [],
            "plant_wide":          bool(self.plant_wide),
            "started_by":          self.started_by,
            "started_at":          self.started_at.isoformat() if self.started_at else None,
            "step_started_at":     self.step_started_at.isoformat() if self.step_started_at else None,
            "waited_sec":          round(waited_sec, 1) if waited_sec is not None else None,
            "ack_timeout_sec":     self.sop.ack_timeout_sec if self.sop else None,
            "completed_at":        self.completed_at.isoformat() if self.completed_at else None,
            "error":               self.error,
            "current_receipts":    self.current_receipts or [],
        }


class SopStepExecution(db.Model):
    """Full audit trail — one row per step event (played / acknowledged /
    timeout-replay / completed / cancelled / failed)."""
    __tablename__ = "sop_step_executions"
    id           = Column(BigInteger, primary_key=True)
    execution_id = Column(BigInteger, ForeignKey("sop_executions.id", ondelete="CASCADE"), nullable=False)
    sop_id       = Column(Integer)
    step_id      = Column(Integer)
    step_number  = Column(Integer)
    event_type   = Column(String(32))     # played | acknowledged | timeout_replay | completed | cancelled | failed
    audio_mode   = Column(String(16))
    zone_code    = Column(String(64))
    language     = Column(String(8))
    operator     = Column(String(64))
    retry_count  = Column(Integer, default=0)
    created_at   = Column(DateTime, default=datetime.now)

    def to_dict(self):
        return {
            "id":           self.id,
            "execution_id": self.execution_id,
            "sop_id":       self.sop_id,
            "step_id":      self.step_id,
            "step_number":  self.step_number,
            "event_type":   self.event_type,
            "audio_mode":   self.audio_mode,
            "zone_code":    self.zone_code,
            "language":     self.language,
            "operator":     self.operator,
            "retry_count":  self.retry_count or 0,
            "created_at":   self.created_at.isoformat() if self.created_at else None,
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


class AppNoTranslateWord(db.Model):
    __tablename__ = "app_no_translate_words"
    id        = Column(Integer, primary_key=True)
    word      = Column(String(128), unique=True, nullable=False)
    category  = Column(String(32), default="custom")  # foundry / basic / custom
    is_preset = Column(Boolean, default=False)

    def to_dict(self):
        return {
            "id":        self.id,
            "word":      self.word,
            "category":  self.category,
            "is_preset": bool(self.is_preset),
        }


class ZoneLanguageConfig(db.Model):
    """
    Stores language assignments for three config types:
      "plant" : reference_id = plant_id
      "zone"  : reference_id = zone_code
      "shift" : reference_id = shift name (Morning / Afternoon / Night)
    """
    __tablename__  = "zone_language_configs"
    __table_args__ = (
        Index("uq_zlc_type_ref", "config_type", "reference_id", unique=True),
    )
    id          = Column(Integer,     primary_key=True)
    config_type = Column(String(16),  nullable=False)   # plant | zone | shift
    reference_id= Column(String(64),  nullable=False)
    language    = Column(String(8),   nullable=False)
    updated_at  = Column(DateTime,    default=datetime.now, onupdate=datetime.now)

    def to_dict(self):
        return {
            "config_type":  self.config_type,
            "reference_id": self.reference_id,
            "language":     self.language,
        }


class AppSettingKV(db.Model):
    """Generic key-value store for app-level settings."""
    __tablename__ = "app_settings_kv"
    key   = Column(String(128), primary_key=True)
    value = Column(Text)


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
    gateways_total = Device.query.filter_by(device_type="Edge Node").count()
    gateways_up    = Device.query.filter_by(device_type="Edge Node", status="online").count()
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

    no_translate_words = [w.to_dict() for w in AppNoTranslateWord.query.order_by(
        AppNoTranslateWord.is_preset.desc(), AppNoTranslateWord.category, AppNoTranslateWord.word
    ).all()]

    return jsonify(ok=True, data={
        "languages":           languages,
        "zone_types":          [z["label"] for z in zone_types],
        "zone_type_objects":   zone_types,
        "parameters":          parameters,
        "no_translate_words":  no_translate_words,
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


# ── No-Translation Words CRUD ──────────────────────────────────────────────────

@app.route("/audio-alerts/config/no-translate", methods=["GET"])
def aa_no_translate_get():
    err = _require_login()
    if err: return err
    words = AppNoTranslateWord.query.order_by(
        AppNoTranslateWord.is_preset.desc(), AppNoTranslateWord.category, AppNoTranslateWord.word
    ).all()
    return jsonify(ok=True, data=[w.to_dict() for w in words])


@app.route("/audio-alerts/config/no-translate", methods=["POST"])
def aa_no_translate_post():
    err = _require_login()
    if err: return err
    data = request.json or {}
    word = (data.get("word") or "").strip()
    if not word:
        return jsonify(ok=False, error="word required"), 400
    if AppNoTranslateWord.query.filter_by(word=word).first():
        return jsonify(ok=False, error="Word already exists"), 409
    w = AppNoTranslateWord(word=word, category="custom", is_preset=False)
    db.session.add(w)
    db.session.commit()
    _add_audit("config.change", f"no_translate/{word}", f"No-translate word added: {word}")
    return jsonify(ok=True, data=w.to_dict()), 201


@app.route("/audio-alerts/config/no-translate/<int:word_id>", methods=["DELETE"])
def aa_no_translate_del(word_id):
    err = _require_login()
    if err: return err
    w = AppNoTranslateWord.query.get(word_id)
    if not w:
        return jsonify(ok=False, error="Word not found"), 404
    if w.is_preset:
        return jsonify(ok=False, error="Pre-registered words cannot be removed"), 400
    before = w.to_dict()
    db.session.delete(w)
    db.session.commit()
    _add_audit("config.change", f"no_translate/{w.word}", f"No-translate word removed: {w.word}", before=before)
    return jsonify(ok=True, data={"id": word_id})


# ============================================================
# ZONE LANGUAGE CONFIG  (plant-wise / zone-wise / shift-wise)
# ============================================================

def _kv_get(key: str, default: str = "") -> str:
    row = AppSettingKV.query.get(key)
    return row.value if row else default


def _kv_set(key: str, value: str):
    row = AppSettingKV.query.get(key)
    if row:
        row.value = value
    else:
        db.session.add(AppSettingKV(key=key, value=value))


@app.route("/audio-alerts/zone-language-config", methods=["GET"])
def aa_zlc_get():
    err = _require_login()
    if err: return err

    active_type = _kv_get("zone_language.active_type", "zone")

    rows = ZoneLanguageConfig.query.all()
    configs: dict = {"plant": {}, "zone": {}, "shift": {}}
    for r in rows:
        configs.setdefault(r.config_type, {})[r.reference_id] = r.language

    # Enrich shift config with defaults if empty
    for shift in ("Morning", "Afternoon", "Night"):
        configs["shift"].setdefault(shift, "EN")

    # Return all plants and zones so frontend can build the UI
    plants = [p.to_dict() for p in Plant.query.all()]
    zones  = [z.to_dict() for z in Zone.query.all()]

    return jsonify(ok=True, data={
        "active_type": active_type,
        "configs":     configs,
        "plants":      plants,
        "zones":       zones,
    })


@app.route("/audio-alerts/zone-language-config", methods=["PUT"])
def aa_zlc_put():
    """
    Save language config and optionally switch active type.

    Body:
      active_type  string            "plant" | "zone" | "shift"
      configs      dict              {"plant": {plant_id: lang}, "zone": {zone_code: lang}, "shift": {shift: lang}}
      apply        bool (default true) — if true, update Zone.default_language immediately
    """
    err = _require_login()
    if err: return err
    if not _can("aa.zones.edit"):
        return jsonify(ok=False, error="Permission denied"), 403

    data        = request.json or {}
    active_type = data.get("active_type", _kv_get("zone_language.active_type", "zone"))
    configs     = data.get("configs", {})
    apply_now   = data.get("apply", True)

    try:
        # Persist every config entry (upsert)
        for ctype, mapping in configs.items():
            if ctype not in ("plant", "zone", "shift"):
                continue
            for ref_id, lang in mapping.items():
                row = ZoneLanguageConfig.query.filter_by(
                    config_type=ctype, reference_id=ref_id
                ).first()
                if row:
                    row.language   = lang
                    row.updated_at = datetime.now()
                else:
                    db.session.add(ZoneLanguageConfig(
                        config_type=ctype, reference_id=ref_id, language=lang
                    ))

        _kv_set("zone_language.active_type", active_type)
        db.session.commit()

        # Apply to zones immediately if requested
        if apply_now:
            _apply_zone_languages(active_type, configs)

        _add_audit("config.change", "zone_language_config",
                   f"Zone language config saved (type={active_type})",
                   after={"active_type": active_type})

        return jsonify(ok=True, data={"active_type": active_type})
    except Exception as e:
        db.session.rollback()
        log.error("zone_language_config save failed: %s", e)
        return jsonify(ok=False, error=str(e)), 500


def _apply_zone_languages(active_type: str, configs: dict):
    """Update Zone.default_language based on the chosen config type."""
    zones = Zone.query.all()

    if active_type == "plant":
        plant_langs = configs.get("plant", {})
        # Fall back to DB
        for r in ZoneLanguageConfig.query.filter_by(config_type="plant").all():
            plant_langs.setdefault(r.reference_id, r.language)
        for z in zones:
            lang = plant_langs.get(z.plant_id)
            if lang:
                z.default_language = lang

    elif active_type == "zone":
        zone_langs = configs.get("zone", {})
        for r in ZoneLanguageConfig.query.filter_by(config_type="zone").all():
            zone_langs.setdefault(r.reference_id, r.language)
        for z in zones:
            lang = zone_langs.get(z.zone_code)
            if lang:
                z.default_language = lang

    elif active_type == "shift":
        shift_langs = configs.get("shift", {})
        for r in ZoneLanguageConfig.query.filter_by(config_type="shift").all():
            shift_langs.setdefault(r.reference_id, r.language)
        current_shift = _detect_shift()
        lang = shift_langs.get(current_shift, "EN")
        for z in zones:
            z.default_language = lang

    db.session.commit()


# ── Shift Times (stored in system_config.json) ──────────────────────────────

@app.route("/audio-alerts/shift-times", methods=["GET"])
def aa_shift_times_get():
    err = _require_login()
    if err: return err
    sc = _read_sc()
    shifts = sc.get("shifts", DEFAULT_SYSTEM_CONFIG["shifts"])
    return jsonify(ok=True, data=shifts)


@app.route("/audio-alerts/shift-times", methods=["PUT"])
def aa_shift_times_put():
    err = _require_login()
    if err: return err
    if not _can("aa.security.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    sc = _read_sc()
    sc["shifts"] = data
    _write_sc(sc)
    _add_audit("config.change", "shift_times", "Shift times updated", after=data)
    return jsonify(ok=True, data=data)


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
    gateways_total = Device.query.filter_by(device_type="Edge Node").count()
    gateways_up    = Device.query.filter_by(device_type="Edge Node", status="online").count()
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


@app.route("/audio-alerts/broadcast/<int:alert_id>/ack", methods=["POST"])
def aa_broadcast_ack(alert_id):
    """Acknowledge a Manual Broadcast / Scheduled Announcement alert from
    Live Monitor — these have no AlertEvent row (they only write to
    alert_logs), so unlike aa_ack() above there's no status to flip; the
    only real state is the edge node's own queue, which acknowledge_on_edge
    already knows how to clear (same helper sop_service already uses)."""
    err = _require_login()
    if err: return err
    if not _can("aa.alerts.ack"):
        return jsonify(ok=False, error="Permission denied"), 403
    row = db.session.execute(text(
        "SELECT device_ip, zone_code FROM alert_logs WHERE alert_id = :aid ORDER BY alert_timestamp DESC LIMIT 1"
    ), {"aid": alert_id}).mappings().first()
    if not row or not (row["device_ip"] or row["zone_code"]):
        return jsonify(ok=False, error="Alert not found"), 404
    if not dispatch_service.acknowledge_on_edge(row["device_ip"], alert_id, zone_code=row["zone_code"]):
        return jsonify(ok=False, error="Could not reach the edge node"), 502
    db.session.execute(text(
        "UPDATE alert_logs SET ack_time = :now WHERE alert_id = :aid"
    ), {"now": datetime.now(), "aid": alert_id})
    db.session.commit()
    _add_audit("ack", f"alert/{alert_id}", f"Broadcast alert #{alert_id}",
              after={"ack_user": _current_user().get("username", "unknown")})
    return jsonify(ok=True, data={"alert_id": alert_id})


@app.route("/audio-alerts/broadcast", methods=["POST"])
def aa_broadcast():
    err = _require_login()
    if err: return err
    if not _can("aa.broadcast.manual"):
        return jsonify(ok=False, error="Permission denied"), 403
    data     = request.json or {}
    zone_ids = data.get("zone_ids", [])
    message  = (data.get("message") or "").strip() or None
    clip_id  = data.get("clip_id")
    language = (data.get("language") or "").strip() or None  # None = use each zone's configured default language

    if not zone_ids:
        return jsonify(ok=False, error="At least one zone is required"), 400
    if not message and not clip_id:
        return jsonify(ok=False, error="Either a message or a clip_id is required"), 400

    clip_path = None
    if clip_id:
        clip = AudioClip.query.filter_by(clip_code=clip_id).first()
        if not clip or not clip.file_path:
            return jsonify(ok=False, error="Clip not found or has no audio file"), 404
        clip_path = str(_clip_abs_path(clip.file_path))

    play_count_override = data.get("play_count_override")
    if play_count_override not in (None, ""):
        play_count_override = int(play_count_override)
    else:
        play_count_override = None
    requires_ack_override = data.get("requires_ack_override")
    if requires_ack_override is not None:
        requires_ack_override = bool(requires_ack_override)

    user = _current_user().get("username", "unknown")
    events_bus.publish({
        "type": "manual_broadcast", "event": "start", "operator": user,
        "zone_ids": zone_ids, "plant_wide": False,
        "timestamp": datetime.now().isoformat(),
    })
    try:
        receipts = dispatch_service.dispatch_broadcast(
            zone_ids, message=message, clip_path=clip_path, language=language,
            alert_category=data.get("priority", "Normal"), alert_source="Manual Broadcast",
            type_code=data.get("type_code"),
            play_count_override=play_count_override,
            requires_ack_override=requires_ack_override,
        )
    finally:
        events_bus.publish({
            "type": "manual_broadcast", "event": "end", "operator": user,
            "zone_ids": zone_ids, "plant_wide": False,
            "timestamp": datetime.now().isoformat(),
        })
    delivered = sum(1 for r in receipts if r.get("edge_delivered"))

    _add_audit("broadcast.manual", "broadcast", "Manual Broadcast",
              after={**data, "delivered": delivered, "targeted": len(receipts)})

    return jsonify(ok=True, data={
        "alert_id":   str(uuid.uuid4()),
        "zone_ids":   zone_ids,
        "message":    message,
        "clip_id":    clip_id,
        "language":   language,
        "timestamp":  datetime.now().isoformat(),
        "targeted":   len(receipts),
        "delivered":  delivered,
        "receipts":   receipts,
    })


# ============================================================
# AUDIO ALERTS — Live Voice Paging (D2)
# ============================================================
#
# Browser mic (MediaRecorder, ~250ms chunks) -> this WS relay -> one outbound
# WS connection per target edge node -> edge_node.py's /paging/ws, which
# pipes the stream live into ffmpeg for near-real-time playback. This relay
# does no decoding itself — it just fans out each binary chunk it receives.
# No translation/TTS anywhere in this path, and no repeated HTTP uploads —
# the voice stream itself only ever travels over these two WebSockets.

_paging_lock = threading.Lock()
_active_paging_users = set()   # operator usernames currently holding a PTT session


@sock.route("/audio-alerts/paging/ws")
def aa_paging_ws(ws):
    if "user" not in session:
        ws.close(reason=1008, message="Unauthorized")
        return
    if not _can("aa.paging.use"):
        ws.close(reason=1008, message="Permission denied")
        return

    user = _current_user().get("username", "unknown")

    with _paging_lock:
        if user in _active_paging_users:
            ws.send(json.dumps({"type": "error", "code": "already_active",
                                "message": "You already have an active paging session"}))
            ws.close(reason=1008, message="Session already active for this operator")
            return
        _active_paging_users.add(user)

    device_conns = {}   # device_ip -> websocket-client connection
    paging_session = None

    def _close_all():
        for ip, conn in device_conns.items():
            try: conn.close()
            except Exception: pass
        device_conns.clear()

    try:
        init_raw = ws.receive(timeout=10)
        if init_raw is None:
            return
        try:
            init = json.loads(init_raw)
        except Exception:
            ws.close(reason=1003, message="First message must be JSON target selection")
            return

        zone_ids   = init.get("zone_ids") or []
        plant_wide = bool(init.get("plant_wide"))
        zone_codes = dispatch_service.all_zone_codes() if plant_wide else zone_ids
        targets    = dispatch_service.resolve_targets(zone_codes)
        edge_port  = _svc_cfg.get("edge_node_port", 5000)

        for t in targets:
            ip = t.get("device_ip")
            if not ip:
                continue
            try:
                conn = ws_client.create_connection(f"ws://{ip}:{edge_port}/paging/ws", timeout=5)
                device_conns[ip] = conn
            except Exception as e:
                log.warning("[Paging] Could not connect to edge node %s: %s", ip, e)

        paging_session = PagingSession(
            session_code=f"page-{uuid.uuid4().hex[:10]}", operator=user,
            zone_ids=zone_codes, plant_wide=plant_wide,
            device_ips=list(device_conns.keys()), status="active",
        )
        db.session.add(paging_session)
        db.session.commit()

        _add_audit("paging.start", "paging", "Live Voice Paging",
                  after={"user": user, "zones": zone_codes, "devices": list(device_conns.keys())})
        events_bus.publish({
            "type": "paging_session", "event": "start", "operator": user,
            "zones": zone_codes, "plant_wide": plant_wide,
            "devices": list(device_conns.keys()), "timestamp": datetime.now().isoformat(),
        })
        log.info("[Paging] %s started paging to %d/%d device(s)",
                user, len(device_conns), len(targets))

        if not device_conns:
            ws.send(json.dumps({"type": "error", "code": "no_devices",
                                "message": "No reachable devices in target zone(s)"}))
            paging_session.status = "error"
            paging_session.error = "No reachable devices"
            paging_session.ended_at = datetime.now()
            db.session.commit()
            return

        ws.send(json.dumps({"type": "ready", "devices": len(device_conns)}))

        while True:
            try:
                data = ws.receive(timeout=30)
            except ConnectionClosed:
                break
            if data is None:
                break
            if isinstance(data, (bytes, bytearray)):
                dead = []
                for ip, conn in device_conns.items():
                    try:
                        conn.send_binary(bytes(data))
                    except Exception:
                        dead.append(ip)
                for ip in dead:
                    device_conns.pop(ip, None)
                    # Node disconnection handled gracefully — tell the operator
                    # rather than silently paging into a dead connection.
                    try:
                        ws.send(json.dumps({"type": "device_disconnected", "device_ip": ip,
                                            "remaining": len(device_conns)}))
                    except Exception:
                        pass
                    if not device_conns:
                        try:
                            ws.send(json.dumps({"type": "error", "code": "all_devices_lost",
                                                "message": "All target devices disconnected"}))
                        except Exception:
                            pass
                        break
            # ignore text control frames other than the initial JSON message
    except Exception as e:
        log.error("[Paging] Session error: %s", e)
        if paging_session:
            paging_session.status = "error"
            paging_session.error = str(e)[:500]
    finally:
        _close_all()
        with _paging_lock:
            _active_paging_users.discard(user)
        if paging_session:
            if paging_session.status == "active":
                paging_session.status = "completed"
            paging_session.ended_at = datetime.now()
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
        _add_audit("paging.stop", "paging", "Live Voice Paging", after={"user": user})
        events_bus.publish({
            "type": "paging_session", "event": "stop", "operator": user,
            "timestamp": datetime.now().isoformat(),
        })
        log.info("[Paging] %s ended paging session", user)


@app.route("/audio-alerts/paging/sessions", methods=["GET"])
def aa_paging_sessions():
    err = _require_login()
    if err: return err
    if not _can("aa.logs.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    limit = max(1, min(200, int(request.args.get("limit", 50))))
    rows = PagingSession.query.order_by(PagingSession.started_at.desc()).limit(limit).all()
    return jsonify(ok=True, data=[r.to_dict() for r in rows])


# ============================================================
# AUDIO ALERTS — Real-time dashboard events (D1 / tech requirements)
# ============================================================
#
# Generic fan-out channel: any backend service (heartbeat_service for device
# status, dispatch_service for announcements, sop_service for execution
# state) calls events_bus.publish(event) and every connected dashboard
# browser receives it immediately — satisfies "real-time zone status /
# announcement / SOP updates without a full page refresh" without forcing
# each feature through its own bespoke channel.

@sock.route("/audio-alerts/dashboard/ws")
def aa_dashboard_ws(ws):
    if "user" not in session:
        ws.close(reason=1008, message="Unauthorized")
        return

    # events_bus fans out from whichever background thread published the
    # event (heartbeat_service, dispatch_service's thread pool, scheduler_service,
    # sop_service) — without this lock, two threads calling ws.send() on the
    # same connection at once interleave their frame writes and corrupt the
    # WebSocket stream (surfaces to the browser as "Invalid frame header").
    send_lock = threading.Lock()

    def _on_event(event):
        try:
            with send_lock:
                ws.send(json.dumps(event))
        except Exception:
            pass

    events_bus.subscribe(_on_event)
    try:
        with send_lock:
            ws.send(json.dumps({"type": "connected"}))
        while True:
            try:
                msg = ws.receive(timeout=30)
            except ConnectionClosed:
                break
            if msg is None:
                # receive() returns None on a plain timeout too, not just on
                # disconnect — this channel is receive-only from the browser
                # (no client->server messages expected), so it times out
                # every 30s by design. Only treat it as closed once the
                # connection itself has actually dropped.
                if not ws.connected:
                    break
                continue
            # No client->server messages expected; connection is receive-only
            # from the browser's point of view (keepalive pings are fine to ignore).
    except Exception as e:
        log.warning("[Dashboard WS] session error: %s", e)
    finally:
        events_bus.unsubscribe(_on_event)


# ============================================================
# AUDIO ALERTS — Scheduled Announcements (D5)
# ============================================================

def _next_schedule_code():
    last = ScheduledAnnouncement.query.order_by(ScheduledAnnouncement.id.desc()).first()
    n = (last.id + 1) if last else 1
    return f"sched-{n:03d}"


@app.route("/audio-alerts/schedules", methods=["GET"])
def aa_schedules_get():
    err = _require_login()
    if err: return err
    if not _can("aa.schedule.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    rows = ScheduledAnnouncement.query.order_by(ScheduledAnnouncement.created_at.desc()).all()
    return jsonify(ok=True, data=[r.to_dict() for r in rows])


def _apply_schedule_fields(sched, data):
    if "name" in data: sched.name = data["name"]
    if "message" in data: sched.message = data["message"]
    if "language" in data: sched.language = data["language"] or None
    if "type_code" in data: sched.type_code = data["type_code"] or None
    if "play_count_override" in data:
        v = data["play_count_override"]
        sched.play_count_override = int(v) if v not in (None, "") else None
    if "requires_ack_override" in data:
        v = data["requires_ack_override"]
        sched.requires_ack_override = bool(v) if v is not None else None
    if "zone_ids" in data: sched.zone_ids = data["zone_ids"] or []
    if "plant_wide" in data: sched.plant_wide = bool(data["plant_wide"])
    if "schedule_type" in data: sched.schedule_type = data["schedule_type"]
    if "days_of_week" in data: sched.days_of_week = data["days_of_week"] or []
    if "time_of_day" in data: sched.time_of_day = data["time_of_day"]
    if "interval_hours" in data: sched.interval_hours = data["interval_hours"]
    if "shift_name" in data: sched.shift_name = data["shift_name"]
    if "shift_event" in data: sched.shift_event = data["shift_event"]
    if "shift_offset_min" in data: sched.shift_offset_min = data["shift_offset_min"] or 0
    if "is_enabled" in data: sched.is_enabled = bool(data["is_enabled"])
    if "scheduled_at" in data and data["scheduled_at"]:
        dt = datetime.fromisoformat(data["scheduled_at"])
        if dt.tzinfo is not None:
            # Everything else in this app (datetime.now(), compute_next_run's
            # `after` default) is naive/local-time. A tz-aware value here
            # would blow up the first `scheduled_at > after` comparison with
            # "can't compare offset-naive and offset-aware datetimes".
            dt = dt.astimezone().replace(tzinfo=None)
        sched.scheduled_at = dt
    if "clip_id" in data:
        clip = AudioClip.query.filter_by(clip_code=data["clip_id"]).first() if data["clip_id"] else None
        sched.clip_id = clip.id if clip else None


def _get_shifts_config():
    sc = _read_sc()
    return sc.get("shifts", DEFAULT_SYSTEM_CONFIG["shifts"])


def _compute_schedule_next_run(sched):
    return scheduler_service.compute_next_run(
        sched.schedule_type, sched.scheduled_at, sched.days_of_week, sched.time_of_day,
        interval_hours=sched.interval_hours, shift_name=sched.shift_name,
        shift_event=sched.shift_event, shift_offset_min=sched.shift_offset_min,
        shifts_config=_get_shifts_config(),
    )


@app.route("/audio-alerts/schedules", methods=["POST"])
def aa_schedules_post():
    err = _require_login()
    if err: return err
    if not _can("aa.schedule.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    if not data.get("name"):
        return jsonify(ok=False, error="Name is required"), 400
    if not data.get("message") and not data.get("clip_id"):
        return jsonify(ok=False, error="Either a message or a clip_id is required"), 400
    if not data.get("zone_ids") and not data.get("plant_wide"):
        return jsonify(ok=False, error="Select target zone(s) or plant-wide"), 400
    if data.get("schedule_type") == "hourly" and not data.get("interval_hours"):
        return jsonify(ok=False, error="Choose how often (every N hours)"), 400
    if data.get("schedule_type") == "shift":
        if not data.get("shift_name") or data["shift_name"] not in _get_shifts_config():
            return jsonify(ok=False, error="Choose a valid shift"), 400
        if data.get("shift_event") not in ("start", "end", "offset"):
            return jsonify(ok=False, error="Choose when during the shift"), 400

    sched = ScheduledAnnouncement(
        schedule_code=_next_schedule_code(),
        created_by=_current_user().get("username", "unknown"),
    )
    _apply_schedule_fields(sched, data)
    sched.next_run_at = _compute_schedule_next_run(sched)
    db.session.add(sched)
    db.session.commit()
    if sched.message and not sched.clip_id:
        dispatch_service.warm_cache_async(sched.message, sched.language or "EN",
                                          alert_source=f"Schedule cache warm: {sched.name}")
    _add_audit("schedule.add", f"schedule/{sched.id}", f"Schedule: {sched.name}", after=sched.to_dict())
    return jsonify(ok=True, data=sched.to_dict()), 201


@app.route("/audio-alerts/schedules/<sched_id>", methods=["PUT"])
def aa_schedules_put(sched_id):
    err = _require_login()
    if err: return err
    if not _can("aa.schedule.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    sched = ScheduledAnnouncement.query.filter_by(schedule_code=sched_id).first()
    if not sched:
        return jsonify(ok=False, error="Schedule not found"), 404
    before = sched.to_dict()
    data = request.json or {}
    _apply_schedule_fields(sched, data)
    sched.next_run_at = _compute_schedule_next_run(sched)
    db.session.commit()
    if sched.message and not sched.clip_id and ("message" in data or "language" in data):
        dispatch_service.warm_cache_async(sched.message, sched.language or "EN",
                                          alert_source=f"Schedule cache warm: {sched.name}")
    _add_audit("schedule.edit", f"schedule/{sched.id}", f"Schedule: {sched.name}",
              before=before, after=sched.to_dict())
    return jsonify(ok=True, data=sched.to_dict())


@app.route("/audio-alerts/schedules/<sched_id>", methods=["DELETE"])
def aa_schedules_del(sched_id):
    err = _require_login()
    if err: return err
    if not _can("aa.schedule.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    sched = ScheduledAnnouncement.query.filter_by(schedule_code=sched_id).first()
    if not sched:
        return jsonify(ok=False, error="Schedule not found"), 404
    before = sched.to_dict()
    db.session.delete(sched)
    db.session.commit()
    _add_audit("schedule.remove", f"schedule/{sched_id}", f"Schedule: {before.get('name')}", before=before)
    return jsonify(ok=True, data={"id": sched_id})


@app.route("/audio-alerts/schedules/<sched_id>/enable", methods=["POST"])
def aa_schedules_enable(sched_id):
    err = _require_login()
    if err: return err
    if not _can("aa.schedule.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    sched = ScheduledAnnouncement.query.filter_by(schedule_code=sched_id).first()
    if not sched:
        return jsonify(ok=False, error="Schedule not found"), 404
    sched.is_enabled = True
    sched.next_run_at = _compute_schedule_next_run(sched)
    db.session.commit()
    return jsonify(ok=True, data=sched.to_dict())


@app.route("/audio-alerts/schedules/<sched_id>/disable", methods=["POST"])
def aa_schedules_disable(sched_id):
    err = _require_login()
    if err: return err
    if not _can("aa.schedule.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    sched = ScheduledAnnouncement.query.filter_by(schedule_code=sched_id).first()
    if not sched:
        return jsonify(ok=False, error="Schedule not found"), 404
    sched.is_enabled = False
    db.session.commit()
    return jsonify(ok=True, data=sched.to_dict())


# ============================================================
# AUDIO ALERTS — Alert Type Settings (D7)
#
# Configurable playback behavior per alert type. Manual/SOP/Scheduled
# dispatches reference a type_code here (falling back to sensible per-kind
# defaults if not set) to resolve play count / repeat interval / reduction
# step / requires_ack, which dispatch_service.py then hands to the edge
# node's /play call — see dispatch_service._resolve_alert_type().
# ============================================================

def _next_alert_type_code(label: str) -> str:
    base = "".join(c.lower() if c.isalnum() else "_" for c in label).strip("_") or "type"
    code = base
    n = 1
    while AlertTypeConfig.query.filter_by(type_code=code).first():
        n += 1
        code = f"{base}_{n}"
    return code


@app.route("/audio-alerts/alert-types", methods=["GET"])
def aa_alert_types_get():
    err = _require_login()
    if err: return err
    if not _can("aa.alerttypes.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    rows = AlertTypeConfig.query.order_by(AlertTypeConfig.sort_order.asc()).all()
    return jsonify(ok=True, data=[r.to_dict() for r in rows])


def _apply_alert_type_fields(cfg, data):
    if "label" in data and data["label"]: cfg.label = data["label"]
    if "category" in data:
        category = data["category"]
        if category not in ("alert", "information"):
            raise ValueError("category must be 'alert' or 'information'")
        cfg.category = category
    if "sort_order" in data: cfg.sort_order = int(data["sort_order"])
    if "is_blocking" in data: cfg.is_blocking = bool(data["is_blocking"])
    if "initial_play_count" in data:
        v = data["initial_play_count"]
        cfg.initial_play_count = int(v) if v not in (None, "") else None
    if "repeat_interval_sec" in data: cfg.repeat_interval_sec = float(data["repeat_interval_sec"])
    if "reduction_step_sec" in data: cfg.reduction_step_sec = float(data["reduction_step_sec"])
    if "min_interval_sec" in data: cfg.min_interval_sec = float(data["min_interval_sec"])
    if "requires_ack" in data: cfg.requires_ack = bool(data["requires_ack"])
    # An "unlimited plays" type with no acknowledgement path would repeat
    # forever with no way to ever stop — the settings UI shouldn't be able
    # to create that dead end.
    if cfg.initial_play_count is None and not cfg.requires_ack:
        raise ValueError("An alert type with unlimited plays must require acknowledgement")


@app.route("/audio-alerts/alert-types", methods=["POST"])
def aa_alert_types_post():
    err = _require_login()
    if err: return err
    if not _can("aa.alerttypes.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    if not data.get("label", "").strip():
        return jsonify(ok=False, error="Name is required"), 400
    cfg = AlertTypeConfig(type_code=_next_alert_type_code(data["label"]), is_builtin=False,
                         repeat_interval_sec=30.0, min_interval_sec=5.0)
    try:
        _apply_alert_type_fields(cfg, data)
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    db.session.add(cfg)
    db.session.commit()
    _add_audit("alerttype.add", f"alert-type/{cfg.type_code}", f"Alert type: {cfg.label}", after=cfg.to_dict())
    return jsonify(ok=True, data=cfg.to_dict()), 201


@app.route("/audio-alerts/alert-types/<type_code>", methods=["PUT"])
def aa_alert_types_put(type_code):
    err = _require_login()
    if err: return err
    if not _can("aa.alerttypes.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg = AlertTypeConfig.query.filter_by(type_code=type_code).first()
    if not cfg:
        return jsonify(ok=False, error="Alert type not found"), 404
    before = cfg.to_dict()
    data = request.json or {}
    try:
        _apply_alert_type_fields(cfg, data)
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    db.session.commit()
    _add_audit("alerttype.edit", f"alert-type/{cfg.type_code}", f"Alert type: {cfg.label}",
              before=before, after=cfg.to_dict())
    return jsonify(ok=True, data=cfg.to_dict())


@app.route("/audio-alerts/alert-types/<type_code>", methods=["DELETE"])
def aa_alert_types_del(type_code):
    err = _require_login()
    if err: return err
    if not _can("aa.alerttypes.manage"):
        return jsonify(ok=False, error="Permission denied"), 403
    cfg = AlertTypeConfig.query.filter_by(type_code=type_code).first()
    if not cfg:
        return jsonify(ok=False, error="Alert type not found"), 404
    if cfg.is_builtin:
        return jsonify(ok=False, error="Built-in alert types can be edited but not deleted"), 400
    before = cfg.to_dict()
    db.session.delete(cfg)
    db.session.commit()
    _add_audit("alerttype.remove", f"alert-type/{type_code}", f"Alert type: {before.get('label')}", before=before)
    return jsonify(ok=True, data={"id": type_code})


# ============================================================
# AUDIO ALERTS — SOP Step-by-Step Audio Guidance (D4)
# ============================================================

def _next_sop_code():
    last = Sop.query.order_by(Sop.id.desc()).first()
    n = (last.id + 1) if last else 1
    return f"sop-{n:03d}"


def _apply_sop_fields(sop, data):
    if "name" in data: sop.name = data["name"]
    if "description" in data: sop.description = data["description"]
    if "zone_ids" in data: sop.zone_ids = data["zone_ids"] or []
    if "plant_wide" in data: sop.plant_wide = bool(data["plant_wide"])
    if "ack_timeout_sec" in data: sop.ack_timeout_sec = max(5, int(data["ack_timeout_sec"] or 120))
    if "is_active" in data: sop.is_active = bool(data["is_active"])

    if "steps" in data:
        for s in list(sop.steps):
            db.session.delete(s)
        sop.steps = []
        for i, step_data in enumerate(data["steps"] or []):
            clip = None
            if step_data.get("clip_id"):
                clip = AudioClip.query.filter_by(clip_code=step_data["clip_id"]).first()
            play_count_override = step_data.get("play_count_override")
            requires_ack_override = step_data.get("requires_ack_override")
            sop.steps.append(SopStep(
                seq=i,
                title=step_data.get("title") or f"Step {i + 1}",
                audio_mode=step_data.get("audio_mode", "text"),
                message=step_data.get("message"),
                clip_id=clip.id if clip else None,
                language=step_data.get("language") or None,
                type_code=step_data.get("type_code") or None,
                play_count_override=int(play_count_override) if play_count_override not in (None, "") else None,
                requires_ack_override=bool(requires_ack_override) if requires_ack_override is not None else None,
            ))


@app.route("/audio-alerts/sops", methods=["GET"])
def aa_sops_get():
    err = _require_login()
    if err: return err
    if not _can("aa.sop.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    include_steps = request.args.get("steps", "1") != "0"
    rows = Sop.query.order_by(Sop.created_at.desc()).all()
    return jsonify(ok=True, data=[s.to_dict(include_steps=include_steps) for s in rows])


@app.route("/audio-alerts/sops/<sop_id>", methods=["GET"])
def aa_sop_get_one(sop_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    sop = Sop.query.filter_by(sop_code=sop_id).first()
    if not sop:
        return jsonify(ok=False, error="SOP not found"), 404
    return jsonify(ok=True, data=sop.to_dict())


@app.route("/audio-alerts/sops", methods=["POST"])
def aa_sops_post():
    err = _require_login()
    if err: return err
    if not _can("aa.sop.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = request.json or {}
    if not data.get("name"):
        return jsonify(ok=False, error="Name is required"), 400
    if not data.get("zone_ids") and not data.get("plant_wide"):
        return jsonify(ok=False, error="Select target zone(s) or plant-wide"), 400

    sop = Sop(sop_code=_next_sop_code(), created_by=_current_user().get("username", "unknown"))
    _apply_sop_fields(sop, data)
    db.session.add(sop)
    db.session.commit()
    _add_audit("sop.add", f"sop/{sop.id}", f"SOP: {sop.name}", after=sop.to_dict())
    return jsonify(ok=True, data=sop.to_dict()), 201


@app.route("/audio-alerts/sops/<sop_id>", methods=["PUT"])
def aa_sops_put(sop_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    sop = Sop.query.filter_by(sop_code=sop_id).first()
    if not sop:
        return jsonify(ok=False, error="SOP not found"), 404
    before = sop.to_dict()
    _apply_sop_fields(sop, request.json or {})
    db.session.commit()
    _add_audit("sop.edit", f"sop/{sop.id}", f"SOP: {sop.name}", before=before, after=sop.to_dict())
    return jsonify(ok=True, data=sop.to_dict())


@app.route("/audio-alerts/sops/<sop_id>", methods=["DELETE"])
def aa_sops_delete(sop_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.delete"):
        return jsonify(ok=False, error="Permission denied"), 403
    sop = Sop.query.filter_by(sop_code=sop_id).first()
    if not sop:
        return jsonify(ok=False, error="SOP not found"), 404
    if sop_service.has_active_execution(Sop, SopExecution, sop.id):
        return jsonify(ok=False, error="SOP has a currently running execution — cancel it first"), 409
    before = sop.to_dict()
    db.session.delete(sop)
    db.session.commit()
    _add_audit("sop.delete", f"sop/{sop_id}", f"SOP: {before.get('name')}", before=before)
    return jsonify(ok=True, data={"id": sop_id})


@app.route("/audio-alerts/sops/<sop_id>/steps/<int:step_id>", methods=["DELETE"])
def aa_sop_step_delete(sop_id, step_id):
    """Delete a single step (re-sequences remaining steps)."""
    err = _require_login()
    if err: return err
    if not _can("aa.sop.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    sop = Sop.query.filter_by(sop_code=sop_id).first()
    if not sop:
        return jsonify(ok=False, error="SOP not found"), 404
    if sop_service.has_active_execution(Sop, SopExecution, sop.id):
        return jsonify(ok=False, error="SOP has a currently running execution — cancel it first"), 409
    step = SopStep.query.filter_by(id=step_id, sop_id=sop.id).first()
    if not step:
        return jsonify(ok=False, error="Step not found"), 404
    db.session.delete(step)
    db.session.flush()
    for i, s in enumerate(sorted(sop.steps, key=lambda s: s.seq)):
        s.seq = i
    db.session.commit()
    return jsonify(ok=True, data=sop.to_dict())


# ── Execution ───────────────────────────────────────────────

@app.route("/audio-alerts/sops/<sop_id>/start", methods=["POST"])
def aa_sop_start(sop_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.run"):
        return jsonify(ok=False, error="Permission denied"), 403
    user = _current_user().get("username", "unknown")
    out, error = sop_service.start_execution(
        app, db, Sop, SopExecution, SopStepExecution,
        dispatch_service.dispatch_broadcast, dispatch_service.all_zone_codes,
        sop_id, user,
    )
    if error:
        return jsonify(ok=False, error=error), 400
    _add_audit("sop.start", f"sop-execution/{out['id']}", f"SOP started: {out['sop_name']}", after=out)
    return jsonify(ok=True, data=out), 201


@app.route("/audio-alerts/sops/executions", methods=["GET"])
def aa_sop_executions():
    err = _require_login()
    if err: return err
    if not _can("aa.sop.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    active_only = request.args.get("active") == "1"
    q = SopExecution.query
    if active_only:
        q = q.filter(SopExecution.status.in_(["PLAYING_STEP", "WAITING_FOR_ACKNOWLEDGEMENT"]))
    limit = max(1, min(200, int(request.args.get("limit", 50))))
    rows = q.order_by(SopExecution.started_at.desc()).limit(limit).all()
    return jsonify(ok=True, data=[r.to_dict() for r in rows])


@app.route("/audio-alerts/sops/executions/<execution_id>", methods=["GET"])
def aa_sop_execution_get(execution_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    execution = SopExecution.query.filter_by(execution_code=execution_id).first()
    if not execution:
        return jsonify(ok=False, error="Execution not found"), 404
    return jsonify(ok=True, data=execution.to_dict())


@app.route("/audio-alerts/sops/executions/<execution_id>/audit", methods=["GET"])
def aa_sop_execution_audit(execution_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.view"):
        return jsonify(ok=False, error="Permission denied"), 403
    execution = SopExecution.query.filter_by(execution_code=execution_id).first()
    if not execution:
        return jsonify(ok=False, error="Execution not found"), 404
    rows = SopStepExecution.query.filter_by(execution_id=execution.id).order_by(SopStepExecution.created_at.asc()).all()
    return jsonify(ok=True, data=[r.to_dict() for r in rows])


@app.route("/audio-alerts/sops/executions/<execution_id>/acknowledge", methods=["POST"])
def aa_sop_ack(execution_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.ack"):
        return jsonify(ok=False, error="Permission denied"), 403
    user = _current_user().get("username", "unknown")
    out, error = sop_service.acknowledge(
        app, db, SopExecution, SopStepExecution,
        dispatch_service.dispatch_broadcast, dispatch_service.all_zone_codes,
        execution_id, user, acknowledge_on_edge=dispatch_service.acknowledge_on_edge,
    )
    if error:
        return jsonify(ok=False, error=error), 400
    _add_audit("sop.acknowledge", f"sop-execution/{execution_id}",
              f"SOP step acknowledged: {out['sop_name']}", after=out)
    return jsonify(ok=True, data=out)


@app.route("/audio-alerts/sops/executions/<execution_id>/repeat", methods=["POST"])
def aa_sop_repeat(execution_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.ack"):
        return jsonify(ok=False, error="Permission denied"), 403
    user = _current_user().get("username", "unknown")
    out, error = sop_service.repeat_current_step(
        app, db, SopExecution, SopStepExecution,
        dispatch_service.dispatch_broadcast, dispatch_service.all_zone_codes,
        execution_id, user, acknowledge_on_edge=dispatch_service.acknowledge_on_edge,
    )
    if error:
        return jsonify(ok=False, error=error), 400
    _add_audit("sop.repeat", f"sop-execution/{execution_id}",
              f"SOP step repeated: {out['sop_name']}", after=out)
    return jsonify(ok=True, data=out)


@app.route("/audio-alerts/sops/executions/<execution_id>/cancel", methods=["POST"])
def aa_sop_cancel(execution_id):
    err = _require_login()
    if err: return err
    if not _can("aa.sop.run"):
        return jsonify(ok=False, error="Permission denied"), 403
    user = _current_user().get("username", "unknown")
    out, error = sop_service.cancel(app, db, SopExecution, SopStepExecution, execution_id, user,
                                    acknowledge_on_edge=dispatch_service.acknowledge_on_edge)
    if error:
        return jsonify(ok=False, error=error), 400
    _add_audit("sop.cancel", f"sop-execution/{execution_id}", f"SOP cancelled: {out['sop_name']}", after=out)
    return jsonify(ok=True, data=out)


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

def _clip_upload_dir() -> Path:
    d = Path(__file__).parent / "uploads" / "clips"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _clip_abs_path(file_path):
    """AudioClip.file_path is stored as just a filename (resolved against
    the current uploads/clips dir at read time, so it survives the backend
    checkout moving/renaming) — except older rows created before this fix,
    which still hold a full absolute path baked in at upload time; keep
    those working as long as that path still exists, with no migration."""
    if not file_path:
        return None
    p = Path(file_path)
    if p.is_absolute():
        return p
    return _clip_upload_dir() / file_path


@app.route("/audio-alerts/audio/clips", methods=["GET"])
def aa_clips_get():
    err = _require_login()
    if err: return err
    return jsonify(ok=True, data=[c.to_dict() for c in AudioClip.query.order_by(AudioClip.id.desc()).all()])


def _hash_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


@app.route("/audio-alerts/audio/clips", methods=["POST"])
def aa_clips_post():
    err = _require_login()
    if err: return err
    if not _can("aa.audio.upload"):
        return jsonify(ok=False, error="Permission denied"), 403
    data = {}
    file_hash = None
    if request.content_type and "multipart/form-data" in request.content_type:
        data = {k: v for k, v in request.form.items()}
        f = request.files.get("file")
        if f:
            content = f.read()
            file_hash = _hash_bytes(content)
            existing = AudioClip.query.filter_by(file_hash=file_hash).first()
            if existing:
                # Identical audio already stored — reuse the file, don't write it again.
                data["file_path"] = existing.file_path
                data["format"]    = existing.format
                data["file_size"] = existing.file_size
                data["duration_sec"] = data.get("duration_sec") or existing.duration_sec
            else:
                filename = f"{uuid.uuid4().hex[:8]}_{f.filename}"
                (_clip_upload_dir() / filename).write_bytes(content)
                data["file_path"] = filename
                data["format"]    = os.path.splitext(f.filename)[1].lstrip(".").upper()
                data["file_size"] = len(content)
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
        file_hash      = file_hash,
        description    = data.get("description"),
        uploaded_by    = _current_user().get("username", "unknown"),
    )
    db.session.add(clip)
    db.session.commit()
    _add_audit("audio.upload", f"clip/{clip.clip_code}", f"Clip: {clip.name}", after=clip.to_dict())
    return jsonify(ok=True, data=clip.to_dict(), reused_existing_file=bool(file_hash and AudioClip.query.filter(
        AudioClip.file_hash == file_hash, AudioClip.id != clip.id).first())), 201


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
            filename = f"{uuid.uuid4().hex[:8]}_{f.filename}"
            f.save(str(_clip_upload_dir() / filename))
            data["file_path"] = filename
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

    # Safe delete: refuse if anything still references this clip rather than
    # silently SET NULL-ing it out from under a rule/schedule/SOP step.
    refs = []
    n = AlertRule.query.filter_by(clip_id=clip.id).count()
    if n: refs.append(f"{n} alert rule(s)")
    n = ScheduledAnnouncement.query.filter_by(clip_id=clip.id).count()
    if n: refs.append(f"{n} scheduled announcement(s)")
    if "SopStep" in globals():
        n = SopStep.query.filter_by(clip_id=clip.id).count()
        if n: refs.append(f"{n} SOP step(s)")
    if refs:
        return jsonify(ok=False, error=f"Clip is still used by {', '.join(refs)} — remove those references first"), 409

    before = clip.to_dict()
    db.session.delete(clip)
    db.session.commit()
    _add_audit("audio.delete", f"clip/{clip_id}", f"Clip: {before.get('name')}", before=before)
    return jsonify(ok=True, data={"id": clip_id})


@app.route("/audio-alerts/audio/clips/<clip_id>/file", methods=["GET"])
def aa_clip_file(clip_id):
    """Serve the raw audio bytes for in-browser preview playback."""
    err = _require_login()
    if err: return err
    clip = AudioClip.query.filter_by(clip_code=clip_id).first()
    if not clip or not clip.file_path:
        return jsonify(ok=False, error="Clip not found"), 404
    p = _clip_abs_path(clip.file_path)
    if not p.exists():
        return jsonify(ok=False, error="Audio file missing on disk"), 404
    mimetype = "audio/wav" if (clip.format or "").upper() == "WAV" else "audio/mpeg"
    return send_from_directory(p.parent, p.name, mimetype=mimetype, conditional=True)


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
            k: data[k] for k in _DEVICE_METADATA_KEYS if k in data
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
    # Merge (never wholesale-replace) so unrelated keys already in metadata —
    # heartbeat_service's live "health" snapshot, audio_channel, etc. — survive
    # an edit that only touches a few fields (e.g. switching protocol/mqtt config).
    meta_updates = data.get("metadata") or {k: data[k] for k in _DEVICE_METADATA_KEYS if k in data}
    if meta_updates:
        device.device_metadata = {**(device.device_metadata or {}), **meta_updates}
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
    device = _resolve_device(dev_id)
    if not device:
        return jsonify(ok=False, error="Device not found"), 404
    if not device.address:
        return jsonify(ok=False, error="No IP address configured for this device"), 400
    receipt = dispatch_service.send_test_tone(device.address)
    _add_audit("device.test_fire", f"device/{device.id}", f"Device: {device.label}", after=receipt)
    return jsonify(ok=receipt.get("ok", False), data={
        "device_id": dev_id,
        "status": "test_fired" if receipt.get("edge_delivered") else "test_failed",
        "ts": datetime.now().isoformat(),
        "receipt": receipt,
    })


@app.route("/audio-alerts/devices/<dev_id>/restart", methods=["POST"])
def aa_device_restart(dev_id):
    err = _require_login()
    if err: return err
    if not _can("aa.devices.edit"):
        return jsonify(ok=False, error="Permission denied"), 403
    device = _resolve_device(dev_id)
    if not device:
        return jsonify(ok=False, error="Device not found"), 404
    if not device.address:
        return jsonify(ok=False, error="No IP address configured for this device"), 400
    # Edge nodes are unattended headless devices with no remote-reboot agent —
    # "restart" clears the node's stuck playback queue/state instead of a real
    # power-cycle, which needs a physical or OS-level remote-reboot capability
    # this system does not currently have.
    try:
        resp = requests.post(
            f"http://{device.address}:{dispatch_service.EDGE_NODE_PORT}/restart",
            timeout=8,
        )
        ok = resp.status_code == 200
    except Exception as e:
        ok = False
        log.warning("Device restart failed for %s: %s", device.address, e)
    _add_audit("device.restart", f"device/{device.id}", f"Device: {device.label}", after={"ok": ok})
    return jsonify(ok=ok, data={
        "device_id": dev_id,
        "status": "queue_cleared" if ok else "unreachable",
        "ts": datetime.now().isoformat(),
    })


@app.route("/audio-alerts/devices/<dev_id>/status", methods=["GET"])
def aa_device_status(dev_id):
    """Proxy to http://<device-ip>:<edge_port>/health for on-demand refresh
    (the background heartbeat_service poller keeps this current on its own —
    this route exists for the dashboard's manual 'Refresh Status' action)."""
    err = _require_login()
    if err: return err
    device = _resolve_device(dev_id)
    if not device:
        return jsonify(ok=False, error="Device not found"), 404
    ip = device.address
    if not ip:
        return jsonify(ok=False, error="No IP address configured for this device"), 400
    edge_port = _svc_cfg.get("edge_node_port", 5000)
    try:
        req = urllib.request.Request(
            f"http://{ip}:{edge_port}/health",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw)
        # Update device last_seen
        device.last_seen = datetime.now()
        device.status    = "online"
        db.session.commit()
        return jsonify(ok=True, data=data)
    except urllib.error.URLError as e:
        reason = str(e.reason) if hasattr(e, "reason") else str(e)
        device.status = "offline"
        db.session.commit()
        return jsonify(ok=False, error=f"Device unreachable: {reason}"), 503
    except json.JSONDecodeError:
        return jsonify(ok=False, error="Device returned invalid JSON"), 502
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 503


# ============================================================
# AUDIO ALERTS — Edge Node Dashboard (D6)
#
# Called server-to-server by edge_node.py's own /dashboard/* proxy routes,
# never directly by a browser — same trusted-LAN model as dispatch_service.py
# already calling into edge_node.py with no auth. No session cookie exists
# on a headless edge device, so these intentionally skip _require_login().
# ============================================================

def _execution_targets_zone(execution, zone_code) -> bool:
    return bool(execution.plant_wide or zone_code in (execution.zone_ids or []))


def _sop_execution_for_zone(zone_code):
    if not zone_code:
        return None
    candidates = SopExecution.query.filter(
        SopExecution.status.in_(["PLAYING_STEP", "WAITING_FOR_ACKNOWLEDGEMENT"])
    ).all()
    return next((e for e in candidates if _execution_targets_zone(e, zone_code)), None)


def _edge_playback_logs(zone_code: str, limit: int) -> list:
    """Recent alert_logs rows for this edge node's zone — for its local
    dashboard's "playback logs" view. Same raw-SQL pattern as _alert_info()
    since alert_logs has no SQLAlchemy model."""
    try:
        rows = db.session.execute(text(
            "SELECT alert_id, alert_timestamp, alert_category, alert_source, announcement_type, "
            "lang_code, edge_delivered, audio_played "
            "FROM alert_logs WHERE zone_code = :zc ORDER BY alert_timestamp DESC LIMIT :lim"
        ), {"zc": zone_code, "lim": limit}).mappings().all()
    except Exception as e:
        log.warning("_edge_playback_logs failed for zone=%s: %s", zone_code, e)
        return []
    return [{
        "alert_id":          r["alert_id"],
        "timestamp":         r["alert_timestamp"].isoformat() if r["alert_timestamp"] else None,
        "alert_category":    r["alert_category"],
        "alert_source":      r["alert_source"],
        "announcement_type": r["announcement_type"],
        "lang_code":         r["lang_code"],
        "edge_delivered":    bool(r["edge_delivered"]),
        "audio_played":      bool(r["audio_played"]),
    } for r in rows]


@app.route("/audio-alerts/edge/ping", methods=["GET"])
def aa_edge_ping():
    """Zone-independent reachability check for an edge node's local
    dashboard — every other /audio-alerts/edge/* route needs a zone or an
    alert_id, so none of them can tell the dashboard "gateway is up" when
    this node has no ZONE_ID configured yet."""
    return jsonify(ok=True)


@app.route("/audio-alerts/edge/playback-logs", methods=["GET"])
def aa_edge_playback_logs():
    """Recent playback log for this edge node's zone — called by
    edge_node.py's own /dashboard/playback-logs proxy route."""
    zone_code = request.args.get("zone", "").strip()
    if not zone_code:
        return jsonify(ok=False, error="zone required"), 400
    limit = max(1, min(100, request.args.get("limit", 20, type=int) or 20))
    return jsonify(ok=True, data=_edge_playback_logs(zone_code, limit))


@app.route("/audio-alerts/edge/alert-info", methods=["GET"])
def aa_edge_alert_info():
    """What is alert_id X? — lets an edge node label its own /health
    currently_playing (SOP / scheduled / manual / other) for its dashboard."""
    alert_id = request.args.get("alert_id", type=int)
    if not alert_id:
        return jsonify(ok=False, error="alert_id required"), 400
    return jsonify(ok=True, data=_alert_info(alert_id))


@app.route("/audio-alerts/edge/sop-status", methods=["GET"])
def aa_edge_sop_status():
    """Active SOP execution (if any) targeting this edge node's zone."""
    zone_code = request.args.get("zone", "").strip()
    execution = _sop_execution_for_zone(zone_code)
    if not execution:
        return jsonify(ok=True, data=None)
    out = execution.to_dict()
    out["needs_ack"] = execution.status == "WAITING_FOR_ACKNOWLEDGEMENT"
    return jsonify(ok=True, data=out)


@app.route("/audio-alerts/edge/sop-ack", methods=["POST"])
def aa_edge_sop_ack():
    """SOP step acknowledgement from the edge node's own dashboard."""
    body = request.get_json(force=True, silent=True) or {}
    execution_id = body.get("execution_id")
    zone_code    = (body.get("zone_code") or "").strip()
    if not execution_id or not zone_code:
        return jsonify(ok=False, error="execution_id and zone_code required"), 400

    execution = SopExecution.query.filter_by(execution_code=execution_id).first()
    if not execution:
        return jsonify(ok=False, error="Execution not found"), 404
    if not _execution_targets_zone(execution, zone_code):
        return jsonify(ok=False, error="This execution does not target your zone"), 403

    out, error = sop_service.acknowledge(
        app, db, SopExecution, SopStepExecution,
        dispatch_service.dispatch_broadcast, dispatch_service.all_zone_codes,
        execution_id, f"edge:{zone_code}", acknowledge_on_edge=dispatch_service.acknowledge_on_edge,
    )
    if error:
        # e.g. already acknowledged by someone else — safe no-op, not a crash
        return jsonify(ok=False, error=error), 409
    return jsonify(ok=True, data=out)


@app.route("/audio-alerts/edge/sop-repeat", methods=["POST"])
def aa_edge_sop_repeat():
    """Manual "repeat this step" from the edge node's own dashboard."""
    body = request.get_json(force=True, silent=True) or {}
    execution_id = body.get("execution_id")
    zone_code    = (body.get("zone_code") or "").strip()
    if not execution_id or not zone_code:
        return jsonify(ok=False, error="execution_id and zone_code required"), 400

    execution = SopExecution.query.filter_by(execution_code=execution_id).first()
    if not execution:
        return jsonify(ok=False, error="Execution not found"), 404
    if not _execution_targets_zone(execution, zone_code):
        return jsonify(ok=False, error="This execution does not target your zone"), 403

    out, error = sop_service.repeat_current_step(
        app, db, SopExecution, SopStepExecution,
        dispatch_service.dispatch_broadcast, dispatch_service.all_zone_codes,
        execution_id, f"edge:{zone_code}", acknowledge_on_edge=dispatch_service.acknowledge_on_edge,
    )
    if error:
        return jsonify(ok=False, error=error), 409
    return jsonify(ok=True, data=out)


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


@app.route("/audio-alerts/announcements/history", methods=["GET"])
def aa_announcement_history():
    """
    Unified Announcement History (D1) — merges manual broadcasts, scheduled
    announcements, live paging sessions, and SOP step executions into one
    normalized timeline: timestamp, type, target, audio_mode, language, status.
    """
    err = _require_login()
    if err: return err
    if not _can("aa.logs.view"):
        return jsonify(ok=False, error="Permission denied"), 403

    page   = max(1, int(request.args.get("page", 1)))
    size   = max(1, min(200, int(request.args.get("page_size", 50))))
    type_f = request.args.get("type", "").strip()
    zone_f = request.args.get("zone", "").strip()

    items = []

    # 1. alert_logs — manual broadcasts + scheduled announcements (+ SOP once tagged)
    if not type_f or type_f in ("broadcast", "scheduled", "sop"):
        try:
            cols = [r[0] for r in db.session.execute(text(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_logs'"
            )).fetchall()]
            if "announcement_type" in cols:
                where = ["announcement_type IS NOT NULL"]
                params = {}
                if type_f:
                    where.append("announcement_type = :t"); params["t"] = type_f
                if zone_f:
                    where.append("zone_code = :z"); params["z"] = zone_f
                rows = db.session.execute(text(
                    f"SELECT * FROM alert_logs WHERE {' AND '.join(where)} "
                    f"ORDER BY alert_timestamp DESC LIMIT 500"
                ), params).mappings().all()
                for r in rows:
                    items.append({
                        "timestamp":  r["alert_timestamp"].isoformat() if r.get("alert_timestamp") else None,
                        "type":       r.get("announcement_type") or "broadcast",
                        "target":     r.get("zone_code") or "—",
                        "audio_mode": r.get("audio_mode"),
                        "language":   r.get("lang_code"),
                        "status":     "delivered" if r.get("edge_delivered") else "failed",
                        "source":     r.get("alert_source"),
                    })
        except Exception as e:
            log.warning("Announcement history: alert_logs read failed: %s", e)

    # 2. live paging sessions
    if not type_f or type_f == "paging":
        q = PagingSession.query
        for p in q.order_by(PagingSession.started_at.desc()).limit(200).all():
            target = "Plant-wide" if p.plant_wide else ", ".join(p.zone_ids or []) or "—"
            if zone_f and not p.plant_wide and zone_f not in (p.zone_ids or []):
                continue
            items.append({
                "timestamp":  p.started_at.isoformat() if p.started_at else None,
                "type":       "paging",
                "target":     target,
                "audio_mode": "live_voice",
                "language":   None,
                "status":     p.status,
                "source":     p.operator,
            })

    # 3. SOP step executions (present once the SOP subsystem models exist)
    if ("SopStepExecution" in globals()) and (not type_f or type_f == "sop"):
        q = SopStepExecution.query
        for e in q.order_by(SopStepExecution.created_at.desc()).limit(200).all():
            if zone_f and e.zone_code != zone_f:
                continue
            items.append({
                "timestamp":  e.created_at.isoformat() if e.created_at else None,
                "type":       "sop",
                "target":     e.zone_code or "—",
                "audio_mode": e.audio_mode,
                "language":   e.language,
                "status":     e.event_type,
                "source":     e.operator or "system",
            })

    items.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    total = len(items)
    start = (page - 1) * size
    return jsonify(ok=True, data={
        "items": items[start:start + size],
        "total": total, "page": page, "page_size": size,
        "pages": max(1, (total + size - 1) // size),
    })


@app.route("/audio-alerts/logs/alert-device", methods=["GET"])
def aa_logs_alert_device():
    """Read from the external alert_logs table populated by the device alert program."""
    err = _require_login()
    if err: return err
    if not _can("aa.logs.view"):
        return jsonify(ok=False, error="Permission denied"), 403

    page          = max(1, int(request.args.get("page", 1)))
    size          = max(1, min(200, int(request.args.get("page_size", 50))))
    search        = request.args.get("search", "").strip()
    priority_arg  = request.args.get("priority", "").strip()
    zone_arg      = request.args.get("zone", "").strip()
    sort_by_arg   = request.args.get("sort_by", "")
    sort_dir_arg  = request.args.get("sort_dir", "desc").lower()

    try:
        # Discover columns from information_schema
        cols_result = db.session.execute(text(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alert_logs' "
            "ORDER BY ORDINAL_POSITION"
        )).fetchall()

        if not cols_result:
            return jsonify(ok=False, error="alert_logs table not found in database"), 404

        cols = [row[0] for row in cols_result]

        # Map semantic roles to actual column names
        def _pick(candidates):
            return next((c for c in candidates if c in cols), None)

        name_col     = _pick(["alert_name","name","message","alert_message","alert","alert_source"])
        priority_col = _pick(["priority","severity","level","alert_level","alert_category"])
        zone_col     = _pick(["zone","zone_name","zone_id","location","zone_code"])
        ts_col       = _pick(["timestamp","alert_timestamp","triggered_at","alert_time","time","ts","created_at"])
        dest_col     = _pick(["destination_ips","dest_ips","target_ips","device_ips","ip_addresses","destination","device_ip"])
        status_col   = _pick(["delivery_status","status","send_status","dispatch_status","delivery_state","edge_delivered"])

        # Build WHERE clause
        conditions = []
        params     = {}

        if search and name_col:
            conditions.append(f"`{name_col}` LIKE :search")
            params["search"] = f"%{search}%"
        if priority_arg and priority_col:
            conditions.append(f"`{priority_col}` = :priority")
            params["priority"] = priority_arg
        if zone_arg and zone_col:
            conditions.append(f"`{zone_col}` = :zone")
            params["zone"] = zone_arg

        where = "WHERE " + " AND ".join(conditions) if conditions else ""

        # Total count
        total = db.session.execute(
            text(f"SELECT COUNT(*) FROM alert_logs {where}"), params
        ).scalar() or 0

        # Validate sort column
        safe_sort = sort_by_arg if sort_by_arg in cols else (ts_col or cols[0])
        safe_dir  = "DESC" if sort_dir_arg == "desc" else "ASC"

        # Fetch page
        qparams = dict(params)
        qparams["limit"]  = size
        qparams["offset"] = (page - 1) * size
        rows = db.session.execute(
            text(f"SELECT * FROM alert_logs {where} "
                 f"ORDER BY `{safe_sort}` {safe_dir} "
                 f"LIMIT :limit OFFSET :offset"),
            qparams
        ).mappings().all()

        def _serialize(r):
            out = {}
            for k, v in r.items():
                if hasattr(v, "isoformat"):
                    out[k] = v.isoformat()
                elif isinstance(v, Decimal):
                    out[k] = float(v)
                else:
                    out[k] = v
            return out

        return jsonify(ok=True, data={
            "items":   [_serialize(r) for r in rows],
            "columns": cols,
            "total":   total,
            "page":    page,
            "page_size": size,
            "pages":   max(1, (total + size - 1) // size),
            "meta": {
                "name_col":     name_col,
                "priority_col": priority_col,
                "zone_col":     zone_col,
                "timestamp_col": ts_col,
                "dest_col":     dest_col,
                "status_col":   status_col,
            },
        })
    except Exception as e:
        log.error("alert_logs query failed: %s", e)
        return jsonify(ok=False, error=f"Failed to read alert_logs: {str(e)}"), 500


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
        "ALTER TABLE audio_clips    ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64)",
        "ALTER TABLE alert_logs     ADD COLUMN IF NOT EXISTS audio_mode VARCHAR(16)",
        "ALTER TABLE alert_logs     ADD COLUMN IF NOT EXISTS announcement_type VARCHAR(24)",
        # sop_executions.status was originally VARCHAR(24), but
        # "WAITING_FOR_ACKNOWLEDGEMENT" is 27 chars — widen the already-created
        # column (MODIFY COLUMN is safe to re-run; no-op once already 32).
        "ALTER TABLE sop_executions MODIFY COLUMN status VARCHAR(32)",
        "ALTER TABLE sop_executions ADD COLUMN IF NOT EXISTS current_receipts JSON",
        "ALTER TABLE scheduled_announcements ADD COLUMN IF NOT EXISTS interval_hours INT",
        "ALTER TABLE scheduled_announcements ADD COLUMN IF NOT EXISTS shift_name VARCHAR(64)",
        "ALTER TABLE scheduled_announcements ADD COLUMN IF NOT EXISTS shift_event VARCHAR(16)",
        "ALTER TABLE scheduled_announcements ADD COLUMN IF NOT EXISTS shift_offset_min INT DEFAULT 0",
        "ALTER TABLE scheduled_announcements ADD COLUMN IF NOT EXISTS type_code VARCHAR(32)",
        "ALTER TABLE scheduled_announcements ADD COLUMN IF NOT EXISTS play_count_override INT",
        "ALTER TABLE scheduled_announcements ADD COLUMN IF NOT EXISTS requires_ack_override TINYINT(1)",
        "ALTER TABLE sop_steps ADD COLUMN IF NOT EXISTS type_code VARCHAR(32)",
        "ALTER TABLE sop_steps ADD COLUMN IF NOT EXISTS play_count_override INT",
        "ALTER TABLE sop_steps ADD COLUMN IF NOT EXISTS requires_ack_override TINYINT(1)",
        "ALTER TABLE alert_type_configs ADD COLUMN IF NOT EXISTS category VARCHAR(16) DEFAULT 'alert'",
        # New tables created automatically by SQLAlchemy — no ALTER needed
        # but we add them here as safety guards:
        """CREATE TABLE IF NOT EXISTS zone_language_configs (
            id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            config_type VARCHAR(16) NOT NULL,
            reference_id VARCHAR(64) NOT NULL,
            language    VARCHAR(8) NOT NULL,
            updated_at  DATETIME,
            UNIQUE KEY uq_zlc_type_ref (config_type, reference_id)
        )""",
        """CREATE TABLE IF NOT EXISTS app_settings_kv (
            `key`   VARCHAR(128) NOT NULL PRIMARY KEY,
            `value` TEXT
        )""",
        """CREATE TABLE IF NOT EXISTS sops (
            id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sop_code        VARCHAR(32) NOT NULL,
            name            VARCHAR(255) NOT NULL,
            description     TEXT,
            zone_ids        JSON,
            plant_wide      BOOLEAN,
            ack_timeout_sec INT,
            is_active       BOOLEAN,
            created_by      VARCHAR(64),
            created_at      DATETIME,
            updated_at      DATETIME,
            UNIQUE KEY uq_sops_sop_code (sop_code)
        )""",
        """CREATE TABLE IF NOT EXISTS sop_steps (
            id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            sop_id     INT NOT NULL,
            seq        INT,
            title      VARCHAR(255) NOT NULL,
            audio_mode VARCHAR(16),
            message    TEXT,
            clip_id    INT,
            language   VARCHAR(8),
            FOREIGN KEY (sop_id) REFERENCES sops(id) ON DELETE CASCADE,
            FOREIGN KEY (clip_id) REFERENCES audio_clips(id) ON DELETE SET NULL
        )""",
        """CREATE TABLE IF NOT EXISTS sop_executions (
            id                  BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            execution_code      VARCHAR(32) NOT NULL,
            sop_id              INT NOT NULL,
            sop_name            VARCHAR(255),
            status              VARCHAR(24),
            current_step_index  INT,
            retry_count         INT,
            zone_ids            JSON,
            plant_wide          BOOLEAN,
            started_by          VARCHAR(64),
            started_at          DATETIME,
            step_started_at     DATETIME,
            completed_at        DATETIME,
            error               TEXT,
            UNIQUE KEY uq_sop_executions_execution_code (execution_code),
            FOREIGN KEY (sop_id) REFERENCES sops(id) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS sop_step_executions (
            id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            execution_id BIGINT NOT NULL,
            sop_id       INT,
            step_id      INT,
            step_number  INT,
            event_type   VARCHAR(32),
            audio_mode   VARCHAR(16),
            zone_code    VARCHAR(64),
            language     VARCHAR(8),
            operator     VARCHAR(64),
            retry_count  INT,
            created_at   DATETIME,
            FOREIGN KEY (execution_id) REFERENCES sop_executions(id) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS paging_sessions (
            id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            session_code VARCHAR(32) NOT NULL,
            operator     VARCHAR(64) NOT NULL,
            zone_ids     JSON,
            plant_wide   BOOLEAN,
            device_ips   JSON,
            status       VARCHAR(16),
            error        TEXT,
            started_at   DATETIME,
            ended_at     DATETIME,
            UNIQUE KEY uq_paging_sessions_session_code (session_code)
        )""",
        """CREATE TABLE IF NOT EXISTS alert_type_configs (
            id                  INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            type_code           VARCHAR(32) NOT NULL,
            label               VARCHAR(64) NOT NULL,
            category            VARCHAR(16) DEFAULT 'alert',
            is_builtin          BOOLEAN DEFAULT FALSE,
            sort_order          INT DEFAULT 100,
            is_blocking         BOOLEAN DEFAULT FALSE,
            initial_play_count  INT,
            repeat_interval_sec FLOAT DEFAULT 30.0,
            reduction_step_sec  FLOAT DEFAULT 0.0,
            min_interval_sec    FLOAT DEFAULT 5.0,
            requires_ack        BOOLEAN DEFAULT FALSE,
            created_at          DATETIME,
            updated_at          DATETIME,
            UNIQUE KEY uq_alert_type_configs_type_code (type_code)
        )""",
    ]
    with db.engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception as e:
                log.warning("Migration skipped (%s): %s", sql[:60], e)

    # Seed the 4 built-in alert types on first run only — these values
    # exactly match edge_node.py's previous hardcoded behavior (Critical
    # round-robins/blocks forever, High replays every 20s forever, Normal/Low
    # play once), so nothing changes for existing deployments until an
    # operator actually edits them from the Alert Type Settings page.
    if AlertTypeConfig.query.count() == 0:
        for type_code, label, sort_order, is_blocking, play_count, interval, reduction, min_interval, requires_ack in [
            ("critical", "Critical", 0, True,  None, 0.0,  0.0, 0.0,  True),
            ("high",     "High",     1, False, None, 20.0, 0.0, 20.0, True),
            ("normal",   "Normal",   2, False, 1,    60.0, 0.0, 60.0, False),
            ("low",      "Low",      3, False, 1,    60.0, 0.0, 60.0, False),
        ]:
            db.session.add(AlertTypeConfig(
                type_code=type_code, label=label, category="alert", is_builtin=True, sort_order=sort_order,
                is_blocking=is_blocking, initial_play_count=play_count,
                repeat_interval_sec=interval, reduction_step_sec=reduction,
                min_interval_sec=min_interval, requires_ack=requires_ack,
            ))
        db.session.commit()
        log.info("Seeded 4 built-in alert types (critical/high/normal/low)")

    # Seed one built-in "Information" type independently of the block above
    # (so it also lands on databases that already had the 4 alert types
    # seeded before this category distinction existed) — a routine, non-
    # urgent announcement: not blocking, plays once, no acknowledgement.
    if not AlertTypeConfig.query.filter_by(type_code="information").first():
        db.session.add(AlertTypeConfig(
            type_code="information", label="Information", category="information", is_builtin=True,
            sort_order=4, is_blocking=False, initial_play_count=1,
            repeat_interval_sec=60.0, reduction_step_sec=0.0, min_interval_sec=60.0, requires_ack=False,
        ))
        db.session.commit()
        log.info("Seeded built-in 'Information' alert type")


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

    if AppNoTranslateWord.query.count() == 0:
        for category, words in NO_TRANSLATE_PRESETS.items():
            for word in words:
                db.session.add(AppNoTranslateWord(word=word, category=category, is_preset=True))
        db.session.commit()
        log.info("Seeded app_no_translate_words")

        log.info("Seeded plants/lines/zones")


if __name__ == "__main__":
    log = setup_logging()
    log.info("Starting Gateway Configuration UI (SQL backend)")
    with app.app_context():
        for attempt in range(10):
            if is_mysql_up():
                try:
                    db.create_all()
                except Exception as e:
                    log.error("db.create_all() failed: %s", e, exc_info=True)

    dispatch_service.init(
        _db_cfg,
        tts_server_url=_svc_cfg.get("tts_server_url"),
        edge_node_port=_svc_cfg.get("edge_node_port", 5000),
    )
    with app.app_context():
        _run_migrations()
    heartbeat_service.start(
        _db_cfg,
        edge_port=_svc_cfg.get("edge_node_port", 5000),
        interval_sec=_svc_cfg.get("heartbeat_interval_sec", 20),
        offline_after_sec=_svc_cfg.get("heartbeat_offline_after_sec", 60),
    )
    scheduler_service.start(
        app, db, ScheduledAnnouncement,
        dispatch_service.dispatch_broadcast, dispatch_service.all_zone_codes,
        get_shifts_config=_get_shifts_config,
    )
    sop_service.start_timeout_checker(
        app, db, SopExecution, SopStepExecution,
        dispatch_service.dispatch_broadcast, dispatch_service.all_zone_codes,
        acknowledge_on_edge=dispatch_service.acknowledge_on_edge,
    )
    mqtt_service.start(
        _db_cfg,
        broker_host=_svc_cfg.get("mqtt_broker_host", "localhost"),
        broker_port=_svc_cfg.get("mqtt_broker_port", 1883),
    )

    # threaded=True is required for the flask-sock WebSocket routes
    # (/audio-alerts/dashboard/ws, /audio-alerts/paging/ws): each open WS
    # connection blocks its handling thread for the connection's whole
    # lifetime, and without threading the dev server can't hold that open
    # while still serving other requests — every other app.run() in this
    # codebase (edge_node.py, tts_server.py) already sets this.
    app.run("0.0.0.0", port=8000, threaded=True)