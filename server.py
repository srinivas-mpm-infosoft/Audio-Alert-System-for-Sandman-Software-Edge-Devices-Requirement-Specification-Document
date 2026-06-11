#!/usr/bin/env python3
"""
server.py — Audio Alert Receiver for Raspberry Pi / Gateway device
Uses cvlc --play-and-exit (same command that works manually).
Priority queue, no audio overlap.

Install:
  sudo apt install vlc-bin alsa-utils
  pip install flask

Endpoints:
  POST /play        — queue audio file (returns immediately)
  POST /acknowledge — remove from queue
  GET  /status      — queue + system info
  GET  /health      — liveness
"""

import os
import time
import heapq
import logging
import tempfile
import subprocess
import threading
import argparse
import socket
import uuid
from dataclasses import dataclass
from typing import Optional

from flask import Flask, request, jsonify

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)-7s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('alert-server')

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
AUDIO_SAVE_DIR   = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'received_audio'
)
PRIORITY_LEVELS = {'critical': 4, 'high': 3, 'medium': 2, 'low': 1}


# ══════════════════════════════════════════════════════════════════════════════
# Queue item
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class QueueItem:
    priority    : int
    seq         : int
    alert_id    : str
    path        : str
    filename    : str
    acknowledged: bool = False

    def __lt__(self, other):
        if self.priority != other.priority:
            return self.priority > other.priority
        return self.seq < other.seq
    def __eq__(self, other): return self.seq == other.seq
    def __le__(self, other): return self == other or self < other
    def __gt__(self, other): return not self <= other
    def __ge__(self, other): return not self < other


# ══════════════════════════════════════════════════════════════════════════════
# Audio player — exact same cvlc command as manual usage
# ══════════════════════════════════════════════════════════════════════════════

class AudioPlayer:
    def __init__(self):
        self._proc    : Optional[subprocess.Popen] = None
        self._lock    = threading.Lock()
        self._current : Optional[str] = None
        self._started : float = 0.0

    def play_blocking(self, path: str) -> bool:
        """
        Play file using cvlc and BLOCK until done.
        Uses the exact same command as running manually in terminal.
        """
        self.stop()
        ext = os.path.splitext(path)[1].lower()

        if ext == '.wav':
            cmd = ['aplay', '-q', path]
        else:
            # Exact same as: cvlc --play-and-exit file.mp3
            cmd = ['cvlc', '--play-and-exit', '--no-video', '--quiet', path]

        log.info(f"[Play] {' '.join(cmd)}")
        try:
            with self._lock:
                self._proc    = subprocess.Popen(
                    cmd,
                    stdout = subprocess.DEVNULL,
                    stderr = subprocess.PIPE,
                )
                self._current = path
                self._started = time.time()

            # Capture stderr for debugging
            stderr_out = self._proc.communicate()[1].decode(errors='replace').strip()
            rc         = self._proc.returncode

            with self._lock:
                self._proc    = None
                self._current = None

            if rc == 0:
                log.info(f"[Play] Done ✓  {os.path.basename(path)}")
            else:
                log.warning(f"[Play] cvlc exit={rc}")
                if stderr_out:
                    # Filter VLC's verbose noise, only show real errors
                    errors = [l for l in stderr_out.splitlines()
                              if any(w in l.lower() for w in
                                     ('error', 'failed', 'cannot', 'no such',
                                      'unable', 'invalid', 'access'))]
                    if errors:
                        log.warning(f"[Play] cvlc errors: {errors[:3]}")
            return rc == 0

        except FileNotFoundError as exc:
            player = cmd[0]
            pkg    = 'vlc-bin' if player == 'cvlc' else 'alsa-utils'
            log.error(f"[Play] '{player}' not found — sudo apt install {pkg}")
            return False
        except Exception as exc:
            log.error(f"[Play] Error: {exc}")
            return False

    def stop(self) -> None:
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()
                try:    self._proc.wait(timeout=2)
                except subprocess.TimeoutExpired: self._proc.kill()
            self._proc    = None
            self._current = None

    def current_file(self) -> Optional[str]:
        with self._lock:
            return os.path.basename(self._current) if self._current else None

    def elapsed(self) -> float:
        with self._lock:
            return round(time.time() - self._started, 1) if self._current else 0.0


# ══════════════════════════════════════════════════════════════════════════════
# Alert queue — single background thread, no overlap
# ══════════════════════════════════════════════════════════════════════════════

class AlertQueue:
    def __init__(self):
        self._heap   : list = []
        self._lock   = threading.Lock()
        self._event  = threading.Event()
        self._seq    = 0
        self._items  : dict = {}
        self._player = AudioPlayer()
        threading.Thread(target=self._loop, daemon=True, name='playback').start()
        log.info("[Queue] Playback worker started")

    def add(self, alert_id: str, path: str, filename: str, priority: int = 1) -> str:
        item = QueueItem(priority=priority, seq=self._seq,
                         alert_id=alert_id, path=path, filename=filename)
        with self._lock:
            self._seq += 1
            heapq.heappush(self._heap, item)
            self._items[alert_id] = item
        log.info(f"[Queue] +{alert_id[:8]}  prio={priority}  depth={len(self._heap)}")
        self._event.set()
        return alert_id

    def acknowledge(self, alert_id: str) -> bool:
        with self._lock:
            item = self._items.get(alert_id)
            if not item: return False
            item.acknowledged = True
        log.info(f"[Queue] Acked {alert_id[:8]}")
        return True

    def status(self) -> dict:
        with self._lock:
            items = sorted(self._heap)
        return {
            'currently_playing': self._player.current_file(),
            'elapsed_sec'      : self._player.elapsed(),
            'queue_length'     : len(items),
            'queue'            : [
                {'alert_id': i.alert_id, 'filename': i.filename,
                 'priority': i.priority, 'acknowledged': i.acknowledged}
                for i in items
            ],
        }

    def _next(self) -> Optional[QueueItem]:
        with self._lock:
            while self._heap:
                item = heapq.heappop(self._heap)
                self._items.pop(item.alert_id, None)
                if not item.acknowledged:
                    return item
                try: os.unlink(item.path)
                except OSError: pass
        return None

    def _loop(self) -> None:
        while True:
            item = self._next()
            if item is None:
                self._event.clear()
                self._event.wait(timeout=1.0)
                continue
            log.info(f"[Queue] Playing: {item.filename}  priority={item.priority}")
            self._player.play_blocking(item.path)
            try: os.unlink(item.path)
            except OSError: pass


queue    = AlertQueue()
_start_t = time.time()
app      = Flask(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# System info (no psutil needed — uses /proc)
# ══════════════════════════════════════════════════════════════════════════════

def _sys_info() -> dict:
    info: dict = {}
    try: info['hostname'] = socket.gethostname()
    except Exception: pass

    # Memory
    try:
        mem = {}
        for line in open('/proc/meminfo'):
            k, v = line.split(':')
            mem[k.strip()] = int(v.split()[0])
        total = mem.get('MemTotal', 0)
        avail = mem.get('MemAvailable', 0)
        used  = total - avail
        if total:
            info['ram_total_mb'] = round(total/1024, 1)
            info['ram_used_mb']  = round(used/1024,  1)
            info['ram_free_mb']  = round(avail/1024, 1)
            info['ram_pct']      = round(100*used/total, 1)
    except Exception: pass

    # Load
    try:
        parts = open('/proc/loadavg').read().split()
        info['load_1m'], info['load_5m'] = float(parts[0]), float(parts[1])
    except Exception: pass

    # Temperature
    for p in ['/sys/class/thermal/thermal_zone0/temp',
              '/sys/class/hwmon/hwmon0/temp1_input']:
        try:
            v = open(p).read().strip()
            if v.isdigit():
                info['cpu_temp_c'] = round(int(v)/1000, 1)
                break
        except Exception: pass

    return info


# ══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/play', methods=['POST'])
def play():
    if 'audio' not in request.files:
        return jsonify(error="'audio' field required"), 400
    f = request.files['audio']
    if not f.filename:
        return jsonify(error="No file"), 400

    f.stream.seek(0, 2); size = f.stream.tell(); f.stream.seek(0)
    if size > MAX_UPLOAD_BYTES:
        return jsonify(error="File too large"), 413

    prio_str   = request.form.get('priority', 'low').lower()
    prio_int   = PRIORITY_LEVELS.get(prio_str, 1)
    alert_id   = request.form.get('alert_id') or str(uuid.uuid4())
    ext        = (os.path.splitext(f.filename)[1] or '.mp3').lower()
    audio_data = f.read()

    # Save permanent copy
    if AUDIO_SAVE_DIR:
        try:
            os.makedirs(AUDIO_SAVE_DIR, exist_ok=True)
            save = os.path.join(AUDIO_SAVE_DIR, f"{time.strftime('%Y%m%d_%H%M%S')}_{f.filename}")
            with open(save, 'wb') as fh: fh.write(audio_data)
            log.info(f"[Save] {save}  ({len(audio_data)//1024}KB)")
        except Exception as e:
            log.warning(f"[Save] {e}")

    # Write temp file for playback
    fd, tmp = tempfile.mkstemp(suffix=ext, prefix='alert_', dir='/tmp')
    os.close(fd)
    with open(tmp, 'wb') as fh: fh.write(audio_data)

    queue.add(alert_id, tmp, f.filename, priority=prio_int)
    log.info(f"[API] queued {f.filename}  {size//1024}KB  prio={prio_str}")
    return jsonify(status='queued', alert_id=alert_id,
                   filename=f.filename, size_kb=size//1024,
                   priority=prio_str, queue_depth=len(queue._heap)), 200


@app.route('/acknowledge', methods=['POST'])
def acknowledge():
    body     = request.get_json(silent=True) or {}
    alert_id = str(body.get('alert_id', '')).strip()
    if not alert_id:
        return jsonify(error="'alert_id' required"), 400
    return (jsonify(status='acknowledged', alert_id=alert_id)
            if queue.acknowledge(alert_id)
            else (jsonify(error="not found"), 404))


@app.route('/status', methods=['GET'])
def status():
    q = queue.status()
    q['server_uptime_sec'] = round(time.time() - _start_t, 1)
    q['system'] = _sys_info()
    return jsonify(q)


@app.route('/health', methods=['GET'])
def health():
    return jsonify(status='ok',
                   uptime_sec=round(time.time() - _start_t, 1),
                   hostname=socket.gethostname())


# ══════════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=5000)
    args = ap.parse_args()

    # Check tools
    for tool, pkg in [('cvlc', 'vlc-bin'), ('aplay', 'alsa-utils')]:
        r = subprocess.run(['which', tool], capture_output=True)
        s = f"✓ {r.stdout.decode().strip()}" if r.returncode == 0 else f"✗ NOT FOUND — sudo apt install {pkg}"
        log.info(f"[Init] {tool}: {s}")

    log.info("=" * 50)
    log.info(f"  http://{args.host}:{args.port}")
    log.info(f"  MP3 → cvlc --play-and-exit")
    log.info(f"  WAV → aplay -q")
    log.info(f"  POST /play  →  queued, returns immediately")
    log.info(f"  Save dir: {AUDIO_SAVE_DIR}")
    log.info("=" * 50)

    app.run(host=args.host, port=args.port, threaded=True)