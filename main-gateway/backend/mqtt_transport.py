"""
mqtt_transport.py — MQTT publish-side transport for Central Gateway alert
delivery, used when a target Device is configured with protocol="mqtt"
instead of the default HTTP push (dispatch_service.deliver_clip /
call_synthesise's HTTP path).

Wire format mirrors edge-node/mqtt_audio_protocol.py exactly (topics +
length-prefixed JSON header + raw mp3 bytes) — duplicated here rather than
imported, matching this codebase's existing gateway/edge-node duplication
convention (dispatch_service.py's own docstring already documents "not
shared code, keep in sync manually"). The two tiers are deployed on
different machines and don't share a Python path, so a real import isn't
an option anyway.

One MQTT client per unique broker config (host, port, username) is opened
and cached — connect-once, publish-many. A one-shot connect/publish/
disconnect isn't enough here because delivery is synchronous request/reply
(mirrors the HTTP path's "wait for the edge node's response"): the gateway
publishes to `.../play` and blocks briefly on the edge node's `.../play/ack`
reply, so the client needs to already be connected and subscribed.
"""
import json
import logging
import struct
import threading
import uuid

log = logging.getLogger("configuration_ui")

try:
    import paho.mqtt.client as mqtt
    _MQTT_AVAILABLE = True
except ImportError:
    _MQTT_AVAILABLE = False

REPLY_TIMEOUT_SEC = 10

_clients: dict = {}       # (host, port, username) -> connected paho client
_clients_lock = threading.Lock()
_pending: dict = {}       # request_id -> {"event": threading.Event, "result": dict|None}
_pending_lock = threading.Lock()


def _play_topic(zone_code):     return f"sandman/audio/{zone_code}/play"
def _ack_topic(zone_code):      return f"sandman/audio/{zone_code}/acknowledge"


def _pack_play(header: dict, mp3: bytes) -> bytes:
    header_bytes = json.dumps(header).encode("utf-8")
    return struct.pack(">I", len(header_bytes)) + header_bytes + mp3


def _on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode("utf-8"))
    except Exception as e:
        log.warning("[MQTT] Bad reply on %s: %s", msg.topic, e)
        return
    with _pending_lock:
        waiter = _pending.get(data.get("request_id"))
    if waiter is not None:
        waiter["result"] = data
        waiter["event"].set()


def _get_client(cfg: dict):
    host, port = cfg.get("mqtt_broker_host"), int(cfg.get("mqtt_broker_port") or 1883)
    username = cfg.get("mqtt_username")
    key = (host, port, username)
    with _clients_lock:
        client = _clients.get(key)
        if client is not None:
            return client
        client_id = cfg.get("mqtt_client_id") or f"gateway-{uuid.uuid4().hex[:8]}"
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        except AttributeError:
            client = mqtt.Client(client_id=client_id)
        if username:
            client.username_pw_set(username, cfg.get("mqtt_password") or "")
        client.on_message = _on_message
        client.connect(host, port, keepalive=30)
        client.subscribe("sandman/audio/+/play/ack", qos=1)
        client.subscribe("sandman/audio/+/acknowledge/ack", qos=1)
        client.loop_start()
        log.info("[MQTT] Gateway connected to broker %s:%s", host, port)
        _clients[key] = client
        return client


def _request_reply(cfg, topic, payload, request_id):
    event = threading.Event()
    waiter = {"event": event, "result": None}
    with _pending_lock:
        _pending[request_id] = waiter
    try:
        _get_client(cfg).publish(topic, payload, qos=1)
        if not event.wait(timeout=REPLY_TIMEOUT_SEC):
            return None
        return waiter["result"]
    finally:
        with _pending_lock:
            _pending.pop(request_id, None)


def publish_play(cfg: dict, zone_code: str, alert_id: int, alert_category: str,
                 lang_code: str, text: str, mp3: bytes, behavior: dict = None) -> dict:
    """Same receipt shape as dispatch_service.deliver_clip/call_synthesise."""
    if not _MQTT_AVAILABLE:
        return {"ok": False, "edge_delivered": False, "audio_queued": False,
                "error": "paho-mqtt not installed on the gateway"}
    if not zone_code or not cfg.get("mqtt_broker_host"):
        return {"ok": False, "edge_delivered": False, "audio_queued": False,
                "error": "MQTT broker host / zone_code required"}
    request_id = uuid.uuid4().hex
    header = {"request_id": request_id, "alert_id": alert_id, "alert_category": alert_category,
              "lang_code": lang_code, "text": text, **(behavior or {})}
    try:
        reply = _request_reply(cfg, _play_topic(zone_code), _pack_play(header, mp3), request_id)
    except Exception as exc:
        log.error("[MQTT] publish_play failed for alert=%s: %s", alert_id, exc)
        return {"ok": False, "edge_delivered": False, "audio_queued": False, "error": str(exc)}
    if reply is None:
        log.warning("[MQTT] No ack for alert=%s within %ss", alert_id, REPLY_TIMEOUT_SEC)
        return {"ok": False, "edge_delivered": False, "audio_queued": False,
                "error": "No ack from edge node (timeout)"}
    return {"ok": True, "edge_delivered": True, "audio_queued": reply.get("queued", True), "error": ""}


def publish_acknowledge(cfg: dict, zone_code: str, alert_id: int) -> bool:
    if not _MQTT_AVAILABLE or not zone_code or not cfg.get("mqtt_broker_host"):
        return False
    request_id = uuid.uuid4().hex
    payload = json.dumps({"request_id": request_id, "alert_id": alert_id})
    try:
        reply = _request_reply(cfg, _ack_topic(zone_code), payload, request_id)
    except Exception as exc:
        log.error("[MQTT] publish_acknowledge failed for alert=%s: %s", alert_id, exc)
        return False
    return bool(reply and reply.get("acknowledged"))


def _demo():
    """Smoke test — wire format + graceful-degradation, no real broker needed."""
    header = {"request_id": "abc", "alert_id": 1, "alert_category": "High", "lang_code": "EN", "text": "hi"}
    packed = _pack_play(header, b"MP3BYTES")
    (hlen,) = struct.unpack(">I", packed[:4])
    assert json.loads(packed[4:4 + hlen].decode("utf-8")) == header
    assert packed[4 + hlen:] == b"MP3BYTES"
    assert _play_topic("z002") == "sandman/audio/z002/play"
    assert _ack_topic("z002") == "sandman/audio/z002/acknowledge"
    r = publish_play({}, "", 1, "High", "EN", "hi", b"x")
    assert r["ok"] is False and "error" in r
    assert publish_acknowledge({}, "", 1) is False
    print("mqtt_transport self-check OK")


if __name__ == "__main__":
    _demo()
