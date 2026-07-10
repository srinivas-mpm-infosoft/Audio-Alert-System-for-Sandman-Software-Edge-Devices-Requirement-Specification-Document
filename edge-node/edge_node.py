# """
# edge_node.py  â€  Edge Node Audio Player
# â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
# Runs on each gateway device. Receives audio from TTS server,
# stores to disk, and plays in priority order.

# PLAYBACK RULES (config-driven â€ see AlertTypeConfig / alert_type_configs on
# the Main Gateway; each /play delivery carries the resolved behavior for its
# alert type as extra form fields):
#   is_blocking=True   : Round-robin through ALL unacked blocking items
#                         continuously. Nothing else plays while any blocking
#                         item is unacked (generalizes the old Critical rule â€
#                         any type can opt into this, not just "Critical").
#   is_blocking=False  : Replayed every repeat_interval_sec until acknowledged
#                         or until initial_play_count plays are used up,
#                         whichever first. Each replay's interval shrinks by
#                         reduction_step_sec (floored at min_interval_sec).
#                         If requires_ack=False, auto-acknowledges once
#                         initial_play_count is reached; otherwise stays
#                         queued (silently) waiting for a manual acknowledge.
#                         Ordered against other non-blocking items by sort_order.
#   No behavior supplied (older caller / MQTT path): falls back to the
#   original hardcoded Critical/High/Normal/Low behavior via
#   _legacy_behavior_for_category().

# AUDIO FILES:
#   Saved to ./audio_files/<alert_id>.mp3
#   Deleted on acknowledge or auto-ack.

# ENDPOINTS:
#   POST /play                â€ receive audio, add to queue
#   POST /acknowledge         â€ remove alert from queue
#   POST /increase-frequency  â€ change repeat interval
#   POST /restart             â€ clear the queue / reset playback state
#   GET  /queue               â€ view queue
#   GET  /health               (includes cpu_temp/uptime/mem for the dashboard)
#   WS   /paging/ws            â€ live push-to-talk audio stream (D4)
# """

# import json
# import logging
# import os
# import queue
# import re
# import subprocess
# import tempfile
# import threading
# import time
# from pathlib import Path
# from typing import Optional

# import requests
# from flask import Flask, request, jsonify
# from flask_sock import Sock
# from simple_websocket import ConnectionClosed

# from mqtt_audio_protocol import ack_ack_topic, ack_topic, play_ack_topic, play_topic, unpack_play

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # CONFIGURATION
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# SERVER_HOST     = '0.0.0.0'
# SERVER_PORT     = 5000
# AUDIO_FILES_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / 'audio_files'
# HIGH_REPEAT_SEC = 20.0   # seconds between High alert replays

# # MQTT heartbeat (technology requirement: MQTT for node heartbeat/status).
# # Set MQTT_ZONE_ID to this node's zone_code at deploy time â€ the gateway's
# # mqtt_service.py resolves that back to the matching Gateway-type device.
# # Optional: if paho-mqtt isn't installed or the broker is unreachable, this
# # silently does nothing and GET /health (HTTP) remains the working fallback.
# MQTT_BROKER_HOST         = os.environ.get('MQTT_BROKER_HOST', 'localhost')
# MQTT_BROKER_PORT         = int(os.environ.get('MQTT_BROKER_PORT', '1883'))
# MQTT_ZONE_ID             = os.environ.get('MQTT_ZONE_ID', '')
# MQTT_USERNAME            = os.environ.get('MQTT_USERNAME', '')
# MQTT_PASSWORD            = os.environ.get('MQTT_PASSWORD', '')
# MQTT_PUBLISH_INTERVAL_SEC = 15

# # MQTT alert/audio receiving (Section 7) â€ an alternative to the HTTP /play
# # route above, for edge nodes the Central Gateway is configured to reach over
# # MQTT instead of direct LAN HTTP. Reuses the same broker/zone env vars as
# # the heartbeat publisher above (same broker, same zone). Both HTTP /play and
# # this MQTT subscriber feed the exact same _enqueue_play() queue â€ whichever
# # transport the gateway's Device config picked for this node just works.

# # Local dashboard (D6) â€ reuses MQTT_ZONE_ID as this node's zone identity
# # (already required for MQTT heartbeat) and proxies SOP/alert lookups to
# # the Main Gateway server-to-server, same trusted-LAN model as the rest of
# # this file's endpoints (no auth on this internal network today).
# GATEWAY_URL = os.environ.get('GATEWAY_URL', 'http://localhost:8000')
# ZONE_ID     = MQTT_ZONE_ID

# AUDIO_FILES_DIR.mkdir(parents=True, exist_ok=True)

# logging.basicConfig(
#     level=logging.INFO,
#     format='%(asctime)s [%(levelname)-7s] %(message)s',
#     datefmt='%H:%M:%S',
# )
# log = logging.getLogger(__name__)

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Queue
# # Item keys: alert_id, alert_category, is_blocking, sort_order, audio_path,
# #            lang_code, seq, received_at, last_played_at, repeat_interval,
# #            reduction_step, min_interval, max_plays, requires_ack,
# #            acknowledged, play_count
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# from threading import Lock
# _queue      : list = []
# _queue_lock = Lock()
# _seq        = [0]

# def _next_seq():
#     _seq[0] += 1; return _seq[0]

# def _unacked_blocking() -> list:
#     with _queue_lock:
#         return [i for i in _queue if i['is_blocking'] and not i['acknowledged']]

# def _due_nonblocking() -> Optional[dict]:
#     """Return the highest-priority (sort_order, seq) non-blocking item that's
#     due to (re)play: never played yet, or its shrinking repeat_interval has
#     elapsed â€ and it hasn't already used up its initial_play_count."""
#     with _queue_lock:
#         pending=[i for i in _queue if not i['is_blocking'] and not i['acknowledged']]
#     now=time.monotonic()
#     due=[]
#     for item in pending:
#         if item['max_plays'] is not None and item['play_count'] >= item['max_plays']:
#             continue
#         last=item['last_played_at']
#         if last is None or now-last >= item['repeat_interval']:
#             due.append(item)
#     return min(due, key=lambda x:(x['sort_order'],x['seq'])) if due else None

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Audio device
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# _device_cache=[None]; _device_lock=Lock()

# def _get_audio_device() -> str:
#     # Raspberry Pi 3.5 mm analog audio jack
#     return 'hw:Headphones,0'

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # System health  (CPU temp / uptime / mem â€ for the dashboard's node-health panel)
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# def _cpu_temp_c() -> Optional[float]:
#     for path in ('/sys/class/thermal/thermal_zone0/temp',):
#         try:
#             with open(path) as f:
#                 return round(int(f.read().strip()) / 1000.0, 1)
#         except Exception:
#             continue
#     return None

# def _uptime_sec() -> Optional[float]:
#     try:
#         with open('/proc/uptime') as f:
#             return float(f.read().split()[0])
#     except Exception:
#         return None

# def _mem_percent() -> Optional[float]:
#     try:
#         info = {}
#         with open('/proc/meminfo') as f:
#             for line in f:
#                 k, v = line.split(':', 1)
#                 info[k.strip()] = int(v.strip().split()[0])
#         total = info.get('MemTotal', 0)
#         avail = info.get('MemAvailable', 0)
#         if total: return round((1 - avail / total) * 100, 1)
#     except Exception:
#         pass
#     return None

# def _load_avg() -> Optional[list]:
#     try:
#         with open('/proc/loadavg') as f:
#             return [float(x) for x in f.read().split()[:3]]
#     except Exception:
#         return None

# def _sys_info() -> dict:
#     return {
#         'cpu_temp_c':  _cpu_temp_c(),
#         'uptime_sec':  _uptime_sec(),
#         'mem_percent': _mem_percent(),
#         'load_avg':    _load_avg(),
#     }

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Live voice paging (D4) â€ raw 16kHz mono PCM streaming, one session at a time
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# _paging_active = [False]
# _paging_lock   = Lock()

# PAGING_RATE          = 16000
# PAGING_CHUNK_SAMPLES = 320       # 20ms at 16kHz
# PAGING_CHUNK_BYTES   = 640       # 320 samples * 2 bytes (S16_LE)
# PAGING_QUEUE_MAX     = 3         # live voice â€ drop old audio rather than build latency

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # MQTT heartbeat publisher (technology requirement â€ additive to GET /health;
# # does not replace it)
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# def _mqtt_publish_loop():
#     try:
#         import paho.mqtt.client as mqtt
#     except ImportError:
#         log.warning("[MQTT] paho-mqtt not installed â€ heartbeat publish disabled "
#                    "(GET /health via HTTP still works)")
#         return
#     if not MQTT_ZONE_ID:
#         log.warning("[MQTT] MQTT_ZONE_ID not set â€ heartbeat publish disabled")
#         return

#     topic = f'sandman/heartbeat/{MQTT_ZONE_ID}'
#     try:
#         client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'edge-{MQTT_ZONE_ID}')
#     except AttributeError:
#         client = mqtt.Client(client_id=f'edge-{MQTT_ZONE_ID}')
#     client.reconnect_delay_set(min_delay=1, max_delay=30)
#     try:
#         client.connect_async(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
#         client.loop_start()
#     except Exception as e:
#         log.warning(f"[MQTT] Could not start client (broker unreachable?): {e}")
#         return

#     log.info(f"[MQTT] Publishing heartbeat to {topic} every {MQTT_PUBLISH_INTERVAL_SEC}s "
#              f"(broker {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT})")
#     while True:
#         try:
#             with _queue_lock:
#                 depth = len(_queue)
#             payload = json.dumps({
#                 'zone_id': MQTT_ZONE_ID, 'status': 'ok', 'paging_active': _paging_active[0],
#                 'queue_depth': depth, 'currently_playing': _playing[0],
#                 **_sys_info(), 'ts': time.time(),
#             })
#             client.publish(topic, payload, qos=0, retain=True)
#         except Exception as e:
#             log.warning(f"[MQTT] Publish failed: {e}")
#         time.sleep(MQTT_PUBLISH_INTERVAL_SEC)

# # Started further below, after _playing is defined (the loop references it).

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Playback
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# _playing=[None]; _play_lock=Lock()
# # Guarded by _play_lock together with _playing above:
# _current_proc      = [None]   # live subprocess.Popen handle for the in-flight _play_file, or None
# _playing_priority  = [None]   # alert_category string ('Critical'/'High'/'Normal'/'Low') of what's in flight


# def _play_file(audio_path: str, alert_id: int, alert_category: str) -> str:
#     """
#     Play audio using the same default audio path as manual cvlc playback.
#     """

#     cmd = [
#         'cvlc',
#         '--play-and-exit',
#         '--quiet',
#         audio_path
#     ]

#     with _play_lock:
#         _playing[0] = alert_id
#         _playing_priority[0] = alert_category

#     t0 = time.monotonic()

#     log.info(
#         f"[Play] START alert={alert_id} "
#         f"cat={alert_category}"
#     )

#     result = 'failed'

#     try:
#         proc = subprocess.Popen(
#             cmd,
#             stdout=subprocess.DEVNULL,
#             stderr=subprocess.DEVNULL
#         )

#         with _play_lock:
#             _current_proc[0] = proc

#         try:
#             proc.wait(timeout=120)

#         except subprocess.TimeoutExpired:
#             log.error(f"[Play] Timeout alert={alert_id}")
#             proc.kill()
#             proc.wait()

#         log.info(
#             f"[Play] DONE alert={alert_id} "
#             f"{time.monotonic() - t0:.2f}s "
#             f"code={proc.returncode}"
#         )

#         if proc.returncode == 0:
#             result = 'completed'
#         elif proc.returncode is not None and proc.returncode < 0:
#             result = 'interrupted'
#         else:
#             result = 'failed'

#     except FileNotFoundError:
#         log.error("[Play] cvlc not found")
#         result = 'failed'

#     except Exception as e:
#         log.error(f"[Play] Error: {e}")
#         result = 'failed'

#     finally:
#         with _play_lock:
#             _playing[0] = None
#             _playing_priority[0] = None
#             _current_proc[0] = None

#     return result

# def _play_item(item: dict) -> str:
#     item['last_played_at']=time.monotonic()
#     item['play_count']=item.get('play_count',0)+1
#     result=_play_file(item['audio_path'], item['alert_id'], item['alert_category'])
#     if result=='interrupted':
#         # Make the item instantly eligible to replay again â€ _due_nonblocking()
#         # treats last_played_at is None as "instantly due".
#         item['last_played_at']=None
#     return result

# def _advance_nonblocking(item: dict):
#     """After a non-blocking item plays: shrink its repeat interval (floored
#     at min_interval), then auto-acknowledge it if it has used up its
#     initial_play_count and doesn't require a manual acknowledgement."""
#     item['repeat_interval'] = max(item['repeat_interval'] - item['reduction_step'],
#                                   item['min_interval'])
#     if item['max_plays'] is None or item['play_count'] < item['max_plays'] or item['requires_ack']:
#         return
#     with _queue_lock: item['acknowledged']=True
#     log.info(f"[Queue] Auto-acked alert={item['alert_id']} ({item['alert_category']})")
#     try: os.unlink(item['audio_path'])
#     except Exception: pass
#     _remove_from_queue(item['alert_id'])

# def _remove_from_queue(alert_id: int) -> Optional[str]:
#     """Remove item from queue, return audio_path for cleanup."""
#     with _queue_lock:
#         for item in _queue:
#             if item['alert_id']==alert_id:
#                 path=item.get('audio_path')
#                 _queue.remove(item)
#                 return path
#     return None

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Playback worker
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# def _worker():
#     """
#     Config-driven playback:
#       1. Blocking types (is_blocking=True): round-robin all unacked blocking
#          items continuously â€ nothing else plays while any is unacked.
#       2. Non-blocking types: replay when due (shrinking interval), ordered
#          by sort_order; auto-ack once initial_play_count is used up unless
#          requires_ack is set.
#     """
#     log.info("[Queue] Worker started")
#     block_idx = 0

#     while True:
#         # â€â€ Live paging in progress: hold all queued playback â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
#         if _paging_active[0]:
#             time.sleep(0.2)
#             continue

#         # â€â€ Blocking types: round-robin â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
#         blocking = _unacked_blocking()
#         if blocking:
#             block_idx = block_idx % len(blocking)
#             item      = blocking[block_idx]
#             _play_item(item)
#             block_idx = (block_idx + 1) % max(len(blocking), 1)
#             continue

#         # â€â€ Non-blocking: play/replay when due â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
#         item = _due_nonblocking()
#         if item:
#             result = _play_item(item)
#             if result == 'interrupted':
#                 # Preempted by a live page â€ leave it queued (already made
#                 # re-eligible for replay by _play_item) and don't ack/delete.
#                 continue
#             _advance_nonblocking(item)
#             continue

#         # â€â€ Clean stale acked items â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
#         with _queue_lock:
#             before=len(_queue)
#             _queue[:] = [i for i in _queue if not i['acknowledged']]
#             if len(_queue)!=before:
#                 log.info(f"[Queue] Cleaned  remaining={len(_queue)}")

#         time.sleep(0.5)

# threading.Thread(target=_worker, daemon=True, name='playback').start()
# threading.Thread(target=_mqtt_publish_loop, daemon=True, name='mqtt-heartbeat').start()

# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Flask app
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# app = Flask(__name__)
# sock = Sock(app)


# @app.before_request
# def _disable_ws_permessage_deflate():
#     # Same fix as flask_backend.py's gateway routes, applied here for the
#     # gateway's outbound connection into this node's /paging/ws â€ see that
#     # file for the full explanation (simple-websocket's compressor state
#     # isn't safe against its own per-connection background thread when a
#     # route both receives a steady stream and sends from the request thread).
#     if request.environ.get("HTTP_UPGRADE", "").lower() == "websocket":
#         request.environ.pop("HTTP_SEC_WEBSOCKET_EXTENSIONS", None)


# # Fallback behavior when a caller doesn't send resolved AlertTypeConfig
# # fields (e.g. an MQTT play message with no behavior header) â€ reproduces
# # the original hardcoded rules exactly.
# _LEGACY_BEHAVIOR = {
#     'Critical': {'is_blocking': True,  'initial_play_count': None, 'requires_ack': True,
#                  'repeat_interval_sec': 0.0, 'reduction_step_sec': 0.0, 'min_interval_sec': 0.0, 'sort_order': 0},
#     'High':     {'is_blocking': False, 'initial_play_count': None, 'requires_ack': True,
#                  'repeat_interval_sec': HIGH_REPEAT_SEC, 'reduction_step_sec': 0.0, 'min_interval_sec': HIGH_REPEAT_SEC, 'sort_order': 1},
#     'Normal':   {'is_blocking': False, 'initial_play_count': 1,    'requires_ack': False,
#                  'repeat_interval_sec': 60.0, 'reduction_step_sec': 0.0, 'min_interval_sec': 60.0, 'sort_order': 2},
#     'Low':      {'is_blocking': False, 'initial_play_count': 1,    'requires_ack': False,
#                  'repeat_interval_sec': 60.0, 'reduction_step_sec': 0.0, 'min_interval_sec': 60.0, 'sort_order': 3},
# }

# def _legacy_behavior_for_category(alert_category: str) -> dict:
#     return dict(_LEGACY_BEHAVIOR.get(alert_category, _LEGACY_BEHAVIOR['Normal']))


# def _enqueue_play(alert_id: int, alert_category: str, lang_code: str, mp3_bytes: bytes,
#                   behavior: Optional[dict] = None, text: str = '', pattern_name: str = '', component_name: str = '', process_parameters: dict = {},
#                   zone_code: str = '', alert_source: str = '') -> dict:
#     """
#     Save audio to disk and enqueue for playback. Shared by the HTTP POST
#     /play route and the MQTT play subscriber (_mqtt_audio_subscriber below) â€
#     both transports end up in the exact same queue. `behavior` is the
#     resolved AlertTypeConfig fields (is_blocking/initial_play_count/
#     repeat_interval_sec/reduction_step_sec/min_interval_sec/requires_ack/
#     sort_order); falls back to the legacy Critical/High/Normal/Low rules if
#     not supplied. `text`/`zone_code`/`alert_source` are display-only (feed
#     the /display Edge Node dashboard's Pattern Name/Component Name cards) â€
#     optional, default '' when a caller doesn't have them.
#     """
#     if not mp3_bytes:
#         return {'queued': False, 'reason': 'empty audio'}

#     b = behavior or _legacy_behavior_for_category(alert_category)

#     # Save to disk (idempotent overwrite â€ harmless even if this turns out to
#     # be a duplicate, since it's the same target filename either way)
#     audio_path = str(AUDIO_FILES_DIR / f"{alert_id}.mp3")
#     try:
#         with open(audio_path, 'wb') as f: f.write(mp3_bytes)
#         log.info(f"[Play] Saved {len(mp3_bytes)//1024}KB â {audio_path}")
#     except Exception as e:
#         log.error(f"[Play] Save failed: {e}")
#         return {'queued': False, 'reason': str(e)}

#     item = {
#         'alert_id':        alert_id,
#         'alert_category':  alert_category,
#         'text':            text or '',
#         'pattern_name':    pattern_name or '',
#         'component_name':  component_name or '',
#         'zone_code':       zone_code or '',
#         'alert_source':    alert_source or '',
#         'is_blocking':     bool(b.get('is_blocking', False)),
#         'sort_order':      b.get('sort_order') if b.get('sort_order') is not None else 100,
#         'audio_path':      audio_path,
#         'lang_code':       lang_code,
#         'seq':             _next_seq(),
#         'received_at':     time.monotonic(),
#         'last_played_at':  None,
#         'repeat_interval': float(b.get('repeat_interval_sec') or 0),
#         'reduction_step':  float(b.get('reduction_step_sec') or 0),
#         'min_interval':    float(b.get('min_interval_sec') or 0),
#         'max_plays':       b.get('initial_play_count'),
#         'requires_ack':    bool(b.get('requires_ack', False)),
#         'acknowledged':    False,
#         'play_count':      0,
#     }

#     # Duplicate-check AND append in a single critical section so two
#     # near-simultaneous /play requests for the same new alert_id can't both
#     # pass the check and both get enqueued.
#     with _queue_lock:
#         if any(i['alert_id']==alert_id and not i['acknowledged'] for i in _queue):
#             log.info(f"[Queue] alert={alert_id} already queued")
#             return {'queued': False, 'reason': 'duplicate', 'critical_active': bool(_unacked_blocking())}
#         _queue.append(item); depth=len(_queue)

#     log.info(f"[Queue] Enqueued alert={alert_id} cat={alert_category} "
#              f"blocking={item['is_blocking']}  depth={depth}")

#     return {
#         'queued':          True,
#         'alert_id':        alert_id,
#         'alert_category':  alert_category,
#         'is_blocking':     item['is_blocking'],
#         'queue_depth':     depth,
#         'critical_active': bool(_unacked_blocking()),
#     }


# def _do_acknowledge(alert_id: int) -> dict:
#     """Remove alert from queue and delete its audio file. Shared by the
#     HTTP POST /acknowledge route and the MQTT subscriber below."""
#     audio_path = None
#     removed    = False
#     with _queue_lock:
#         for item in _queue:
#             if item['alert_id']==alert_id:
#                 item['acknowledged']=True
#                 audio_path=item.get('audio_path')
#                 removed=True
#                 log.info(f"[Queue] Acknowledged alert={alert_id} "
#                          f"cat={item['alert_category']}  "
#                          f"played={item['play_count']}x")
#                 break
#         _queue[:] = [i for i in _queue if i['alert_id']!=alert_id]

#     if audio_path:
#         try: os.unlink(audio_path)
#         except Exception: pass

#     return {
#         'acknowledged':   removed,
#         'alert_id':       alert_id,
#         'critical_active': bool(_unacked_blocking()),
#     }


# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # MQTT play/acknowledge subscriber (Section 7 â€ alternative to HTTP /play)
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# _BEHAVIOR_KEYS = ('is_blocking', 'initial_play_count', 'repeat_interval_sec',
#                   'reduction_step_sec', 'min_interval_sec', 'requires_ack', 'sort_order')


# def _mqtt_on_message(client, userdata, msg):
#     try:
#         if msg.topic == play_topic(MQTT_ZONE_ID):
#             header, mp3_bytes = unpack_play(msg.payload)
#             behavior = {k: header[k] for k in _BEHAVIOR_KEYS if k in header} or None
#             result = _enqueue_play(
#                 int(header.get('alert_id', 0)), header.get('alert_category', 'Normal'),
#                 header.get('lang_code', 'EN'), mp3_bytes, behavior,
#                 text=header.get('text', ''), zone_code=MQTT_ZONE_ID,
#                 alert_source=header.get('alert_source', ''),
#             )
#             reply = {'request_id': header.get('request_id'), 'alert_id': header.get('alert_id'),
#                      'queued': result.get('queued', False), 'critical_active': result.get('critical_active', False)}
#             client.publish(play_ack_topic(MQTT_ZONE_ID), json.dumps(reply), qos=1)

#         elif msg.topic == ack_topic(MQTT_ZONE_ID):
#             body = json.loads(msg.payload.decode('utf-8'))
#             result = _do_acknowledge(int(body.get('alert_id', 0)))
#             reply = {'request_id': body.get('request_id'), 'acknowledged': result['acknowledged']}
#             client.publish(ack_ack_topic(MQTT_ZONE_ID), json.dumps(reply), qos=1)
#     except Exception as e:
#         log.error(f"[MQTT-Audio] Failed handling {msg.topic}: {e}")


# def _mqtt_audio_subscriber():
#     try:
#         import paho.mqtt.client as mqtt
#     except ImportError:
#         log.warning("[MQTT-Audio] paho-mqtt not installed â€ MQTT play/acknowledge disabled "
#                    "(HTTP /play and /acknowledge still work)")
#         return
#     if not MQTT_ZONE_ID:
#         log.warning("[MQTT-Audio] MQTT_ZONE_ID not set â€ MQTT play/acknowledge disabled")
#         return

#     try:
#         client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'edge-audio-{MQTT_ZONE_ID}')
#     except AttributeError:
#         client = mqtt.Client(client_id=f'edge-audio-{MQTT_ZONE_ID}')
#     if MQTT_USERNAME:
#         client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
#     client.on_message = _mqtt_on_message
#     client.reconnect_delay_set(min_delay=1, max_delay=30)
#     try:
#         client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
#     except Exception as e:
#         log.warning(f"[MQTT-Audio] Could not connect to broker: {e}")
#         return

#     client.subscribe(play_topic(MQTT_ZONE_ID), qos=1)
#     client.subscribe(ack_topic(MQTT_ZONE_ID), qos=1)
#     log.info(f"[MQTT-Audio] Subscribed: {play_topic(MQTT_ZONE_ID)}  {ack_topic(MQTT_ZONE_ID)}")
#     client.loop_forever()


# # _mqtt_audio_subscriber runs client.loop_forever() (blocking), unlike the
# # heartbeat publisher's loop_start()+sleep loop â€ needs its own dedicated
# # thread, started here (after its def, same convention as the other two
# # thread-starts further up) rather than grouped with them.
# threading.Thread(target=_mqtt_audio_subscriber, daemon=True, name='mqtt-audio').start()


# def _form_bool(v) -> bool:
#     return str(v).strip().lower() in ('1', 'true', 'yes')

# def _form_float(v, default: float) -> float:
#     if v is None or v == '': return default
#     try: return float(v)
#     except (TypeError, ValueError): return default

# def _form_int_or_none(v) -> Optional[int]:
#     if v is None or v == '': return None
#     try: return int(float(v))
#     except (TypeError, ValueError): return None


# @app.route('/play', methods=['POST'])
# def play():
#     """
#     Receive MP3 + metadata from TTS server.
#     Save to disk, enqueue for playback.

#     Multipart form:
#       audio          : MP3 file
#       alert_id       : int
#       alert_category : str (label only â€ playback rules come from behavior fields below)
#       lang_code      : str
#       is_blocking, initial_play_count, repeat_interval_sec, reduction_step_sec,
#       min_interval_sec, requires_ack, sort_order : resolved AlertTypeConfig
#       behavior fields (optional â€ falls back to legacy Critical/High/Normal/Low
#       rules for alert_category if omitted).
#     """
#     if 'audio' not in request.files:
#         return jsonify({'error': 'audio file required'}), 400

#     mp3_bytes      = request.files['audio'].read()
#     alert_id       = int(request.form.get('alert_id', 0))
#     alert_category = request.form.get('alert_category', 'Normal').strip()
#     lang_code      = request.form.get('lang_code', 'EN').strip()
#     text           = request.form.get('text', '').strip()
#     zone_code      = request.form.get('zone_code', '').strip()
#     alert_source   = request.form.get('alert_source', '').strip()
#     pattern_name   = request.form.get('pattern_name', '').strip()
#     component_name = request.form.get('component_name', '').strip()
#     process_parameters = request.form.get('process_parameters', '').strip()

#     if not mp3_bytes:
#         return jsonify({'error': 'empty audio'}), 400

#     behavior = None
#     if 'is_blocking' in request.form:
#         behavior = {
#             'is_blocking':         _form_bool(request.form.get('is_blocking')),
#             'initial_play_count':  _form_int_or_none(request.form.get('initial_play_count')),
#             'repeat_interval_sec': _form_float(request.form.get('repeat_interval_sec'), 60.0),
#             'reduction_step_sec':  _form_float(request.form.get('reduction_step_sec'), 0.0),
#             'min_interval_sec':    _form_float(request.form.get('min_interval_sec'), 0.0),
#             'requires_ack':        _form_bool(request.form.get('requires_ack')),
#             'sort_order':          _form_int_or_none(request.form.get('sort_order')),
#         }

#     return jsonify(_enqueue_play(alert_id, alert_category, lang_code, mp3_bytes, behavior,
#                                  text=text, pattern_name=pattern_name, component_name=component_name, process_parameters=process_parameters, zone_code=zone_code, alert_source=alert_source
#                                  ))


# @app.route('/acknowledge', methods=['POST'])
# def acknowledge():
#     """
#     Remove alert from queue and delete its audio file.
#     POST body: {"alert_id": 42}
#     """
#     body     = request.get_json(force=True, silent=True) or {}
#     alert_id = int(body.get('alert_id', 0))
#     if not alert_id:
#         return jsonify({'error': 'alert_id required'}), 400

#     return jsonify(_do_acknowledge(alert_id))


# @app.route('/acknowledge-all', methods=['POST'])
# def acknowledge_all():
#     """
#     Silence everything currently queued on this node right now â€ the local
#     dashboard's "Acknowledge All" emergency override (e.g. a pile-up of
#     blocking Critical alerts). Local queue clear only: if the current item
#     happens to be an active SOP step, the gateway's SopExecution isn't told,
#     so it stays WAITING_FOR_ACKNOWLEDGEMENT until it times out and replays â€
#     use the SOP card's own Acknowledge button for that case instead.
#     """
#     with _queue_lock:
#         alert_ids = [i['alert_id'] for i in _queue]
#     for alert_id in alert_ids:
#         _do_acknowledge(alert_id)
#     return jsonify({'acknowledged_count': len(alert_ids), 'critical_active': bool(_unacked_blocking())})


# @app.route('/increase-frequency', methods=['POST'])
# def increase_frequency():
#     """
#     Reduce repeat interval for High/Critical alert.
#     POST body: {"alert_id": 42, "repeat_interval": 10}
#     """
#     body            = request.get_json(force=True, silent=True) or {}
#     alert_id        = int(body.get('alert_id', 0))
#     repeat_interval = float(body.get('repeat_interval', 10))
#     if not alert_id:
#         return jsonify({'error': 'alert_id required'}), 400

#     updated=False
#     with _queue_lock:
#         for item in _queue:
#             if item['alert_id']==alert_id:
#                 old=item['repeat_interval']
#                 item['repeat_interval']=repeat_interval
#                 updated=True
#                 log.info(f"[Queue] alert={alert_id} interval {old}sâ{repeat_interval}s")
#                 break

#     return jsonify({'updated':updated,'alert_id':alert_id,
#                     'repeat_interval':repeat_interval})


# @app.route('/queue', methods=['GET'])
# def queue_status():
#     with _queue_lock:
#         items=[{k:v for k,v in i.items() if k!='audio_path'} for i in _queue]
#     return jsonify({
#         'depth':            len(items),
#         'critical_active':  bool(_unacked_blocking()),
#         'currently_playing': _playing[0],
#         'items':            items,
#     })


# @app.route('/display-data', methods=['GET'])
# def display_data():
#     """
#     Data feed for the simplified /display Edge Node UI (Section 3) â€ Pattern
#     Name / Component Name / Process Parameters for whatever is currently
#     playing. Reads straight off this node's own in-memory queue (no gateway
#     round-trip needed â€ the alert's own metadata already arrived with it),
#     so this keeps working even if the Central Gateway is briefly unreachable.
#     """
#     current_id = _playing[0]
#     item = None
#     if current_id is not None:
#         with _queue_lock:
#             item = next((i for i in _queue if i['alert_id'] == current_id), None)
#     if not item:
#         return jsonify({'active': False, 'pattern_name': None, 'component_name': None,
#                         'text': None, 'process_parameters': None, 'ts': time.time()})
#     return jsonify({
#         'active':             True,
#         'pattern_name':       item.get('pattern_name') or  'Single Piece',
#         'component_name':     item.get('component_name') or "Alloy",
#         'text':               item.get('text') or None,
#         # Not currently threaded through any dispatch path to this node (no
#         # source_parameter/trigger_value/threshold data reaches /play today)
#         # â€ reserved so a future caller can populate it without another
#         # contract change; None here is a genuine "not available", not a bug.
#         'process_parameters': item.get("process_parameters"),
#         'ts': time.time(),
#     })


# @app.route('/restart', methods=['POST'])
# def restart():
#     """
#     Soft restart â€ clears the playback queue and resets state.
#     Edge nodes are unattended headless devices with no remote-reboot agent,
#     so this does not power-cycle the Pi; it recovers a stuck audio queue,
#     which is the failure mode a dashboard "Restart" action can actually fix.
#     """
#     with _queue_lock:
#         cleared = len(_queue)
#         _queue.clear()
#     with _play_lock:
#         proc_to_stop = _current_proc[0]
#         _playing[0] = None
#     if proc_to_stop is not None:
#         try:
#             proc_to_stop.terminate()
#         except Exception:
#             pass
#     log.info(f"[Queue] Restart requested â€ cleared {cleared} item(s)")
#     return jsonify({'restarted': True, 'cleared': cleared, 'ts': time.time()})


# @app.route('/health', methods=['GET'])
# def health():
#     with _queue_lock: depth=len(_queue)
#     return jsonify({
#         'status':            'ok',
#         'queue_depth':       depth,
#         'critical_active':   bool(_unacked_blocking()),
#         'currently_playing': _playing[0],
#         'audio_device':      _get_audio_device() or 'default',
#         'high_repeat_sec':   HIGH_REPEAT_SEC,
#         'paging_active':     _paging_active[0],
#         **_sys_info(),
#     })


# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Live voice paging â€ WebSocket ingest (D4)
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# def _paging_session(ws):
#     """
#     Receives raw 16kHz mono S16_LE PCM (320-sample / 640-byte / 20ms binary
#     frames â€ the browser resamples+encodes this itself, no container/codec
#     involved) forwarded by flask_backend.py's paging relay, and feeds it to
#     aplay for near-real-time playback on this node's audio device. A bounded
#     queue (PAGING_QUEUE_MAX) sits between the WebSocket receive loop and the
#     playback thread â€ for live voice, old audio is worthless, so a slow
#     speaker/network drops the oldest queued chunk rather than accumulating
#     latency.

#     Only one paging session per node at a time â€ normal queued alert
#     playback is held (see _worker's paging_active check) for the duration.
#     """
#     with _paging_lock:
#         if _paging_active[0]:
#             ws.close(reason=1013, message='Paging session already active on this node')
#             return
#         _paging_active[0] = True

#     # â€â€ Arbitrate with queued-alert playback before starting the live page â€â€
#     # HIGH/NORMAL/LOW currently playing: interrupt it immediately.
#     # CRITICAL currently playing: wait for it to finish, capped at 45s, then
#     # proceed with paging anyway â€ never permanently block an operator.
#     deadline = time.monotonic() + 45.0
#     while True:
#         with _play_lock:
#             cur_priority = _playing_priority[0]
#             cur_proc     = _current_proc[0]

#         if cur_priority == 'Critical':
#             if time.monotonic() >= deadline:
#                 log.warning("[Paging] proceeding after timing out waiting for "
#                             "CRITICAL alert to finish")
#                 break
#             try:
#                 # Drain incoming frames while we wait so the upstream relay's
#                 # WebSocket (5s socket timeout) never blocks on a send to us.
#                 ws.receive(timeout=0.2)
#             except ConnectionClosed:
#                 with _paging_lock:
#                     _paging_active[0] = False
#                 log.info("[Paging] Caller hung up while waiting for CRITICAL "
#                          "alert to finish â€ aborting session")
#                 return
#             continue

#         if cur_proc is not None:
#             # High/Normal/Low currently playing â€ preempt it immediately.
#             # This causes _play_file's proc.wait() to return with a negative
#             # returncode, which _play_file/_play_item/_worker treat as 'interrupted'.
#             try:
#                 cur_proc.terminate()
#             except Exception:
#                 pass
#         break

#     device = _get_audio_device()
#     cmd = ['aplay', '-D', device if device else 'default',
#           '-f', 'S16_LE', '-r', str(PAGING_RATE), '-c', '1',
#           '--buffer-size=960', '--period-size=320', '-q']
#     log.info(f"[Paging] Session start â€ device={device or 'default'} "
#              f"rate={PAGING_RATE} chunk={PAGING_CHUNK_SAMPLES} queue={PAGING_QUEUE_MAX}")

#     proc = None
#     playback_thread = None
#     audio_queue = queue.Queue(maxsize=PAGING_QUEUE_MAX)

#     def playback_loop():
#         while True:
#             chunk = audio_queue.get()
#             if chunk is None:
#                 break
#             try:
#                 proc.stdin.write(chunk)
#             except (BrokenPipeError, OSError):
#                 break

#     try:
#         proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
#                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
#                                 bufsize=0)
#         playback_thread = threading.Thread(target=playback_loop, daemon=True)
#         playback_thread.start()

#         while True:
#             try:
#                 data = ws.receive(timeout=30)
#             except ConnectionClosed:
#                 break
#             if data is None:
#                 break
#             if isinstance(data, (bytes, bytearray)):
#                 if len(data) != PAGING_CHUNK_BYTES:
#                     log.warning(f"[Paging] Invalid PCM chunk: {len(data)} bytes, "
#                                 f"expected {PAGING_CHUNK_BYTES}")
#                     continue
#                 try:
#                     audio_queue.put_nowait(bytes(data))
#                 except queue.Full:
#                     # Drop the oldest audio instead of building latency.
#                     try: audio_queue.get_nowait()
#                     except queue.Empty: pass
#                     try: audio_queue.put_nowait(bytes(data))
#                     except queue.Full: pass
#             # Ignore text control frames (e.g. a client-side keepalive ping)
#     except Exception as e:
#         log.error(f"[Paging] Session error: {e}")
#     finally:
#         # Non-blocking sentinel â€ if the queue happens to be full and the
#         # playback thread has already died (broken pipe), a blocking put()
#         # here would hang this whole handler forever.
#         try:
#             audio_queue.put_nowait(None)
#         except queue.Full:
#             try: audio_queue.get_nowait()
#             except queue.Empty: pass
#             try: audio_queue.put_nowait(None)
#             except queue.Full: pass
#         if playback_thread is not None:
#             playback_thread.join(timeout=2)
#         if proc is not None:
#             try:
#                 proc.stdin.close()
#             except Exception:
#                 pass
#             try:
#                 proc.wait(timeout=5)
#             except Exception:
#                 proc.kill()
#         with _paging_lock:
#             _paging_active[0] = False
#         log.info("[Paging] Session ended")


# # sock.route()'s decorator doesn't return the wrapped function (it registers
# # websocket_route with Flask instead), so decorating _paging_session directly
# # with @sock.route(...) would clobber this module's name for it with None â€
# # apply the registration this way instead so _paging_session stays a plain,
# # directly-callable/testable function.
# sock.route('/paging/ws')(_paging_session)


# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Local dashboard (D6) â€ basic HTML/JS status page + SOP acknowledgement.
# # Proxies SOP/alert-type lookups to the Main Gateway (server-to-server, no
# # session auth needed here â€ same trust model as /play, /acknowledge etc).
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# def _gateway(method: str, path: str, timeout=5, **kwargs) -> dict:
#     try:
#         resp = requests.request(method, f"{GATEWAY_URL}{path}", timeout=timeout, **kwargs)
#         return resp.json()
#     except Exception as e:
#         return {"ok": False, "error": f"Gateway unreachable: {e}"}


# @app.route('/dashboard/ping', methods=['GET'])
# def dashboard_ping():
#     """Zone-independent gateway reachability check â€ used by the dashboard's
#     gwStatus pill so an unconfigured ZONE_ID doesn't make the gateway look
#     unreachable (it only means the SOP card can't be shown)."""
#     return jsonify(_gateway('GET', '/audio-alerts/edge/ping'))


# @app.route('/dashboard/alert-info', methods=['GET'])
# def dashboard_alert_info():
#     alert_id = request.args.get('alert_id', type=int)
#     if not alert_id:
#         return jsonify({'ok': False, 'error': 'alert_id required'}), 400
#     return jsonify(_gateway('GET', '/audio-alerts/edge/alert-info', params={'alert_id': alert_id}))


# @app.route('/dashboard/playback-logs', methods=['GET'])
# def dashboard_playback_logs():
#     if not ZONE_ID:
#         return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
#     return jsonify(_gateway('GET', '/audio-alerts/edge/playback-logs', params={'zone': ZONE_ID, 'limit': 20}))


# @app.route('/dashboard/sop-status', methods=['GET'])
# def dashboard_sop_status():
#     if not ZONE_ID:
#         return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
#     return jsonify(_gateway('GET', '/audio-alerts/edge/sop-status', params={'zone': ZONE_ID}))


# @app.route('/dashboard/sop-ack', methods=['POST'])
# def dashboard_sop_ack():
#     if not ZONE_ID:
#         return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
#     body = request.get_json(force=True, silent=True) or {}
#     execution_id = body.get('execution_id')
#     if not execution_id:
#         return jsonify({'ok': False, 'error': 'execution_id required'}), 400
#     return jsonify(_gateway('POST', '/audio-alerts/edge/sop-ack', timeout=8,
#                              json={'execution_id': execution_id, 'zone_code': ZONE_ID}))


# @app.route('/dashboard/sop-repeat', methods=['POST'])
# def dashboard_sop_repeat():
#     if not ZONE_ID:
#         return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
#     body = request.get_json(force=True, silent=True) or {}
#     execution_id = body.get('execution_id')
#     if not execution_id:
#         return jsonify({'ok': False, 'error': 'execution_id required'}), 400
#     return jsonify(_gateway('POST', '/audio-alerts/edge/sop-repeat', timeout=8,
#                              json={'execution_id': execution_id, 'zone_code': ZONE_ID}))


# _DASHBOARD_HTML = """<!doctype html>
# <html lang="en">
# <head>
# <meta charset="utf-8">
# <meta name="viewport" content="width=device-width, initial-scale=1">
# <title>Edge Node Dashboard</title>
# <style>
#   body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
#   h1 { font-size: 18px; margin: 0 0 4px; }
#   .zone { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
#   .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
#   .card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; margin: 0 0 10px; }
#   .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 3px 0; font-size: 14px; }
#   .row .k { color: #94a3b8; }
#   .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
#   .pill.ok { background: #052e16; color: #4ade80; }
#   .pill.bad { background: #450a0a; color: #f87171; }
#   .pill.warn { background: #451a03; color: #fbbf24; }
#   .pill.idle { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
#   button { background: #6366f1; color: white; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
#   button:disabled { background: #475569; cursor: not-allowed; }
#   button.btn-secondary { background: transparent; border: 1px solid #334155; color: #cbd5e1; margin-left: 8px; }
#   button.btn-secondary:disabled { background: transparent; color: #475569; border-color: #334155; }
#   .msg { font-size: 13px; color: #cbd5e1; margin-top: 8px; line-height: 1.4; }
#   .ack-state { font-size: 12px; margin-top: 8px; }
#   .ack-state.pending { color: #fbbf24; }
#   .ack-state.success { color: #4ade80; }
#   .ack-state.error { color: #f87171; }
# </style>
# </head>
# <body>
#   <h1>Edge Node Dashboard</h1>

#   <div class="card">
#     <h2>Currently Playing</h2>
#     <div class="row"><span class="k">Alert type</span><span id="npType">â€</span></div>
#     <div class="row"><span class="k">Name</span><span id="npName">â€</span></div>
#     <div class="row"><span class="k">Playback status</span><span id="npStatus" class="pill idle">idle</span></div>
#     <div class="row"><span class="k">Queue depth</span><span id="npQueue">0</span></div>
#     <button id="ackAllBtn" class="btn-secondary" style="margin-top:10px;margin-left:0">Acknowledge All</button>
#     <div id="ackAllState" class="ack-state"></div>
#   </div>

#   <div class="card">
#     <h2>Alert Queue â€ everything on this node right now</h2>
#     <div id="queueList" style="font-size:13px;color:#94a3b8">Loadingâ€¦</div>
#   </div>

#   <div class="card">
#     <h2>Live Voice Paging</h2>
#     <div class="row"><span class="k">Status</span><span id="pagingStatus" class="pill idle">idle</span></div>
#   </div>

#   <div class="card" id="sopCard" style="display:none">
#     <h2>SOP â€ Standard Operating Procedure</h2>
#     <div class="row"><span class="k">Procedure</span><span id="sopName">â€</span></div>
#     <div class="row"><span class="k">Step</span><span id="sopStep">â€</span></div>
#     <div class="msg" id="sopMessage"></div>
#     <div id="sopAckArea" style="margin-top:12px"></div>
#   </div>

#   <div class="card">
#     <h2>Node Health</h2>
#     <div class="row"><span class="k">CPU temp</span><span id="cpuTemp">â€</span></div>
#     <div class="row"><span class="k">Memory used</span><span id="memPct">â€</span></div>
#     <div class="row"><span class="k">Uptime</span><span id="uptime">â€</span></div>
#   </div>

#   <div class="card">
#     <h2>Playback Logs</h2>
#     <div id="logsList" style="font-size:13px;color:#94a3b8">Loadingâ€¦</div>
#   </div>

# <script>
# const ZONE_ID = %(zone_id_json)s;
# const GATEWAY_URL_DISPLAY = %(gateway_url_json)s;
# let ackInFlight = false;

# function fmtUptime(sec) {
#   if (!sec) return "â€";
#   const h = Math.floor(sec / 3600), m = Math.floor((sec %% 3600) / 60);
#   return h + "h " + m + "m";
# }

# async function refreshHealth() {
#   try {
#     const res = await fetch('/health');
#     const h = await res.json();
#     document.getElementById('npQueue').textContent = h.queue_depth ?? 0;
#     document.getElementById('cpuTemp').textContent = h.cpu_temp_c != null ? h.cpu_temp_c + ' Â°C' : 'â€';
#     document.getElementById('memPct').textContent = h.mem_percent != null ? h.mem_percent + '%%' : 'â€';
#     document.getElementById('uptime').textContent = fmtUptime(h.uptime_sec);

#     const pagingEl = document.getElementById('pagingStatus');
#     pagingEl.textContent = h.paging_active ? 'Active' : 'Idle';
#     pagingEl.className = 'pill ' + (h.paging_active ? 'warn' : 'idle');

#     const statusEl = document.getElementById('npStatus');
#     if (h.paging_active) {
#       statusEl.textContent = 'Playing';
#       statusEl.className = 'pill warn';
#       document.getElementById('npType').textContent = 'Live Paging';
#       document.getElementById('npName').textContent = 'Live Voice Paging';
#     } else if (h.currently_playing) {
#       statusEl.textContent = 'Playing';
#       statusEl.className = 'pill ok';
#       const info = await fetchJSON('/dashboard/alert-info?alert_id=' + h.currently_playing);
#       if (info && info.ok && info.data) {
#         document.getElementById('npType').textContent = info.data.type || 'alert';
#         document.getElementById('npName').textContent = info.data.name || ('Alert #' + h.currently_playing);
#       } else {
#         document.getElementById('npType').textContent = 'alert';
#         document.getElementById('npName').textContent = 'Alert #' + h.currently_playing;
#       }
#     } else {
#       statusEl.textContent = h.queue_depth ? 'Queued' : 'Idle';
#       statusEl.className = 'pill idle';
#       document.getElementById('npType').textContent = 'â€';
#       document.getElementById('npName').textContent = 'â€';
#     }
#   } catch (e) {
#     console.error('health refresh failed', e);
#   }
# }

# async function fetchJSON(url, opts) {
#   try {
#     const res = await fetch(url, opts);
#     return await res.json();
#   } catch (e) {
#     return { ok: false, error: String(e) };
#   }
# }

# async function refreshGatewayStatus() {
#   const gwEl = document.getElementById('gwStatus');
#   const res = await fetchJSON('/dashboard/ping');
#   if (!res.ok) {
#     // Show the real reason (e.g. "Connection refused" / bad host) instead of
#     // a bare "unreachable" â€ almost always means GATEWAY_URL is misconfigured
#     // for this node (it defaults to http://localhost:8000, which is only
#     // correct if this edge node runs on the same machine as the gateway).
#     gwEl.textContent = 'unreachable: ' + (res.error || 'no response') + ' (check GATEWAY_URL=' + GATEWAY_URL_DISPLAY + ')';
#     gwEl.className = 'pill bad';
#     return;
#   }
#   if (!ZONE_ID) {
#     gwEl.textContent = 'connected â€ no zone configured';
#     gwEl.className = 'pill warn';
#     return;
#   }
#   gwEl.textContent = 'connected';
#   gwEl.className = 'pill ok';
# }

# // alert_id -> SOP execution id, for whatever SOP step audio is currently
# // queued on this node â€ lets the Alert Queue card redirect its per-item
# // Acknowledge to the proper SOP-ack flow instead of the edge-local-only one,
# // so clicking either button while a SOP step is active does the right thing.
# let currentSopAlertIds = {};

# async function refreshSop() {
#   const sopCard = document.getElementById('sopCard');
#   if (!ZONE_ID) {
#     sopCard.style.display = 'none';
#     currentSopAlertIds = {};
#     return;
#   }
#   const res = await fetchJSON('/dashboard/sop-status');
#   if (!res.ok) return;

#   if (!res.data) {
#     sopCard.style.display = 'none';
#     currentSopAlertIds = {};
#     return;
#   }
#   sopCard.style.display = 'block';
#   const ex = res.data;
#   currentSopAlertIds = {};
#   (ex.current_receipts || []).forEach((r) => { currentSopAlertIds[r.alert_id] = ex.id; });
#   document.getElementById('sopName').textContent = ex.sop_name || 'â€';
#   document.getElementById('sopStep').textContent =
#     'Step ' + ex.current_step_number + ' of ' + ex.total_steps + ' â€ ' + ex.status.replace(/_/g, ' ');
#   document.getElementById('sopMessage').textContent = ex.current_step ? (ex.current_step.message || '') : '';

#   const ackArea = document.getElementById('sopAckArea');
#   if (ex.needs_ack && !ackInFlight) {
#     ackArea.innerHTML = '<button id="ackBtn">Acknowledge</button>' +
#       '<button id="repeatBtn" class="btn-secondary">Repeat</button>' +
#       '<div id="ackState" class="ack-state"></div>';
#     document.getElementById('ackBtn').onclick = () => doAck(ex.id);
#     document.getElementById('repeatBtn').onclick = () => doRepeat(ex.id);
#   } else if (!ex.needs_ack) {
#     ackArea.innerHTML = '';
#   }
# }

# async function doAck(executionId) {
#   if (ackInFlight) return;
#   ackInFlight = true;
#   const ackState = document.getElementById('ackState');
#   const btn = document.getElementById('ackBtn');
#   const repeatBtn = document.getElementById('repeatBtn');
#   if (btn) btn.disabled = true;
#   if (repeatBtn) repeatBtn.disabled = true;
#   if (ackState) { ackState.textContent = 'Sending acknowledgementâ€¦'; ackState.className = 'ack-state pending'; }

#   const res = await fetchJSON('/dashboard/sop-ack', {
#     method: 'POST',
#     headers: { 'Content-Type': 'application/json' },
#     body: JSON.stringify({ execution_id: executionId }),
#   });

#   if (res.ok) {
#     if (ackState) { ackState.textContent = 'Acknowledged'; ackState.className = 'ack-state success'; }
#   } else {
#     if (ackState) { ackState.textContent = 'Failed: ' + (res.error || 'unknown error'); ackState.className = 'ack-state error'; }
#     if (btn) btn.disabled = false;
#     if (repeatBtn) repeatBtn.disabled = false;
#   }
#   ackInFlight = false;
#   setTimeout(refreshSop, 1000);
# }

# async function doRepeat(executionId) {
#   if (ackInFlight) return;
#   ackInFlight = true;
#   const ackState = document.getElementById('ackState');
#   const btn = document.getElementById('ackBtn');
#   const repeatBtn = document.getElementById('repeatBtn');
#   if (btn) btn.disabled = true;
#   if (repeatBtn) repeatBtn.disabled = true;
#   if (ackState) { ackState.textContent = 'Repeating stepâ€¦'; ackState.className = 'ack-state pending'; }

#   const res = await fetchJSON('/dashboard/sop-repeat', {
#     method: 'POST',
#     headers: { 'Content-Type': 'application/json' },
#     body: JSON.stringify({ execution_id: executionId }),
#   });

#   if (res.ok) {
#     if (ackState) { ackState.textContent = 'Step repeated'; ackState.className = 'ack-state success'; }
#   } else {
#     if (ackState) { ackState.textContent = 'Failed: ' + (res.error || 'unknown error'); ackState.className = 'ack-state error'; }
#   }
#   if (btn) btn.disabled = false;
#   if (repeatBtn) repeatBtn.disabled = false;
#   ackInFlight = false;
#   setTimeout(refreshSop, 1000);
# }

# async function doAckAll() {
#   const btn = document.getElementById('ackAllBtn');
#   const state = document.getElementById('ackAllState');
#   if (btn) btn.disabled = true;
#   if (state) { state.textContent = 'Acknowledging everythingâ€¦'; state.className = 'ack-state pending'; }
#   const res = await fetchJSON('/acknowledge-all', { method: 'POST' });
#   if (state) {
#     state.textContent = 'Acknowledged ' + (res.acknowledged_count ?? 0) + ' item(s)';
#     state.className = 'ack-state success';
#   }
#   if (btn) btn.disabled = false;
#   refreshHealth();
# }
# document.getElementById('ackAllBtn').onclick = doAckAll;

# function escapeHtml(s) {
#   return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
# }

# async function refreshQueue() {
#   const el = document.getElementById('queueList');
#   const res = await fetchJSON('/queue');
#   const items = res.items || [];
#   if (items.length === 0) { el.textContent = 'Queue is empty â€ nothing playing or waiting.'; return; }
#   el.innerHTML = items.map((it) => {
#     const maxPlays = (it.max_plays == null) ? 'â' : it.max_plays;
#     const sopExecId = currentSopAlertIds[it.alert_id];
#     const badges = [
#       it.is_blocking ? '<span class="pill bad">blocking</span>' : '',
#       it.requires_ack ? '<span class="pill warn">needs ack</span>' : '<span class="pill idle">auto-ack</span>',
#       it.acknowledged ? '<span class="pill ok">acknowledged</span>' : '',
#       sopExecId ? '<span class="pill warn">SOP step â€ use the SOP card to acknowledge</span>' : '',
#     ].filter(Boolean).join(' ');
#     // A SOP-step item's Acknowledge must go through /dashboard/sop-ack (tells
#     // the gateway) rather than the plain edge-local /acknowledge (silently
#     // stops replay here only, leaving the gateway's SopExecution waiting
#     // forever) â€ both buttons now converge on the correct action either way.
#     const btn = it.acknowledged ? '' : (sopExecId
#       ? '<button data-sop-exec-id="' + sopExecId + '" class="btn-secondary">Acknowledge</button>'
#       : '<button data-ack-id="' + it.alert_id + '" class="btn-secondary">Acknowledge</button>');
#     return '<div class="row" style="border-bottom:1px solid #1e293b;padding:8px 0;align-items:flex-start">' +
#       '<span>' +
#         '<strong>#' + it.alert_id + '</strong> â€ ' + escapeHtml(it.alert_category || 'alert') +
#         ' <span style="color:#64748b">(' + it.play_count + '/' + maxPlays + ' plays)</span><br>' +
#         badges +
#       '</span>' + btn +
#     '</div>';
#   }).join('');
# }
# document.getElementById('queueList').addEventListener('click', (e) => {
#   const sopBtn = e.target.closest('button[data-sop-exec-id]');
#   if (sopBtn) {
#     sopBtn.disabled = true;
#     fetchJSON('/dashboard/sop-ack', {
#       method: 'POST', headers: { 'Content-Type': 'application/json' },
#       body: JSON.stringify({ execution_id: sopBtn.dataset.sopExecId }),
#     }).then(() => { refreshQueue(); refreshSop(); refreshHealth(); });
#     return;
#   }
#   const btn = e.target.closest('button[data-ack-id]');
#   if (!btn) return;
#   btn.disabled = true;
#   fetchJSON('/acknowledge', {
#     method: 'POST', headers: { 'Content-Type': 'application/json' },
#     body: JSON.stringify({ alert_id: +btn.dataset.ackId }),
#   }).then(() => { refreshQueue(); refreshHealth(); });
# });

# function fmtLogTime(iso) {
#   if (!iso) return 'â€';
#   try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
# }

# async function refreshLogs() {
#   const el = document.getElementById('logsList');
#   const res = await fetchJSON('/dashboard/playback-logs');
#   if (!res.ok) { el.textContent = res.error || 'Unavailable'; return; }
#   const rows = res.data || [];
#   if (rows.length === 0) { el.textContent = 'No playback history for this zone yet.'; return; }
#   el.innerHTML = rows.map((r) => (
#     '<div class="row" style="border-bottom:1px solid #1e293b;padding:6px 0">' +
#       '<span class="k">' + fmtLogTime(r.timestamp) + ' â€ ' + (r.alert_category || 'alert') +
#       ' (' + (r.announcement_type || 'â€') + ')</span>' +
#       '<span class="pill ' + (r.edge_delivered ? 'ok' : 'bad') + '">' + (r.edge_delivered ? 'delivered' : 'failed') + '</span>' +
#     '</div>'
#   )).join('');
# }

# refreshHealth(); refreshGatewayStatus(); refreshSop(); refreshLogs(); refreshQueue();
# setInterval(refreshHealth, 3000);
# setInterval(refreshGatewayStatus, 5000);
# setInterval(refreshSop, 3000);
# setInterval(refreshLogs, 15000);
# setInterval(refreshQueue, 3000);
# </script>
# </body>
# </html>
# """


# @app.route('/dashboard', methods=['GET'])
# def dashboard():
#     # Flask serves a plain string return as text/html by default â€ no
#     # Response/mimetype needed.
#     return _DASHBOARD_HTML % {
#         'zone_id': ZONE_ID or '(not configured)',
#         'zone_id_json': json.dumps(ZONE_ID),
#         'gateway_url_json': json.dumps(GATEWAY_URL),
#     }


# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# # Edge Node Display UI (Section 3) â€ simple information display, visually
# # separate from the operator /dashboard above. White background, large
# # high-contrast text, no controls/settings â€ meant for a screen mounted next
# # to the speaker running continuously on a factory floor.
# # ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

# _DISPLAY_HTML = """<!doctype html>
# <html lang="en">
# <head>
# <meta charset="utf-8">
# <meta name="viewport" content="width=device-width, initial-scale=1">
# <title>Audio Alert Display</title>
# <style>
#   * { box-sizing: border-box; }
#   body {
#     font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
#     background: #ffffff; color: #0f172a; margin: 0;
#     min-height: 100vh; display: flex; flex-direction: column;
#   }
#   nav {
#     display: flex; align-items: center; gap: 14px;
#     padding: 20px 32px; border-bottom: 2px solid #e2e8f0;
#   }
#   nav .logo {
#     width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0;
#     background: #1d4ed8; color: #fff; display: flex; align-items: center;
#     justify-content: center; font-weight: 800; font-size: 18px;
#   }
#   nav .title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
#   nav .zone { margin-left: auto; font-size: 15px; color: #64748b; font-weight: 600; }
#   main { flex: 1; display: flex; flex-direction: column; gap: 28px; padding: 40px 48px; }
#   .idle-banner {
#     display: none; text-align: center; font-size: 28px; font-weight: 700;
#     color: #94a3b8; margin-top: 10vh;
#   }
#   .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 28px; }
#   .card {
#     border: 2px solid #e2e8f0; border-radius: 16px; padding: 28px 32px;
#     background: #f8fafc;
#   }
#   .card .label {
#     font-size: 15px; font-weight: 700; text-transform: uppercase;
#     letter-spacing: 0.08em; color: #64748b; margin-bottom: 10px;
#   }
#   .card .value { font-size: 40px; font-weight: 800; line-height: 1.15; color: #0f172a; word-break: break-word; }
#   .card .value.empty { color: #cbd5e1; font-weight: 600; font-size: 28px; }
#   .message-card { border-color: #1d4ed8; background: #eff6ff; }
#   .message-card .value { font-size: 28px; font-weight: 600; color: #1e3a8a; }
#   .conn-pill {
#     position: fixed; bottom: 18px; right: 22px; font-size: 13px; font-weight: 600;
#     padding: 6px 14px; border-radius: 999px; background: #f1f5f9; color: #64748b;
#   }
#   .conn-pill.bad { background: #fef2f2; color: #dc2626; }
# </style>
# </head>
# <body>
#   <nav>
#     <div class="logo">SA</div>
#     <div class="title">SandMan Audio Alert System</div>
#     <div class="zone">%(zone_label)s</div>
#   </nav>
#   <main>
#     <div class="idle-banner" id="idleBanner">No active announcement</div>
#     <div class="cards" id="cards" style="display:none">
#       <div class="card">
#         <div class="label">Pattern Name</div>
#         <div class="value" id="patternName">â€</div>
#       </div>
#       <div class="card">
#         <div class="label">Component Name</div>
#         <div class="value" id="componentName">â€</div>
#       </div>
#       <div class="card">
#         <div class="label">Process Parameters</div>
#         <div class="value" id="processParams">â€</div>
#       </div>
#       <div class="card message-card" id="messageCard" style="display:none">
#         <div class="label">Announcement</div>
#         <div class="value" id="messageText"></div>
#       </div>
#     </div>
#   </main>
#   <div class="conn-pill" id="connPill">connectingâ€¦</div>
# <script>
#   const $ = id => document.getElementById(id);

#   function setValue(el, text) {
#     if (text) { el.textContent = text; el.classList.remove('empty'); }
#     else { el.textContent = 'Not available'; el.classList.add('empty'); }
#   }

#   async function refresh() {
#     try {
#       const res = await fetch('/display-data');
#       if (!res.ok) throw new Error('HTTP ' + res.status);
#       const d = await res.json();
#       $('connPill').textContent = 'connected';
#       $('connPill').classList.remove('bad');

#       if (!d.active) {
#         $('idleBanner').style.display = 'block';
#         $('cards').style.display = 'none';
#         return;
#       }
#       $('idleBanner').style.display = 'none';
#       $('cards').style.display = 'grid';
#       setValue($('patternName'), d.pattern_name);
#       setValue($('componentName'), d.component_name);
#       setValue($('processParams'), d.process_parameters);
#       if (d.text) { $('messageCard').style.display = 'block'; $('messageText').textContent = d.text; }
#       else { $('messageCard').style.display = 'none'; }
#     } catch (e) {
#       $('connPill').textContent = 'disconnected';
#       $('connPill').classList.add('bad');
#     }
#   }
#   refresh();
#   setInterval(refresh, 2000);
# </script>
# </body>
# </html>
# """


# @app.route('/display', methods=['GET'])
# def display():
#     return _DISPLAY_HTML % {
#         'zone_label': ZONE_ID or 'Zone not configured',
#     }


# if __name__=='__main__':
#     log.info("="*55)
#     log.info("  Edge Node")
#     log.info(f"  Listen    : http://{SERVER_HOST}:{SERVER_PORT}")
#     log.info(f"  Audio dir : {AUDIO_FILES_DIR}")
#     log.info(f"  Playback  : config-driven (see AlertTypeConfig on the Main Gateway)")
#     log.info(f"  Legacy fallback if no behavior sent â€ Critical: blocking round-robin, "
#              f"High: replay every {HIGH_REPEAT_SEC}s, Normal/Low: play once")
#     log.info("="*55)
#     app.run(host=SERVER_HOST, port=SERVER_PORT, threaded=True)

# #V1


"""
edge_node.py  â€  Edge Node Audio Player
â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
Runs on each gateway device. Receives audio from TTS server,
stores to disk, and plays in priority order.

PLAYBACK RULES (config-driven â€ see AlertTypeConfig / alert_type_configs on
the Main Gateway; each /play delivery carries the resolved behavior for its
alert type as extra form fields):
  is_blocking=True   : Round-robin through ALL unacked blocking items
                        continuously. Nothing else plays while any blocking
                        item is unacked (generalizes the old Critical rule â€
                        any type can opt into this, not just "Critical").
  is_blocking=False  : Replayed every repeat_interval_sec until acknowledged
                        or until initial_play_count plays are used up,
                        whichever first. Each replay's interval shrinks by
                        reduction_step_sec (floored at min_interval_sec).
                        If requires_ack=False, auto-acknowledges once
                        initial_play_count is reached; otherwise stays
                        queued (silently) waiting for a manual acknowledge.
                        Ordered against other non-blocking items by sort_order.
  No behavior supplied (older caller / MQTT path): falls back to the
  original hardcoded Critical/High/Normal/Low behavior via
  _legacy_behavior_for_category().

AUDIO FILES:
  Saved to ./audio_files/<alert_id>.mp3
  Deleted on acknowledge or auto-ack.

ENDPOINTS:
  POST /play                â€ receive audio, add to queue
  POST /acknowledge         â€ remove alert from queue
  POST /increase-frequency  â€ change repeat interval
  POST /restart             â€ clear the queue / reset playback state
  GET  /queue               â€ view queue
  GET  /health               (includes cpu_temp/uptime/mem for the dashboard)
  WS   /paging/ws            â€ live push-to-talk audio stream (D4)
"""

import json
import logging
import os
import queue
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

import requests
from flask import Flask, request, jsonify
from flask_sock import Sock
from simple_websocket import ConnectionClosed

from mqtt_audio_protocol import ack_ack_topic, ack_topic, play_ack_topic, play_topic, unpack_play

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# CONFIGURATION
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

SERVER_HOST     = '0.0.0.0'
SERVER_PORT     = 5000
AUDIO_FILES_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / 'audio_files'
HIGH_REPEAT_SEC = 20.0   # seconds between High alert replays

# MQTT heartbeat (technology requirement: MQTT for node heartbeat/status).
# Set MQTT_ZONE_ID to this node's zone_code at deploy time â€ the gateway's
# mqtt_service.py resolves that back to the matching Gateway-type device.
# Optional: if paho-mqtt isn't installed or the broker is unreachable, this
# silently does nothing and GET /health (HTTP) remains the working fallback.
MQTT_BROKER_HOST         = os.environ.get('MQTT_BROKER_HOST', 'localhost')
MQTT_BROKER_PORT         = int(os.environ.get('MQTT_BROKER_PORT', '1883'))
MQTT_ZONE_ID             = os.environ.get('MQTT_ZONE_ID', '')
MQTT_USERNAME            = os.environ.get('MQTT_USERNAME', '')
MQTT_PASSWORD            = os.environ.get('MQTT_PASSWORD', '')
MQTT_PUBLISH_INTERVAL_SEC = 15

# MQTT alert/audio receiving (Section 7) â€ an alternative to the HTTP /play
# route above, for edge nodes the Central Gateway is configured to reach over
# MQTT instead of direct LAN HTTP. Reuses the same broker/zone env vars as
# the heartbeat publisher above (same broker, same zone). Both HTTP /play and
# this MQTT subscriber feed the exact same _enqueue_play() queue â€ whichever
# transport the gateway's Device config picked for this node just works.

# Local dashboard (D6) â€ reuses MQTT_ZONE_ID as this node's zone identity
# (already required for MQTT heartbeat) and proxies SOP/alert lookups to
# the Main Gateway server-to-server, same trusted-LAN model as the rest of
# this file's endpoints (no auth on this internal network today).
GATEWAY_URL = os.environ.get('GATEWAY_URL', 'http://localhost:8000')
ZONE_ID     = MQTT_ZONE_ID

AUDIO_FILES_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)-7s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Queue
# Item keys: alert_id, alert_category, is_blocking, sort_order, audio_path,
#            lang_code, seq, received_at, last_played_at, repeat_interval,
#            reduction_step, min_interval, max_plays, requires_ack,
#            acknowledged, play_count
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

from threading import Lock
_queue      : list = []
_queue_lock = Lock()
_seq        = [0]

def _next_seq():
    _seq[0] += 1; return _seq[0]

def _unacked_blocking() -> list:
    with _queue_lock:
        return [i for i in _queue if i['is_blocking'] and not i['acknowledged']]

def _due_nonblocking() -> Optional[dict]:
    """Return the highest-priority (sort_order, seq) non-blocking item that's
    due to (re)play: never played yet, or its shrinking repeat_interval has
    elapsed â€ and it hasn't already used up its initial_play_count."""
    with _queue_lock:
        pending=[i for i in _queue if not i['is_blocking'] and not i['acknowledged']]
    now=time.monotonic()
    due=[]
    for item in pending:
        if item['max_plays'] is not None and item['play_count'] >= item['max_plays']:
            continue
        last=item['last_played_at']
        if last is None or now-last >= item['repeat_interval']:
            due.append(item)
    return min(due, key=lambda x:(x['sort_order'],x['seq'])) if due else None

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Audio device
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

_device_cache=[None]; _device_lock=Lock()

def _get_audio_device() -> str:
    # Raspberry Pi 3.5 mm analog audio jack
    return 'hw:Headphones,0'

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# System health  (CPU temp / uptime / mem â€ for the dashboard's node-health panel)
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def _cpu_temp_c() -> Optional[float]:
    for path in ('/sys/class/thermal/thermal_zone0/temp',):
        try:
            with open(path) as f:
                return round(int(f.read().strip()) / 1000.0, 1)
        except Exception:
            continue
    return None

def _uptime_sec() -> Optional[float]:
    try:
        with open('/proc/uptime') as f:
            return float(f.read().split()[0])
    except Exception:
        return None

def _mem_percent() -> Optional[float]:
    try:
        info = {}
        with open('/proc/meminfo') as f:
            for line in f:
                k, v = line.split(':', 1)
                info[k.strip()] = int(v.strip().split()[0])
        total = info.get('MemTotal', 0)
        avail = info.get('MemAvailable', 0)
        if total: return round((1 - avail / total) * 100, 1)
    except Exception:
        pass
    return None

def _load_avg() -> Optional[list]:
    try:
        with open('/proc/loadavg') as f:
            return [float(x) for x in f.read().split()[:3]]
    except Exception:
        return None

def _sys_info() -> dict:
    return {
        'cpu_temp_c':  _cpu_temp_c(),
        'uptime_sec':  _uptime_sec(),
        'mem_percent': _mem_percent(),
        'load_avg':    _load_avg(),
    }

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Live voice paging (D4) â€ raw 16kHz mono PCM streaming, one session at a time
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

_paging_active = [False]
_paging_lock   = Lock()

PAGING_RATE          = 16000
PAGING_CHUNK_SAMPLES = 320       # 20ms at 16kHz
PAGING_CHUNK_BYTES   = 640       # 320 samples * 2 bytes (S16_LE)
PAGING_QUEUE_MAX     = 3         # live voice â€ drop old audio rather than build latency

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# MQTT heartbeat publisher (technology requirement â€ additive to GET /health;
# does not replace it)
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def _mqtt_publish_loop():
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        log.warning("[MQTT] paho-mqtt not installed â€ heartbeat publish disabled "
                   "(GET /health via HTTP still works)")
        return
    if not MQTT_ZONE_ID:
        log.warning("[MQTT] MQTT_ZONE_ID not set â€ heartbeat publish disabled")
        return

    topic = f'sandman/heartbeat/{MQTT_ZONE_ID}'
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'edge-{MQTT_ZONE_ID}')
    except AttributeError:
        client = mqtt.Client(client_id=f'edge-{MQTT_ZONE_ID}')
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    try:
        client.connect_async(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
        client.loop_start()
    except Exception as e:
        log.warning(f"[MQTT] Could not start client (broker unreachable?): {e}")
        return

    log.info(f"[MQTT] Publishing heartbeat to {topic} every {MQTT_PUBLISH_INTERVAL_SEC}s "
             f"(broker {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT})")
    while True:
        try:
            with _queue_lock:
                depth = len(_queue)
            payload = json.dumps({
                'zone_id': MQTT_ZONE_ID, 'status': 'ok', 'paging_active': _paging_active[0],
                'queue_depth': depth, 'currently_playing': _playing[0],
                **_sys_info(), 'ts': time.time(),
            })
            client.publish(topic, payload, qos=0, retain=True)
        except Exception as e:
            log.warning(f"[MQTT] Publish failed: {e}")
        time.sleep(MQTT_PUBLISH_INTERVAL_SEC)

# Started further below, after _playing is defined (the loop references it).

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Playback
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

_playing=[None]; _play_lock=Lock()
# Guarded by _play_lock together with _playing above:
_current_proc      = [None]   # live subprocess.Popen handle for the in-flight _play_file, or None
_playing_priority  = [None]   # alert_category string ('Critical'/'High'/'Normal'/'Low') of what's in flight


def _play_file(audio_path: str, alert_id: int, alert_category: str) -> str:
    """
    Play audio using the same default audio path as manual cvlc playback.
    """

    cmd = [
        'cvlc',
        '--play-and-exit',
        '--quiet',
        audio_path
    ]

    with _play_lock:
        _playing[0] = alert_id
        _playing_priority[0] = alert_category

    t0 = time.monotonic()

    log.info(
        f"[Play] START alert={alert_id} "
        f"cat={alert_category}"
    )

    result = 'failed'

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        with _play_lock:
            _current_proc[0] = proc

        try:
            proc.wait(timeout=120)

        except subprocess.TimeoutExpired:
            log.error(f"[Play] Timeout alert={alert_id}")
            proc.kill()
            proc.wait()

        log.info(
            f"[Play] DONE alert={alert_id} "
            f"{time.monotonic() - t0:.2f}s "
            f"code={proc.returncode}"
        )

        if proc.returncode == 0:
            result = 'completed'
        elif proc.returncode is not None and proc.returncode < 0:
            result = 'interrupted'
        else:
            result = 'failed'

    except FileNotFoundError:
        log.error("[Play] cvlc not found")
        result = 'failed'

    except Exception as e:
        log.error(f"[Play] Error: {e}")
        result = 'failed'

    finally:
        with _play_lock:
            _playing[0] = None
            _playing_priority[0] = None
            _current_proc[0] = None

    return result

def _play_item(item: dict) -> str:
    item['last_played_at']=time.monotonic()
    item['play_count']=item.get('play_count',0)+1
    result=_play_file(item['audio_path'], item['alert_id'], item['alert_category'])
    if result=='interrupted':
        # Make the item instantly eligible to replay again â€ _due_nonblocking()
        # treats last_played_at is None as "instantly due".
        item['last_played_at']=None
    return result

def _advance_nonblocking(item: dict):
    """After a non-blocking item plays: shrink its repeat interval (floored
    at min_interval), then auto-acknowledge it if it has used up its
    initial_play_count and doesn't require a manual acknowledgement."""
    item['repeat_interval'] = max(item['repeat_interval'] - item['reduction_step'],
                                  item['min_interval'])
    if item['max_plays'] is None or item['play_count'] < item['max_plays'] or item['requires_ack']:
        return
    with _queue_lock: item['acknowledged']=True
    log.info(f"[Queue] Auto-acked alert={item['alert_id']} ({item['alert_category']})")
    try: os.unlink(item['audio_path'])
    except Exception: pass
    _remove_from_queue(item['alert_id'])

def _remove_from_queue(alert_id: int) -> Optional[str]:
    """Remove item from queue, return audio_path for cleanup."""
    with _queue_lock:
        for item in _queue:
            if item['alert_id']==alert_id:
                path=item.get('audio_path')
                _queue.remove(item)
                return path
    return None

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Playback worker
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def _worker():
    """
    Config-driven playback:
      1. Blocking types (is_blocking=True): round-robin all unacked blocking
         items continuously â€ nothing else plays while any is unacked.
      2. Non-blocking types: replay when due (shrinking interval), ordered
         by sort_order; auto-ack once initial_play_count is used up unless
         requires_ack is set.
    """
    log.info("[Queue] Worker started")
    block_idx = 0

    while True:
        # â€â€ Live paging in progress: hold all queued playback â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
        if _paging_active[0]:
            time.sleep(0.2)
            continue

        # â€â€ Blocking types: round-robin â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
        blocking = _unacked_blocking()
        if blocking:
            block_idx = block_idx % len(blocking)
            item      = blocking[block_idx]
            _play_item(item)
            block_idx = (block_idx + 1) % max(len(blocking), 1)
            continue

        # â€â€ Non-blocking: play/replay when due â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
        item = _due_nonblocking()
        if item:
            result = _play_item(item)
            if result == 'interrupted':
                # Preempted by a live page â€ leave it queued (already made
                # re-eligible for replay by _play_item) and don't ack/delete.
                continue
            _advance_nonblocking(item)
            continue

        # â€â€ Clean stale acked items â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€
        with _queue_lock:
            before=len(_queue)
            _queue[:] = [i for i in _queue if not i['acknowledged']]
            if len(_queue)!=before:
                log.info(f"[Queue] Cleaned  remaining={len(_queue)}")

        time.sleep(0.5)

threading.Thread(target=_worker, daemon=True, name='playback').start()
threading.Thread(target=_mqtt_publish_loop, daemon=True, name='mqtt-heartbeat').start()

# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Flask app
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

app = Flask(__name__)
sock = Sock(app)


@app.before_request
def _disable_ws_permessage_deflate():
    # Same fix as flask_backend.py's gateway routes, applied here for the
    # gateway's outbound connection into this node's /paging/ws â€ see that
    # file for the full explanation (simple-websocket's compressor state
    # isn't safe against its own per-connection background thread when a
    # route both receives a steady stream and sends from the request thread).
    if request.environ.get("HTTP_UPGRADE", "").lower() == "websocket":
        request.environ.pop("HTTP_SEC_WEBSOCKET_EXTENSIONS", None)


# Fallback behavior when a caller doesn't send resolved AlertTypeConfig
# fields (e.g. an MQTT play message with no behavior header) â€ reproduces
# the original hardcoded rules exactly.
_LEGACY_BEHAVIOR = {
    'Critical': {'is_blocking': True,  'initial_play_count': None, 'requires_ack': True,
                 'repeat_interval_sec': 0.0, 'reduction_step_sec': 0.0, 'min_interval_sec': 0.0, 'sort_order': 0},
    'High':     {'is_blocking': False, 'initial_play_count': None, 'requires_ack': True,
                 'repeat_interval_sec': HIGH_REPEAT_SEC, 'reduction_step_sec': 0.0, 'min_interval_sec': HIGH_REPEAT_SEC, 'sort_order': 1},
    'Normal':   {'is_blocking': False, 'initial_play_count': 1,    'requires_ack': False,
                 'repeat_interval_sec': 60.0, 'reduction_step_sec': 0.0, 'min_interval_sec': 60.0, 'sort_order': 2},
    'Low':      {'is_blocking': False, 'initial_play_count': 1,    'requires_ack': False,
                 'repeat_interval_sec': 60.0, 'reduction_step_sec': 0.0, 'min_interval_sec': 60.0, 'sort_order': 3},
}

def _legacy_behavior_for_category(alert_category: str) -> dict:
    return dict(_LEGACY_BEHAVIOR.get(alert_category, _LEGACY_BEHAVIOR['Normal']))


def _enqueue_play(alert_id: int, alert_category: str, lang_code: str, mp3_bytes: bytes,
                  behavior: Optional[dict] = None, text: str = '', zone_code: str = '',
                  alert_source: str = '', process_parameters: str = '') -> dict:
    """
    Save audio to disk and enqueue for playback. Shared by the HTTP POST
    /play route and the MQTT play subscriber (_mqtt_audio_subscriber below) â€
    both transports end up in the exact same queue. `behavior` is the
    resolved AlertTypeConfig fields (is_blocking/initial_play_count/
    repeat_interval_sec/reduction_step_sec/min_interval_sec/requires_ack/
    sort_order); falls back to the legacy Critical/High/Normal/Low rules if
    not supplied. `text`/`zone_code`/`alert_source`/`process_parameters` are
    display-only (feed the /display Edge Node dashboard's Pattern Name/
    Component Name/Process Parameters cards) â€ optional, default '' when a
    caller doesn't have them.
    """
    if not mp3_bytes:
        return {'queued': False, 'reason': 'empty audio'}

    b = behavior or _legacy_behavior_for_category(alert_category)

    # Save to disk (idempotent overwrite â€ harmless even if this turns out to
    # be a duplicate, since it's the same target filename either way)
    audio_path = str(AUDIO_FILES_DIR / f"{alert_id}.mp3")
    try:
        with open(audio_path, 'wb') as f: f.write(mp3_bytes)
        log.info(f"[Play] Saved {len(mp3_bytes)//1024}KB â {audio_path}")
    except Exception as e:
        log.error(f"[Play] Save failed: {e}")
        return {'queued': False, 'reason': str(e)}

    item = {
        'alert_id':        alert_id,
        'alert_category':  alert_category,
        'text':            text or '',
        'zone_code':       zone_code or '',
        'alert_source':    alert_source or '',
        'process_parameters': process_parameters or '',
        'is_blocking':     bool(b.get('is_blocking', False)),
        'sort_order':      b.get('sort_order') if b.get('sort_order') is not None else 100,
        'audio_path':      audio_path,
        'lang_code':       lang_code,
        'seq':             _next_seq(),
        'received_at':     time.monotonic(),
        'last_played_at':  None,
        'repeat_interval': float(b.get('repeat_interval_sec') or 0),
        'reduction_step':  float(b.get('reduction_step_sec') or 0),
        'min_interval':    float(b.get('min_interval_sec') or 0),
        'max_plays':       b.get('initial_play_count'),
        'requires_ack':    bool(b.get('requires_ack', False)),
        'acknowledged':    False,
        'play_count':      0,
    }

    # Duplicate-check AND append in a single critical section so two
    # near-simultaneous /play requests for the same new alert_id can't both
    # pass the check and both get enqueued.
    with _queue_lock:
        if any(i['alert_id']==alert_id and not i['acknowledged'] for i in _queue):
            log.info(f"[Queue] alert={alert_id} already queued")
            return {'queued': False, 'reason': 'duplicate', 'critical_active': bool(_unacked_blocking())}
        _queue.append(item); depth=len(_queue)

    log.info(f"[Queue] Enqueued alert={alert_id} cat={alert_category} "
             f"blocking={item['is_blocking']}  depth={depth}")

    return {
        'queued':          True,
        'alert_id':        alert_id,
        'alert_category':  alert_category,
        'is_blocking':     item['is_blocking'],
        'queue_depth':     depth,
        'critical_active': bool(_unacked_blocking()),
    }


def _do_acknowledge(alert_id: int) -> dict:
    """Remove alert from queue and delete its audio file. Shared by the
    HTTP POST /acknowledge route and the MQTT subscriber below."""
    audio_path = None
    removed    = False
    with _queue_lock:
        for item in _queue:
            if item['alert_id']==alert_id:
                item['acknowledged']=True
                audio_path=item.get('audio_path')
                removed=True
                log.info(f"[Queue] Acknowledged alert={alert_id} "
                         f"cat={item['alert_category']}  "
                         f"played={item['play_count']}x")
                break
        _queue[:] = [i for i in _queue if i['alert_id']!=alert_id]

    if audio_path:
        try: os.unlink(audio_path)
        except Exception: pass

    return {
        'acknowledged':   removed,
        'alert_id':       alert_id,
        'critical_active': bool(_unacked_blocking()),
    }


# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# MQTT play/acknowledge subscriber (Section 7 â€ alternative to HTTP /play)
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

_BEHAVIOR_KEYS = ('is_blocking', 'initial_play_count', 'repeat_interval_sec',
                  'reduction_step_sec', 'min_interval_sec', 'requires_ack', 'sort_order')


def _mqtt_on_message(client, userdata, msg):
    try:
        if msg.topic == play_topic(MQTT_ZONE_ID):
            header, mp3_bytes = unpack_play(msg.payload)
            behavior = {k: header[k] for k in _BEHAVIOR_KEYS if k in header} or None
            result = _enqueue_play(
                int(header.get('alert_id', 0)), header.get('alert_category', 'Normal'),
                header.get('lang_code', 'EN'), mp3_bytes, behavior,
                text=header.get('text', ''), zone_code=MQTT_ZONE_ID,
                alert_source=header.get('alert_source', ''),
                process_parameters=header.get('process_parameters', ''),
            )
            reply = {'request_id': header.get('request_id'), 'alert_id': header.get('alert_id'),
                     'queued': result.get('queued', False), 'critical_active': result.get('critical_active', False)}
            client.publish(play_ack_topic(MQTT_ZONE_ID), json.dumps(reply), qos=1)

        elif msg.topic == ack_topic(MQTT_ZONE_ID):
            body = json.loads(msg.payload.decode('utf-8'))
            result = _do_acknowledge(int(body.get('alert_id', 0)))
            reply = {'request_id': body.get('request_id'), 'acknowledged': result['acknowledged']}
            client.publish(ack_ack_topic(MQTT_ZONE_ID), json.dumps(reply), qos=1)
    except Exception as e:
        log.error(f"[MQTT-Audio] Failed handling {msg.topic}: {e}")


def _mqtt_audio_subscriber():
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        log.warning("[MQTT-Audio] paho-mqtt not installed â€ MQTT play/acknowledge disabled "
                   "(HTTP /play and /acknowledge still work)")
        return
    if not MQTT_ZONE_ID:
        log.warning("[MQTT-Audio] MQTT_ZONE_ID not set â€ MQTT play/acknowledge disabled")
        return

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'edge-audio-{MQTT_ZONE_ID}')
    except AttributeError:
        client = mqtt.Client(client_id=f'edge-audio-{MQTT_ZONE_ID}')
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.on_message = _mqtt_on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    try:
        client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
    except Exception as e:
        log.warning(f"[MQTT-Audio] Could not connect to broker: {e}")
        return

    client.subscribe(play_topic(MQTT_ZONE_ID), qos=1)
    client.subscribe(ack_topic(MQTT_ZONE_ID), qos=1)
    log.info(f"[MQTT-Audio] Subscribed: {play_topic(MQTT_ZONE_ID)}  {ack_topic(MQTT_ZONE_ID)}")
    client.loop_forever()


# _mqtt_audio_subscriber runs client.loop_forever() (blocking), unlike the
# heartbeat publisher's loop_start()+sleep loop â€ needs its own dedicated
# thread, started here (after its def, same convention as the other two
# thread-starts further up) rather than grouped with them.
threading.Thread(target=_mqtt_audio_subscriber, daemon=True, name='mqtt-audio').start()


def _form_bool(v) -> bool:
    return str(v).strip().lower() in ('1', 'true', 'yes')

def _form_float(v, default: float) -> float:
    if v is None or v == '': return default
    try: return float(v)
    except (TypeError, ValueError): return default

def _form_int_or_none(v) -> Optional[int]:
    if v is None or v == '': return None
    try: return int(float(v))
    except (TypeError, ValueError): return None


@app.route('/play', methods=['POST'])
def play():
    """
    Receive MP3 + metadata from TTS server.
    Save to disk, enqueue for playback.

    Multipart form:
      audio          : MP3 file
      alert_id       : int
      alert_category : str (label only â€ playback rules come from behavior fields below)
      lang_code      : str
      is_blocking, initial_play_count, repeat_interval_sec, reduction_step_sec,
      min_interval_sec, requires_ack, sort_order : resolved AlertTypeConfig
      behavior fields (optional â€ falls back to legacy Critical/High/Normal/Low
      rules for alert_category if omitted).
    """
    if 'audio' not in request.files:
        return jsonify({'error': 'audio file required'}), 400

    mp3_bytes      = request.files['audio'].read()
    alert_id       = int(request.form.get('alert_id', 0))
    alert_category = request.form.get('alert_category', 'Normal').strip()
    lang_code      = request.form.get('lang_code', 'EN').strip()
    text           = request.form.get('text', '').strip()
    zone_code      = request.form.get('zone_code', '').strip()
    alert_source   = request.form.get('alert_source', '').strip()
    process_parameters = request.form.get('process_parameters', '').strip()

    if not mp3_bytes:
        return jsonify({'error': 'empty audio'}), 400

    behavior = None
    if 'is_blocking' in request.form:
        behavior = {
            'is_blocking':         _form_bool(request.form.get('is_blocking')),
            'initial_play_count':  _form_int_or_none(request.form.get('initial_play_count')),
            'repeat_interval_sec': _form_float(request.form.get('repeat_interval_sec'), 60.0),
            'reduction_step_sec':  _form_float(request.form.get('reduction_step_sec'), 0.0),
            'min_interval_sec':    _form_float(request.form.get('min_interval_sec'), 0.0),
            'requires_ack':        _form_bool(request.form.get('requires_ack')),
            'sort_order':          _form_int_or_none(request.form.get('sort_order')),
        }

    return jsonify(_enqueue_play(alert_id, alert_category, lang_code, mp3_bytes, behavior,
                                 text=text, zone_code=zone_code, alert_source=alert_source,
                                 process_parameters=process_parameters))


@app.route('/acknowledge', methods=['POST'])
def acknowledge():
    """
    Remove alert from queue and delete its audio file.
    POST body: {"alert_id": 42}
    """
    body     = request.get_json(force=True, silent=True) or {}
    alert_id = int(body.get('alert_id', 0))
    if not alert_id:
        return jsonify({'error': 'alert_id required'}), 400

    return jsonify(_do_acknowledge(alert_id))


@app.route('/acknowledge-all', methods=['POST'])
def acknowledge_all():
    """
    Silence everything currently queued on this node right now â€ the local
    dashboard's "Acknowledge All" emergency override (e.g. a pile-up of
    blocking Critical alerts). Local queue clear only: if the current item
    happens to be an active SOP step, the gateway's SopExecution isn't told,
    so it stays WAITING_FOR_ACKNOWLEDGEMENT until it times out and replays â€
    use the SOP card's own Acknowledge button for that case instead.
    """
    with _queue_lock:
        alert_ids = [i['alert_id'] for i in _queue]
    for alert_id in alert_ids:
        _do_acknowledge(alert_id)
    return jsonify({'acknowledged_count': len(alert_ids), 'critical_active': bool(_unacked_blocking())})


@app.route('/increase-frequency', methods=['POST'])
def increase_frequency():
    """
    Reduce repeat interval for High/Critical alert.
    POST body: {"alert_id": 42, "repeat_interval": 10}
    """
    body            = request.get_json(force=True, silent=True) or {}
    alert_id        = int(body.get('alert_id', 0))
    repeat_interval = float(body.get('repeat_interval', 10))
    if not alert_id:
        return jsonify({'error': 'alert_id required'}), 400

    updated=False
    with _queue_lock:
        for item in _queue:
            if item['alert_id']==alert_id:
                old=item['repeat_interval']
                item['repeat_interval']=repeat_interval
                updated=True
                log.info(f"[Queue] alert={alert_id} interval {old}sâ{repeat_interval}s")
                break

    return jsonify({'updated':updated,'alert_id':alert_id,
                    'repeat_interval':repeat_interval})


@app.route('/queue', methods=['GET'])
def queue_status():
    with _queue_lock:
        items=[{k:v for k,v in i.items() if k!='audio_path'} for i in _queue]
    return jsonify({
        'depth':            len(items),
        'critical_active':  bool(_unacked_blocking()),
        'currently_playing': _playing[0],
        'items':            items,
    })


@app.route('/display-data', methods=['GET'])
def display_data():
    """
    Data feed for the simplified /display Edge Node UI (Section 3) â€ Pattern
    Name / Component Name / Process Parameters for whatever is currently
    playing. Reads straight off this node's own in-memory queue (no gateway
    round-trip needed â€ the alert's own metadata already arrived with it),
    so this keeps working even if the Central Gateway is briefly unreachable.
    """
    current_id = _playing[0]
    item = None
    if current_id is not None:
        with _queue_lock:
            item = next((i for i in _queue if i['alert_id'] == current_id), None)
    if not item:
        return jsonify({'active': False, 'pattern_name': None, 'component_name': None,
                        'text': None, 'process_parameters': None, 'ts': time.time()})
    return jsonify({
        'active':             True,
        'pattern_name':       'Single Piece',
        'component_name':     'Alloy',
        'text':               item.get('text') or None,
        'process_parameters': item.get('process_parameters') or None,
        'ts': time.time(),
    })


@app.route('/restart', methods=['POST'])
def restart():
    """
    Soft restart â€ clears the playback queue and resets state.
    Edge nodes are unattended headless devices with no remote-reboot agent,
    so this does not power-cycle the Pi; it recovers a stuck audio queue,
    which is the failure mode a dashboard "Restart" action can actually fix.
    """
    with _queue_lock:
        cleared = len(_queue)
        _queue.clear()
    with _play_lock:
        proc_to_stop = _current_proc[0]
        _playing[0] = None
    if proc_to_stop is not None:
        try:
            proc_to_stop.terminate()
        except Exception:
            pass
    log.info(f"[Queue] Restart requested â€ cleared {cleared} item(s)")
    return jsonify({'restarted': True, 'cleared': cleared, 'ts': time.time()})


@app.route('/health', methods=['GET'])
def health():
    with _queue_lock: depth=len(_queue)
    return jsonify({
        'status':            'ok',
        'queue_depth':       depth,
        'critical_active':   bool(_unacked_blocking()),
        'currently_playing': _playing[0],
        'audio_device':      _get_audio_device() or 'default',
        'high_repeat_sec':   HIGH_REPEAT_SEC,
        'paging_active':     _paging_active[0],
        **_sys_info(),
    })


# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Live voice paging â€ WebSocket ingest (D4)
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def _paging_session(ws):
    """
    Receives raw 16kHz mono S16_LE PCM (320-sample / 640-byte / 20ms binary
    frames â€ the browser resamples+encodes this itself, no container/codec
    involved) forwarded by flask_backend.py's paging relay, and feeds it to
    aplay for near-real-time playback on this node's audio device. A bounded
    queue (PAGING_QUEUE_MAX) sits between the WebSocket receive loop and the
    playback thread â€ for live voice, old audio is worthless, so a slow
    speaker/network drops the oldest queued chunk rather than accumulating
    latency.

    Only one paging session per node at a time â€ normal queued alert
    playback is held (see _worker's paging_active check) for the duration.
    """
    with _paging_lock:
        if _paging_active[0]:
            ws.close(reason=1013, message='Paging session already active on this node')
            return
        _paging_active[0] = True

    # â€â€ Arbitrate with queued-alert playback before starting the live page â€â€
    # HIGH/NORMAL/LOW currently playing: interrupt it immediately.
    # CRITICAL currently playing: wait for it to finish, capped at 45s, then
    # proceed with paging anyway â€ never permanently block an operator.
    deadline = time.monotonic() + 45.0
    while True:
        with _play_lock:
            cur_priority = _playing_priority[0]
            cur_proc     = _current_proc[0]

        if cur_priority == 'Critical':
            if time.monotonic() >= deadline:
                log.warning("[Paging] proceeding after timing out waiting for "
                            "CRITICAL alert to finish")
                break
            try:
                # Drain incoming frames while we wait so the upstream relay's
                # WebSocket (5s socket timeout) never blocks on a send to us.
                ws.receive(timeout=0.2)
            except ConnectionClosed:
                with _paging_lock:
                    _paging_active[0] = False
                log.info("[Paging] Caller hung up while waiting for CRITICAL "
                         "alert to finish â€ aborting session")
                return
            continue

        if cur_proc is not None:
            # High/Normal/Low currently playing â€ preempt it immediately.
            # This causes _play_file's proc.wait() to return with a negative
            # returncode, which _play_file/_play_item/_worker treat as 'interrupted'.
            try:
                cur_proc.terminate()
            except Exception:
                pass
        break

    device = _get_audio_device()
    cmd = ['aplay', '-D', device if device else 'default',
          '-f', 'S16_LE', '-r', str(PAGING_RATE), '-c', '1',
          '--buffer-size=960', '--period-size=320', '-q']
    log.info(f"[Paging] Session start â€ device={device or 'default'} "
             f"rate={PAGING_RATE} chunk={PAGING_CHUNK_SAMPLES} queue={PAGING_QUEUE_MAX}")

    proc = None
    playback_thread = None
    audio_queue = queue.Queue(maxsize=PAGING_QUEUE_MAX)

    def playback_loop():
        while True:
            chunk = audio_queue.get()
            if chunk is None:
                break
            try:
                proc.stdin.write(chunk)
            except (BrokenPipeError, OSError):
                break

    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                bufsize=0)
        playback_thread = threading.Thread(target=playback_loop, daemon=True)
        playback_thread.start()

        while True:
            try:
                data = ws.receive(timeout=30)
            except ConnectionClosed:
                break
            if data is None:
                break
            if isinstance(data, (bytes, bytearray)):
                if len(data) != PAGING_CHUNK_BYTES:
                    log.warning(f"[Paging] Invalid PCM chunk: {len(data)} bytes, "
                                f"expected {PAGING_CHUNK_BYTES}")
                    continue
                try:
                    audio_queue.put_nowait(bytes(data))
                except queue.Full:
                    # Drop the oldest audio instead of building latency.
                    try: audio_queue.get_nowait()
                    except queue.Empty: pass
                    try: audio_queue.put_nowait(bytes(data))
                    except queue.Full: pass
            # Ignore text control frames (e.g. a client-side keepalive ping)
    except Exception as e:
        log.error(f"[Paging] Session error: {e}")
    finally:
        # Non-blocking sentinel â€ if the queue happens to be full and the
        # playback thread has already died (broken pipe), a blocking put()
        # here would hang this whole handler forever.
        try:
            audio_queue.put_nowait(None)
        except queue.Full:
            try: audio_queue.get_nowait()
            except queue.Empty: pass
            try: audio_queue.put_nowait(None)
            except queue.Full: pass
        if playback_thread is not None:
            playback_thread.join(timeout=2)
        if proc is not None:
            try:
                proc.stdin.close()
            except Exception:
                pass
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
        with _paging_lock:
            _paging_active[0] = False
        log.info("[Paging] Session ended")


# sock.route()'s decorator doesn't return the wrapped function (it registers
# websocket_route with Flask instead), so decorating _paging_session directly
# with @sock.route(...) would clobber this module's name for it with None â€
# apply the registration this way instead so _paging_session stays a plain,
# directly-callable/testable function.
sock.route('/paging/ws')(_paging_session)


# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Local dashboard (D6) â€ basic HTML/JS status page + SOP acknowledgement.
# Proxies SOP/alert-type lookups to the Main Gateway (server-to-server, no
# session auth needed here â€ same trust model as /play, /acknowledge etc).
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

def _gateway(method: str, path: str, timeout=5, **kwargs) -> dict:
    try:
        resp = requests.request(method, f"{GATEWAY_URL}{path}", timeout=timeout, **kwargs)
        return resp.json()
    except Exception as e:
        return {"ok": False, "error": f"Gateway unreachable: {e}"}


@app.route('/dashboard/ping', methods=['GET'])
def dashboard_ping():
    """Zone-independent gateway reachability check â€ used by the dashboard's
    gwStatus pill so an unconfigured ZONE_ID doesn't make the gateway look
    unreachable (it only means the SOP card can't be shown)."""
    return jsonify(_gateway('GET', '/audio-alerts/edge/ping'))


@app.route('/dashboard/alert-info', methods=['GET'])
def dashboard_alert_info():
    alert_id = request.args.get('alert_id', type=int)
    if not alert_id:
        return jsonify({'ok': False, 'error': 'alert_id required'}), 400
    return jsonify(_gateway('GET', '/audio-alerts/edge/alert-info', params={'alert_id': alert_id}))


@app.route('/dashboard/playback-logs', methods=['GET'])
def dashboard_playback_logs():
    if not ZONE_ID:
        return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
    return jsonify(_gateway('GET', '/audio-alerts/edge/playback-logs', params={'zone': ZONE_ID, 'limit': 20}))


@app.route('/dashboard/sop-status', methods=['GET'])
def dashboard_sop_status():
    if not ZONE_ID:
        return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
    return jsonify(_gateway('GET', '/audio-alerts/edge/sop-status', params={'zone': ZONE_ID}))


@app.route('/dashboard/sop-ack', methods=['POST'])
def dashboard_sop_ack():
    if not ZONE_ID:
        return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
    body = request.get_json(force=True, silent=True) or {}
    execution_id = body.get('execution_id')
    if not execution_id:
        return jsonify({'ok': False, 'error': 'execution_id required'}), 400
    return jsonify(_gateway('POST', '/audio-alerts/edge/sop-ack', timeout=8,
                             json={'execution_id': execution_id, 'zone_code': ZONE_ID}))


@app.route('/dashboard/sop-repeat', methods=['POST'])
def dashboard_sop_repeat():
    if not ZONE_ID:
        return jsonify({'ok': False, 'error': 'ZONE_ID (MQTT_ZONE_ID) not configured on this node'}), 400
    body = request.get_json(force=True, silent=True) or {}
    execution_id = body.get('execution_id')
    if not execution_id:
        return jsonify({'ok': False, 'error': 'execution_id required'}), 400
    return jsonify(_gateway('POST', '/audio-alerts/edge/sop-repeat', timeout=8,
                             json={'execution_id': execution_id, 'zone_code': ZONE_ID}))


_DASHBOARD_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edge Node Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .zone { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
  .card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; margin: 0 0 10px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 3px 0; font-size: 14px; }
  .row .k { color: #94a3b8; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.ok { background: #052e16; color: #4ade80; }
  .pill.bad { background: #450a0a; color: #f87171; }
  .pill.warn { background: #451a03; color: #fbbf24; }
  .pill.idle { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
  button { background: #6366f1; color: white; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:disabled { background: #475569; cursor: not-allowed; }
  button.btn-secondary { background: transparent; border: 1px solid #334155; color: #cbd5e1; margin-left: 8px; }
  button.btn-secondary:disabled { background: transparent; color: #475569; border-color: #334155; }
  .msg { font-size: 13px; color: #cbd5e1; margin-top: 8px; line-height: 1.4; }
  .ack-state { font-size: 12px; margin-top: 8px; }
  .ack-state.pending { color: #fbbf24; }
  .ack-state.success { color: #4ade80; }
  .ack-state.error { color: #f87171; }
</style>
</head>
<body>
  <h1>Edge Node Dashboard</h1>

  <div class="card">
    <h2>Currently Playing</h2>
    <div class="row"><span class="k">Alert type</span><span id="npType">â€</span></div>
    <div class="row"><span class="k">Name</span><span id="npName">â€</span></div>
    <div class="row"><span class="k">Playback status</span><span id="npStatus" class="pill idle">idle</span></div>
    <div class="row"><span class="k">Queue depth</span><span id="npQueue">0</span></div>
    <button id="ackAllBtn" class="btn-secondary" style="margin-top:10px;margin-left:0">Acknowledge All</button>
    <div id="ackAllState" class="ack-state"></div>
  </div>

  <div class="card">
    <h2>Alert Queue â€ everything on this node right now</h2>
    <div id="queueList" style="font-size:13px;color:#94a3b8">Loadingâ€¦</div>
  </div>

  <div class="card">
    <h2>Live Voice Paging</h2>
    <div class="row"><span class="k">Status</span><span id="pagingStatus" class="pill idle">idle</span></div>
  </div>

  <div class="card" id="sopCard" style="display:none">
    <h2>SOP â€ Standard Operating Procedure</h2>
    <div class="row"><span class="k">Procedure</span><span id="sopName">â€</span></div>
    <div class="row"><span class="k">Step</span><span id="sopStep">â€</span></div>
    <div class="msg" id="sopMessage"></div>
    <div id="sopAckArea" style="margin-top:12px"></div>
  </div>

  <div class="card">
    <h2>Node Health</h2>
    <div class="row"><span class="k">CPU temp</span><span id="cpuTemp">â€</span></div>
    <div class="row"><span class="k">Memory used</span><span id="memPct">â€</span></div>
    <div class="row"><span class="k">Uptime</span><span id="uptime">â€</span></div>
  </div>

  <div class="card">
    <h2>Playback Logs</h2>
    <div id="logsList" style="font-size:13px;color:#94a3b8">Loadingâ€¦</div>
  </div>

<script>
const ZONE_ID = %(zone_id_json)s;
const GATEWAY_URL_DISPLAY = %(gateway_url_json)s;
let ackInFlight = false;

function fmtUptime(sec) {
  if (!sec) return "â€";
  const h = Math.floor(sec / 3600), m = Math.floor((sec %% 3600) / 60);
  return h + "h " + m + "m";
}

async function refreshHealth() {
  try {
    const res = await fetch('/health');
    const h = await res.json();
    document.getElementById('npQueue').textContent = h.queue_depth ?? 0;
    document.getElementById('cpuTemp').textContent = h.cpu_temp_c != null ? h.cpu_temp_c + ' Â°C' : 'â€';
    document.getElementById('memPct').textContent = h.mem_percent != null ? h.mem_percent + '%%' : 'â€';
    document.getElementById('uptime').textContent = fmtUptime(h.uptime_sec);

    const pagingEl = document.getElementById('pagingStatus');
    pagingEl.textContent = h.paging_active ? 'Active' : 'Idle';
    pagingEl.className = 'pill ' + (h.paging_active ? 'warn' : 'idle');

    const statusEl = document.getElementById('npStatus');
    if (h.paging_active) {
      statusEl.textContent = 'Playing';
      statusEl.className = 'pill warn';
      document.getElementById('npType').textContent = 'Live Paging';
      document.getElementById('npName').textContent = 'Live Voice Paging';
    } else if (h.currently_playing) {
      statusEl.textContent = 'Playing';
      statusEl.className = 'pill ok';
      const info = await fetchJSON('/dashboard/alert-info?alert_id=' + h.currently_playing);
      if (info && info.ok && info.data) {
        document.getElementById('npType').textContent = info.data.type || 'alert';
        document.getElementById('npName').textContent = info.data.name || ('Alert #' + h.currently_playing);
      } else {
        document.getElementById('npType').textContent = 'alert';
        document.getElementById('npName').textContent = 'Alert #' + h.currently_playing;
      }
    } else {
      statusEl.textContent = h.queue_depth ? 'Queued' : 'Idle';
      statusEl.className = 'pill idle';
      document.getElementById('npType').textContent = 'â€';
      document.getElementById('npName').textContent = 'â€';
    }
  } catch (e) {
    console.error('health refresh failed', e);
  }
}

async function fetchJSON(url, opts) {
  try {
    const res = await fetch(url, opts);
    return await res.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function refreshGatewayStatus() {
  const gwEl = document.getElementById('gwStatus');
  const res = await fetchJSON('/dashboard/ping');
  if (!res.ok) {
    // Show the real reason (e.g. "Connection refused" / bad host) instead of
    // a bare "unreachable" â€ almost always means GATEWAY_URL is misconfigured
    // for this node (it defaults to http://localhost:8000, which is only
    // correct if this edge node runs on the same machine as the gateway).
    gwEl.textContent = 'unreachable: ' + (res.error || 'no response') + ' (check GATEWAY_URL=' + GATEWAY_URL_DISPLAY + ')';
    gwEl.className = 'pill bad';
    return;
  }
  if (!ZONE_ID) {
    gwEl.textContent = 'connected â€ no zone configured';
    gwEl.className = 'pill warn';
    return;
  }
  gwEl.textContent = 'connected';
  gwEl.className = 'pill ok';
}

// alert_id -> SOP execution id, for whatever SOP step audio is currently
// queued on this node â€ lets the Alert Queue card redirect its per-item
// Acknowledge to the proper SOP-ack flow instead of the edge-local-only one,
// so clicking either button while a SOP step is active does the right thing.
let currentSopAlertIds = {};

async function refreshSop() {
  const sopCard = document.getElementById('sopCard');
  if (!ZONE_ID) {
    sopCard.style.display = 'none';
    currentSopAlertIds = {};
    return;
  }
  const res = await fetchJSON('/dashboard/sop-status');
  if (!res.ok) return;

  if (!res.data) {
    sopCard.style.display = 'none';
    currentSopAlertIds = {};
    return;
  }
  sopCard.style.display = 'block';
  const ex = res.data;
  currentSopAlertIds = {};
  (ex.current_receipts || []).forEach((r) => { currentSopAlertIds[r.alert_id] = ex.id; });
  document.getElementById('sopName').textContent = ex.sop_name || 'â€';
  document.getElementById('sopStep').textContent =
    'Step ' + ex.current_step_number + ' of ' + ex.total_steps + ' â€ ' + ex.status.replace(/_/g, ' ');
  document.getElementById('sopMessage').textContent = ex.current_step ? (ex.current_step.message || '') : '';

  const ackArea = document.getElementById('sopAckArea');
  if (ex.needs_ack && !ackInFlight) {
    ackArea.innerHTML = '<button id="ackBtn">Acknowledge</button>' +
      '<button id="repeatBtn" class="btn-secondary">Repeat</button>' +
      '<div id="ackState" class="ack-state"></div>';
    document.getElementById('ackBtn').onclick = () => doAck(ex.id);
    document.getElementById('repeatBtn').onclick = () => doRepeat(ex.id);
  } else if (!ex.needs_ack) {
    ackArea.innerHTML = '';
  }
}

async function doAck(executionId) {
  if (ackInFlight) return;
  ackInFlight = true;
  const ackState = document.getElementById('ackState');
  const btn = document.getElementById('ackBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  if (btn) btn.disabled = true;
  if (repeatBtn) repeatBtn.disabled = true;
  if (ackState) { ackState.textContent = 'Sending acknowledgementâ€¦'; ackState.className = 'ack-state pending'; }

  const res = await fetchJSON('/dashboard/sop-ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execution_id: executionId }),
  });

  if (res.ok) {
    if (ackState) { ackState.textContent = 'Acknowledged'; ackState.className = 'ack-state success'; }
  } else {
    if (ackState) { ackState.textContent = 'Failed: ' + (res.error || 'unknown error'); ackState.className = 'ack-state error'; }
    if (btn) btn.disabled = false;
    if (repeatBtn) repeatBtn.disabled = false;
  }
  ackInFlight = false;
  setTimeout(refreshSop, 1000);
}

async function doRepeat(executionId) {
  if (ackInFlight) return;
  ackInFlight = true;
  const ackState = document.getElementById('ackState');
  const btn = document.getElementById('ackBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  if (btn) btn.disabled = true;
  if (repeatBtn) repeatBtn.disabled = true;
  if (ackState) { ackState.textContent = 'Repeating stepâ€¦'; ackState.className = 'ack-state pending'; }

  const res = await fetchJSON('/dashboard/sop-repeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execution_id: executionId }),
  });

  if (res.ok) {
    if (ackState) { ackState.textContent = 'Step repeated'; ackState.className = 'ack-state success'; }
  } else {
    if (ackState) { ackState.textContent = 'Failed: ' + (res.error || 'unknown error'); ackState.className = 'ack-state error'; }
  }
  if (btn) btn.disabled = false;
  if (repeatBtn) repeatBtn.disabled = false;
  ackInFlight = false;
  setTimeout(refreshSop, 1000);
}

async function doAckAll() {
  const btn = document.getElementById('ackAllBtn');
  const state = document.getElementById('ackAllState');
  if (btn) btn.disabled = true;
  if (state) { state.textContent = 'Acknowledging everythingâ€¦'; state.className = 'ack-state pending'; }
  const res = await fetchJSON('/acknowledge-all', { method: 'POST' });
  if (state) {
    state.textContent = 'Acknowledged ' + (res.acknowledged_count ?? 0) + ' item(s)';
    state.className = 'ack-state success';
  }
  if (btn) btn.disabled = false;
  refreshHealth();
}
document.getElementById('ackAllBtn').onclick = doAckAll;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function refreshQueue() {
  const el = document.getElementById('queueList');
  const res = await fetchJSON('/queue');
  const items = res.items || [];
  if (items.length === 0) { el.textContent = 'Queue is empty â€ nothing playing or waiting.'; return; }
  el.innerHTML = items.map((it) => {
    const maxPlays = (it.max_plays == null) ? 'â' : it.max_plays;
    const sopExecId = currentSopAlertIds[it.alert_id];
    const badges = [
      it.is_blocking ? '<span class="pill bad">blocking</span>' : '',
      it.requires_ack ? '<span class="pill warn">needs ack</span>' : '<span class="pill idle">auto-ack</span>',
      it.acknowledged ? '<span class="pill ok">acknowledged</span>' : '',
      sopExecId ? '<span class="pill warn">SOP step â€ use the SOP card to acknowledge</span>' : '',
    ].filter(Boolean).join(' ');
    // A SOP-step item's Acknowledge must go through /dashboard/sop-ack (tells
    // the gateway) rather than the plain edge-local /acknowledge (silently
    // stops replay here only, leaving the gateway's SopExecution waiting
    // forever) â€ both buttons now converge on the correct action either way.
    const btn = it.acknowledged ? '' : (sopExecId
      ? '<button data-sop-exec-id="' + sopExecId + '" class="btn-secondary">Acknowledge</button>'
      : '<button data-ack-id="' + it.alert_id + '" class="btn-secondary">Acknowledge</button>');
    return '<div class="row" style="border-bottom:1px solid #1e293b;padding:8px 0;align-items:flex-start">' +
      '<span>' +
        '<strong>#' + it.alert_id + '</strong> â€ ' + escapeHtml(it.alert_category || 'alert') +
        ' <span style="color:#64748b">(' + it.play_count + '/' + maxPlays + ' plays)</span><br>' +
        badges +
      '</span>' + btn +
    '</div>';
  }).join('');
}
document.getElementById('queueList').addEventListener('click', (e) => {
  const sopBtn = e.target.closest('button[data-sop-exec-id]');
  if (sopBtn) {
    sopBtn.disabled = true;
    fetchJSON('/dashboard/sop-ack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ execution_id: sopBtn.dataset.sopExecId }),
    }).then(() => { refreshQueue(); refreshSop(); refreshHealth(); });
    return;
  }
  const btn = e.target.closest('button[data-ack-id]');
  if (!btn) return;
  btn.disabled = true;
  fetchJSON('/acknowledge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alert_id: +btn.dataset.ackId }),
  }).then(() => { refreshQueue(); refreshHealth(); });
});

function fmtLogTime(iso) {
  if (!iso) return 'â€';
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

async function refreshLogs() {
  const el = document.getElementById('logsList');
  const res = await fetchJSON('/dashboard/playback-logs');
  if (!res.ok) { el.textContent = res.error || 'Unavailable'; return; }
  const rows = res.data || [];
  if (rows.length === 0) { el.textContent = 'No playback history for this zone yet.'; return; }
  el.innerHTML = rows.map((r) => (
    '<div class="row" style="border-bottom:1px solid #1e293b;padding:6px 0">' +
      '<span class="k">' + fmtLogTime(r.timestamp) + ' â€ ' + (r.alert_category || 'alert') +
      ' (' + (r.announcement_type || 'â€') + ')</span>' +
      '<span class="pill ' + (r.edge_delivered ? 'ok' : 'bad') + '">' + (r.edge_delivered ? 'delivered' : 'failed') + '</span>' +
    '</div>'
  )).join('');
}

refreshHealth(); refreshGatewayStatus(); refreshSop(); refreshLogs(); refreshQueue();
setInterval(refreshHealth, 3000);
setInterval(refreshGatewayStatus, 5000);
setInterval(refreshSop, 3000);
setInterval(refreshLogs, 15000);
setInterval(refreshQueue, 3000);
</script>
</body>
</html>
"""


@app.route('/dashboard', methods=['GET'])
def dashboard():
    # Flask serves a plain string return as text/html by default â€ no
    # Response/mimetype needed.
    return _DASHBOARD_HTML % {
        'zone_id': ZONE_ID or '(not configured)',
        'zone_id_json': json.dumps(ZONE_ID),
        'gateway_url_json': json.dumps(GATEWAY_URL),
    }


# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
# Edge Node Display UI (Section 3) â€ simple information display, visually
# separate from the operator /dashboard above. White background, large
# high-contrast text, no controls/settings â€ meant for a screen mounted next
# to the speaker running continuously on a factory floor.
# ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

_DISPLAY_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audio Alert Display</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #ffffff; color: #0f172a; margin: 0;
    min-height: 100vh; display: flex; flex-direction: column;
  }
  nav {
    display: flex; align-items: center; gap: 14px;
    padding: 20px 32px; border-bottom: 2px solid #e2e8f0;
  }
  nav .logo {
    width: 150px; height: 50px; border-radius: 8px; flex-shrink: 0;
    background: black; color: #fff; display: flex; align-items: center;
    justify-content: center; font-weight: 800; font-size: 18px;
  }
  nav .title { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  nav .zone { margin-left: auto; font-size: 15px; color: #64748b; font-weight: 600; }
  main { flex: 1; display: flex; flex-direction: column; gap: 28px; padding: 40px 48px; }
  .idle-banner {
    display: none; text-align: center; font-size: 28px; font-weight: 700;
    color: #94a3b8; margin-top: 10vh;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 28px; }
  .card {
    border: 2px solid #e2e8f0; border-radius: 16px; padding: 28px 32px;
    background: #f8fafc;
  }
  .card .label {
    font-size: 15px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #64748b; margin-bottom: 10px;
  }
  .card .value { font-size: 40px; font-weight: 800; line-height: 1.15; color: #0f172a; word-break: break-word; }
  .card .value.empty { color: #cbd5e1; font-weight: 600; font-size: 28px; }
  .message-card { border-color: #1d4ed8; background: #eff6ff; }
  .message-card .value { font-size: 28px; font-weight: 600; color: #1e3a8a; }
  .conn-pill {
    position: fixed; bottom: 18px; right: 22px; font-size: 13px; font-weight: 600;
    padding: 6px 14px; border-radius: 999px; background: #f1f5f9; color: #64748b;
  }
  .conn-pill.bad { background: #fef2f2; color: #dc2626; }
</style>
</head>
<body>
  <nav>
    <img class="logo" src="/static/logo.png">
    <div class="title">SandMan Audio Alert / Information System</div>
    <div class="zone">%(zone_label)s</div>
  </nav>
  <main>
    <div class="idle-banner" id="idleBanner">No active announcement</div>
    <div class="cards" id="cards" style="display:none">
      <div class="card">
        <div class="label">Pattern Name</div>
        <div class="value" id="patternName">â€</div>
      </div>
      <div class="card">
        <div class="label">Component Name</div>
        <div class="value" id="componentName">â€</div>
      </div>
      <div class="card">
        <div class="label">Process Parameters</div>
        <div class="value" id="processParams">â€</div>
      </div>
      <div class="card message-card" id="messageCard" style="display:none">
        <div class="label">Announcement</div>
        <div class="value" id="messageText"></div>
      </div>
    </div>
  </main>
  <div class="conn-pill" id="connPill">connectingâ€¦</div>
<script>
  const $ = id => document.getElementById(id);

  function setValue(el, text) {
    if (text) { el.textContent = text; el.classList.remove('empty'); }
    else { el.textContent = 'Not available'; el.classList.add('empty'); }
  }

  async function refresh() {
    try {
      const res = await fetch('/display-data');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      $('connPill').textContent = 'connected';
      $('connPill').classList.remove('bad');

      if (!d.active) {
        $('idleBanner').style.display = 'block';
        $('cards').style.display = 'none';
        return;
      }
      $('idleBanner').style.display = 'none';
      $('cards').style.display = 'grid';
      setValue($('patternName'), d.pattern_name);
      setValue($('componentName'), d.component_name);
      setValue($('processParams'), d.process_parameters);
      if (d.text) { $('messageCard').style.display = 'block'; $('messageText').textContent = d.text; }
      else { $('messageCard').style.display = 'none'; }
    } catch (e) {
      $('connPill').textContent = 'disconnected';
      $('connPill').classList.add('bad');
    }
  }
  refresh();
  setInterval(refresh, 2000);
</script>
</body>
</html>
"""


@app.route('/display', methods=['GET'])
def display():
    return _DISPLAY_HTML % {
        'zone_label': ZONE_ID or '',
    }


if __name__=='__main__':
    log.info("="*55)
    log.info("  Edge Node")
    log.info(f"  Listen    : http://{SERVER_HOST}:{SERVER_PORT}")
    log.info(f"  Audio dir : {AUDIO_FILES_DIR}")
    log.info(f"  Playback  : config-driven (see AlertTypeConfig on the Main Gateway)")
    log.info(f"  Legacy fallback if no behavior sent â€ Critical: blocking round-robin, "
             f"High: replay every {HIGH_REPEAT_SEC}s, Normal/Low: play once")
    log.info("="*55)
    app.run(host=SERVER_HOST, port=SERVER_PORT, threaded=True)

#V1
