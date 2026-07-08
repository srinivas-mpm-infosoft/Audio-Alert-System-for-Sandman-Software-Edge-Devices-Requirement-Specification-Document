"""
tts_server_mqtt.py — MQTT delivery variant of tts_server.py.

Everything else — translate, cache, Voicemaker TTS, the /synthesise Flask
route, /health, /langs, /cache/* — is IDENTICAL to tts_server.py and is
imported straight from it (no duplicated logic to drift out of sync). The
ONLY thing this file changes is HOW the synthesised audio reaches the edge
node: instead of an HTTP POST to <device_ip>:5000/play, it publishes over
MQTT to sandman/audio/<zone_code>/play and waits for edge_node_mqtt.py's
ack reply on sandman/audio/<zone_code>/play/ack (see mqtt_audio_protocol.py
for the exact wire format).

Run this INSTEAD OF tts_server.py when your deployment connects the CM5
gateway to edge nodes over an MQTT broker rather than direct LAN HTTP.
alert_poller.py needs no changes either way — it already sends both
device_ip and zone_code to /synthesise and /note-acknowledge.

Requires: paho-mqtt (already in edge-node/requirements.txt) and a reachable
MQTT broker, e.g. Mosquitto — same MQTT_BROKER_HOST/MQTT_BROKER_PORT env
vars edge_node.py already uses for its heartbeat publisher.
"""
import json
import os
import threading
import uuid
from threading import Lock

import tts_server as base
from mqtt_audio_protocol import ack_topic, pack_play, play_topic

log = base.log

MQTT_BROKER_HOST       = os.environ.get('MQTT_BROKER_HOST', 'localhost')
MQTT_BROKER_PORT       = int(os.environ.get('MQTT_BROKER_PORT', '1883'))
MQTT_REPLY_TIMEOUT_SEC = 10   # mirrors tts_server.EDGE_TIMEOUT_SEC's role for the HTTP version

_pending: dict = {}   # request_id -> {"event": threading.Event, "result": dict|None}
_pending_lock  = Lock()
_mqtt_client   = [None]
_client_lock   = Lock()


def _on_reply(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode('utf-8'))
    except Exception as e:
        log.warning(f"[MQTT] Bad reply on {msg.topic}: {e}")
        return
    with _pending_lock:
        waiter = _pending.get(data.get('request_id'))
    if waiter is not None:
        waiter['result'] = data
        waiter['event'].set()


def _get_client():
    with _client_lock:
        if _mqtt_client[0] is not None:
            return _mqtt_client[0]
        import paho.mqtt.client as mqtt
        client_id = f"tts-server-{uuid.uuid4().hex[:8]}"
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        except AttributeError:
            client = mqtt.Client(client_id=client_id)
        client.on_message = _on_reply
        client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
        client.subscribe('sandman/audio/+/play/ack', qos=1)
        client.subscribe('sandman/audio/+/acknowledge/ack', qos=1)
        client.loop_start()
        log.info(f"[MQTT] Connected to {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}")
        _mqtt_client[0] = client
        return client


def _request_reply(topic: str, payload, request_id: str):
    """Publish `payload` to `topic`, block until a reply carrying the same
    request_id arrives (or timeout). Returns the reply dict, or None."""
    event  = threading.Event()
    waiter = {'event': event, 'result': None}
    with _pending_lock:
        _pending[request_id] = waiter
    try:
        _get_client().publish(topic, payload, qos=1)
        if not event.wait(timeout=MQTT_REPLY_TIMEOUT_SEC):
            return None
        return waiter['result']
    finally:
        with _pending_lock:
            _pending.pop(request_id, None)


def deliver_to_edge_mqtt(mp3: bytes, zone_code: str, alert_id: int,
                         alert_category: str, lang_code: str) -> dict:
    """Same receipt shape as tts_server.deliver_to_edge, addressed by
    zone_code (MQTT topic) instead of device_ip (HTTP URL)."""
    if not zone_code:
        return {'edge_delivered': False, 'audio_queued': False, 'critical_active': False,
                'error': 'zone_code required for MQTT delivery'}
    request_id = uuid.uuid4().hex
    header = {'request_id': request_id, 'alert_id': alert_id,
              'alert_category': alert_category, 'lang_code': lang_code}
    log.info(f"[MQTT] Publish play alert={alert_id} → {play_topic(zone_code)} ({len(mp3)//1024}KB)")
    reply = _request_reply(play_topic(zone_code), pack_play(header, mp3), request_id)
    if reply is None:
        log.warning(f"[MQTT] No ack for alert={alert_id} within {MQTT_REPLY_TIMEOUT_SEC}s")
        return {'edge_delivered': False, 'audio_queued': False, 'critical_active': False,
                'error': 'No ack from edge node (timeout)'}
    return {
        'edge_delivered':  True,
        'audio_queued':    reply.get('queued', True),
        'critical_active': reply.get('critical_active', False),
        'error':           '',
    }


def acknowledge_on_edge_mqtt(zone_code: str, alert_id: int) -> bool:
    if not zone_code:
        return False
    request_id = uuid.uuid4().hex
    payload = json.dumps({'request_id': request_id, 'alert_id': alert_id})
    reply = _request_reply(ack_topic(zone_code), payload, request_id)
    return bool(reply and reply.get('acknowledged'))


# ── Redirect tts_server.py's delivery calls to the MQTT versions above. ──
# synthesise() and /note-acknowledge call deliver_to_edge()/acknowledge_on_edge()
# by module-level name (Python's normal late-binding global lookup), so
# reassigning those names on the `base` module redirects both call sites —
# nothing else in tts_server.py needs to change.
base.deliver_to_edge = lambda mp3, device_ip, alert_id, alert_category, lang_code, zone_code='': \
    deliver_to_edge_mqtt(mp3, zone_code, alert_id, alert_category, lang_code)
base.acknowledge_on_edge = lambda device_ip, alert_id, zone_code='': \
    acknowledge_on_edge_mqtt(zone_code, alert_id)

app = base.app

if __name__ == '__main__':
    if not base.GEMINI_API_KEY:      raise SystemExit("GEMINI_API_KEY not set")
    if not base.VOICEMAKER_API_KEY:  raise SystemExit("VOICEMAKER_API_KEY not set")
    base.get_gemini()
    _get_client()  # connect eagerly so a broken broker is obvious at startup, not on first alert
    log.info("="*60)
    log.info(f"  TTS SERVER — MQTT delivery variant")
    log.info(f"  MQTT broker : {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}")
    log.info(f"  Listening   : http://{base.SERVER_HOST}:{base.SERVER_PORT}  (POST /synthesise is still HTTP — only edge delivery is MQTT)")
    log.info("="*60)
    app.run(host=base.SERVER_HOST, port=base.SERVER_PORT, threaded=True)
