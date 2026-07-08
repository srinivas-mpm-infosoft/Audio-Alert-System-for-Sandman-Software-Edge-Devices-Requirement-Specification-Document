"""
edge_node_mqtt.py — MQTT delivery variant of edge_node.py.

Everything else — the priority playback queue/worker, /health, /queue,
/restart, /increase-frequency, the local dashboard, live voice paging — is
IDENTICAL to edge_node.py and is imported straight from it (no duplicated
logic to drift out of sync). The HTTP /play and /acknowledge routes also
stay active, so dispatch_service.py's direct clip delivery (manual/SOP/
scheduled broadcasts on the Main Gateway) keeps working unchanged either way.

What this file ADDS: an MQTT subscriber that listens on
sandman/audio/<MQTT_ZONE_ID>/play and .../acknowledge (see
mqtt_audio_protocol.py for the wire format) and feeds the exact same
_enqueue_play()/_do_acknowledge() functions edge_node.py's own HTTP routes
use — one queue, reachable by either transport.

Run this INSTEAD OF edge_node.py when your deployment connects this node to
tts_server_mqtt.py over an MQTT broker rather than direct LAN HTTP.
Requires MQTT_ZONE_ID to be set (same env var edge_node.py's heartbeat
publisher already needs) — this node has no zone identity without it.
"""
import json
import os

import edge_node as base
from mqtt_audio_protocol import ack_ack_topic, ack_topic, play_ack_topic, play_topic, unpack_play

log             = base.log
MQTT_ZONE_ID    = base.MQTT_ZONE_ID
MQTT_BROKER_HOST = base.MQTT_BROKER_HOST
MQTT_BROKER_PORT = base.MQTT_BROKER_PORT


def _on_message(client, userdata, msg):
    try:
        if msg.topic == play_topic(MQTT_ZONE_ID):
            header, mp3_bytes = unpack_play(msg.payload)
            result = base._enqueue_play(
                int(header.get('alert_id', 0)), header.get('alert_category', 'Normal'),
                header.get('lang_code', 'EN'), mp3_bytes,
            )
            reply = {'request_id': header.get('request_id'), 'alert_id': header.get('alert_id'),
                     'queued': result.get('queued', False), 'critical_active': result.get('critical_active', False)}
            client.publish(play_ack_topic(MQTT_ZONE_ID), json.dumps(reply), qos=1)

        elif msg.topic == ack_topic(MQTT_ZONE_ID):
            body = json.loads(msg.payload.decode('utf-8'))
            result = base._do_acknowledge(int(body.get('alert_id', 0)))
            reply = {'request_id': body.get('request_id'), 'acknowledged': result['acknowledged']}
            client.publish(ack_ack_topic(MQTT_ZONE_ID), json.dumps(reply), qos=1)
    except Exception as e:
        log.error(f"[MQTT-Audio] Failed handling {msg.topic}: {e}")


def _mqtt_audio_subscriber():
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        log.warning("[MQTT-Audio] paho-mqtt not installed — MQTT play/acknowledge disabled "
                   "(HTTP /play and /acknowledge still work)")
        return
    if not MQTT_ZONE_ID:
        log.warning("[MQTT-Audio] MQTT_ZONE_ID not set — MQTT play/acknowledge disabled")
        return

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'edge-audio-{MQTT_ZONE_ID}')
    except AttributeError:
        client = mqtt.Client(client_id=f'edge-audio-{MQTT_ZONE_ID}')
    client.on_message = _on_message
    try:
        client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
    except Exception as e:
        log.warning(f"[MQTT-Audio] Could not connect to broker: {e}")
        return

    client.subscribe(play_topic(MQTT_ZONE_ID), qos=1)
    client.subscribe(ack_topic(MQTT_ZONE_ID), qos=1)
    log.info(f"[MQTT-Audio] Subscribed: {play_topic(MQTT_ZONE_ID)}  {ack_topic(MQTT_ZONE_ID)}")
    client.loop_forever()


app = base.app

if __name__ == '__main__':
    import threading
    threading.Thread(target=_mqtt_audio_subscriber, daemon=True, name='mqtt-audio').start()
    log.info("="*55)
    log.info("  EDGE NODE — MQTT delivery variant")
    log.info(f"  Zone        : {MQTT_ZONE_ID or '(not configured — MQTT play disabled)'}")
    log.info(f"  MQTT broker : {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}")
    log.info(f"  Listen      : http://{base.SERVER_HOST}:{base.SERVER_PORT}  (HTTP /play still works too)")
    log.info("="*55)
    app.run(host=base.SERVER_HOST, port=base.SERVER_PORT, threaded=True)
