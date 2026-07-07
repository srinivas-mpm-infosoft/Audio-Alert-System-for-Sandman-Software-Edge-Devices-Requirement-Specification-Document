"""
heartbeat_service.py — background device health poller (D2).

Replaces the old "only refresh on demand" behaviour (the dashboard's
Refresh Status button) with a continuous background poll of every
configured device's /health endpoint (edge_node.py), keeping
devices.status / devices.last_seen current on its own, and caching the
latest health payload (cpu_temp, uptime, queue depth, currently playing)
into devices.metadata so the dashboard can render live node health
without a per-view round trip to the device.

Uses its own short-lived pymysql connections (not the Flask-SQLAlchemy
session) since this runs on a dedicated background thread.
"""

import json
import logging
import threading
import time
from datetime import datetime

import pymysql
import pymysql.cursors
import requests

import events_bus

log = logging.getLogger("configuration_ui")

_DB_CFG: dict = {}
_EDGE_PORT = 5000
_INTERVAL_SEC = 20
_OFFLINE_AFTER_SEC = 60
_HEALTH_TIMEOUT_SEC = 4
_started = False


def _connect():
    try:
        return pymysql.connect(**_DB_CFG, cursorclass=pymysql.cursors.DictCursor)
    except Exception as e:
        log.error("[Heartbeat] DB connect failed: %s", e)
        return None


def _poll_once():
    conn = _connect()
    if not conn:
        return
    try:
        with conn.cursor() as c:
            c.execute(
                "SELECT id, address, status, last_seen, metadata FROM devices "
                "WHERE address IS NOT NULL AND address <> ''"
            )
            devices = c.fetchall()

        now = datetime.now()
        for d in devices:
            ip = d["address"]
            reached = False
            prev_status = d.get("status")
            try:
                resp = requests.get(f"http://{ip}:{_EDGE_PORT}/health", timeout=_HEALTH_TIMEOUT_SEC)
                if resp.status_code == 200:
                    reached = True
                    payload = resp.json()
                    meta = d.get("metadata")
                    if isinstance(meta, str):
                        try: meta = json.loads(meta)
                        except Exception: meta = {}
                    meta = meta or {}
                    meta["health"] = payload
                    meta["health_updated_at"] = now.isoformat()
                    with conn.cursor() as c:
                        c.execute(
                            "UPDATE devices SET status='online', last_seen=%s, metadata=%s WHERE id=%s",
                            (now, json.dumps(meta), d["id"]),
                        )
                    events_bus.publish({
                        "type": "device_status", "device_id": d["id"], "address": ip,
                        "status": "online", "status_changed": prev_status != "online",
                        "health": payload, "timestamp": now.isoformat(),
                    })
            except Exception:
                pass

            if not reached:
                last_seen = d.get("last_seen")
                stale = True
                if last_seen:
                    try:
                        stale = (now - last_seen).total_seconds() > _OFFLINE_AFTER_SEC
                    except Exception:
                        stale = True
                if stale and d.get("status") != "offline":
                    with conn.cursor() as c:
                        c.execute("UPDATE devices SET status='offline' WHERE id=%s", (d["id"],))
                    events_bus.publish({
                        "type": "device_status", "device_id": d["id"], "address": ip,
                        "status": "offline", "status_changed": True,
                        "timestamp": now.isoformat(),
                    })
    except Exception as e:
        log.error("[Heartbeat] poll cycle failed: %s", e)
    finally:
        conn.close()


def _loop():
    log.info("[Heartbeat] Started — every %ss, offline after %ss", _INTERVAL_SEC, _OFFLINE_AFTER_SEC)
    while True:
        try:
            _poll_once()
        except Exception as e:
            log.error("[Heartbeat] loop error: %s", e)
        time.sleep(_INTERVAL_SEC)


def start(db_cfg: dict, edge_port: int = 5000, interval_sec: int = 20, offline_after_sec: int = 60):
    """Call once at app startup with the same db config flask_backend.py uses."""
    global _DB_CFG, _EDGE_PORT, _INTERVAL_SEC, _OFFLINE_AFTER_SEC, _started
    if _started:
        return
    _DB_CFG = dict(
        host="localhost", port=db_cfg.get("port", 3306),
        user=db_cfg.get("user", "gateway"), password=db_cfg.get("password", "gateway"),
        database=db_cfg.get("name", "gateway"), charset="utf8mb4", autocommit=True,
    )
    _EDGE_PORT = edge_port
    _INTERVAL_SEC = interval_sec
    _OFFLINE_AFTER_SEC = offline_after_sec
    _started = True
    threading.Thread(target=_loop, daemon=True, name="heartbeat").start()
