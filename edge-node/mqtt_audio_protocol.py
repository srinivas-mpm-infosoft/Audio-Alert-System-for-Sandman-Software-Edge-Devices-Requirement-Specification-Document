"""
mqtt_audio_protocol.py — shared wire format for the MQTT audio-delivery
variant (tts_server_mqtt.py <-> edge_node_mqtt.py). The plain HTTP variant
(tts_server.py / edge_node.py) doesn't use this at all — it just POSTs
multipart forms directly.

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
