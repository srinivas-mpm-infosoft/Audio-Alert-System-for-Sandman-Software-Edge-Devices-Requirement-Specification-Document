"""
mqtt_service.py — MQTT-based node heartbeat/status ingestion.

Per the Phase 2 technology requirements (MQTT for node heartbeat/status/
control, HTTP for CRUD/config/file-transfer, WebSockets for real-time
dashboard/paging/SOP updates), this adds an event-driven COMPLEMENT to
heartbeat_service.py's proven 20s HTTP poll. heartbeat_service.py is left
running unchanged — this is additive, not a replacement, per "preserve
existing... do not replace working functionality." If a device publishes a
heartbeat over MQTT, the dashboard updates immediately instead of waiting
for the next HTTP poll tick; if it doesn't (or the broker is down), HTTP
polling keeps node status tracking working exactly as before.

Edge nodes publish a retained JSON status message to
`sandman/heartbeat/<zone_code>` (see edge-services/edge_node.py's
_mqtt_publish_loop); this subscribes to `sandman/heartbeat/+`, resolves the
zone_code to its Gateway-type device the same way alert_poller.py's
get_gateway_ip() does, and updates devices.status/last_seen/metadata plus
publishes a device_status event on the same events_bus dashboard WebSocket
channel heartbeat_service.py uses.

Requires `paho-mqtt` (pip install paho-mqtt) and a reachable broker (e.g.
mosquitto). Both are optional at runtime — if either is missing, start()
logs a warning and returns; nothing else in the system depends on this.
"""

import json
import logging
from datetime import datetime

import pymysql
import pymysql.cursors

import events_bus

log = logging.getLogger("configuration_ui")

try:
    import paho.mqtt.client as mqtt
    _MQTT_AVAILABLE = True
except ImportError:
    _MQTT_AVAILABLE = False

_DB_CFG = {}
_started = False
HEARTBEAT_TOPIC_FILTER = "sandman/heartbeat/+"


def _connect_db():
    try:
        return pymysql.connect(**_DB_CFG, cursorclass=pymysql.cursors.DictCursor)
    except Exception as e:
        log.error("[MQTT] DB connect failed: %s", e)
        return None


def _on_connect(client, userdata, flags, reason_code, properties=None):
    ok = (reason_code == 0) or (hasattr(reason_code, "is_failure") and not reason_code.is_failure)
    if ok:
        log.info("[MQTT] Connected to broker — subscribing to %s", HEARTBEAT_TOPIC_FILTER)
        client.subscribe(HEARTBEAT_TOPIC_FILTER, qos=0)
    else:
        log.warning("[MQTT] Connect failed: %s", reason_code)


def _on_message(client, userdata, msg):
    try:
        zone_id = msg.topic.rsplit("/", 1)[-1]
        payload = json.loads(msg.payload.decode("utf-8"))
    except Exception as e:
        log.warning("[MQTT] Bad payload on %s: %s", msg.topic, e)
        return

    conn = _connect_db()
    if not conn:
        return
    try:
        now = datetime.now()
        with conn.cursor() as c:
            # Same "Gateway device for this zone" resolution alert_poller.py's
            # get_gateway_ip() uses, so MQTT and HTTP update the same device row.
            c.execute(
                "SELECT d.id, d.metadata FROM devices d JOIN zones z ON d.zone_id = z.id "
                "WHERE z.zone_code=%s AND d.device_type='Gateway' ORDER BY d.id LIMIT 1",
                (zone_id,),
            )
            row = c.fetchone()
            if not row:
                log.warning("[MQTT] Heartbeat for unknown zone_code=%s — no matching device", zone_id)
                return
            meta = row.get("metadata")
            if isinstance(meta, str):
                try: meta = json.loads(meta)
                except Exception: meta = {}
            meta = meta or {}
            meta["health"] = payload
            meta["health_updated_at"] = now.isoformat()
            meta["health_source"] = "mqtt"
            c.execute(
                "UPDATE devices SET status='online', last_seen=%s, metadata=%s WHERE id=%s",
                (now, json.dumps(meta), row["id"]),
            )
        events_bus.publish({
            "type": "device_status", "device_id": row["id"], "status": "online",
            "status_changed": False, "health": payload, "source": "mqtt",
            "timestamp": now.isoformat(),
        })
    except Exception as e:
        log.error("[MQTT] Failed to process heartbeat for zone %s: %s", zone_id, e)
    finally:
        conn.close()


def start(db_cfg, broker_host="localhost", broker_port=1883):
    """Call once at app startup. Safe no-op if paho-mqtt isn't installed or
    the broker is unreachable — HTTP heartbeat_service.py is unaffected."""
    global _DB_CFG, _started
    if _started:
        return
    if not _MQTT_AVAILABLE:
        log.warning("[MQTT] paho-mqtt not installed (pip install paho-mqtt) — "
                   "MQTT heartbeat ingestion disabled; HTTP heartbeat_service.py "
                   "remains the primary/working node-status mechanism")
        return
    _DB_CFG = dict(
        host="localhost", port=db_cfg.get("port", 3306),
        user=db_cfg.get("user", "gateway"), password=db_cfg.get("password", "gateway"),
        database=db_cfg.get("name", "gateway"), charset="utf8mb4", autocommit=True,
    )
    _started = True
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="gateway-heartbeat-subscriber")
    except AttributeError:
        # paho-mqtt 1.x — no CallbackAPIVersion enum
        client = mqtt.Client(client_id="gateway-heartbeat-subscriber")
    client.on_connect = _on_connect
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    try:
        client.connect_async(broker_host, broker_port, keepalive=30)
        client.loop_start()
        log.info("[MQTT] Client started — broker %s:%s (async, retries in background)", broker_host, broker_port)
    except Exception as e:
        log.warning("[MQTT] Could not start client (broker unreachable?): %s", e)
