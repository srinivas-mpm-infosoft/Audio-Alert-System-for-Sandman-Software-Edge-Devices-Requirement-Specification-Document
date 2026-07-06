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
  GET  /queue               — view queue
  GET  /health
"""

import logging
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from flask import Flask, request, jsonify

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

SERVER_HOST     = '0.0.0.0'
SERVER_PORT     = 5000
AUDIO_FILES_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / 'audio_files'
HIGH_REPEAT_SEC = 20.0   # seconds between High alert replays

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
# Playback
# ══════════════════════════════════════════════════════════════════════════════

_playing=[None]; _play_lock=Lock()

def _play_file(audio_path: str, alert_id: int, alert_category: str) -> bool:
    """Play audio file via cvlc. Blocks until done. Returns True on success."""
    device=_get_audio_device()
    cmd=['cvlc','--play-and-exit','--quiet']
    if device: cmd+=['--aout=alsa',f'--alsa-audio-device={device}']
    cmd.append(audio_path)
    with _play_lock: _playing[0]=alert_id
    t0=time.monotonic()
    log.info(f"[Play] START alert={alert_id} cat={alert_category}  "
             f"device={device or 'default'}")
    try:
        r=subprocess.run(cmd,stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL,timeout=120)
        log.info(f"[Play] DONE  alert={alert_id}  "
                 f"{time.monotonic()-t0:.2f}s  code={r.returncode}")
        return r.returncode==0
    except FileNotFoundError: log.error("[Play] cvlc not found — sudo apt install vlc")
    except subprocess.TimeoutExpired: log.error(f"[Play] Timeout alert={alert_id}")
    except Exception as e: log.error(f"[Play] Error: {e}")
    finally:
        with _play_lock: _playing[0]=None
    return False

def _play_item(item: dict) -> None:
    item['last_played_at']=time.monotonic()
    item['play_count']=item.get('play_count',0)+1
    _play_file(item['audio_path'], item['alert_id'], item['alert_category'])

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
            _play_item(normal)
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

# ══════════════════════════════════════════════════════════════════════════════
# Flask app
# ══════════════════════════════════════════════════════════════════════════════

app = Flask(__name__)


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
    priority       = PRIORITY_MAP.get(alert_category, 2)

    if not mp3_bytes:
        return jsonify({'error': 'empty audio'}), 400

    # Reject duplicate
    with _queue_lock:
        if any(i['alert_id']==alert_id and not i['acknowledged'] for i in _queue):
            log.info(f"[Queue] alert={alert_id} already queued")
            return jsonify({'queued': False, 'reason': 'duplicate'}), 200

    # Save to disk
    audio_path = str(AUDIO_FILES_DIR / f"{alert_id}.mp3")
    try:
        with open(audio_path, 'wb') as f: f.write(mp3_bytes)
        log.info(f"[Play] Saved {len(mp3_bytes)//1024}KB → {audio_path}")
    except Exception as e:
        log.error(f"[Play] Save failed: {e}")
        return jsonify({'error': str(e)}), 500

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

    with _queue_lock:
        _queue.append(item); depth=len(_queue)

    log.info(f"[Queue] Enqueued alert={alert_id} cat={alert_category} "
             f"priority={priority}  depth={depth}")

    return jsonify({
        'queued':          True,
        'alert_id':        alert_id,
        'alert_category':  alert_category,
        'priority':        priority,
        'queue_depth':     depth,
        'critical_active': bool(_unacked_criticals()),
    })


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

    return jsonify({
        'acknowledged':   removed,
        'alert_id':       alert_id,
        'critical_active': bool(_unacked_criticals()),
    })


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
    })


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
