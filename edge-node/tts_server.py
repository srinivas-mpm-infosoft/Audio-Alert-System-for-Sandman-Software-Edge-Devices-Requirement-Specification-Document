"""
tts_server.py  —  Translate + TTS + Deliver to Edge Node
─────────────────────────────────────────────────────────
POST /synthesise
  1. Cache check (text + lang) → instant return if hit
  2. Translate via Gemini (code-switching style)
  3. TTS via Voicemaker WebSocket (one fresh connection per request)
  4. POST audio synchronously to edge node /play
  5. Return MP3 + delivery receipt headers to caller

The delivery is SYNCHRONOUS — /synthesise blocks until edge node confirms
receipt. This lets alert_poller log real edge_delivered / audio_played status.

Local playback on TTS server machine (PLAY_LOCALLY) runs in a background
queue so it never blocks the HTTP response.

POST /note-acknowledge
  Forward acknowledge from alert_poller to edge node /acknowledge.

GET  /health  GET /langs  GET /cache/stats  POST /cache/clear
"""

import base64
import datetime
import hashlib
import io
import json
import logging
import os
import queue as _queue_module
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from threading import Lock
from typing import Optional, List

import requests
import websocket
import pymysql
import pymysql.cursors
from flask import Flask, request, jsonify, Response
from google import genai

# ══════════════════════════════════════════════════════════════════════════════
# USER CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

GEMINI_API_KEY     = os.getenv('GEMINI_API_KEY',     'AQ.Ab8RN6Ky1pwWr6mT37cQBdIyWIW2XHfVvfe7RF8T9m1I12D6Hg')
VOICEMAKER_API_KEY = os.getenv('VOICEMAKER_API_KEY', '8c19dc20-12aa-11ef-8d6e-49a96d622f69')

TTS_GENDER    = 'male'
AUDIO_SPEED   = 1.1
PLAY_LOCALLY  = True     # also play on TTS server machine
AUDIO_DEVICE  = None     # e.g. 'hw:1,0' — None = auto-detect USB
SERVER_HOST   = '0.0.0.0'
SERVER_PORT   = 6000

EDGE_NODE_PORT        = 5000
EDGE_NODE_PLAY        = '/play'
EDGE_NODE_ACKNOWLEDGE = '/acknowledge'
EDGE_TIMEOUT_SEC      = 10   # seconds to wait for edge /play response

# --- MariaDB (zones / devices lookup) ---
DB_HOST     = os.getenv('DB_HOST',     'localhost')
DB_PORT     = int(os.getenv('DB_PORT', '3306'))
DB_USER     = os.getenv('DB_USER',     'gateway')
DB_PASSWORD = os.getenv('DB_PASSWORD', 'gateway')
DB_NAME     = os.getenv('DB_NAME',     'gateway')

# ══════════════════════════════════════════════════════════════════════════════
# PATHS
# ══════════════════════════════════════════════════════════════════════════════

_BASE     = Path(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = _BASE / 'audio_cache'
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ══════════════════════════════════════════════════════════════════════════════
# INTERNAL CONFIG
# ══════════════════════════════════════════════════════════════════════════════

GEMINI_TRANS_MODELS = [
    'models/gemini-3.1-flash-lite',
    'models/gemini-2.5-flash-lite',
    'models/gemini-2.5-flash',
]

_VOICEMAKER_VOICES = {
    'male': {
        'TE': ('ai3-te-IN-Mohan',  'te-IN'),
        'HI': ('ai2-hi-IN-Nikhil', 'hi-IN'),
        'BN': ('ai2-bn-IN-Binod',  'bn-IN'),
        'GU': ('ai2-gu-IN-Varun',  'gu-IN'),
        'MR': ('ai2-mr-IN-Rohan',  'mr-IN'),
        'TA': ('ai2-ta-IN-Vihan',  'ta-IN'),
        'KN': ('ai2-kn-IN-Aadi',   'kn-IN'),
        'ML': ('ai2-ml-IN-Ashok',  'ml-IN'),
        '_default': ('ai3-Jony',   'en-US'),
    },
    'female': {
        'TE': ('ai3-te-IN-Shruti', 'te-IN'),
        '_default': ('ai3-Aria',   'en-US'),
    },
}

LANG_MAP = {
    'EN': ('en','com','English'),         'HI': ('hi','co.in','Hindi'),
    'TA': ('ta','co.in','Tamil'),         'TE': ('te','co.in','Telugu'),
    'BN': ('bn','co.in','Bengali'),       'MR': ('mr','co.in','Marathi'),
    'GU': ('gu','co.in','Gujarati'),      'KN': ('kn','co.in','Kannada'),
    'ML': ('ml','co.in','Malayalam'),     'PA': ('pa','co.in','Punjabi'),
    'UR': ('ur','co.in','Urdu'),          'NE': ('ne','co.in','Nepali'),
    'DE': ('de','de','German'),           'FR': ('fr','fr','French'),
    'ES': ('es','es','Spanish'),          'IT': ('it','it','Italian'),
    'JA': ('ja','co.jp','Japanese'),      'ZH': ('zh-CN','com','Chinese Simplified'),
    'KO': ('ko','co.kr','Korean'),        'AR': ('ar','com','Arabic'),
    'RU': ('ru','ru','Russian'),          'TR': ('tr','com.tr','Turkish'),
    'NL': ('nl','nl','Dutch'),            'PL': ('pl','pl','Polish'),
    'SV': ('sv','se','Swedish'),          'NO': ('no','no','Norwegian'),
}

VOICEMAKER_WS_URL = 'wss://developer.voicemaker.in/api/v1/voice/convert'

logging.getLogger('websocket').setLevel(logging.WARNING)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)-7s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# Gemini client singleton
# ══════════════════════════════════════════════════════════════════════════════

_gemini_client = None
_gemini_lock   = Lock()

def get_gemini() -> genai.Client:
    global _gemini_client
    with _gemini_lock:
        if _gemini_client is None:
            _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


# ══════════════════════════════════════════════════════════════════════════════
# Rate limiter
# ══════════════════════════════════════════════════════════════════════════════

class TokenBucket:
    def __init__(self, max_tokens: float, refill_rate: float):
        self._max = max_tokens; self._rate = refill_rate
        self._tokens = max_tokens; self._last = time.monotonic(); self._lock = Lock()
    def acquire(self):
        while True:
            with self._lock:
                now = time.monotonic()
                self._tokens = min(self._max, self._tokens + (now-self._last)*self._rate)
                self._last = now
                if self._tokens >= 1.0:
                    self._tokens -= 1.0; return
                wait = (1.0 - self._tokens) / self._rate
            time.sleep(min(wait, 1.0))

_trans_bucket   = TokenBucket(max_tokens=15, refill_rate=15/60)
_trans_slow     : dict = {}
_TRANS_SKIP_SEC = 300

def _trans_is_slow(m): return m in _trans_slow and time.monotonic()-_trans_slow[m] < _TRANS_SKIP_SEC
def _trans_mark_slow(m):
    _trans_slow[m] = time.monotonic()
    log.warning(f"[Trans] {m} slow — skip {_TRANS_SKIP_SEC//60}min")


# ══════════════════════════════════════════════════════════════════════════════
# Disk cache
# ══════════════════════════════════════════════════════════════════════════════

def _cache_path(text: str, lang_code: str) -> Path:
    key = hashlib.sha1(f"{lang_code}:{text}".encode()).hexdigest()[:12]
    d   = CACHE_DIR / lang_code
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{lang_code}_{key}.mp3"

def cache_get(text: str, lang_code: str) -> Optional[bytes]:
    p = _cache_path(text, lang_code)
    if p.exists() and p.stat().st_size > 512:
        log.info(f"[Cache] HIT [{lang_code}] \"{text[:45]}\"  ({p.stat().st_size//1024}KB)")
        return p.read_bytes()
    return None

def cache_put(text: str, lang_code: str, mp3: bytes) -> None:
    if not mp3: return
    p = _cache_path(text, lang_code)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(mp3)
    log.info(f"[Cache] PUT [{lang_code}] \"{text[:45]}\"  ({len(mp3)//1024}KB)")

def cache_stats() -> dict:
    stats = {}; total_c = 0; total_kb = 0
    for d in sorted(CACHE_DIR.iterdir()):
        if d.is_dir():
            files = list(d.glob('*.mp3'))
            kb    = sum(f.stat().st_size for f in files) // 1024
            stats[d.name] = {'count': len(files), 'size_kb': kb}
            total_c += len(files); total_kb += kb
    stats['_total'] = {'count': total_c, 'size_kb': total_kb}
    return stats


# ══════════════════════════════════════════════════════════════════════════════
# Translation
# ══════════════════════════════════════════════════════════════════════════════

_trans_cache : dict = {}
_trans_lock  = Lock()


def _clean_translation(text: str, lang_code: str) -> str:
    """Remove backticks, English in parentheses after native chars, mixed-script words."""
    text = text.replace('`', '')
    LATIN = {'EN','DE','FR','ES','IT','PT','NL','PL','SV','NO','RU','TR'}
    if lang_code not in LATIN:
        text = re.sub(
            r'(?<=[\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF\u0A80-\u0AFF'
            r'\u0C80-\u0CFF\u0B00-\u0B7F\u0600-\u06FF])\s*\([A-Za-z][^)]*\)',
            '', text)
        def _cw(w):
            if any(ord(c)>127 for c in w) and re.search(r'[A-Za-z]',w):
                return re.sub(r'[A-Za-z]','',w)
            return w
        text = ' '.join(_cw(w) for w in text.split())
    return re.sub(r' {2,}',' ',text).strip()


def translate_text(text: str, lang_code: str,
                   no_translate_words: Optional[List[str]] = None) -> str:
    """
    Translate English → target language using Gemini, code-switching style.
    Skips pure numbers / dates / alphanumeric codes.
    Returns cached result if available.
    """
    if lang_code == 'EN' or not text.strip():
        return text

    # Skip if all tokens are numeric/code/abbreviation
    tokens = text.strip().split()
    all_skip = True
    for tok in tokens:
        cl = re.sub(r'[^\w]','',tok)
        if not cl: continue
        hd = bool(re.search(r'\d',cl)); hl = bool(re.search(r'[A-Za-z]',cl))
        hn = any(ord(c)>127 for c in cl)
        if hn: all_skip=False; break
        if hl and not hd and not (cl.isupper() and len(cl)<=6):
            all_skip=False; break
    if all_skip and tokens:
        log.info(f"[Trans] Skip [{lang_code}] code/numeric: \"{text.strip()}\"")
        return text.strip()

    _, _, lang_name = LANG_MAP.get(lang_code, ('en','com','English'))
    nt_words  = no_translate_words or []
    cache_key = (text.strip(), lang_code)
    with _trans_lock:
        if cache_key in _trans_cache:
            return _trans_cache[cache_key]

    nt_sample       = ', '.join(nt_words[:25]) or 'none'
    text_for_prompt = text.strip().title() if text.isupper() else text.strip()

    prompt = (
        f"You are helping translate factory/industrial alert messages for workers "
        f"in India who speak {lang_name} at work.\n\n"
        f"These workers naturally mix English industry words into their {lang_name} "
        f"speech — just like how people actually talk on the factory floor.\n\n"
        f"RULES:\n"
        f"1. Keep ALL industry/technical words in English as-is — do NOT translate them.\n"
        f"   Always keep in English: sand, burn, loss, furnace, temperature, mill, mixer, "
        f"moisture, addition, compressor, pressure, sensor, gate, zone, data, SCADA, PLC, "
        f"RPM, pH, check, high, low, alert, alarm, acknowledge, limit, count, speed, "
        f"level, reading, new sand, loss on ignition.\n"
        f"   Also keep in English: {nt_sample}\n"
        f"2. Only translate connecting/conversational words to {lang_name} — "
        f"is, are, has, in, the, please, and, to, for, received, present, only, last, "
        f"minutes, people, has been, has not, there is.\n"
        f"3. Result must sound like a bilingual factory worker speaking naturally.\n"
        f"4. Numbers, dates, symbols: keep exactly as-is.\n"
        f"5. Output ONLY the mixed text. No explanations.\n\n"
        f"Examples:\n"
        f"  EN: Sand burn loss is high, please check new sand addition.\n"
        f"  TE: Sand burn loss high గా ఉంది, new sand addition check చేయండి.\n"
        f"  HI: Sand burn loss high है, new sand addition check करो.\n\n"
        f"  EN: No SCADA data received in the last 90 minutes.\n"
        f"  TE: చివరి 90 minutes లో SCADA data రాలేదు.\n"
        f"  HI: पिछले 90 minutes में SCADA data नहीं आया।\n\n"
        f"  EN: 10 people are present, only 2 is the limit.\n"
        f"  TE: 10 people ఉన్నారు, limit కేవలం 2 మాత్రమే.\n\n"
        f"Now translate:\nText: {text_for_prompt}"
    )

    client  = get_gemini()
    t_total = time.monotonic()
    for model in GEMINI_TRANS_MODELS:
        if _trans_is_slow(model): continue
        _trans_bucket.acquire()
        log.info(f"[Trans] [{model}] → {lang_name}: \"{text[:50]}\" …")
        t0 = time.monotonic()
        try:
            result=[None]; err=[None]
            def _call():
                try: result[0]=client.models.generate_content(model=model,contents=prompt).text.strip()
                except Exception as e: err[0]=e
            th=threading.Thread(target=_call,daemon=True); th.start(); th.join(timeout=8)
            if th.is_alive(): _trans_mark_slow(model); continue
            if err[0]: raise err[0]
            raw=result[0]; translated=_clean_translation(raw,lang_code)
            elapsed=time.monotonic()-t0
            if translated!=raw: log.warning(f"[Trans] Cleaned artefacts: \"{raw[:50]}\"")
            if translated.lower().strip()==text.lower().strip():
                log.warning(f"[Trans] {model} unchanged ({elapsed:.2f}s) — retry"); continue
            log.info(f"[Trans] {model} {elapsed:.2f}s → \"{translated[:55]}\"")
            with _trans_lock: _trans_cache[cache_key]=translated
            return translated
        except Exception as exc:
            s=str(exc)
            if '429' in s or 'RESOURCE_EXHAUSTED' in s or '503' in s:
                import re as _re; m2=_re.search(r'"retryDelay"\s*:\s*"(\d+)s"',s)
                wait=min(int(m2.group(1))+2 if m2 else 10,60)
                log.warning(f"[Trans] Rate limit {model} — wait {wait}s"); time.sleep(wait)
            else: log.warning(f"[Trans] {model} error: {s[:60]}")
    log.error(f"[Trans] All models failed ({time.monotonic()-t_total:.2f}s) — original")
    return text


# ══════════════════════════════════════════════════════════════════════════════
# TTS text prep — spell out alphanumeric codes for Indian voices
# ══════════════════════════════════════════════════════════════════════════════

def _prepare_tts_text(text: str, lang_code: str) -> str:
    """Spell out mixed alphanumeric codes so Indian voices read them char-by-char."""
    LATIN = {'EN','DE','FR','ES','IT','PT','NL','PL','SV','NO','RU','TR'}
    if lang_code in LATIN: return text
    def _needs(w):
        hd=bool(re.search(r'\d',w)); hl=bool(re.search(r'[A-Za-z]',w))
        hn=any(ord(c)>127 for c in w)
        if hn: return False
        if hd and hl: return True
        if hl and w.isupper() and len(w)<=4: return True
        return False
    result=[]
    for word in text.split():
        m=re.match(r'^([^\w]*)(\w[\w.]*)([^\w]*)$',word)
        if m:
            pre,core,post=m.group(1),m.group(2),m.group(3)
            if _needs(core):
                result.append(pre+' '.join(core)+post); continue
        result.append(word)
    prepared=' '.join(result)
    if prepared!=text: log.info(f"[TTS] Code spelling: \"{text[:55]}\" → \"{prepared[:55]}\"")
    return prepared


# ══════════════════════════════════════════════════════════════════════════════
# Voicemaker TTS — one fresh WS per request
# ══════════════════════════════════════════════════════════════════════════════

def _vm_voice(lang_code: str):
    gmap = _VOICEMAKER_VOICES.get(TTS_GENDER, _VOICEMAKER_VOICES['male'])
    return gmap.get(lang_code, gmap['_default'])


def voicemaker_tts(text: str, lang_code: str) -> bytes:
    """
    Synthesise via Voicemaker WebSocket.
    Opens a fresh connection per call — avoids idle-timeout issues.
    Returns MP3 bytes or b'' on failure.
    """
    voice_id, vm_lang = _vm_voice(lang_code)
    tts_text = _prepare_tts_text(text, lang_code)
    log.info(f"[VM] Connecting — voice={voice_id} [{lang_code}] \"{tts_text[:55]}\" …")
    t0 = time.monotonic()

    chunks=[]; error_msg=[None]; connected=threading.Event(); done=threading.Event()

    payload = json.dumps({
        'VoiceId': voice_id, 'LanguageCode': vm_lang,
        'Text': tts_text, 'OutputFormat': 'mp3', 'SampleRate': '48000',
        'Effect': 'default', 'MasterVolume': '0', 'MasterSpeed': '0', 'MasterPitch': '0',
    })

    def on_open(ws):
        connected.set()
        log.info(f"[VM] Connected in {time.monotonic()-t0:.2f}s — sending")
        ws.send(payload)

    def on_message(ws, msg):
        try: data=json.loads(msg)
        except Exception: return
        if not data.get('success'):
            error_msg[0]=str(data.get('errors') or data.get('message','unknown'))
            log.error(f"[VM] API error: {error_msg[0]}"); done.set(); ws.close(); return
        if data.get('audio'):
            try: chunks.append(base64.b64decode(data['audio']))
            except Exception as e: log.warning(f"[VM] Decode: {e}")
        if data.get('isFinal'): done.set(); ws.close()

    def on_error(ws, err): error_msg[0]=str(err); connected.set(); done.set()
    def on_close(ws, code, msg): connected.set(); done.set()

    ws_app = websocket.WebSocketApp(
        VOICEMAKER_WS_URL,
        header={'Authorization': f'Bearer {VOICEMAKER_API_KEY}'},
        on_open=on_open, on_message=on_message,
        on_error=on_error, on_close=on_close,
    )
    threading.Thread(target=lambda: ws_app.run_forever(), daemon=True, name='vm-ws').start()

    if not connected.wait(timeout=15):
        log.error("[VM] Connect timeout"); return b''
    if not done.wait(timeout=60):
        log.error("[VM] Audio timeout"); ws_app.close(); return b''
    if error_msg[0]: log.error(f"[VM] Failed: {error_msg[0]}"); return b''
    if not chunks: log.error("[VM] No audio chunks"); return b''

    raw   = b''.join(chunks)
    t_aud = time.monotonic()-t0
    log.info(f"[VM] {len(raw)//1024}KB in {t_aud:.2f}s  voice={voice_id}")

    if AUDIO_SPEED != 1.0:
        try:
            r=subprocess.run(
                ['ffmpeg','-y','-i','pipe:0','-filter:a',f'atempo={AUDIO_SPEED}',
                 '-f','mp3','-q:a','4','pipe:1'],
                input=raw, capture_output=True, timeout=10)
            if r.returncode==0 and len(r.stdout)>512:
                log.info(f"[VM] Speedup {AUDIO_SPEED}x: {len(raw)//1024}→{len(r.stdout)//1024}KB")
                raw=r.stdout
        except Exception as e: log.warning(f"[VM] Speedup failed: {e}")
    return raw


# ══════════════════════════════════════════════════════════════════════════════
# MariaDB — resolve zone_id → language + edge node IP
# ══════════════════════════════════════════════════════════════════════════════

def get_db_connection():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT,
        user=DB_USER, password=DB_PASSWORD,
        database=DB_NAME,
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=5,
    )


def resolve_zone(zone_id: int) -> Optional[dict]:
    """
    Given a zone_id (zones.id), look up:
      - default_language  (zones.default_language)   → lang_code
      - address            (devices.address)          → device_ip
        (the Edge Node row whose devices.zone_id == zone_id)

    Returns {'lang_code','device_ip','zone_code'} or None if not found.
    """
    try:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT zone_code, default_language FROM zones WHERE id = %s",
                    (zone_id,)
                )
                zone = cur.fetchone()
                if not zone:
                    log.error(f"[DB] zone_id={zone_id} not found in zones table")
                    return None

                cur.execute(
                    "SELECT address, status FROM devices "
                    "WHERE zone_id = %s AND device_type = 'Edge Node' "
                    "ORDER BY (status = 'online') DESC, updated_at DESC LIMIT 1",
                    (zone_id,)
                )
                device = cur.fetchone()
                if not device or not device.get('address'):
                    log.error(f"[DB] No Edge Node device found for zone_id={zone_id}")
                    return None
                if device.get('status') != 'online':
                    log.warning(f"[DB] Edge Node for zone_id={zone_id} is status="
                                f"{device.get('status')} — sending anyway")

                return {
                    'lang_code': (zone.get('default_language') or 'EN').upper(),
                    'device_ip': device['address'],
                    'zone_code': zone.get('zone_code') or '',
                }
        finally:
            conn.close()
    except Exception as exc:
        log.error(f"[DB] resolve_zone({zone_id}) failed: {exc}")
        return None


_BEHAVIOR_KEYS = ('is_blocking', 'initial_play_count', 'repeat_interval_sec',
                  'reduction_step_sec', 'min_interval_sec', 'requires_ack', 'sort_order')

_DEFAULT_ALERT_TYPE_BEHAVIOR = {
    'is_blocking': False, 'initial_play_count': 1, 'repeat_interval_sec': 60.0,
    'reduction_step_sec': 0.0, 'min_interval_sec': 60.0, 'requires_ack': False,
    'sort_order': 100,
}


def resolve_alert_type_behavior(type_code: str) -> dict:
    """
    Look up configured playback behavior from alert_type_configs (same table
    dispatch_service.py's resolve_alert_type() reads — not shared code
    between the two services, kept in sync manually, same as resolve_zone/
    get_gateway_ip already are). Used when a caller (e.g. alert_poller.py's
    cloud-alert path) doesn't already know its alert type's behavior and
    didn't pass one explicitly in the /synthesise body.
    """
    slug = (type_code or 'normal').strip().lower().replace(' ', '_')
    try:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM alert_type_configs WHERE type_code=%s LIMIT 1", (slug,))
                row = cur.fetchone()
            if not row:
                return dict(_DEFAULT_ALERT_TYPE_BEHAVIOR)
            return {
                'is_blocking':         bool(row['is_blocking']),
                'initial_play_count':  row['initial_play_count'],
                'repeat_interval_sec': float(row['repeat_interval_sec'] or 0),
                'reduction_step_sec':  float(row['reduction_step_sec'] or 0),
                'min_interval_sec':    float(row['min_interval_sec'] or 0),
                'requires_ack':        bool(row['requires_ack']),
                'sort_order':          row['sort_order'],
            }
        finally:
            conn.close()
    except Exception as exc:
        log.warning(f"[DB] resolve_alert_type_behavior({type_code}) failed: {exc}")
        return dict(_DEFAULT_ALERT_TYPE_BEHAVIOR)


# ══════════════════════════════════════════════════════════════════════════════
# Edge node delivery  (SYNCHRONOUS — blocks until edge responds)
# ══════════════════════════════════════════════════════════════════════════════

def deliver_to_edge(mp3: bytes, device_ip: str, alert_id: int,
                    alert_category: str, lang_code: str, zone_code: str = '',
                    behavior: Optional[dict] = None) -> dict:
    """
    POST audio to edge node /play synchronously.
    zone_code is unused here (HTTP addresses by device_ip) — accepted so
    tts_server_mqtt.py can override this function with the same call
    signature and address by zone_code (MQTT topic) instead.
    Returns receipt dict:
      edge_delivered : bool  — HTTP 200 received
      audio_queued   : bool  — edge node confirmed it queued the audio
      critical_active: bool  — edge node has critical alerts active
      error          : str   — error message if failed
    """
    url = f"http://{device_ip}:{EDGE_NODE_PORT}{EDGE_NODE_PLAY}"
    log.info(f"[Edge] POST {url}  alert={alert_id}  cat={alert_category}")
    t0 = time.monotonic()
    form = {'alert_id': str(alert_id), 'alert_category': alert_category, 'lang_code': lang_code}
    for k, v in (behavior or {}).items():
        form[k] = '' if v is None else str(v)
    try:
        resp = requests.post(
            url,
            files={'audio': ('alert.mp3', io.BytesIO(mp3), 'audio/mpeg')},
            data=form,
            timeout=EDGE_TIMEOUT_SEC,
        )
        elapsed = time.monotonic()-t0
        ok = resp.status_code == 200
        data = {}
        try: data = resp.json()
        except Exception: pass
        log.info(f"[Edge] HTTP {resp.status_code}  {elapsed:.2f}s  "
                 f"queued={data.get('queued')}  critical_active={data.get('critical_active')}")
        return {
            'edge_delivered':  ok,
            'audio_queued':    data.get('queued', ok),
            'critical_active': data.get('critical_active', False),
            'error':           '' if ok else f"HTTP {resp.status_code}",
        }
    except Exception as exc:
        log.error(f"[Edge] Delivery failed: {exc}")
        return {'edge_delivered': False, 'audio_queued': False,
                'critical_active': False, 'error': str(exc)}


def acknowledge_on_edge(device_ip: str, alert_id: int, zone_code: str = '') -> bool:
    """POST /acknowledge to edge node. Returns True on success.
    zone_code unused here — see deliver_to_edge()'s docstring."""
    url = f"http://{device_ip}:{EDGE_NODE_PORT}{EDGE_NODE_ACKNOWLEDGE}"
    try:
        resp = requests.post(url, json={'alert_id': alert_id}, timeout=8)
        log.info(f"[Edge] /acknowledge alert={alert_id} → HTTP {resp.status_code}")
        return resp.status_code == 200
    except Exception as exc:
        log.error(f"[Edge] /acknowledge failed: {exc}")
        return False


# ══════════════════════════════════════════════════════════════════════════════
# Local playback queue (async, non-blocking)
# ══════════════════════════════════════════════════════════════════════════════

_local_queue = _queue_module.Queue()


def _detect_audio_device() -> Optional[str]:
    if AUDIO_DEVICE: return AUDIO_DEVICE
    try:
        r=subprocess.run(['aplay','-l'],capture_output=True,text=True,timeout=5)
        for line in r.stdout.splitlines():
            if 'usb' in line.lower():
                m=re.search(r'card\s+(\d+).*device\s+(\d+)',line,re.IGNORECASE)
                if m: hw=f"hw:{m.group(1)},{m.group(2)}"; log.info(f"[Play] USB: {hw}"); return hw
    except Exception: pass
    return None

_detected_device = [None]; _device_lock = Lock()
def _get_device():
    with _device_lock:
        if _detected_device[0] is None:
            _detected_device[0] = _detect_audio_device() or ''
    return _detected_device[0] or None


def _play_locally_worker():
    """Background thread — plays MP3s locally via cvlc one at a time."""
    log.info("[Play] Local playback worker started")
    while True:
        item = _local_queue.get(block=True)
        mp3=item['mp3']; alert_id=item['alert_id']
        device=_get_device()
        fd,path=tempfile.mkstemp(suffix='.mp3'); os.close(fd)
        try:
            open(path,'wb').write(mp3)
            cmd=['cvlc','--play-and-exit','--quiet']
            if device: cmd+=['--aout=alsa',f'--alsa-audio-device={device}']
            cmd.append(path)
            t0=time.monotonic()
            r=subprocess.run(cmd,stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL,timeout=120)
            log.info(f"[Play] DONE alert={alert_id}  {time.monotonic()-t0:.2f}s")
        except Exception as e: log.error(f"[Play] Error: {e}")
        finally:
            try: os.unlink(path)
            except Exception: pass
        _local_queue.task_done()

threading.Thread(target=_play_locally_worker, daemon=True, name='local-play').start()


# ══════════════════════════════════════════════════════════════════════════════
# Core synthesise — cache → translate → TTS → deliver → return receipt
# ══════════════════════════════════════════════════════════════════════════════

def synthesise(text: str, lang_code: str,
               no_translate_words: Optional[List[str]] = None,
               alert_id: int = 0, zone_code: str = '',
               alert_category: str = 'Normal',
               device_ip: str = '',
               behavior: Optional[dict] = None) -> dict:
    """
    Full pipeline. Returns receipt dict:
      mp3            : bytes
      tts_duration   : float
      edge_delivered : bool
      audio_queued   : bool
      from_cache     : bool
    """
    t0 = time.monotonic()

    # 1. Cache check
    cached = cache_get(text, lang_code)
    if cached:
        log.info(f"[Synth] Cache hit in {time.monotonic()-t0:.3f}s")
        mp3        = cached
        from_cache = True
        tts_dur    = 0.0
    else:
        # 2. Translate
        t_tr       = time.monotonic()
        translated = translate_text(text, lang_code, no_translate_words)
        log.info(f"[Synth] Translation: {time.monotonic()-t_tr:.2f}s")

        # 3. Cache check with translated text
        if translated != text:
            cached2 = cache_get(translated, lang_code)
            if cached2:
                cache_put(text, lang_code, cached2)
                mp3=cached2; from_cache=True; tts_dur=0.0
            else:
                cached2 = None
        else:
            cached2 = None

        if not cached2:
            # 4. TTS
            t_tts   = time.monotonic()
            mp3     = voicemaker_tts(translated, lang_code)
            tts_dur = time.monotonic()-t_tts
            if not mp3:
                return {'mp3': b'', 'tts_duration': tts_dur,
                        'edge_delivered': False, 'audio_queued': False, 'from_cache': False}
            cache_put(text, lang_code, mp3)
            if translated != text: cache_put(translated, lang_code, mp3)

            # Save dated copy
            try:
                ts    = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                zone  = (zone_code or 'nozone').replace('/','_')
                fname = f"{ts}_alert{alert_id}_{lang_code}_{zone}.mp3"
                (CACHE_DIR/fname).write_bytes(mp3)
            except Exception: pass

            from_cache = False

    # 5. Deliver to edge node (SYNCHRONOUS)
    receipt = {'edge_delivered': False, 'audio_queued': False, 'critical_active': False}
    if device_ip or zone_code:
        receipt = deliver_to_edge(mp3, device_ip, alert_id, alert_category, lang_code,
                                  zone_code=zone_code, behavior=behavior)
    else:
        log.info(f"[Synth] No device_ip/zone_code — skipping edge delivery for alert={alert_id}")

    # 6. Local playback (non-blocking)
    if PLAY_LOCALLY and mp3:
        _local_queue.put({'mp3': mp3, 'alert_id': alert_id})
        log.info(f"[Synth] Queued for local play (depth={_local_queue.qsize()})")

    total = time.monotonic()-t0
    log.info(f"[Synth] DONE alert={alert_id}  total={total:.2f}s  "
             f"tts={tts_dur:.2f}s  cache={from_cache}  "
             f"edge={receipt['edge_delivered']}")

    return {
        'mp3':           mp3,
        'tts_duration':  round(tts_dur, 3),
        'edge_delivered': receipt['edge_delivered'],
        'audio_queued':   receipt['audio_queued'],
        'from_cache':     from_cache,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Flask app
# ══════════════════════════════════════════════════════════════════════════════

app = Flask(__name__)


@app.route('/synthesise', methods=['POST'])
def synthesise_endpoint():
    """
    POST body (JSON):
    {
      "text":               "Sand burn loss is high",
      "zone_id":            2,
      "lang_code":          "TE",
      "alert_id":           42,
      "alert_category":     "Critical",
      "device_ip":          "10.42.0.50",
      "zone_code":          "Z1",
      "no_translate_words": ["Sand","Burn"],
      "alert_source":       "SCADA"
    }

    zone_id (new): if supplied, tts_server looks up the zone's
    default_language and the matching Edge Node's IP address from the
    MariaDB `gateway` DB (tables: zones, devices) and uses those for
    lang_code / device_ip UNLESS the caller explicitly supplied their own
    lang_code / device_ip in the body (those always take priority).

    Returns MP3 audio/mpeg.

    Response headers (used by alert_poller for logging):
      X-TTS-Duration   : float seconds
      X-Edge-Delivered : true|false
      X-Audio-Queued   : true|false
      X-From-Cache     : true|false
      X-Total-Time     : float seconds
    """
    t0       = time.monotonic()
    raw_body = request.get_data(as_text=True)
    body     = request.get_json(force=True, silent=True)

    if body is None:
        import json as _j
        try: _j.loads(raw_body)
        except Exception as e:
            return jsonify({'error':'Invalid JSON','detail':str(e),'hint':'Check commas'}),400
        body={}
    if not isinstance(body, dict):
        return jsonify({'error':'Expected JSON object'}),400

    text           = (body.get('text')           or '').strip()
    nt_words       = body.get('no_translate_words') or []
    alert_id       = int(body.get('alert_id')     or 0)
    zone_code      = str(body.get('zone_code')    or '')
    alert_category = str(body.get('alert_category') or 'Normal').strip()

    lang_code_in = (body.get('lang_code') or '').upper().strip()
    device_ip_in = (body.get('device_ip') or '').strip()
    zone_id      = body.get('zone_id')

    lang_code = lang_code_in or 'EN'
    device_ip = device_ip_in

    if zone_id not in (None, ''):
        try:
            zone_id_int = int(zone_id)
        except (TypeError, ValueError):
            return jsonify({'error': f'invalid zone_id: {zone_id!r}'}), 400

        zone_info = resolve_zone(zone_id_int)
        if not zone_info:
            return jsonify({'error': f'zone_id {zone_id_int} not found, '
                                      f'or has no Edge Node device configured'}), 400

        if not lang_code_in:
            lang_code = zone_info['lang_code']
        if not device_ip_in:
            device_ip = zone_info['device_ip']
        if not zone_code:
            zone_code = zone_info['zone_code']

    if not text:
        return jsonify({'error':'text is required'}),400
    if lang_code not in LANG_MAP:
        return jsonify({'error':f'unsupported lang_code: {lang_code}',
                        'supported':list(LANG_MAP.keys())}),400

    # Playback behavior (repeat/ack/blocking rules): dispatch_service.py resolves
    # this itself and sends it flat in the body; other callers (e.g. alert_poller's
    # cloud-alert path) don't know about alert types, so resolve it here instead.
    if any(k in body for k in _BEHAVIOR_KEYS):
        behavior = {k: body.get(k) for k in _BEHAVIOR_KEYS}
    else:
        behavior = resolve_alert_type_behavior(alert_category)

    log.info(f"[API] /synthesise  lang={lang_code}  alert={alert_id}  "
             f"cat={alert_category}  device={device_ip or 'none'}  "
             f"\"{text[:50]}\"")

    try:
        result = synthesise(text, lang_code, nt_words, alert_id,
                            zone_code, alert_category, device_ip, behavior)
    except Exception as exc:
        log.error(f"[API] Error: {exc}", exc_info=True)
        return jsonify({'error': str(exc)}),500

    mp3 = result['mp3']
    if not mp3:
        return jsonify({'error':'TTS produced no audio'}),500

    total = time.monotonic()-t0
    log.info(f"[API] Complete in {total:.2f}s  {len(mp3)//1024}KB")

    resp = Response(mp3, mimetype='audio/mpeg')
    resp.headers['X-TTS-Duration']   = str(result['tts_duration'])
    resp.headers['X-Edge-Delivered'] = str(result['edge_delivered']).lower()
    resp.headers['X-Audio-Queued']   = str(result['audio_queued']).lower()
    resp.headers['X-From-Cache']     = str(result['from_cache']).lower()
    resp.headers['X-Total-Time']     = f"{total:.2f}"
    resp.headers['X-Lang-Code']      = lang_code
    resp.headers['X-Alert-Category'] = alert_category
    return resp


@app.route('/note-acknowledge', methods=['POST'])
def note_acknowledge():
    """
    Called by alert_poller when cloud DB status changes to 'ack'.
    Forwards to edge node /acknowledge.

    POST body: {"alert_id": 42, "device_ip": "10.42.0.50", "zone_code": "z002"}
    device_ip and zone_code are both accepted since alert_poller always sends
    both — the HTTP version addresses by device_ip, the MQTT variant
    (tts_server_mqtt.py) overrides acknowledge_on_edge to use zone_code instead.
    """
    body      = request.get_json(force=True, silent=True) or {}
    alert_id  = int(body.get('alert_id', 0))
    device_ip = str(body.get('device_ip', '')).strip()
    zone_code = str(body.get('zone_code', '')).strip()

    if not alert_id or not (device_ip or zone_code):
        return jsonify({'error':'alert_id and (device_ip or zone_code) required'}),400

    log.info(f"[Ack] Forwarding acknowledge alert={alert_id} → {device_ip or zone_code}")
    ok = acknowledge_on_edge(device_ip, alert_id, zone_code=zone_code)
    return jsonify({'forwarded': ok, 'alert_id': alert_id, 'device_ip': device_ip})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status':       'ok',
        'gender':       TTS_GENDER,
        'speed':        AUDIO_SPEED,
        'play_locally': PLAY_LOCALLY,
        'local_queue':  _local_queue.qsize(),
        'cache':        cache_stats(),
    })


@app.route('/langs', methods=['GET'])
def langs():
    return jsonify({'languages': list(LANG_MAP.keys())})


@app.route('/cache/stats', methods=['GET'])
def cache_stats_ep():
    return jsonify(cache_stats())


@app.route('/cache/clear', methods=['POST'])
def cache_clear():
    body  = request.get_json(force=True, silent=True) or {}
    langs = body.get('lang_codes')
    count = 0
    for d in CACHE_DIR.iterdir():
        if d.is_dir() and (langs is None or d.name in langs):
            for f in d.glob('*.mp3'):
                try: f.unlink(); count+=1
                except Exception: pass
    if langs is None:
        for f in CACHE_DIR.glob('*.mp3'):
            try: f.unlink(); count+=1
            except Exception: pass
    log.info(f"[Cache] Cleared {count} files")
    return jsonify({'cleared': count})


# ══════════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    if not GEMINI_API_KEY:   raise SystemExit("GEMINI_API_KEY not set")
    if not VOICEMAKER_API_KEY: raise SystemExit("VOICEMAKER_API_KEY not set")
    get_gemini()
    try:
        get_db_connection().close()
        log.info(f"[DB] Connected OK — {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}")
    except Exception as e:
        log.error(f"[DB] Could not connect to {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}: {e}")
        log.error("[DB] zone_id lookups will fail until this is fixed. "
                   "requests without zone_id (using device_ip directly) still work.")
    log.info("="*60)
    log.info(f"  TTS         : Voicemaker ({TTS_GENDER})  speed={AUDIO_SPEED}x")
    log.info(f"  Play locally: {PLAY_LOCALLY}  device={AUDIO_DEVICE or 'auto'}")
    log.info(f"  DB          : {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}")
    log.info(f"  Listening   : http://{SERVER_HOST}:{SERVER_PORT}")
    log.info(f"  POST /synthesise    POST /note-acknowledge")
    log.info(f"  GET  /health        GET  /langs")
    log.info(f"  GET  /cache/stats   POST /cache/clear")
    log.info("="*60)
    stats=cache_stats(); total=stats.pop('_total',{})
    for lang,v in stats.items():
        log.info(f"    {lang:<6}: {v['count']} files  {v['size_kb']}KB")
    log.info(f"    TOTAL : {total.get('count',0)} files  {total.get('size_kb',0)}KB")
    log.info("="*60)
    app.run(host=SERVER_HOST, port=SERVER_PORT, threaded=True)