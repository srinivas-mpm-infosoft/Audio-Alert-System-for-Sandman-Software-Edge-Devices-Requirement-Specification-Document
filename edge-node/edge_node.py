"""
edge_node.py  —  Edge Node Audio Player
────────────────────────────────────────
Runs on each gateway device. Receives audio from TTS server,
stores to disk, and plays in priority order.

PRIORITY RULES:
  Critical (0): Round-robin through ALL unacked criticals continuously.
                Nothing else plays while any Critical is unacked.
                If multiple criticals, each plays once per cycle (round-robin).
  High     (1): Replay every HIGH_REPEAT_SEC (20s) until acknowledged.
                Does not block Normal/Low between replays.
  Normal   (2): Play once, auto-acknowledge.
  Low      (3): Play once, auto-acknowledge.

AUDIO FILES:
  Saved to ./audio_files/<alert_id>.mp3
  Deleted on acknowledge or auto-ack.

ENDPOINTS:
  POST /play                — receive audio, add to queue
  POST /acknowledge         — remove alert from queue
  POST /increase-frequency  — change repeat interval
  POST /restart             — clear the queue / reset playback state
  GET  /queue               — view queue
  GET  /health               (includes cpu_temp/uptime/mem for the dashboard)
  WS   /paging/ws            — live push-to-talk audio stream (D4)
"""

import json
import logging
import os
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

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

SERVER_HOST     = '0.0.0.0'
SERVER_PORT     = 5000
AUDIO_FILES_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / 'audio_files'
HIGH_REPEAT_SEC = 20.0   # seconds between High alert replays

# MQTT heartbeat (technology requirement: MQTT for node heartbeat/status).
# Set MQTT_ZONE_ID to this node's zone_code at deploy time — the gateway's
# mqtt_service.py resolves that back to the matching Gateway-type device.
# Optional: if paho-mqtt isn't installed or the broker is unreachable, this
# silently does nothing and GET /health (HTTP) remains the working fallback.
MQTT_BROKER_HOST         = os.environ.get('MQTT_BROKER_HOST', 'localhost')
MQTT_BROKER_PORT         = int(os.environ.get('MQTT_BROKER_PORT', '1883'))
MQTT_ZONE_ID             = os.environ.get('MQTT_ZONE_ID', '')
MQTT_PUBLISH_INTERVAL_SEC = 15

# Local dashboard (D6) — reuses MQTT_ZONE_ID as this node's zone identity
# (already required for MQTT heartbeat) and proxies SOP/alert lookups to
# the Main Gateway server-to-server, same trusted-LAN model as the rest of
# this file's endpoints (no auth on this internal network today).
GATEWAY_URL = os.environ.get('GATEWAY_URL', 'http://localhost:8000')
ZONE_ID     = MQTT_ZONE_ID

AUDIO_FILES_DIR.mkdir(parents=True, exist_ok=True)

PRIORITY_MAP = {'Critical': 0, 'High': 1, 'Normal': 2, 'Low': 3}

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)-7s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════
# Queue
# Item keys: alert_id, alert_category, priority, audio_path, lang_code,
#            seq, received_at, last_played_at, repeat_interval,
#            acknowledged, play_count
# ══════════════════════════════════════════════════════════════════════════════

from threading import Lock
_queue      : list = []
_queue_lock = Lock()
_seq        = [0]

def _next_seq():
    _seq[0] += 1; return _seq[0]

def _unacked_criticals() -> list:
    with _queue_lock:
        return [i for i in _queue if i['priority']==0 and not i['acknowledged']]

def _due_high() -> Optional[dict]:
    """Return oldest High alert that is due for replay."""
    with _queue_lock:
        highs=[i for i in _queue if i['priority']==1 and not i['acknowledged']]
    now=time.monotonic()
    for item in sorted(highs, key=lambda x: x['seq']):
        last=item['last_played_at']
        if last is None or now-last >= item['repeat_interval']:
            return item
    return None

def _next_normal() -> Optional[dict]:
    """Return highest-priority unplayed Normal/Low item."""
    with _queue_lock:
        pending=[i for i in _queue
                 if i['priority']>1 and not i['acknowledged']
                 and i['last_played_at'] is None]
    return min(pending, key=lambda x:(x['priority'],x['seq'])) if pending else None

# ══════════════════════════════════════════════════════════════════════════════
# Audio device
# ══════════════════════════════════════════════════════════════════════════════

_device_cache=[None]; _device_lock=Lock()

def _get_audio_device() -> Optional[str]:
    with _device_lock:
        if _device_cache[0] is None:
            try:
                r=subprocess.run(['aplay','-l'],capture_output=True,text=True,timeout=5)
                for line in r.stdout.splitlines():
                    if 'usb' in line.lower():
                        m=re.search(r'card\s+(\d+).*device\s+(\d+)',line,re.IGNORECASE)
                        if m:
                            hw=f"hw:{m.group(1)},{m.group(2)}"
                            log.info(f"[Audio] USB: {hw}"); _device_cache[0]=hw; break
                if _device_cache[0] is None: _device_cache[0]=''
            except Exception: _device_cache[0]=''
    return _device_cache[0] or None

# ══════════════════════════════════════════════════════════════════════════════
# System health  (CPU temp / uptime / mem — for the dashboard's node-health panel)
# ══════════════════════════════════════════════════════════════════════════════

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

# ══════════════════════════════════════════════════════════════════════════════
# Live voice paging (D4) — chunked near-live streaming, one session at a time
# ══════════════════════════════════════════════════════════════════════════════

_paging_active = [False]
_paging_lock   = Lock()

# ══════════════════════════════════════════════════════════════════════════════
# MQTT heartbeat publisher (technology requirement — additive to GET /health;
# does not replace it)
# ══════════════════════════════════════════════════════════════════════════════

def _mqtt_publish_loop():
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        log.warning("[MQTT] paho-mqtt not installed — heartbeat publish disabled "
                   "(GET /health via HTTP still works)")
        return
    if not MQTT_ZONE_ID:
        log.warning("[MQTT] MQTT_ZONE_ID not set — heartbeat publish disabled")
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

# ══════════════════════════════════════════════════════════════════════════════
# Playback
# ══════════════════════════════════════════════════════════════════════════════

_playing=[None]; _play_lock=Lock()
# Guarded by _play_lock together with _playing above:
_current_proc      = [None]   # live subprocess.Popen handle for the in-flight _play_file, or None
_playing_priority  = [None]   # alert_category string ('Critical'/'High'/'Normal'/'Low') of what's in flight

def _play_file(audio_path: str, alert_id: int, alert_category: str) -> str:
    """
    Play audio file via cvlc. Blocks until done, interrupted (paging
    preemption via _current_proc[0].terminate()), or failed.
    Returns one of: 'completed', 'interrupted', 'failed'.
    """
    device=_get_audio_device()
    cmd=['cvlc','--play-and-exit','--quiet']
    if device: cmd+=['--aout=alsa',f'--alsa-audio-device={device}']
    cmd.append(audio_path)
    with _play_lock:
        _playing[0]=alert_id
        _playing_priority[0]=alert_category
    t0=time.monotonic()
    log.info(f"[Play] START alert={alert_id} cat={alert_category}  "
             f"device={device or 'default'}")
    result='failed'
    try:
        proc=subprocess.Popen(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        with _play_lock:
            _current_proc[0]=proc
        try:
            proc.wait(timeout=120)
        except subprocess.TimeoutExpired:
            log.error(f"[Play] Timeout alert={alert_id}")
            proc.kill()
            proc.wait()
        log.info(f"[Play] DONE  alert={alert_id}  "
                 f"{time.monotonic()-t0:.2f}s  code={proc.returncode}")
        if proc.returncode==0:
            result='completed'
        elif proc.returncode is not None and proc.returncode<0:
            result='interrupted'
        else:
            result='failed'
    except FileNotFoundError:
        log.error("[Play] cvlc not found — sudo apt install vlc")
        result='failed'
    except Exception as e:
        log.error(f"[Play] Error: {e}")
        result='failed'
    finally:
        with _play_lock:
            _playing[0]=None
            _playing_priority[0]=None
            _current_proc[0]=None
    return result

def _play_item(item: dict) -> str:
    item['last_played_at']=time.monotonic()
    item['play_count']=item.get('play_count',0)+1
    result=_play_file(item['audio_path'], item['alert_id'], item['alert_category'])
    if result=='interrupted':
        # Make the item instantly eligible to replay again — _due_high() treats
        # last_played_at is None as "instantly due" and _next_normal() requires
        # last_played_at is None to be selectable.
        item['last_played_at']=None
    return result

def _remove_from_queue(alert_id: int) -> Optional[str]:
    """Remove item from queue, return audio_path for cleanup."""
    with _queue_lock:
        for item in _queue:
            if item['alert_id']==alert_id:
                path=item.get('audio_path')
                _queue.remove(item)
                return path
    return None

# ══════════════════════════════════════════════════════════════════════════════
# Playback worker
# ══════════════════════════════════════════════════════════════════════════════

def _worker():
    """
    Priority playback:
      1. Critical: round-robin all unacked criticals (never stop until acked)
      2. High: play when due (every HIGH_REPEAT_SEC)
      3. Normal/Low: play once, auto-ack
    """
    log.info("[Queue] Worker started")
    crit_idx = 0

    while True:
        # ── Live paging in progress: hold all queued playback ───────────────────
        if _paging_active[0]:
            time.sleep(0.2)
            continue

        # ── Critical: round-robin ─────────────────────────────────────────────
        criticals = _unacked_criticals()
        if criticals:
            crit_idx = crit_idx % len(criticals)
            item     = criticals[crit_idx]
            _play_item(item)
            crit_idx = (crit_idx + 1) % max(len(criticals), 1)
            continue

        # ── High: replay when due ─────────────────────────────────────────────
        high = _due_high()
        if high:
            _play_item(high)
            continue

        # ── Normal/Low: play once, auto-ack ──────────────────────────────────
        normal = _next_normal()
        if normal:
            result = _play_item(normal)
            if result == 'interrupted':
                # Preempted by a live page — leave it queued (already made
                # re-eligible for replay by _play_item) and don't ack/delete.
                continue
            with _queue_lock: normal['acknowledged']=True
            log.info(f"[Queue] Auto-acked alert={normal['alert_id']} "
                     f"({normal['alert_category']})")
            try: os.unlink(normal['audio_path'])
            except Exception: pass
            _remove_from_queue(normal['alert_id'])
            continue

        # ── Clean stale acked items ───────────────────────────────────────────
        with _queue_lock:
            before=len(_queue)
            _queue[:] = [i for i in _queue if not i['acknowledged']]
            if len(_queue)!=before:
                log.info(f"[Queue] Cleaned  remaining={len(_queue)}")

        time.sleep(0.5)

threading.Thread(target=_worker, daemon=True, name='playback').start()
threading.Thread(target=_mqtt_publish_loop, daemon=True, name='mqtt-heartbeat').start()

# ══════════════════════════════════════════════════════════════════════════════
# Flask app
# ══════════════════════════════════════════════════════════════════════════════

app = Flask(__name__)
sock = Sock(app)


def _enqueue_play(alert_id: int, alert_category: str, lang_code: str, mp3_bytes: bytes) -> dict:
    """
    Save audio to disk and enqueue for playback. Shared by the HTTP POST
    /play route and edge_node_mqtt.py's MQTT play subscriber — both transports
    end up in the exact same priority queue.
    """
    priority = PRIORITY_MAP.get(alert_category, 2)
    if not mp3_bytes:
        return {'queued': False, 'reason': 'empty audio'}

    # Save to disk (idempotent overwrite — harmless even if this turns out to
    # be a duplicate, since it's the same target filename either way)
    audio_path = str(AUDIO_FILES_DIR / f"{alert_id}.mp3")
    try:
        with open(audio_path, 'wb') as f: f.write(mp3_bytes)
        log.info(f"[Play] Saved {len(mp3_bytes)//1024}KB → {audio_path}")
    except Exception as e:
        log.error(f"[Play] Save failed: {e}")
        return {'queued': False, 'reason': str(e)}

    item = {
        'alert_id':       alert_id,
        'alert_category': alert_category,
        'priority':       priority,
        'audio_path':     audio_path,
        'lang_code':      lang_code,
        'seq':            _next_seq(),
        'received_at':    time.monotonic(),
        'last_played_at': None,
        'repeat_interval': HIGH_REPEAT_SEC if priority==1 else 60.0,
        'acknowledged':   False,
        'play_count':     0,
    }

    # Duplicate-check AND append in a single critical section so two
    # near-simultaneous /play requests for the same new alert_id can't both
    # pass the check and both get enqueued.
    with _queue_lock:
        if any(i['alert_id']==alert_id and not i['acknowledged'] for i in _queue):
            log.info(f"[Queue] alert={alert_id} already queued")
            return {'queued': False, 'reason': 'duplicate', 'critical_active': bool(_unacked_criticals())}
        _queue.append(item); depth=len(_queue)

    log.info(f"[Queue] Enqueued alert={alert_id} cat={alert_category} "
             f"priority={priority}  depth={depth}")

    return {
        'queued':          True,
        'alert_id':        alert_id,
        'alert_category':  alert_category,
        'priority':        priority,
        'queue_depth':     depth,
        'critical_active': bool(_unacked_criticals()),
    }


def _do_acknowledge(alert_id: int) -> dict:
    """Remove alert from queue and delete its audio file. Shared by the
    HTTP POST /acknowledge route and edge_node_mqtt.py's MQTT subscriber."""
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
        'critical_active': bool(_unacked_criticals()),
    }


@app.route('/play', methods=['POST'])
def play():
    """
    Receive MP3 + metadata from TTS server.
    Save to disk, enqueue for playback.

    Multipart form:
      audio          : MP3 file
      alert_id       : int
      alert_category : Critical | High | Normal | Low
      lang_code      : str
    """
    if 'audio' not in request.files:
        return jsonify({'error': 'audio file required'}), 400

    mp3_bytes      = request.files['audio'].read()
    alert_id       = int(request.form.get('alert_id', 0))
    alert_category = request.form.get('alert_category', 'Normal').strip()
    lang_code      = request.form.get('lang_code', 'EN').strip()

    if not mp3_bytes:
        return jsonify({'error': 'empty audio'}), 400

    return jsonify(_enqueue_play(alert_id, alert_category, lang_code, mp3_bytes))


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
                log.info(f"[Queue] alert={alert_id} interval {old}s→{repeat_interval}s")
                break

    return jsonify({'updated':updated,'alert_id':alert_id,
                    'repeat_interval':repeat_interval})


@app.route('/queue', methods=['GET'])
def queue_status():
    with _queue_lock:
        items=[{k:v for k,v in i.items() if k!='audio_path'} for i in _queue]
    return jsonify({
        'depth':            len(items),
        'critical_active':  bool(_unacked_criticals()),
        'currently_playing': _playing[0],
        'items':            items,
    })


@app.route('/restart', methods=['POST'])
def restart():
    """
    Soft restart — clears the playback queue and resets state.
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
    log.info(f"[Queue] Restart requested — cleared {cleared} item(s)")
    return jsonify({'restarted': True, 'cleared': cleared, 'ts': time.time()})


@app.route('/health', methods=['GET'])
def health():
    with _queue_lock: depth=len(_queue)
    return jsonify({
        'status':            'ok',
        'queue_depth':       depth,
        'critical_active':   bool(_unacked_criticals()),
        'currently_playing': _playing[0],
        'audio_device':      _get_audio_device() or 'default',
        'high_repeat_sec':   HIGH_REPEAT_SEC,
        'paging_active':     _paging_active[0],
        **_sys_info(),
    })


# ══════════════════════════════════════════════════════════════════════════════
# Live voice paging — WebSocket ingest (D4)
# ══════════════════════════════════════════════════════════════════════════════

@sock.route('/paging/ws')
def paging_ws(ws):
    """
    Receives chunked audio (binary frames, whatever container/codec the
    browser's MediaRecorder produced — typically WebM/Opus) forwarded by
    flask_backend.py's paging relay, and pipes it live into ffmpeg for
    near-real-time playback on this node's audio device.

    Only one paging session per node at a time — normal queued alert
    playback is held (see _worker's paging_active check) for the duration.
    """
    with _paging_lock:
        if _paging_active[0]:
            ws.close(reason=1013, message='Paging session already active on this node')
            return
        _paging_active[0] = True

    # ── Arbitrate with queued-alert playback before starting the live page ──
    # HIGH/NORMAL/LOW currently playing: interrupt it immediately.
    # CRITICAL currently playing: wait for it to finish, capped at 45s, then
    # proceed with paging anyway — never permanently block an operator.
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
                         "alert to finish — aborting session")
                return
            continue

        if cur_proc is not None:
            # High/Normal/Low currently playing — preempt it immediately.
            # This causes _play_file's proc.wait() to return with a negative
            # returncode, which _play_file/_play_item/_worker treat as 'interrupted'.
            try:
                cur_proc.terminate()
            except Exception:
                pass
        break

    device = _get_audio_device()
    cmd = ['ffmpeg', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'alsa',
          device if device else 'default']
    log.info(f"[Paging] Session start — device={device or 'default'}")

    proc = None
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while True:
            try:
                data = ws.receive(timeout=30)
            except ConnectionClosed:
                break
            if data is None:
                break
            if isinstance(data, (bytes, bytearray)):
                try:
                    proc.stdin.write(data)
                    proc.stdin.flush()
                except (BrokenPipeError, OSError):
                    log.warning("[Paging] ffmpeg pipe closed unexpectedly")
                    break
            # Ignore text control frames (e.g. a client-side keepalive ping)
    except Exception as e:
        log.error(f"[Paging] Session error: {e}")
    finally:
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


# ══════════════════════════════════════════════════════════════════════════════
# Local dashboard (D6) — basic HTML/JS status page + SOP acknowledgement.
# Proxies SOP/alert-type lookups to the Main Gateway (server-to-server, no
# session auth needed here — same trust model as /play, /acknowledge etc).
# ══════════════════════════════════════════════════════════════════════════════

def _gateway(method: str, path: str, timeout=5, **kwargs) -> dict:
    try:
        resp = requests.request(method, f"{GATEWAY_URL}{path}", timeout=timeout, **kwargs)
        return resp.json()
    except Exception as e:
        return {"ok": False, "error": f"Gateway unreachable: {e}"}


@app.route('/dashboard/alert-info', methods=['GET'])
def dashboard_alert_info():
    alert_id = request.args.get('alert_id', type=int)
    if not alert_id:
        return jsonify({'ok': False, 'error': 'alert_id required'}), 400
    return jsonify(_gateway('GET', '/audio-alerts/edge/alert-info', params={'alert_id': alert_id}))


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
  .msg { font-size: 13px; color: #cbd5e1; margin-top: 8px; line-height: 1.4; }
  .ack-state { font-size: 12px; margin-top: 8px; }
  .ack-state.pending { color: #fbbf24; }
  .ack-state.success { color: #4ade80; }
  .ack-state.error { color: #f87171; }
</style>
</head>
<body>
  <h1>Edge Node Dashboard</h1>
  <div class="zone">Zone: <strong id="zoneId">%(zone_id)s</strong> &middot; Gateway: <span id="gwStatus" class="pill idle">checking…</span></div>

  <div class="card">
    <h2>Currently Playing</h2>
    <div class="row"><span class="k">Alert type</span><span id="npType">—</span></div>
    <div class="row"><span class="k">Name</span><span id="npName">—</span></div>
    <div class="row"><span class="k">Playback status</span><span id="npStatus" class="pill idle">idle</span></div>
    <div class="row"><span class="k">Queue depth</span><span id="npQueue">0</span></div>
  </div>

  <div class="card">
    <h2>Live Voice Paging</h2>
    <div class="row"><span class="k">Status</span><span id="pagingStatus" class="pill idle">idle</span></div>
  </div>

  <div class="card" id="sopCard" style="display:none">
    <h2>SOP — Standard Operating Procedure</h2>
    <div class="row"><span class="k">Procedure</span><span id="sopName">—</span></div>
    <div class="row"><span class="k">Step</span><span id="sopStep">—</span></div>
    <div class="msg" id="sopMessage"></div>
    <div id="sopAckArea" style="margin-top:12px"></div>
  </div>

  <div class="card">
    <h2>Node Health</h2>
    <div class="row"><span class="k">CPU temp</span><span id="cpuTemp">—</span></div>
    <div class="row"><span class="k">Memory used</span><span id="memPct">—</span></div>
    <div class="row"><span class="k">Uptime</span><span id="uptime">—</span></div>
  </div>

<script>
const ZONE_ID = %(zone_id_json)s;
let ackInFlight = false;

function fmtUptime(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec %% 3600) / 60);
  return h + "h " + m + "m";
}

async function refreshHealth() {
  try {
    const res = await fetch('/health');
    const h = await res.json();
    document.getElementById('npQueue').textContent = h.queue_depth ?? 0;
    document.getElementById('cpuTemp').textContent = h.cpu_temp_c != null ? h.cpu_temp_c + ' °C' : '—';
    document.getElementById('memPct').textContent = h.mem_percent != null ? h.mem_percent + '%%' : '—';
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
      document.getElementById('npType').textContent = '—';
      document.getElementById('npName').textContent = '—';
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

async function refreshSop() {
  const gwEl = document.getElementById('gwStatus');
  const sopCard = document.getElementById('sopCard');
  if (!ZONE_ID) {
    gwEl.textContent = 'no zone configured';
    gwEl.className = 'pill warn';
    return;
  }
  const res = await fetchJSON('/dashboard/sop-status');
  if (!res.ok) {
    gwEl.textContent = 'unreachable';
    gwEl.className = 'pill bad';
    return;
  }
  gwEl.textContent = 'connected';
  gwEl.className = 'pill ok';

  if (!res.data) {
    sopCard.style.display = 'none';
    return;
  }
  sopCard.style.display = 'block';
  const ex = res.data;
  document.getElementById('sopName').textContent = ex.sop_name || '—';
  document.getElementById('sopStep').textContent =
    'Step ' + ex.current_step_number + ' of ' + ex.total_steps + ' — ' + ex.status.replace(/_/g, ' ');
  document.getElementById('sopMessage').textContent = ex.current_step ? (ex.current_step.message || '') : '';

  const ackArea = document.getElementById('sopAckArea');
  if (ex.needs_ack && !ackInFlight) {
    ackArea.innerHTML = '<button id="ackBtn">Acknowledge</button><div id="ackState" class="ack-state"></div>';
    document.getElementById('ackBtn').onclick = () => doAck(ex.id);
  } else if (!ex.needs_ack) {
    ackArea.innerHTML = '';
  }
}

async function doAck(executionId) {
  if (ackInFlight) return;
  ackInFlight = true;
  const ackState = document.getElementById('ackState');
  const btn = document.getElementById('ackBtn');
  if (btn) btn.disabled = true;
  if (ackState) { ackState.textContent = 'Sending acknowledgement…'; ackState.className = 'ack-state pending'; }

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
  }
  ackInFlight = false;
  setTimeout(refreshSop, 1000);
}

refreshHealth(); refreshSop();
setInterval(refreshHealth, 3000);
setInterval(refreshSop, 3000);
</script>
</body>
</html>
"""


@app.route('/dashboard', methods=['GET'])
def dashboard():
    # Flask serves a plain string return as text/html by default — no
    # Response/mimetype needed.
    return _DASHBOARD_HTML % {
        'zone_id': ZONE_ID or '(not configured)',
        'zone_id_json': json.dumps(ZONE_ID),
    }


if __name__=='__main__':
    log.info("="*55)
    log.info("  Edge Node")
    log.info(f"  Listen    : http://{SERVER_HOST}:{SERVER_PORT}")
    log.info(f"  Audio dir : {AUDIO_FILES_DIR}")
    log.info(f"  Critical  : round-robin until all acked")
    log.info(f"  High      : replay every {HIGH_REPEAT_SEC}s until acked")
    log.info(f"  Normal/Low: play once, auto-ack")
    log.info(f"  Priority  : Critical>High>Normal>Low")
    log.info("="*55)
    app.run(host=SERVER_HOST, port=SERVER_PORT, threaded=True)
