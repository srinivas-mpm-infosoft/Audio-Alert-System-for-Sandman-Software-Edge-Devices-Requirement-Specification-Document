"""
events_bus.py — tiny in-process pub/sub so background services
(dispatch_service, heartbeat_service, scheduler_service, sop_service) can
push real-time events to any dashboard browser connected via
flask_backend.py's /audio-alerts/dashboard/ws, without those services
needing to know anything about Flask or WebSockets.

Event shape is a plain JSON-serialisable dict with at least a "type" key,
e.g. {"type": "device_status", "device_id": ..., "status": "online"},
{"type": "announcement", ...}, {"type": "sop_execution", ...}.
"""

import logging
import threading

log = logging.getLogger("configuration_ui")

_lock = threading.Lock()
_subscribers = []  # list of callables: fn(event: dict) -> None


def subscribe(callback):
    with _lock:
        _subscribers.append(callback)


def unsubscribe(callback):
    with _lock:
        if callback in _subscribers:
            _subscribers.remove(callback)


def publish(event: dict):
    with _lock:
        subs = list(_subscribers)
    for cb in subs:
        try:
            cb(event)
        except Exception as e:
            log.warning("[Events] subscriber failed: %s", e)
