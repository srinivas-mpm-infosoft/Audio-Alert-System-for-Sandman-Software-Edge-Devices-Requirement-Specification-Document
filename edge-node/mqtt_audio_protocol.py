"""
mqtt_audio_protocol.py — shared wire format for MQTT audio delivery, used by
tts_server.py's _deliver_to_edge_mqtt()/_acknowledge_on_edge_mqtt() (gateway
side, publish) and edge_node.py's _mqtt_audio_subscriber() (edge side,
subscribe). Both files support HTTP and MQTT at the same time — which
transport is used for a given alert is decided per target device (the
Central Gateway's Device.protocol config), not by which file/process is
running.

Topics, one set per zone_code (e.g. "z002"):
  sandman/audio/<zone_code>/play              tts_server -> edge_node   (play command)
  sandman/audio/<zone_code>/play/ack          edge_node -> tts_server   (queued receipt)
  sandman/audio/<zone_code>/acknowledge       tts_server -> edge_node   (clear a queued alert)
  sandman/audio/<zone_code>/acknowledge/ack   edge_node -> tts_server

Every message carries a "request_id" (a UUID hex string) so the sender can
match a reply to its request over the shared ack topics (edge nodes for
different zones can share one broker without cross-talk since each zone's
ack topic is distinct, and request_id also guards against any residual
ambiguity from a slow/duplicate reply).

Wire format:
  - play:      4-byte big-endian header length, then UTF-8 JSON header,
               then raw MP3 bytes. (Not base64 — MQTT payloads are already
               raw bytes, so this avoids the ~33% base64 size overhead.)
  - every other message (acks, acknowledge command): plain UTF-8 JSON.
"""
import json
import struct


def play_topic(zone_code: str) -> str:
    return f"sandman/audio/{zone_code}/play"


def play_ack_topic(zone_code: str) -> str:
    return f"sandman/audio/{zone_code}/play/ack"


def ack_topic(zone_code: str) -> str:
    return f"sandman/audio/{zone_code}/acknowledge"


def ack_ack_topic(zone_code: str) -> str:
    return f"sandman/audio/{zone_code}/acknowledge/ack"


def pack_play(header: dict, mp3: bytes) -> bytes:
    header_bytes = json.dumps(header).encode('utf-8')
    return struct.pack('>I', len(header_bytes)) + header_bytes + mp3


def unpack_play(data: bytes):
    """Returns (header: dict, mp3: bytes). Raises on malformed input —
    callers should catch and log, not crash their message-handling loop."""
    (hlen,) = struct.unpack('>I', data[:4])
    header = json.loads(data[4:4 + hlen].decode('utf-8'))
    return header, data[4 + hlen:]
