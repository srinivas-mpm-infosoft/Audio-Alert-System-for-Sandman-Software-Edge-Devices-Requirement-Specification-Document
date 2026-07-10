"""
dispatch_service.py — shared audio dispatch for manual broadcasts,
scheduled announcements, and (future) rule-fired alerts.

Reuses the exact pipeline edge-services/alert_poller.py already uses for
cloud-originated alerts:
  TTS text        -> POST tts_server /synthesise  (translate + TTS + deliver, synchronous)
  Pre-recorded clip -> read file bytes, POST directly to edge_node /play

Every dispatch writes a row into the same `alert_logs` table alert_poller.py
writes to, so manual broadcasts and scheduled announcements show up
side-by-side with cloud alerts in the existing Logs & Audit dashboard page —
no new logging UI needed.

Uses its own short-lived pymysql connections (not the Flask-SQLAlchemy
session) because dispatch fans out across a thread pool and SQLAlchemy
sessions are not safe to share across threads.
"""

import io
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Optional

import pymysql
import pymysql.cursors
import requests

import events_bus
import mqtt_transport

log = logging.getLogger("configuration_ui")

# ============================================================
# CONFIGURATION — set once at app startup via init()
# ============================================================

TTS_SERVER_URL = os.getenv("TTS_SERVER_URL", "http://localhost:6000")
EDGE_NODE_PORT = int(os.getenv("EDGE_NODE_PORT", "5000"))
SYNTH_TIMEOUT_SEC = 90
PLAY_TIMEOUT_SEC = 15

ALERT_LOGS_TABLE = "alert_logs"

# Synthetic alert_id ranges so manual/scheduled dispatches never collide with
# real cloud-alert ids (which start small, from the "alerts" cloud table).
BROADCAST_ID_BASE = 900_000_000
SCHEDULE_ID_BASE = 800_000_000

_DB_CFG: dict = {}
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="dispatch")

_LOGS_DDL = f"""
CREATE TABLE IF NOT EXISTS {ALERT_LOGS_TABLE} (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    alert_id          INT          NOT NULL,
    alert_timestamp   DATETIME     NOT NULL,
    alert_category    VARCHAR(32)  NOT NULL DEFAULT 'Normal',
    alert_source      VARCHAR(128) DEFAULT NULL,
    zone_code         VARCHAR(64)  DEFAULT NULL,
    lang_code         VARCHAR(8)   DEFAULT 'EN',
    device_ip         VARCHAR(64)  DEFAULT NULL,
    tts_duration_sec  FLOAT        DEFAULT NULL,
    edge_delivered    TINYINT(1)   DEFAULT 0,
    audio_played      TINYINT(1)   DEFAULT 0,
    ack_time          DATETIME     DEFAULT NULL,
    escalation_count  INT          DEFAULT 0,
    audio_mode        VARCHAR(16)  DEFAULT NULL,
    announcement_type VARCHAR(24)  DEFAULT NULL,
    created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_alert_id (alert_id),
    INDEX idx_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


def init(db_cfg: dict, tts_server_url: Optional[str] = None, edge_node_port: Optional[int] = None):
    """Call once at app startup with the same db config flask_backend.py uses."""
    global _DB_CFG, TTS_SERVER_URL, EDGE_NODE_PORT
    _DB_CFG = dict(
        host="localhost",
        port=db_cfg.get("port", 3306),
        user=db_cfg.get("user", "python"),
        password=db_cfg.get("password", "python"),
        database=db_cfg.get("name", "gateway"),
        charset="utf8mb4",
        autocommit=True,
    )
    if tts_server_url:
        TTS_SERVER_URL = tts_server_url
    if edge_node_port:
        EDGE_NODE_PORT = edge_node_port
    conn = _connect()
    if conn:
        try:
            with conn.cursor() as c:
                c.execute(_LOGS_DDL)
            log.info("[Dispatch] alert_logs table ready")
        finally:
            conn.close()
    else:
        log.error("[Dispatch] Could not connect to DB during init — alert_logs not verified")


def _connect():
    try:
        return pymysql.connect(**_DB_CFG, cursorclass=pymysql.cursors.DictCursor)
    except Exception as e:
        log.error("[Dispatch] DB connect failed: %s", e)
        return None


# ============================================================
# Zone / device resolution
# ============================================================

def _device_transport(row: Optional[dict]) -> dict:
    """Extract protocol + MQTT broker config from a devices.metadata JSON
    blob. Defaults to 'http' — every device that predates per-device
    protocol selection keeps working over HTTP unchanged."""
    if not row:
        return {"protocol": "http"}
    meta = row.get("metadata")
    if isinstance(meta, str):
        try: meta = json.loads(meta)
        except Exception: meta = {}
    meta = meta or {}
    return {
        "protocol":         meta.get("protocol") or "http",
        "mqtt_broker_host": meta.get("mqtt_broker_host"),
        "mqtt_broker_port": meta.get("mqtt_broker_port"),
        "mqtt_username":    meta.get("mqtt_username"),
        "mqtt_password":    meta.get("mqtt_password"),
        "mqtt_client_id":   meta.get("mqtt_client_id"),
    }


def resolve_targets(zone_codes: list) -> list:
    """
    zone_codes -> [{zone_code, zone_name, device_ip, default_language,
    protocol, mqtt_broker_host, ...}, ...] for zones that have a device
    configured. Mirrors alert_poller.get_gateway_ip's 'Edge Node/Gateway
    device_type first, else any dotted-IP address' fallback. default_language
    lets callers leave language unspecified and have each zone play in its
    own configured language (see _dispatch_one). device_ip is only present
    for HTTP-protocol devices — MQTT devices are addressed by zone_code/topic
    instead, so device_ip stays None for them (never a stale/wrong IP).
    """
    if not zone_codes:
        return []
    conn = _connect()
    if not conn:
        return []
    out = []
    try:
        with conn.cursor() as c:
            fmt = ",".join(["%s"] * len(zone_codes))
            c.execute(f"SELECT id, zone_code, name, default_language FROM zones WHERE zone_code IN ({fmt})", zone_codes)
            zones = c.fetchall()
            for z in zones:
                c.execute(
                    "SELECT address, metadata FROM devices WHERE zone_id=%s AND device_type IN ('Edge Node','Gateway') "
                    "ORDER BY id LIMIT 1", (z["id"],),
                )
                row = c.fetchone()
                if not row:
                    c.execute(
                        "SELECT address, metadata FROM devices WHERE zone_id=%s "
                        "AND address REGEXP '^[0-9]+\\\\.[0-9]+\\\\.[0-9]+\\\\.[0-9]+' "
                        "ORDER BY id LIMIT 1", (z["id"],),
                    )
                    row = c.fetchone()
                transport = _device_transport(row)
                out.append({
                    "zone_code": z["zone_code"],
                    "zone_name": z["name"],
                    "device_ip": (row["address"] if row else None) if transport["protocol"] == "http" else None,
                    "default_language": z.get("default_language") or "EN",
                    **transport,
                })
    except Exception as e:
        log.error("[Dispatch] resolve_targets failed: %s", e)
    finally:
        conn.close()
    return out


_DEFAULT_ALERT_TYPE_BEHAVIOR = {
    "is_blocking": False, "initial_play_count": 1, "repeat_interval_sec": 60.0,
    "reduction_step_sec": 0.0, "min_interval_sec": 60.0, "requires_ack": False,
    "sort_order": 100,
}


def resolve_alert_type(type_code: str) -> dict:
    """
    Look up the configured playback behavior (play count / repeat interval /
    reduction step / requires_ack / is_blocking) for a type_code from
    alert_type_configs. Falls back to a safe "play once, no ack needed"
    default if the type isn't configured — never silently falls back to
    "repeat forever" with no way to stop it.
    """
    slug = (type_code or "normal").strip().lower().replace(" ", "_")
    conn = _connect()
    if not conn:
        return dict(_DEFAULT_ALERT_TYPE_BEHAVIOR)
    try:
        with conn.cursor() as c:
            c.execute("SELECT * FROM alert_type_configs WHERE type_code=%s LIMIT 1", (slug,))
            row = c.fetchone()
        if not row:
            return dict(_DEFAULT_ALERT_TYPE_BEHAVIOR)
        return {
            "is_blocking":         bool(row["is_blocking"]),
            "initial_play_count":  row["initial_play_count"],
            "repeat_interval_sec": float(row["repeat_interval_sec"] or 0),
            "reduction_step_sec":  float(row["reduction_step_sec"] or 0),
            "min_interval_sec":    float(row["min_interval_sec"] or 0),
            "requires_ack":        bool(row["requires_ack"]),
            "sort_order":          row["sort_order"],
        }
    except Exception as e:
        log.error("[Dispatch] resolve_alert_type(%s) failed: %s", type_code, e)
        return dict(_DEFAULT_ALERT_TYPE_BEHAVIOR)
    finally:
        conn.close()


def resolve_target(zone_code: str) -> Optional[dict]:
    """Single-zone convenience wrapper around resolve_targets().
    Returns {zone_code, zone_name, device_ip} or None if the zone doesn't
    exist / has no device configured. Used by callers (e.g. Test Fire) that
    only have a zone_code and need the device_ip looked up from the DB."""
    if not zone_code:
        return None
    targets = resolve_targets([zone_code])
    return targets[0] if targets else None


def all_zone_codes() -> list:
    """Every zone in the system — used for one-click plant-wide broadcasts."""
    conn = _connect()
    if not conn:
        return []
    try:
        with conn.cursor() as c:
            c.execute("SELECT zone_code FROM zones ORDER BY name")
            return [r["zone_code"] for r in c.fetchall()]
    except Exception as e:
        log.error("[Dispatch] all_zone_codes failed: %s", e)
        return []
    finally:
        conn.close()


# ============================================================
# alert_logs writer
# ============================================================

def _insert_log(row: dict):
    conn = _connect()
    if not conn:
        return
    try:
        cols = ["alert_id", "alert_timestamp", "alert_category", "alert_source",
                "zone_code", "lang_code", "device_ip", "tts_duration_sec",
                "edge_delivered", "audio_played", "audio_mode", "announcement_type"]
        data = {c: row.get(c) for c in cols}
        ph = ",".join(["%s"] * len(data))
        cn = ",".join(data.keys())
        with conn.cursor() as c:
            c.execute(f"INSERT INTO {ALERT_LOGS_TABLE} ({cn}) VALUES ({ph})", list(data.values()))
    except Exception as e:
        log.error("[Dispatch] alert_logs insert failed: %s", e)
    finally:
        conn.close()


# ============================================================
# Delivery — TTS text (via tts_server) or pre-recorded clip (direct to edge)
# ============================================================

# NOTE: conceptually mirrors edge-services/alert_poller.py's call_synthesise() — not shared code, keep in sync manually if either changes.
def call_synthesise(text: str, lang_code: str, alert_id: int, zone_code: str,
                    alert_category: str, device_ip: str, alert_source: str = "",
                    behavior: Optional[dict] = None, mqtt_cfg: Optional[dict] = None) -> dict:
    """POST to tts_server /synthesise. Synchronous — translate+TTS+deliver.

    tts_server.py does the actual edge delivery (HTTP POST or MQTT publish),
    so for an MQTT-configured target its broker config rides along in this
    same JSON payload (mqtt_cfg's protocol/mqtt_* keys) — tts_server.py's own
    deliver_to_edge() reads them back out and branches transport there.
    """
    url = f"{TTS_SERVER_URL.rstrip('/')}/synthesise"
    payload = {
        "text": text, "lang_code": lang_code, "alert_id": alert_id,
        "zone_code": zone_code, "alert_category": alert_category,
        "device_ip": device_ip, "alert_source": alert_source,
        **(behavior or {}), **(mqtt_cfg or {}),
    }
    t0 = time.monotonic()
    try:
        resp = requests.post(url, json=payload, timeout=SYNTH_TIMEOUT_SEC)
        if resp.status_code != 200:
            log.error("[Dispatch] /synthesise HTTP %s: %s", resp.status_code, resp.text[:150])
            return {"ok": False, "tts_duration": time.monotonic() - t0,
                    "edge_delivered": False, "audio_queued": False,
                    "error": f"HTTP {resp.status_code}"}
        return {
            "ok": True,
            "tts_duration": float(resp.headers.get("X-TTS-Duration", time.monotonic() - t0)),
            "edge_delivered": resp.headers.get("X-Edge-Delivered", "false").lower() == "true",
            "audio_queued": resp.headers.get("X-Audio-Queued", "false").lower() == "true",
        }
    except Exception as exc:
        log.error("[Dispatch] /synthesise error: %s", exc)
        return {"ok": False, "tts_duration": time.monotonic() - t0,
                "edge_delivered": False, "audio_queued": False, "error": str(exc)}


def deliver_clip(file_path: str, device_ip: str, alert_id: int,
                 alert_category: str, lang_code: str, behavior: Optional[dict] = None,
                 zone_code: Optional[str] = None, mqtt_cfg: Optional[dict] = None) -> dict:
    """Deliver a pre-recorded clip file to the edge node — no TTS needed.
    HTTP (default): POST the file directly to edge_node /play.
    MQTT (mqtt_cfg["protocol"] == "mqtt"): publish over the target's
    configured broker instead, addressed by zone_code rather than device_ip."""
    p = Path(file_path)
    if not p.exists():
        return {"ok": False, "edge_delivered": False, "audio_queued": False,
                "error": f"Clip file not found: {file_path}"}
    if mqtt_cfg and mqtt_cfg.get("protocol") == "mqtt":
        mp3 = p.read_bytes()
        return mqtt_transport.publish_play(mqtt_cfg, zone_code, alert_id, alert_category,
                                           lang_code, "", mp3, behavior=behavior)
    url = f"http://{device_ip}:{EDGE_NODE_PORT}/play"
    form = {"alert_id": str(alert_id), "alert_category": alert_category, "lang_code": lang_code}
    for k, v in (behavior or {}).items():
        form[k] = "" if v is None else str(v)
    try:
        with open(p, "rb") as f:
            resp = requests.post(
                url,
                files={"audio": (p.name, f, "audio/mpeg")},
                data=form,
                timeout=PLAY_TIMEOUT_SEC,
            )
        ok = resp.status_code == 200
        data = {}
        try: data = resp.json()
        except Exception: pass
        return {"ok": ok, "edge_delivered": ok, "audio_queued": data.get("queued", ok),
                "error": "" if ok else f"HTTP {resp.status_code}"}
    except Exception as exc:
        log.error("[Dispatch] clip delivery failed: %s", exc)
        return {"ok": False, "edge_delivered": False, "audio_queued": False, "error": str(exc)}


def acknowledge_on_edge(device_ip: str, alert_id: int, zone_code: Optional[str] = None) -> bool:
    """Tell an edge node to stop/clear a queued item (e.g. dashboard ack of a
    broadcast). device_ip is blank for an MQTT-configured device — pass
    zone_code so its MQTT config can be resolved and the ack published there."""
    if not device_ip:
        if not zone_code:
            return False
        target = resolve_target(zone_code)
        if not target or target.get("protocol") != "mqtt":
            return False
        return mqtt_transport.publish_acknowledge(target, zone_code, alert_id)
    try:
        resp = requests.post(f"http://{device_ip}:{EDGE_NODE_PORT}/acknowledge",
                             json={"alert_id": alert_id}, timeout=8)
        return resp.status_code == 200
    except Exception as exc:
        log.error("[Dispatch] acknowledge_on_edge failed: %s", exc)
        return False


def warm_cache(text: str, language: str, alert_source: str = "Cache Warm") -> dict:
    """
    Pre-generate and cache TTS audio without delivering it anywhere.

    tts_server.synthesise() runs translate+TTS+cache_put BEFORE it checks
    device_ip, so a call with device_ip="" still warms the on-disk cache —
    the D3 requirement to generate/cache dynamic-text schedule audio at
    creation/update time rather than waiting for the first execution.
    Does not touch alert_logs — this isn't a real dispatch, just a cache fill.
    """
    if not text:
        return {"ok": False, "error": "no text to warm"}
    warm_id = SCHEDULE_ID_BASE + int(time.time() * 1000) % 90_000_000
    return call_synthesise(text, language, warm_id, "", "Normal", "", alert_source=alert_source)


def warm_cache_async(text: str, language: str, alert_source: str = "Cache Warm"):
    """Fire-and-forget version — translate+TTS can take several seconds, and a
    schedule Save shouldn't block the HTTP response waiting for it."""
    if not text:
        return
    _pool.submit(warm_cache, text, language, alert_source)


def send_test_tone(zone_code: str) -> dict:
    """
    Deliver a short spoken test phrase to one zone (used by 'Test Fire').

    Takes a zone_code — NOT a raw device_ip — and resolves the target
    device from the DB itself via resolve_target(). This mirrors the
    tts_server.py zone_id fix: the caller should never be responsible for
    already knowing the device's IP, since a stale/blank IP silently
    produces a broken "http://:5000/play" URL downstream.
    """
    target = resolve_target(zone_code)
    is_mqtt = target and target.get("protocol") == "mqtt"
    if not target or not (target.get("device_ip") or (is_mqtt and target.get("mqtt_broker_host"))):
        log.error("[Dispatch] send_test_tone: no device configured for zone_code=%s", zone_code)
        return {"ok": False, "edge_delivered": False, "audio_queued": False,
                "error": f"No device configured for zone '{zone_code}'"}

    test_id = BROADCAST_ID_BASE + int(time.time() * 1000) % 90_000_000
    return call_synthesise(
        "This is a test announcement from the audio alert system.",
        "EN", test_id, zone_code, "Low", target.get("device_ip"), alert_source="Test Fire",
        mqtt_cfg=target if is_mqtt else None,
    )


# ============================================================
# High-level entry points
# ============================================================

def _dispatch_one(target: dict, *, text, clip_path, language, alert_category,
                  alert_source, alert_id: int, announcement_type: str = "broadcast",
                  type_code: Optional[str] = None, play_count_override: Optional[int] = None,
                  requires_ack_override: Optional[bool] = None) -> dict:
    zone_code = target["zone_code"]
    device_ip = target.get("device_ip")
    audio_mode = "clip" if clip_path else "tts"
    # Language left unspecified -> each zone plays in its own configured
    # default language rather than one language forced across every zone.
    lang = language or target.get("default_language") or "EN"
    behavior = resolve_alert_type(type_code or alert_category)
    # Per-dispatch overrides (from the Manual/SOP/Schedule form) win over the
    # alert type's own defaults, without changing the shared type config.
    if play_count_override is not None:
        behavior["initial_play_count"] = play_count_override
    if requires_ack_override is not None:
        behavior["requires_ack"] = requires_ack_override
    is_mqtt = target.get("protocol") == "mqtt"
    mqtt_cfg = target if is_mqtt else None
    receipt = {"zone_code": zone_code, "zone_name": target.get("zone_name"),
              "device_ip": device_ip, "alert_id": alert_id}

    if not device_ip and not (is_mqtt and target.get("mqtt_broker_host")):
        receipt.update(ok=False, edge_delivered=False, error="No device configured for zone")
    elif clip_path:
        r = deliver_clip(clip_path, device_ip, alert_id, alert_category, lang, behavior=behavior,
                         zone_code=zone_code, mqtt_cfg=mqtt_cfg)
        receipt.update(r)
    else:
        r = call_synthesise(text, lang, alert_id, zone_code, alert_category,
                            device_ip, alert_source, behavior=behavior, mqtt_cfg=mqtt_cfg)
        receipt.update(r)

    _insert_log({
        "alert_id": alert_id,
        "alert_timestamp": datetime.now(),
        "alert_category": alert_category,
        "alert_source": alert_source,
        "zone_code": zone_code,
        "lang_code": lang,
        "device_ip": device_ip,
        "tts_duration_sec": round(receipt.get("tts_duration", 0.0), 3) if receipt.get("tts_duration") else None,
        "edge_delivered": 1 if receipt.get("edge_delivered") else 0,
        "audio_played": 0,
        "audio_mode": audio_mode,
        "announcement_type": announcement_type,
    })
    events_bus.publish({
        "type": "announcement",
        "announcement_type": announcement_type,
        "zone_code": zone_code,
        "zone_name": target.get("zone_name"),
        "audio_mode": audio_mode,
        "language": lang,
        "alert_source": alert_source,
        "edge_delivered": bool(receipt.get("edge_delivered")),
        "timestamp": datetime.now().isoformat(),
    })
    return receipt


def dispatch_broadcast(zone_codes: list, *, message: str = None, clip_path: str = None,
                       language: Optional[str] = None, alert_category: str = "Normal",
                       alert_source: str = "Manual Broadcast",
                       id_base: int = BROADCAST_ID_BASE,
                       announcement_type: str = "broadcast",
                       type_code: Optional[str] = None,
                       play_count_override: Optional[int] = None,
                       requires_ack_override: Optional[bool] = None) -> list:
    """
    Fan out one message/clip to every zone in zone_codes in parallel.
    Returns a list of per-zone receipt dicts (see _dispatch_one).

    language=None plays each zone in its own configured default language
    (see resolve_targets/_dispatch_one). type_code selects the configured
    alert-type behavior (play count/interval/reduction/ack) — defaults to
    alert_category (lowercased) for backward compatibility.
    play_count_override/requires_ack_override let one specific dispatch
    (a Manual broadcast, a SOP step, a Schedule) override just those two
    fields without changing the shared alert-type config.
    """
    targets = resolve_targets(zone_codes)
    if not targets:
        return []
    base = id_base + int(time.time() * 1000) % 90_000_000
    futures = []
    for i, t in enumerate(targets):
        futures.append(_pool.submit(
            _dispatch_one, t,
            text=message, clip_path=clip_path, language=language,
            alert_category=alert_category, alert_source=alert_source,
            announcement_type=announcement_type, type_code=type_code,
            play_count_override=play_count_override, requires_ack_override=requires_ack_override,
            alert_id=base + i,
        ))
    return [f.result() for f in futures]