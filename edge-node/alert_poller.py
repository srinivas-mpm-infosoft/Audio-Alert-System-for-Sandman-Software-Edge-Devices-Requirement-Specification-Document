# """
# alert_poller.py  —  Cloud DB Poller + Alert Logger
# ───────────────────────────────────────────────────
# 1. Poll cloud DB every 1s for new alerts
# 2. For each alert: zone lookup → POST to TTS server /synthesise
# 3. TTS server returns synchronous receipt (edge_delivered, audio_queued)
# 4. Store alert log in LOCAL DB alert_logs table
# 5. Track unacked alerts in memory

# Every 3s: re-check cloud DB for status='ack' on unacked alerts
#   → call TTS /note-acknowledge → edge /acknowledge
#   → update ack_time + escalation_count in local DB

# alert_logs columns:
#   alert_id, alert_timestamp, alert_category, alert_source,
#   zone_code, lang_code, device_ip, tts_duration_sec,
#   edge_delivered, audio_played, ack_time, escalation_count, created_at

# Flask endpoints:
#   GET  /health
#   GET  /unacked
#   GET  /logs?limit=50
#   GET  /check-acknowledge
# """

# import datetime
# import logging
# import os
# import threading
# import time
# from threading import Lock
# from typing import Optional, Dict

# import pymysql
# import pymysql.cursors
# import requests
# from flask import Flask, jsonify, request

# # ══════════════════════════════════════════════════════════════════════════════
# # CONFIGURATION
# # ══════════════════════════════════════════════════════════════════════════════

# TTS_SERVER_URL        = os.getenv('TTS_SERVER_URL', 'http://localhost:6000')
# POLL_INTERVAL_SEC     = 1.0
# ACKNOWLEDGE_CHECK_SEC = 3.0
# TTS_TIMEOUT_SEC       = 90
# HEARTBEAT_SEC         = 30
# SERVER_HOST           = '0.0.0.0'
# SERVER_PORT           = 7000

# LOCAL_DB = dict(
#     host='localhost', port=3306,
#     user='gateway', password='gateway',
#     database='gateway', charset='utf8mb4', autocommit=True,
# )

 
# CLOUD_DB = dict(
#     host='hayabusa.proxy.rlwy.net', port=47366,
#     user='root', password='KyfbQYIzmmLUClWQQsJkyHpCfJPuMENK',
#     database='railway', charset='utf8mb4',
#     connect_timeout=5, read_timeout=8, write_timeout=8, autocommit=True,
# )


# CLOUD_ALERTS_TABLE = 'alerts'
# NO_TRANSLATE_TABLE = 'app_no_translate_words'
# ALERT_LOGS_TABLE   = 'alert_logs'

# logging.basicConfig(
#     level=logging.INFO,
#     format='%(asctime)s [%(levelname)-7s] %(message)s',
#     datefmt='%H:%M:%S',
# )
# log = logging.getLogger(__name__)

# # ══════════════════════════════════════════════════════════════════════════════
# # Unacked tracker  {alert_id → info_dict}
# # ══════════════════════════════════════════════════════════════════════════════

# _unacked      : Dict[int, dict] = {}
# _unacked_lock = Lock()

# # ══════════════════════════════════════════════════════════════════════════════
# # No-translate words
# # ══════════════════════════════════════════════════════════════════════════════

# class NoTranslateWords:
#     def __init__(self):
#         self._lock=Lock(); self._words=[]; self._count=0
#     def load(self, conn):
#         with conn.cursor() as c:
#             c.execute(f"SELECT word FROM {NO_TRANSLATE_TABLE} ORDER BY LENGTH(word) DESC")
#             rows=c.fetchall()
#             c.execute(f"SELECT COUNT(*) AS cnt FROM {NO_TRANSLATE_TABLE}")
#             cnt=c.fetchone()['cnt']
#         words=[r['word'] for r in rows]
#         with self._lock: self._words,self._count=words,cnt
#         log.info(f"[NT] {cnt} words  sample={words[:5]}")
#     def refresh_if_changed(self, conn):
#         try:
#             with conn.cursor() as c:
#                 c.execute(f"SELECT COUNT(*) AS cnt FROM {NO_TRANSLATE_TABLE}")
#                 cnt=c.fetchone()['cnt']
#             with self._lock: changed=cnt!=self._count
#             if changed: self.load(conn)
#         except Exception as e: log.warning(f"[NT] {e}")
#     def get_words(self):
#         with self._lock: return list(self._words)

# no_translate = NoTranslateWords()

# # ══════════════════════════════════════════════════════════════════════════════
# # DB helpers
# # ══════════════════════════════════════════════════════════════════════════════

# def connect_db(cfg, label='DB'):
#     try:
#         c=pymysql.connect(**cfg, cursorclass=pymysql.cursors.DictCursor)
#         log.info(f"[DB] {label} ✓"); return c
#     except Exception as e:
#         log.warning(f"[DB] {label} failed: {e}"); return None

# def ensure_conn(conn, cfg, label):
#     if conn is None: return connect_db(cfg, label)
#     try: conn.ping(); return conn
#     except Exception:
#         log.warning(f"[DB] {label} stale — reconnect")
#         try: conn.close()
#         except Exception: pass
#         return connect_db(cfg, label)

# def get_zone(conn, zone_code):
#     with conn.cursor() as c:
#         c.execute("SELECT * FROM zones WHERE zone_code=%s LIMIT 1",(zone_code,))
#         row=c.fetchone()
#     if row: log.info(f"[Zone] {zone_code} → lang={row['default_language']}")
#     else:   log.warning(f"[Zone] {zone_code} not found")
#     return row

# def get_gateway_ip(conn, zone_id):
#     with conn.cursor() as c:
#         c.execute("SELECT address FROM devices WHERE zone_id=%s "
#                   "AND device_type IN ('Edge Node','Gateway') ORDER BY id LIMIT 1",(zone_id,))
#         row=c.fetchone()
#         if row: log.info(f"[Device] {row['address']}"); return row['address']
#         c.execute("SELECT address FROM devices WHERE zone_id=%s "
#                   "AND address REGEXP '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+' "
#                   "ORDER BY id LIMIT 1",(zone_id,))
#         row=c.fetchone()
#     if row: log.info(f"[Device] Fallback: {row['address']}"); return row['address']
#     log.warning(f"[Device] No IP for zone_id={zone_id}"); return None

# def fetch_new_alerts(conn, last_id):
#     """
#     Fetch unacknowledged alerts with id > last_id.
#     Uses 'acknowledged' column (0 = pending, 1 = acked).
#     """
#     with conn.cursor() as c:
#         c.execute(f"SELECT * FROM {CLOUD_ALERTS_TABLE} "
#                   f"WHERE id>%s AND (acknowledged IS NULL OR acknowledged=0) "
#                   f"ORDER BY id ASC",(last_id,))
#         return c.fetchall()

# def get_alert_status(conn, alert_id) -> Optional[str]:
#     """
#     Return 'ack' if acknowledged=1, 'pending' if acknowledged=0, None if not found.
#     """
#     try:
#         with conn.cursor() as c:
#             c.execute(f"SELECT acknowledged, acknowledged_at "
#                       f"FROM {CLOUD_ALERTS_TABLE} WHERE id=%s",(alert_id,))
#             row=c.fetchone()
#         if row is None: return None
#         return 'ack' if row.get('acknowledged') == 1 else 'pending'
#     except Exception as e:
#         log.warning(f"[DB] status({alert_id}): {e}"); return None

# # ══════════════════════════════════════════════════════════════════════════════
# # Alert logs — LOCAL DB
# # ══════════════════════════════════════════════════════════════════════════════

# _LOGS_DDL = f"""
# CREATE TABLE IF NOT EXISTS {ALERT_LOGS_TABLE} (
#     id                INT AUTO_INCREMENT PRIMARY KEY,
#     alert_id          INT          NOT NULL,
#     alert_timestamp   DATETIME     NOT NULL COMMENT 'When alert was created in cloud',
#     alert_category    VARCHAR(32)  NOT NULL DEFAULT 'Normal',
#     alert_source      VARCHAR(128) DEFAULT NULL COMMENT 'SCADA / PLC / manual etc',
#     zone_code         VARCHAR(64)  DEFAULT NULL,
#     lang_code         VARCHAR(8)   DEFAULT 'EN',
#     device_ip         VARCHAR(64)  DEFAULT NULL COMMENT 'Edge node IP',
#     tts_duration_sec  FLOAT        DEFAULT NULL COMMENT 'Time taken for TTS',
#     edge_delivered    TINYINT(1)   DEFAULT 0   COMMENT 'Edge node received audio',
#     audio_played      TINYINT(1)   DEFAULT 0   COMMENT 'Audio confirmed played on edge',
#     ack_time          DATETIME     DEFAULT NULL COMMENT 'When operator acknowledged',
#     escalation_count  INT          DEFAULT 0   COMMENT 'Times re-checked while unacked',
#     created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
#     INDEX idx_alert_id (alert_id),
#     INDEX idx_created  (created_at)
# ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
# """

# _ALERT_DDL = f"""
# CREATE TABLE IF NOT EXISTS {CLOUD_ALERTS_TABLE} (
#     id                  INT AUTO_INCREMENT PRIMARY KEY,
#     created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
#     updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
#     alert_type          VARCHAR(16)  NOT NULL DEFAULT 'SI' COMMENT 'e.g. SI',
#     foundry_line_id     INT          NOT NULL,
#     zone_code           VARCHAR(64)  DEFAULT NULL COMMENT 'Zone this alert belongs to',
#     date                DATE         DEFAULT NULL,
#     shift               VARCHAR(8)   DEFAULT NULL COMMENT '1 / 2 / 3',
#     batch_pkey          INT          DEFAULT 0,
#     period_key          VARCHAR(32)  DEFAULT NULL COMMENT 'e.g. 2026-05-31_3',
#     si_score            FLOAT        DEFAULT NULL,
#     alert_level         VARCHAR(32)  DEFAULT NULL COMMENT 'e.g. !! WARNING',
#     root_cause          TEXT         DEFAULT NULL,
#     recommendation      TEXT         DEFAULT NULL,
#     params_json         JSON         DEFAULT NULL,
#     raw_values_json     JSON         DEFAULT NULL,
#     overall_status      VARCHAR(64)  DEFAULT NULL,
#     tolerance           FLOAT        DEFAULT NULL,
#     component_id        VARCHAR(64)  DEFAULT NULL,
#     group_name          VARCHAR(128) DEFAULT NULL,
#     batch_time          VARCHAR(64)  DEFAULT NULL,
#     deviations_json     JSON         DEFAULT NULL,
#     acknowledged        TINYINT(1)   NOT NULL DEFAULT 0,
#     acknowledged_at     DATETIME     DEFAULT NULL,

#     INDEX idx_foundry_line   (foundry_line_id),
#     INDEX idx_created_at     (created_at),
#     INDEX idx_acknowledged   (acknowledged),
#     INDEX idx_period_key     (period_key),
#     INDEX idx_zone_code      (zone_code)
# ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

# """

# def ensure_alert_logs_table(conn):
#     try:
#         with conn.cursor() as c: 
#             c.execute(_LOGS_DDL)
#             c.execute(_ALERT_DDL)
#         log.info(f"[Log] {ALERT_LOGS_TABLE} ready")
#     except Exception as e: log.error(f"[Log] DDL failed: {e}")

# def insert_alert_log(conn, row: dict) -> Optional[int]:
#     """Insert a row into alert_logs. Returns new id or None."""
#     cols = ['alert_id','alert_timestamp','alert_category','alert_source',
#             'zone_code','lang_code','device_ip','tts_duration_sec',
#             'edge_delivered','audio_played']
#     data = {c: row.get(c) for c in cols}
#     try:
#         ph = ','.join(['%s']*len(data))
#         cn = ','.join(data.keys())
#         with conn.cursor() as c:
#             c.execute(f"INSERT INTO {ALERT_LOGS_TABLE} ({cn}) VALUES ({ph})",
#                       list(data.values()))
#         log.info(f"[Log] Inserted log for alert_id={row.get('alert_id')}")
#         return conn.insert_id()
#     except Exception as e:
#         log.error(f"[Log] Insert failed: {e}"); return None

# def update_log_ack(conn, alert_id, ack_time):
#     try:
#         with conn.cursor() as c:
#             c.execute(f"UPDATE {ALERT_LOGS_TABLE} SET ack_time=%s "
#                       f"WHERE alert_id=%s ORDER BY id DESC LIMIT 1",
#                       (ack_time, alert_id))
#         log.info(f"[Log] ack_time updated for alert_id={alert_id}")
#     except Exception as e: log.error(f"[Log] ack update: {e}")

# def update_log_escalation(conn, alert_id):
#     try:
#         with conn.cursor() as c:
#             c.execute(f"UPDATE {ALERT_LOGS_TABLE} "
#                       f"SET escalation_count=escalation_count+1 "
#                       f"WHERE alert_id=%s ORDER BY id DESC LIMIT 1",(alert_id,))
#     except Exception as e: log.error(f"[Log] escalation update: {e}")

# def update_log_audio_played(conn, alert_id):
#     """Mark audio_played=1 once edge confirms playback."""
#     try:
#         with conn.cursor() as c:
#             c.execute(f"UPDATE {ALERT_LOGS_TABLE} SET audio_played=1 "
#                       f"WHERE alert_id=%s ORDER BY id DESC LIMIT 1",(alert_id,))
#     except Exception as e: log.error(f"[Log] audio_played update: {e}")

# # ══════════════════════════════════════════════════════════════════════════════
# # TTS server client
# # ══════════════════════════════════════════════════════════════════════════════

# # NOTE: conceptually mirrors ../dispatch_service.py's call_synthesise() — not shared code, keep in sync manually if either changes.
# def call_synthesise(text, lang_code, alert_id=0, zone_code='',
#                     alert_category='Normal', device_ip='', alert_source='') -> dict:
#     """
#     POST to TTS server /synthesise (SYNCHRONOUS).
#     TTS server: translates → TTS → delivers to edge → returns receipt.

#     Returns:
#       ok             : bool
#       tts_duration   : float (seconds)
#       edge_delivered : bool
#       audio_queued   : bool
#     """
#     url     = f"{TTS_SERVER_URL.rstrip('/')}/synthesise"
#     payload = {
#         'text':               text,
#         'lang_code':          lang_code,
#         'no_translate_words': no_translate.get_words(),
#         'alert_id':           alert_id,
#         'zone_code':          zone_code,
#         'alert_category':     alert_category,
#         'device_ip':          device_ip,
#         'alert_source':       alert_source,
#     }
#     log.info(f"[TTS] /synthesise alert={alert_id} lang={lang_code} "
#              f"cat={alert_category} device={device_ip or 'none'}")
#     t0 = time.monotonic()
#     try:
#         resp = requests.post(url, json=payload, timeout=TTS_TIMEOUT_SEC)
#         elapsed = time.monotonic()-t0
#         if resp.status_code != 200:
#             log.error(f"[TTS] HTTP {resp.status_code}: {resp.text[:100]}")
#             return {'ok':False,'tts_duration':elapsed,
#                     'edge_delivered':False,'audio_queued':False}
#         # Read receipt from response headers
#         tts_dur  = float(resp.headers.get('X-TTS-Duration', elapsed))
#         edge_ok  = resp.headers.get('X-Edge-Delivered','false').lower()=='true'
#         queued   = resp.headers.get('X-Audio-Queued','false').lower()=='true'
#         log.info(f"[TTS] OK {elapsed:.2f}s  tts={tts_dur:.2f}s  "
#                  f"edge={edge_ok}  queued={queued}")
#         return {'ok':True,'tts_duration':tts_dur,
#                 'edge_delivered':edge_ok,'audio_queued':queued}
#     except Exception as exc:
#         log.error(f"[TTS] /synthesise error: {exc}")
#         return {'ok':False,'tts_duration':time.monotonic()-t0,
#                 'edge_delivered':False,'audio_queued':False}

# def call_note_acknowledge(alert_id, device_ip, zone_code=''):
#     url = f"{TTS_SERVER_URL.rstrip('/')}/note-acknowledge"
#     try:
#         resp = requests.post(url, json={'alert_id':alert_id,
#                                         'device_ip':device_ip,
#                                         'zone_code':zone_code}, timeout=10)
#         log.info(f"[TTS] /note-acknowledge alert={alert_id} → {resp.status_code}")
#     except Exception as e: log.error(f"[TTS] /note-acknowledge: {e}")

# # ══════════════════════════════════════════════════════════════════════════════
# # Alert processing
# # ══════════════════════════════════════════════════════════════════════════════

# _sem        = threading.Semaphore(8)
# _log_lock   = Lock()
# _log_conn_r = [None]   # local DB connection used by log writes

# def _map_alert_level(alert_level: str) -> str:
#     """
#     Map cloud DB alert_level string to standard category.
#       "!! CRITICAL" / "CRITICAL"  → "Critical"
#       "!! WARNING"  / "WARNING"   → "High"
#       "!! ALERT"    / "ALERT"     → "Normal"
#       anything else               → "Normal"
#     """
#     lvl = (alert_level or '').upper().replace('!','').strip()
#     if 'CRITICAL' in lvl: return 'Critical'
#     if 'WARNING'  in lvl: return 'High'
#     if 'ALERT'    in lvl: return 'Normal'
#     return 'Normal'


# def _get_zone_for_foundry_line(conn, foundry_line_id) -> Optional[dict]:
#     """
#     Look up zone by foundry_line_id.
#     Tries zones.foundry_line_id column first, falls back to zone_code matching.
#     """
#     try:
#         with conn.cursor() as c:
#             # Try direct foundry_line_id column if it exists
#             c.execute("SELECT * FROM zones WHERE line_id=%s LIMIT 1",
#                       (foundry_line_id,))
#             row = c.fetchone()
#             if row:
#                 log.info(f"[Zone] foundry_line_id={foundry_line_id} → "
#                          f"zone={row.get('zone_code')} lang={row.get('default_language')}")
#                 return row
#     except Exception:
#         pass
#     # Fallback: treat foundry_line_id as zone_code
#     try:
#         with conn.cursor() as c:
#             c.execute("SELECT * FROM zones WHERE zone_code=%s LIMIT 1",
#                       (str(foundry_line_id),))
#             row = c.fetchone()
#         if row:
#             log.info(f"[Zone] zone_code={foundry_line_id} → lang={row.get('default_language')}")
#             return row
#     except Exception:
#         pass
#     log.warning(f"[Zone] No zone for foundry_line_id={foundry_line_id}")
#     return None


# def _handle_alert(alert: dict, local_conn) -> None:
#     alert_id = alert['id']

#     # ── Extract text to speak ─────────────────────────────────────────────────
#     # Use root_cause as the primary text. Append recommendation if present.
#     root_cause     = (alert.get('root_cause') or '').strip()
#     recommendation = (alert.get('recommendation') or '').strip()
#     if root_cause and recommendation:
#         text = f"{root_cause}. {recommendation}"
#     else:
#         text = root_cause or recommendation or str(alert_id)

#     # ── Extract metadata ──────────────────────────────────────────────────────
#     alert_level    = alert.get('alert_level') or ''
#     alert_category = _map_alert_level(alert_level)
#     alert_source   = alert.get('alert_type') or ''
#     foundry_line_id = alert.get('foundry_line_id')

#     raw_ts = alert.get('created_at') or alert.get('updated_at')
#     alert_timestamp = raw_ts if isinstance(raw_ts, datetime.datetime)                      else datetime.datetime.now()

#     t0 = time.monotonic()
#     log.info("─"*55)
#     log.info(f"[Alert {alert_id}] level={alert_level} → cat={alert_category}  "
#              f"line={foundry_line_id}  source={alert_source}")
#     log.info(f"[Alert {alert_id}] {text[:100]}")

#     # ── Zone lookup via foundry_line_id ───────────────────────────────────────
#     zone      = _get_zone_for_foundry_line(local_conn, foundry_line_id)                 if foundry_line_id else None
#     zone_code = zone.get('zone_code','') if zone else str(foundry_line_id or '')
#     lang_code = zone['default_language'].upper() if zone else 'EN'
#     device_ip = get_gateway_ip(local_conn, zone['id']) if zone else None

#     receipt = call_synthesise(
#         text, lang_code,
#         alert_id=alert_id, zone_code=zone_code,
#         alert_category=alert_category, device_ip=device_ip or '',
#         alert_source=alert_source,
#     )

#     # Insert alert log
#     log_row = {
#         'alert_id':        alert_id,
#         'alert_timestamp': alert_timestamp,
#         'alert_category':  alert_category,
#         'alert_source':    alert_source or None,
#         'zone_code':       zone_code or None,
#         'lang_code':       lang_code,
#         'device_ip':       device_ip or None,
#         'tts_duration_sec': round(receipt['tts_duration'],3),
#         'edge_delivered':  1 if receipt['edge_delivered'] else 0,
#         'audio_played':    0,   # updated later when edge confirms playback
#     }
#     with _log_lock:
#         lconn = ensure_conn(_log_conn_r[0], LOCAL_DB, 'LocalDB-log')
#         _log_conn_r[0] = lconn
#         if lconn: insert_alert_log(lconn, log_row)

#     # Track unacked
#     with _unacked_lock:
#         _unacked[alert_id] = {
#             'alert_id':        alert_id,
#             'text':            text,
#             'zone_code':       zone_code,
#             'lang_code':       lang_code,
#             'device_ip':       device_ip,
#             'alert_category':  alert_category,
#             'alert_timestamp': alert_timestamp.isoformat(),
#             'escalation_count': 0,
#         }

#     log.info(f"[Alert {alert_id}] Done in {time.monotonic()-t0:.2f}s  "
#              f"lang={lang_code}  edge={receipt['edge_delivered']}")
#     log.info("─"*55)

# def _handle_guarded(alert, local_conn):
#     try: _handle_alert(alert, local_conn)
#     finally: _sem.release()

# def process_alert(alert, local_conn) -> bool:
#     """Returns True if dispatched (semaphore acquired, handler thread spawned),
#     False if dropped because the semaphore was busy — caller must not advance
#     its cursor past a dropped alert so it gets retried next poll cycle."""
#     if not _sem.acquire(timeout=5):
#         log.warning(f"[Alert {alert['id']}] Semaphore busy — will retry next poll cycle")
#         return False
#     threading.Thread(target=_handle_guarded, args=(alert,local_conn),
#                      daemon=True, name=f"alert-{alert['id']}").start()
#     return True

# # ══════════════════════════════════════════════════════════════════════════════
# # Acknowledge checker — every 3s
# # ══════════════════════════════════════════════════════════════════════════════

# def check_acknowledges(cloud_conn) -> None:
#     """
#     Re-check cloud DB status for all unacked alerts.
#     If status='ack': notify edge, update local log, remove from tracker.
#     If still unacked (Critical/High): increment escalation_count in log.
#     """
#     with _unacked_lock:
#         snapshot = dict(_unacked)
#     if not snapshot:
#         return

#     acked_ids = []
#     for alert_id, info in snapshot.items():
#         status = get_alert_status(cloud_conn, alert_id)

#         if status == 'ack':
#             ack_time  = datetime.datetime.now()
#             device_ip = info.get('device_ip') or ''
#             zone_code = info.get('zone_code') or ''
#             log.info(f"[Ack] Alert {alert_id} acked — notifying edge")
#             if device_ip:
#                 call_note_acknowledge(alert_id, device_ip, zone_code)
#             with _log_lock:
#                 lconn = ensure_conn(_log_conn_r[0], LOCAL_DB, 'LocalDB-ack')
#                 _log_conn_r[0] = lconn
#                 if lconn: update_log_ack(lconn, alert_id, ack_time)
#             acked_ids.append(alert_id)

#         elif info.get('alert_category') in ('Critical','High'):
#             # Still unacked — increment escalation in memory and DB
#             with _unacked_lock:
#                 if alert_id in _unacked:
#                     _unacked[alert_id]['escalation_count'] = \
#                         _unacked[alert_id].get('escalation_count',0) + 1
#             with _log_lock:
#                 lconn = ensure_conn(_log_conn_r[0], LOCAL_DB, 'LocalDB-esc')
#                 _log_conn_r[0] = lconn
#                 if lconn: update_log_escalation(lconn, alert_id)

#     if acked_ids:
#         with _unacked_lock:
#             for aid in acked_ids: _unacked.pop(aid, None)
#         log.info(f"[Ack] Removed {len(acked_ids)} from tracker")

# def _ack_loop(get_cloud_fn):
#     log.info(f"[Ack] Checker every {ACKNOWLEDGE_CHECK_SEC}s")
#     while True:
#         time.sleep(ACKNOWLEDGE_CHECK_SEC)
#         try:
#             conn = get_cloud_fn()
#             if conn: check_acknowledges(conn)
#         except Exception as e: log.error(f"[Ack] {e}")

# # ══════════════════════════════════════════════════════════════════════════════
# # Watchdog + Poll loop
# # ══════════════════════════════════════════════════════════════════════════════

# _last_tick = [time.monotonic()]

# def _watchdog():
#     while True:
#         time.sleep(60)
#         since = time.monotonic()-_last_tick[0]
#         if since > 60: log.error(f"[Watchdog] Stalled {since:.0f}s!")

# threading.Thread(target=_watchdog, daemon=True, name='watchdog').start()

# def poll_loop(local_conn, cloud_conn) -> None:
#     last_id=0; cycle=0; last_hb=time.monotonic()
#     log.info(f"[Poll] Started — {int(POLL_INTERVAL_SEC*1000)}ms")
#     while True:
#         t0=time.monotonic(); cycle+=1; _last_tick[0]=t0
#         try:
#             local_conn=ensure_conn(local_conn,LOCAL_DB,'LocalDB')
#             cloud_conn=ensure_conn(cloud_conn,CLOUD_DB,'CloudDB')
#             if local_conn: no_translate.refresh_if_changed(local_conn)
#             if cloud_conn:
#                 alerts=fetch_new_alerts(cloud_conn,last_id)
#                 if alerts:
#                     log.info(f"[Poll] {len(alerts)} new: {[a['id'] for a in alerts]}")
#                     for a in alerts:
#                         if process_alert(a, local_conn):
#                             last_id=max(last_id,a['id'])
#                         else:
#                             log.warning(f"[Poll] Dropped alert {a['id']} — stopping "
#                                         f"batch here, will retry from this id next cycle")
#                             break
#                 elif time.monotonic()-last_hb>=HEARTBEAT_SEC:
#                     log.info(f"[Poll] ♥ cycle={cycle} last_id={last_id} unacked={len(_unacked)}")
#                     last_hb=time.monotonic()
#             else: log.warning("[Poll] Cloud DB unavailable")
#         except Exception as e: log.error(f"[Poll] cycle {cycle}: {e}", exc_info=True)
#         time.sleep(max(0.0, POLL_INTERVAL_SEC-(time.monotonic()-t0)))

# # ══════════════════════════════════════════════════════════════════════════════
# # Flask endpoints
# # ══════════════════════════════════════════════════════════════════════════════

# app = Flask(__name__)
# _cloud_ref = [None]

# @app.route('/health', methods=['GET'])
# def health():
#     with _unacked_lock: n=len(_unacked)
#     return jsonify({'status':'ok','unacked':n,'tts_server':TTS_SERVER_URL})

# @app.route('/unacked', methods=['GET'])
# def unacked():
#     with _unacked_lock: data=list(_unacked.values())
#     return jsonify({'unacked':data,'count':len(data)})

# @app.route('/check-acknowledge', methods=['GET','POST'])
# def check_ack():
#     conn=ensure_conn(_cloud_ref[0],CLOUD_DB,'CloudDB'); _cloud_ref[0]=conn
#     if not conn: return jsonify({'error':'cloud DB unavailable'}),503
#     check_acknowledges(conn)
#     with _unacked_lock: rem=len(_unacked)
#     return jsonify({'checked':True,'unacked_remaining':rem})

# @app.route('/logs', methods=['GET'])
# def alert_logs():
#     limit=int(request.args.get('limit',50))
#     with _log_lock:
#         lconn=ensure_conn(_log_conn_r[0],LOCAL_DB,'LocalDB'); _log_conn_r[0]=lconn
#     if not lconn: return jsonify({'error':'local DB unavailable'}),503
#     try:
#         with lconn.cursor() as c:
#             c.execute(f"SELECT * FROM {ALERT_LOGS_TABLE} "
#                       f"ORDER BY id DESC LIMIT %s",(limit,))
#             rows=c.fetchall()
#         for r in rows:
#             for k,v in r.items():
#                 if isinstance(v,datetime.datetime): r[k]=v.isoformat()
#         return jsonify({'logs':rows,'count':len(rows)})
#     except Exception as e: return jsonify({'error':str(e)}),500

# # ══════════════════════════════════════════════════════════════════════════════
# # Entry point
# # ══════════════════════════════════════════════════════════════════════════════

# def main():
#     local_conn=connect_db(LOCAL_DB,'LocalDB')
#     if not local_conn: raise SystemExit("Cannot connect to local DB")
#     cloud_conn=connect_db(CLOUD_DB,'CloudDB')
#     if not cloud_conn: raise SystemExit("Cannot connect to cloud DB")

#     _cloud_ref[0]=cloud_conn; _log_conn_r[0]=local_conn

#     ensure_alert_logs_table(local_conn)
#     no_translate.load(local_conn)

#     ensure_alert_logs_table(cloud_conn)

#     try:
#         r=requests.get(f"{TTS_SERVER_URL}/health",timeout=5)
#         log.info(f"[Init] TTS server: {r.json().get('status')}")
#     except Exception as e: log.warning(f"[Init] TTS not reachable: {e}")

#     def _get_cloud():
#         _cloud_ref[0]=ensure_conn(_cloud_ref[0],CLOUD_DB,'CloudDB'); return _cloud_ref[0]

#     threading.Thread(target=_ack_loop,args=(_get_cloud,),daemon=True,name='ack').start()
#     threading.Thread(
#         target=lambda: app.run(host=SERVER_HOST,port=SERVER_PORT,
#                                threaded=True,use_reloader=False),
#         daemon=True,name='flask').start()

#     log.info("="*60)
#     log.info(f"  TTS server    : {TTS_SERVER_URL}")
#     log.info(f"  Poll          : {POLL_INTERVAL_SEC}s")
#     log.info(f"  Ack check     : every {ACKNOWLEDGE_CHECK_SEC}s")
#     log.info(f"  API           : http://{SERVER_HOST}:{SERVER_PORT}")
#     log.info(f"    GET /health  GET /unacked  GET /logs  GET /check-acknowledge")
#     log.info(f"  DB            : {ALERT_LOGS_TABLE} in local DB")
#     log.info("="*60)

#     try: poll_loop(local_conn,cloud_conn)
#     except KeyboardInterrupt: log.info("Stopped")
#     finally:
#         local_conn.close()
#         try: cloud_conn.close()
#         except Exception: pass

# if __name__=='__main__':
#     main()



"""
alert_poller.py  —  Cloud DB Poller + Alert Logger
───────────────────────────────────────────────────
1. Poll cloud DB every 1s for new alerts
2. For each alert: zone lookup → POST to TTS server /synthesise
3. TTS server returns synchronous receipt (edge_delivered, audio_queued)
4. Store alert log in LOCAL DB alert_logs table
5. Track unacked alerts in memory

Every 3s: re-check cloud DB for status='ack' on unacked alerts
  → call TTS /note-acknowledge → edge /acknowledge
  → update ack_time + escalation_count in local DB

alert_logs columns:
  alert_id, alert_timestamp, alert_category, alert_source,
  zone_code, lang_code, device_ip, tts_duration_sec,
  edge_delivered, audio_played, ack_time, escalation_count, created_at

Flask endpoints:
  GET  /health
  GET  /unacked
  GET  /logs?limit=50
  GET  /check-acknowledge
"""

import datetime
import json
import logging
import os
import threading
import time
from threading import Lock
from typing import Optional, Dict

import pymysql
import pymysql.cursors
import requests
from flask import Flask, jsonify, request

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

TTS_SERVER_URL        = os.getenv('TTS_SERVER_URL', 'http://localhost:6000')
POLL_INTERVAL_SEC     = 1.0
ACKNOWLEDGE_CHECK_SEC = 3.0
TTS_TIMEOUT_SEC       = 90
HEARTBEAT_SEC         = 30
SERVER_HOST           = '0.0.0.0'
SERVER_PORT           = 7000

LOCAL_DB = dict(
    host='localhost', port=3306,
    user='gateway', password='gateway',
    database='gateway', charset='utf8mb4', autocommit=True,
)

 
CLOUD_DB = dict(
    host='hayabusa.proxy.rlwy.net', port=47366,
    user='root', password='KyfbQYIzmmLUClWQQsJkyHpCfJPuMENK',
    database='railway', charset='utf8mb4',
    connect_timeout=5, read_timeout=8, write_timeout=8, autocommit=True,
)


CLOUD_ALERTS_TABLE = 'alerts'
NO_TRANSLATE_TABLE = 'app_no_translate_words'
ALERT_LOGS_TABLE   = 'alert_logs'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)-7s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════
# Unacked tracker  {alert_id → info_dict}
# ══════════════════════════════════════════════════════════════════════════════

_unacked      : Dict[int, dict] = {}
_unacked_lock = Lock()

# ══════════════════════════════════════════════════════════════════════════════
# No-translate words
# ══════════════════════════════════════════════════════════════════════════════

class NoTranslateWords:
    def __init__(self):
        self._lock=Lock(); self._words=[]; self._count=0
    def load(self, conn):
        with conn.cursor() as c:
            c.execute(f"SELECT word FROM {NO_TRANSLATE_TABLE} ORDER BY LENGTH(word) DESC")
            rows=c.fetchall()
            c.execute(f"SELECT COUNT(*) AS cnt FROM {NO_TRANSLATE_TABLE}")
            cnt=c.fetchone()['cnt']
        words=[r['word'] for r in rows]
        with self._lock: self._words,self._count=words,cnt
        log.info(f"[NT] {cnt} words  sample={words[:5]}")
    def refresh_if_changed(self, conn):
        try:
            with conn.cursor() as c:
                c.execute(f"SELECT COUNT(*) AS cnt FROM {NO_TRANSLATE_TABLE}")
                cnt=c.fetchone()['cnt']
            with self._lock: changed=cnt!=self._count
            if changed: self.load(conn)
        except Exception as e: log.warning(f"[NT] {e}")
    def get_words(self):
        with self._lock: return list(self._words)

no_translate = NoTranslateWords()

# ══════════════════════════════════════════════════════════════════════════════
# DB helpers
# ══════════════════════════════════════════════════════════════════════════════

def connect_db(cfg, label='DB'):
    try:
        c=pymysql.connect(**cfg, cursorclass=pymysql.cursors.DictCursor)
        log.info(f"[DB] {label} ✓"); return c
    except Exception as e:
        log.warning(f"[DB] {label} failed: {e}"); return None

def ensure_conn(conn, cfg, label):
    if conn is None: return connect_db(cfg, label)
    try: conn.ping(); return conn
    except Exception:
        log.warning(f"[DB] {label} stale — reconnect")
        try: conn.close()
        except Exception: pass
        return connect_db(cfg, label)

def get_zone(conn, zone_code):
    with conn.cursor() as c:
        c.execute("SELECT * FROM zones WHERE zone_code=%s LIMIT 1",(zone_code,))
        row=c.fetchone()
    if row: log.info(f"[Zone] {zone_code} → lang={row['default_language']}")
    else:   log.warning(f"[Zone] {zone_code} not found")
    return row

def get_gateway_ip(conn, zone_id):
    with conn.cursor() as c:
        c.execute("SELECT address FROM devices WHERE zone_id=%s "
                  "AND device_type IN ('Edge Node','Gateway') ORDER BY id LIMIT 1",(zone_id,))
        row=c.fetchone()
        if row: log.info(f"[Device] {row['address']}"); return row['address']
        c.execute("SELECT address FROM devices WHERE zone_id=%s "
                  "AND address REGEXP '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+' "
                  "ORDER BY id LIMIT 1",(zone_id,))
        row=c.fetchone()
    if row: log.info(f"[Device] Fallback: {row['address']}"); return row['address']
    log.warning(f"[Device] No IP for zone_id={zone_id}"); return None

def fetch_new_alerts(conn, last_id):
    """
    Fetch unacknowledged alerts with id > last_id.
    Uses 'acknowledged' column (0 = pending, 1 = acked).
    """
    with conn.cursor() as c:
        c.execute(f"SELECT * FROM {CLOUD_ALERTS_TABLE} "
                  f"WHERE id>%s AND (acknowledged IS NULL OR acknowledged=0) "
                  f"ORDER BY id ASC",(last_id,))
        return c.fetchall()

def get_alert_status(conn, alert_id) -> Optional[str]:
    """
    Return 'ack' if acknowledged=1, 'pending' if acknowledged=0, None if not found.
    """
    try:
        with conn.cursor() as c:
            c.execute(f"SELECT acknowledged, acknowledged_at "
                      f"FROM {CLOUD_ALERTS_TABLE} WHERE id=%s",(alert_id,))
            row=c.fetchone()
        if row is None: return None
        return 'ack' if row.get('acknowledged') == 1 else 'pending'
    except Exception as e:
        log.warning(f"[DB] status({alert_id}): {e}"); return None

# ══════════════════════════════════════════════════════════════════════════════
# Alert logs — LOCAL DB
# ══════════════════════════════════════════════════════════════════════════════

_LOGS_DDL = f"""
CREATE TABLE IF NOT EXISTS {ALERT_LOGS_TABLE} (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    alert_id          INT          NOT NULL,
    alert_timestamp   DATETIME     NOT NULL COMMENT 'When alert was created in cloud',
    alert_category    VARCHAR(32)  NOT NULL DEFAULT 'Normal',
    alert_source      VARCHAR(128) DEFAULT NULL COMMENT 'SCADA / PLC / manual etc',
    zone_code         VARCHAR(64)  DEFAULT NULL,
    lang_code         VARCHAR(8)   DEFAULT 'EN',
    device_ip         VARCHAR(64)  DEFAULT NULL COMMENT 'Edge node IP',
    tts_duration_sec  FLOAT        DEFAULT NULL COMMENT 'Time taken for TTS',
    edge_delivered    TINYINT(1)   DEFAULT 0   COMMENT 'Edge node received audio',
    audio_played      TINYINT(1)   DEFAULT 0   COMMENT 'Audio confirmed played on edge',
    ack_time          DATETIME     DEFAULT NULL COMMENT 'When operator acknowledged',
    escalation_count  INT          DEFAULT 0   COMMENT 'Times re-checked while unacked',
    created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_alert_id (alert_id),
    INDEX idx_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""

_ALERT_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLOUD_ALERTS_TABLE} (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    alert_type          VARCHAR(16)  NOT NULL DEFAULT 'SI' COMMENT 'e.g. SI',
    foundry_line_id     INT          NOT NULL,
    zone_code           VARCHAR(64)  DEFAULT NULL COMMENT 'Zone this alert belongs to',
    date                DATE         DEFAULT NULL,
    shift               VARCHAR(8)   DEFAULT NULL COMMENT '1 / 2 / 3',
    batch_pkey          INT          DEFAULT 0,
    period_key          VARCHAR(32)  DEFAULT NULL COMMENT 'e.g. 2026-05-31_3',
    si_score            FLOAT        DEFAULT NULL,
    alert_level         VARCHAR(32)  DEFAULT NULL COMMENT 'e.g. !! WARNING',
    root_cause          TEXT         DEFAULT NULL,
    recommendation      TEXT         DEFAULT NULL,
    params_json         JSON         DEFAULT NULL,
    raw_values_json     JSON         DEFAULT NULL,
    overall_status      VARCHAR(64)  DEFAULT NULL,
    tolerance           FLOAT        DEFAULT NULL,
    component_id        VARCHAR(64)  DEFAULT NULL,
    group_name          VARCHAR(128) DEFAULT NULL,
    batch_time          VARCHAR(64)  DEFAULT NULL,
    deviations_json     JSON         DEFAULT NULL,
    acknowledged        TINYINT(1)   NOT NULL DEFAULT 0,
    acknowledged_at     DATETIME     DEFAULT NULL,

    INDEX idx_foundry_line   (foundry_line_id),
    INDEX idx_created_at     (created_at),
    INDEX idx_acknowledged   (acknowledged),
    INDEX idx_period_key     (period_key),
    INDEX idx_zone_code      (zone_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

"""

def ensure_alert_logs_table(conn):
    try:
        with conn.cursor() as c: 
            c.execute(_LOGS_DDL)
            c.execute(_ALERT_DDL)
        log.info(f"[Log] {ALERT_LOGS_TABLE} ready")
    except Exception as e: log.error(f"[Log] DDL failed: {e}")

def insert_alert_log(conn, row: dict) -> Optional[int]:
    """Insert a row into alert_logs. Returns new id or None."""
    cols = ['alert_id','alert_timestamp','alert_category','alert_source',
            'zone_code','lang_code','device_ip','tts_duration_sec',
            'edge_delivered','audio_played']
    data = {c: row.get(c) for c in cols}
    try:
        ph = ','.join(['%s']*len(data))
        cn = ','.join(data.keys())
        with conn.cursor() as c:
            c.execute(f"INSERT INTO {ALERT_LOGS_TABLE} ({cn}) VALUES ({ph})",
                      list(data.values()))
        log.info(f"[Log] Inserted log for alert_id={row.get('alert_id')}")
        return conn.insert_id()
    except Exception as e:
        log.error(f"[Log] Insert failed: {e}"); return None

def update_log_ack(conn, alert_id, ack_time):
    try:
        with conn.cursor() as c:
            c.execute(f"UPDATE {ALERT_LOGS_TABLE} SET ack_time=%s "
                      f"WHERE alert_id=%s ORDER BY id DESC LIMIT 1",
                      (ack_time, alert_id))
        log.info(f"[Log] ack_time updated for alert_id={alert_id}")
    except Exception as e: log.error(f"[Log] ack update: {e}")

def update_log_escalation(conn, alert_id):
    try:
        with conn.cursor() as c:
            c.execute(f"UPDATE {ALERT_LOGS_TABLE} "
                      f"SET escalation_count=escalation_count+1 "
                      f"WHERE alert_id=%s ORDER BY id DESC LIMIT 1",(alert_id,))
    except Exception as e: log.error(f"[Log] escalation update: {e}")

def update_log_audio_played(conn, alert_id):
    """Mark audio_played=1 once edge confirms playback."""
    try:
        with conn.cursor() as c:
            c.execute(f"UPDATE {ALERT_LOGS_TABLE} SET audio_played=1 "
                      f"WHERE alert_id=%s ORDER BY id DESC LIMIT 1",(alert_id,))
    except Exception as e: log.error(f"[Log] audio_played update: {e}")

# ══════════════════════════════════════════════════════════════════════════════
# TTS server client
# ══════════════════════════════════════════════════════════════════════════════

# NOTE: conceptually mirrors ../dispatch_service.py's call_synthesise() — not shared code, keep in sync manually if either changes.
def call_synthesise(text, lang_code, alert_id=0, zone_code='',
                    alert_category='Normal', device_ip='', alert_source='',
                    process_parameters='') -> dict:
    """
    POST to TTS server /synthesise (SYNCHRONOUS).
    TTS server: translates → TTS → delivers to edge → returns receipt.

    process_parameters : optional human-readable string (component/group/
      param readings) built from a 'process_data' style cloud alert row —
      threaded through to the edge node so its /display UI can show the
      "Process Parameters" card. Empty string for plain/'normal' alerts.

    Returns:
      ok             : bool
      tts_duration   : float (seconds)
      edge_delivered : bool
      audio_queued   : bool
    """
    url     = f"{TTS_SERVER_URL.rstrip('/')}/synthesise"
    payload = {
        'text':               text,
        'lang_code':          lang_code,
        'no_translate_words': no_translate.get_words(),
        'alert_id':           alert_id,
        'zone_code':          zone_code,
        'alert_category':     alert_category,
        'device_ip':          device_ip,
        'alert_source':       alert_source,
        'process_parameters': process_parameters,
    }
    log.info(f"[TTS] /synthesise alert={alert_id} lang={lang_code} "
             f"cat={alert_category} device={device_ip or 'none'}")
    t0 = time.monotonic()
    try:
        resp = requests.post(url, json=payload, timeout=TTS_TIMEOUT_SEC)
        elapsed = time.monotonic()-t0
        if resp.status_code != 200:
            log.error(f"[TTS] HTTP {resp.status_code}: {resp.text[:100]}")
            return {'ok':False,'tts_duration':elapsed,
                    'edge_delivered':False,'audio_queued':False}
        # Read receipt from response headers
        tts_dur  = float(resp.headers.get('X-TTS-Duration', elapsed))
        edge_ok  = resp.headers.get('X-Edge-Delivered','false').lower()=='true'
        queued   = resp.headers.get('X-Audio-Queued','false').lower()=='true'
        log.info(f"[TTS] OK {elapsed:.2f}s  tts={tts_dur:.2f}s  "
                 f"edge={edge_ok}  queued={queued}")
        return {'ok':True,'tts_duration':tts_dur,
                'edge_delivered':edge_ok,'audio_queued':queued}
    except Exception as exc:
        log.error(f"[TTS] /synthesise error: {exc}")
        return {'ok':False,'tts_duration':time.monotonic()-t0,
                'edge_delivered':False,'audio_queued':False}

def call_note_acknowledge(alert_id, device_ip, zone_code=''):
    url = f"{TTS_SERVER_URL.rstrip('/')}/note-acknowledge"
    try:
        resp = requests.post(url, json={'alert_id':alert_id,
                                        'device_ip':device_ip,
                                        'zone_code':zone_code}, timeout=10)
        log.info(f"[TTS] /note-acknowledge alert={alert_id} → {resp.status_code}")
    except Exception as e: log.error(f"[TTS] /note-acknowledge: {e}")

# ══════════════════════════════════════════════════════════════════════════════
# Alert processing
# ══════════════════════════════════════════════════════════════════════════════

_sem        = threading.Semaphore(8)
_log_lock   = Lock()
_log_conn_r = [None]   # local DB connection used by log writes

def _map_alert_level(alert_level: str) -> str:
    """
    Map cloud DB alert_level string to standard category.
      "!! CRITICAL" / "CRITICAL"  → "Critical"
      "!! WARNING"  / "WARNING"   → "High"
      "!! ALERT"    / "ALERT"     → "Normal"
      anything else               → "Normal"
    """
    lvl = (alert_level or '').upper().replace('!','').strip()
    if 'CRITICAL' in lvl: return 'Critical'
    if 'WARNING'  in lvl: return 'High'
    if 'ALERT'    in lvl: return 'Normal'
    return 'Normal'


def _build_process_parameters(alert: dict) -> str:
    """
    Build a human-readable "Process Parameters" string for the edge node's
    /display UI from a 'process_data' style cloud alert row (component_id,
    group_name, params_json, tolerance, overall_status). Returns '' for a
    plain 'normal' alert that has none of these populated — the display
    card then just shows "Not available", same as today.
    """
    parts = []

    component_id = str(alert.get('component_id') or '').strip()
    group_name   = str(alert.get('group_name') or '').strip()
    if component_id: parts.append(f"Component: {component_id}")
    if group_name:   parts.append(f"Group: {group_name}")

    params_raw = alert.get('params_json')
    params = []
    if params_raw:
        try:
            params = params_raw if isinstance(params_raw, list) else json.loads(params_raw)
        except Exception as e:
            log.warning(f"[Process] params_json parse failed: {e}")

    for p in params:
        if not isinstance(p, dict):
            continue
        label = p.get('label') or p.get('param') or 'Param'
        val   = p.get('raw_value')
        dev   = p.get('deviation')
        piece = f"{label}: {val}" if val is not None else str(label)
        if dev:
            piece += f" ({dev})"
        parts.append(piece)

    tolerance = alert.get('tolerance')
    if tolerance not in (None, ''):
        parts.append(f"Tolerance: ±{tolerance}")

    overall_status = str(alert.get('overall_status') or '').strip()
    if overall_status:
        parts.append(f"Status: {overall_status}")

    return ' | '.join(parts)


def _get_zone_for_foundry_line(conn, foundry_line_id) -> Optional[dict]:
    """
    Look up zone by foundry_line_id.
    Tries zones.foundry_line_id column first, falls back to zone_code matching.
    """
    try:
        with conn.cursor() as c:
            # Try direct foundry_line_id column if it exists
            c.execute("SELECT * FROM zones WHERE line_id=%s LIMIT 1",
                      (foundry_line_id,))
            row = c.fetchone()
            if row:
                log.info(f"[Zone] foundry_line_id={foundry_line_id} → "
                         f"zone={row.get('zone_code')} lang={row.get('default_language')}")
                return row
    except Exception:
        pass
    # Fallback: treat foundry_line_id as zone_code
    try:
        with conn.cursor() as c:
            c.execute("SELECT * FROM zones WHERE zone_code=%s LIMIT 1",
                      (str(foundry_line_id),))
            row = c.fetchone()
        if row:
            log.info(f"[Zone] zone_code={foundry_line_id} → lang={row.get('default_language')}")
            return row
    except Exception:
        pass
    log.warning(f"[Zone] No zone for foundry_line_id={foundry_line_id}")
    return None


def _handle_alert(alert: dict, local_conn) -> None:
    alert_id = alert['id']

    # ── Extract text to speak ─────────────────────────────────────────────────
    # Use root_cause as the primary text. Append recommendation if present.
    root_cause     = (alert.get('root_cause') or '').strip()
    recommendation = (alert.get('recommendation') or '').strip()
    if root_cause and recommendation:
        text = f"{root_cause}. {recommendation}"
    else:
        text = root_cause or recommendation or str(alert_id)

    # ── Extract metadata ──────────────────────────────────────────────────────
    alert_level    = alert.get('alert_level') or ''
    alert_category = _map_alert_level(alert_level)
    alert_source   = alert.get('alert_type') or ''
    foundry_line_id = alert.get('foundry_line_id')

    raw_ts = alert.get('created_at') or alert.get('updated_at')
    alert_timestamp = raw_ts if isinstance(raw_ts, datetime.datetime)                      else datetime.datetime.now()

    process_parameters = _build_process_parameters(alert)

    t0 = time.monotonic()
    log.info("─"*55)
    log.info(f"[Alert {alert_id}] level={alert_level} → cat={alert_category}  "
             f"line={foundry_line_id}  source={alert_source}")
    log.info(f"[Alert {alert_id}] {text[:100]}")

    # ── Zone lookup via foundry_line_id ───────────────────────────────────────
    zone      = _get_zone_for_foundry_line(local_conn, foundry_line_id)                 if foundry_line_id else None
    zone_code = zone.get('zone_code','') if zone else str(foundry_line_id or '')
    lang_code = zone['default_language'].upper() if zone else 'EN'
    device_ip = get_gateway_ip(local_conn, zone['id']) if zone else None

    receipt = call_synthesise(
        text, lang_code,
        alert_id=alert_id, zone_code=zone_code,
        alert_category=alert_category, device_ip=device_ip or '',
        alert_source=alert_source,
        process_parameters=process_parameters,
    )

    # Insert alert log
    log_row = {
        'alert_id':        alert_id,
        'alert_timestamp': alert_timestamp,
        'alert_category':  alert_category,
        'alert_source':    alert_source or None,
        'zone_code':       zone_code or None,
        'lang_code':       lang_code,
        'device_ip':       device_ip or None,
        'tts_duration_sec': round(receipt['tts_duration'],3),
        'edge_delivered':  1 if receipt['edge_delivered'] else 0,
        'audio_played':    0,   # updated later when edge confirms playback
    }
    with _log_lock:
        lconn = ensure_conn(_log_conn_r[0], LOCAL_DB, 'LocalDB-log')
        _log_conn_r[0] = lconn
        if lconn: insert_alert_log(lconn, log_row)

    # Track unacked
    with _unacked_lock:
        _unacked[alert_id] = {
            'alert_id':        alert_id,
            'text':            text,
            'zone_code':       zone_code,
            'lang_code':       lang_code,
            'device_ip':       device_ip,
            'alert_category':  alert_category,
            'alert_timestamp': alert_timestamp.isoformat(),
            'escalation_count': 0,
        }

    log.info(f"[Alert {alert_id}] Done in {time.monotonic()-t0:.2f}s  "
             f"lang={lang_code}  edge={receipt['edge_delivered']}")
    log.info("─"*55)

def _handle_guarded(alert, local_conn):
    try: _handle_alert(alert, local_conn)
    finally: _sem.release()

def process_alert(alert, local_conn) -> bool:
    """Returns True if dispatched (semaphore acquired, handler thread spawned),
    False if dropped because the semaphore was busy — caller must not advance
    its cursor past a dropped alert so it gets retried next poll cycle."""
    if not _sem.acquire(timeout=5):
        log.warning(f"[Alert {alert['id']}] Semaphore busy — will retry next poll cycle")
        return False
    threading.Thread(target=_handle_guarded, args=(alert,local_conn),
                     daemon=True, name=f"alert-{alert['id']}").start()
    return True

# ══════════════════════════════════════════════════════════════════════════════
# Acknowledge checker — every 3s
# ══════════════════════════════════════════════════════════════════════════════

def check_acknowledges(cloud_conn) -> None:
    """
    Re-check cloud DB status for all unacked alerts.
    If status='ack': notify edge, update local log, remove from tracker.
    If still unacked (Critical/High): increment escalation_count in log.
    """
    with _unacked_lock:
        snapshot = dict(_unacked)
    if not snapshot:
        return

    acked_ids = []
    for alert_id, info in snapshot.items():
        status = get_alert_status(cloud_conn, alert_id)

        if status == 'ack':
            ack_time  = datetime.datetime.now()
            device_ip = info.get('device_ip') or ''
            zone_code = info.get('zone_code') or ''
            log.info(f"[Ack] Alert {alert_id} acked — notifying edge")
            if device_ip:
                call_note_acknowledge(alert_id, device_ip, zone_code)
            with _log_lock:
                lconn = ensure_conn(_log_conn_r[0], LOCAL_DB, 'LocalDB-ack')
                _log_conn_r[0] = lconn
                if lconn: update_log_ack(lconn, alert_id, ack_time)
            acked_ids.append(alert_id)

        elif info.get('alert_category') in ('Critical','High'):
            # Still unacked — increment escalation in memory and DB
            with _unacked_lock:
                if alert_id in _unacked:
                    _unacked[alert_id]['escalation_count'] = \
                        _unacked[alert_id].get('escalation_count',0) + 1
            with _log_lock:
                lconn = ensure_conn(_log_conn_r[0], LOCAL_DB, 'LocalDB-esc')
                _log_conn_r[0] = lconn
                if lconn: update_log_escalation(lconn, alert_id)

    if acked_ids:
        with _unacked_lock:
            for aid in acked_ids: _unacked.pop(aid, None)
        log.info(f"[Ack] Removed {len(acked_ids)} from tracker")

def _ack_loop(get_cloud_fn):
    log.info(f"[Ack] Checker every {ACKNOWLEDGE_CHECK_SEC}s")
    while True:
        time.sleep(ACKNOWLEDGE_CHECK_SEC)
        try:
            conn = get_cloud_fn()
            if conn: check_acknowledges(conn)
        except Exception as e: log.error(f"[Ack] {e}")

# ══════════════════════════════════════════════════════════════════════════════
# Watchdog + Poll loop
# ══════════════════════════════════════════════════════════════════════════════

_last_tick = [time.monotonic()]

def _watchdog():
    while True:
        time.sleep(60)
        since = time.monotonic()-_last_tick[0]
        if since > 60: log.error(f"[Watchdog] Stalled {since:.0f}s!")

threading.Thread(target=_watchdog, daemon=True, name='watchdog').start()

def poll_loop(local_conn, cloud_conn) -> None:
    last_id=0; cycle=0; last_hb=time.monotonic()
    log.info(f"[Poll] Started — {int(POLL_INTERVAL_SEC*1000)}ms")
    while True:
        t0=time.monotonic(); cycle+=1; _last_tick[0]=t0
        try:
            local_conn=ensure_conn(local_conn,LOCAL_DB,'LocalDB')
            cloud_conn=ensure_conn(cloud_conn,CLOUD_DB,'CloudDB')
            if local_conn: no_translate.refresh_if_changed(local_conn)
            if cloud_conn:
                alerts=fetch_new_alerts(cloud_conn,last_id)
                if alerts:
                    log.info(f"[Poll] {len(alerts)} new: {[a['id'] for a in alerts]}")
                    for a in alerts:
                        if process_alert(a, local_conn):
                            last_id=max(last_id,a['id'])
                        else:
                            log.warning(f"[Poll] Dropped alert {a['id']} — stopping "
                                        f"batch here, will retry from this id next cycle")
                            break
                elif time.monotonic()-last_hb>=HEARTBEAT_SEC:
                    log.info(f"[Poll] ♥ cycle={cycle} last_id={last_id} unacked={len(_unacked)}")
                    last_hb=time.monotonic()
            else: log.warning("[Poll] Cloud DB unavailable")
        except Exception as e: log.error(f"[Poll] cycle {cycle}: {e}", exc_info=True)
        time.sleep(max(0.0, POLL_INTERVAL_SEC-(time.monotonic()-t0)))

# ══════════════════════════════════════════════════════════════════════════════
# Flask endpoints
# ══════════════════════════════════════════════════════════════════════════════

app = Flask(__name__)
_cloud_ref = [None]

@app.route('/health', methods=['GET'])
def health():
    with _unacked_lock: n=len(_unacked)
    return jsonify({'status':'ok','unacked':n,'tts_server':TTS_SERVER_URL})

@app.route('/unacked', methods=['GET'])
def unacked():
    with _unacked_lock: data=list(_unacked.values())
    return jsonify({'unacked':data,'count':len(data)})

@app.route('/check-acknowledge', methods=['GET','POST'])
def check_ack():
    conn=ensure_conn(_cloud_ref[0],CLOUD_DB,'CloudDB'); _cloud_ref[0]=conn
    if not conn: return jsonify({'error':'cloud DB unavailable'}),503
    check_acknowledges(conn)
    with _unacked_lock: rem=len(_unacked)
    return jsonify({'checked':True,'unacked_remaining':rem})

@app.route('/logs', methods=['GET'])
def alert_logs():
    limit=int(request.args.get('limit',50))
    with _log_lock:
        lconn=ensure_conn(_log_conn_r[0],LOCAL_DB,'LocalDB'); _log_conn_r[0]=lconn
    if not lconn: return jsonify({'error':'local DB unavailable'}),503
    try:
        with lconn.cursor() as c:
            c.execute(f"SELECT * FROM {ALERT_LOGS_TABLE} "
                      f"ORDER BY id DESC LIMIT %s",(limit,))
            rows=c.fetchall()
        for r in rows:
            for k,v in r.items():
                if isinstance(v,datetime.datetime): r[k]=v.isoformat()
        return jsonify({'logs':rows,'count':len(rows)})
    except Exception as e: return jsonify({'error':str(e)}),500

# ══════════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════════

def main():
    local_conn=connect_db(LOCAL_DB,'LocalDB')
    if not local_conn: raise SystemExit("Cannot connect to local DB")
    cloud_conn=connect_db(CLOUD_DB,'CloudDB')
    if not cloud_conn: raise SystemExit("Cannot connect to cloud DB")

    _cloud_ref[0]=cloud_conn; _log_conn_r[0]=local_conn

    ensure_alert_logs_table(local_conn)
    no_translate.load(local_conn)

    ensure_alert_logs_table(cloud_conn)

    try:
        r=requests.get(f"{TTS_SERVER_URL}/health",timeout=5)
        log.info(f"[Init] TTS server: {r.json().get('status')}")
    except Exception as e: log.warning(f"[Init] TTS not reachable: {e}")

    def _get_cloud():
        _cloud_ref[0]=ensure_conn(_cloud_ref[0],CLOUD_DB,'CloudDB'); return _cloud_ref[0]

    threading.Thread(target=_ack_loop,args=(_get_cloud,),daemon=True,name='ack').start()
    threading.Thread(
        target=lambda: app.run(host=SERVER_HOST,port=SERVER_PORT,
                               threaded=True,use_reloader=False),
        daemon=True,name='flask').start()

    log.info("="*60)
    log.info(f"  TTS server    : {TTS_SERVER_URL}")
    log.info(f"  Poll          : {POLL_INTERVAL_SEC}s")
    log.info(f"  Ack check     : every {ACKNOWLEDGE_CHECK_SEC}s")
    log.info(f"  API           : http://{SERVER_HOST}:{SERVER_PORT}")
    log.info(f"    GET /health  GET /unacked  GET /logs  GET /check-acknowledge")
    log.info(f"  DB            : {ALERT_LOGS_TABLE} in local DB")
    log.info("="*60)

    try: poll_loop(local_conn,cloud_conn)
    except KeyboardInterrupt: log.info("Stopped")
    finally:
        local_conn.close()
        try: cloud_conn.close()
        except Exception: pass

if __name__=='__main__':
    main()