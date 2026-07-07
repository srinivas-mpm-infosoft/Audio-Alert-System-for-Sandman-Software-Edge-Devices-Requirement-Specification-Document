"""
scheduler_service.py — background engine for Scheduled Announcements (D5).

Runs a daemon thread that wakes on a short interval, finds schedules whose
next_run_at has passed, dispatches them through dispatch_service (the same
pipeline manual broadcasts use — translate/TTS or pre-recorded clip, deliver
to every target zone's edge node, log into alert_logs), and computes the
following next_run_at.

Takes the Flask app/db/model objects at start() time rather than importing
flask_backend directly, to avoid a circular import (flask_backend imports
this module).
"""

import logging
import threading
import time
from datetime import datetime, timedelta

log = logging.getLogger("configuration_ui")

_CHECK_INTERVAL_SEC = 20
_started = False


def compute_next_run(schedule_type, scheduled_at, days_of_week, time_of_day, after=None):
    """
    Return the next datetime this schedule should fire, or None if it has
    nothing left to schedule (e.g. a one-off that already ran).
    """
    after = after or datetime.now()

    if schedule_type == "once":
        return scheduled_at if (scheduled_at and scheduled_at > after) else None

    if not time_of_day:
        return None
    try:
        hh, mm = [int(x) for x in str(time_of_day).split(":")[:2]]
    except Exception:
        return None

    if schedule_type == "daily":
        candidate = after.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if candidate <= after:
            candidate += timedelta(days=1)
        return candidate

    if schedule_type == "weekly":
        days = days_of_week or []
        if not days:
            return None
        for delta in range(8):
            candidate_date = after + timedelta(days=delta)
            if candidate_date.weekday() in days:
                candidate = candidate_date.replace(hour=hh, minute=mm, second=0, microsecond=0)
                if candidate > after:
                    return candidate
        return None

    return None


def _run_due(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes):
    with app.app_context():
        now = datetime.now()
        due = ScheduledAnnouncement.query.filter(
            ScheduledAnnouncement.is_enabled.is_(True),
            ScheduledAnnouncement.next_run_at.isnot(None),
            ScheduledAnnouncement.next_run_at <= now,
        ).all()
        for sched in due:
            try:
                zone_codes = list(sched.zone_ids or [])
                if sched.plant_wide:
                    zone_codes = all_zone_codes()

                if not zone_codes:
                    log.warning("[Scheduler] '%s' has no target zones — skipping", sched.name)
                    status = "failed"
                else:
                    clip_path = sched.clip.file_path if (sched.clip_id and sched.clip) else None
                    receipts = dispatch_broadcast(
                        zone_codes,
                        message=sched.message if not clip_path else None,
                        clip_path=clip_path,
                        language=sched.language or "EN",
                        alert_category="Normal",
                        alert_source=f"Scheduled: {sched.name}",
                        announcement_type="scheduled",
                    )
                    delivered = sum(1 for r in receipts if r.get("edge_delivered"))
                    if not receipts:
                        status = "failed"
                    elif delivered == len(receipts):
                        status = "success"
                    elif delivered:
                        status = "partial"
                    else:
                        status = "failed"
                    log.info("[Scheduler] Ran '%s' — %d/%d zones delivered",
                             sched.name, delivered, len(receipts))

                sched.last_run_at = now
                sched.last_run_status = status
                sched.next_run_at = compute_next_run(
                    sched.schedule_type, sched.scheduled_at, sched.days_of_week,
                    sched.time_of_day, after=now,
                )
                if sched.schedule_type == "once":
                    sched.is_enabled = False
                db.session.commit()
            except Exception as e:
                log.error("[Scheduler] Failed running '%s': %s", sched.name, e)
                db.session.rollback()


def _loop(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes):
    log.info("[Scheduler] Started — checking every %ss", _CHECK_INTERVAL_SEC)
    while True:
        try:
            _run_due(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes)
        except Exception as e:
            log.error("[Scheduler] loop error: %s", e)
        time.sleep(_CHECK_INTERVAL_SEC)


def start(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes, interval_sec: int = 20):
    """Call once at app startup."""
    global _CHECK_INTERVAL_SEC, _started
    if _started:
        return
    _CHECK_INTERVAL_SEC = interval_sec
    _started = True
    threading.Thread(
        target=_loop,
        args=(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes),
        daemon=True, name="scheduler",
    ).start()
