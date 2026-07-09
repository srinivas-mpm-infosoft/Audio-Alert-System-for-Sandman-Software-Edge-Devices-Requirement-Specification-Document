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
from pathlib import Path

log = logging.getLogger("configuration_ui")

_CHECK_INTERVAL_SEC = 20
_started = False


def _clip_abs_path(file_path):
    # AudioClip.file_path is just a filename, resolved against uploads/clips
    # at read time (not shared code with flask_backend.py's identical
    # helper — kept in sync manually, same as other sibling-file duplication
    # in this codebase). Absolute legacy paths from before this fix still
    # work as-is, no migration needed.
    if not file_path:
        return None
    p = Path(file_path)
    if p.is_absolute():
        return p
    return Path(__file__).parent / "uploads" / "clips" / file_path


def _hm_to_min(hhmm):
    hh, mm = [int(x) for x in str(hhmm).split(":")[:2]]
    return hh * 60 + mm


def _naive(dt):
    """Strip tzinfo so comparisons against datetime.now() (naive) never blow
    up with 'can't compare offset-naive and offset-aware datetimes'."""
    if dt is not None and dt.tzinfo is not None:
        return dt.astimezone().replace(tzinfo=None)
    return dt


def compute_next_run(schedule_type, scheduled_at, days_of_week, time_of_day, after=None,
                     interval_hours=None, shift_name=None, shift_event=None,
                     shift_offset_min=None, shifts_config=None):
    """
    Return the next datetime this schedule should fire, or None if it has
    nothing left to schedule (e.g. a one-off that already ran).
    """
    after = _naive(after) or datetime.now()
    scheduled_at = _naive(scheduled_at)

    if schedule_type == "once":
        return scheduled_at if (scheduled_at and scheduled_at > after) else None

    if schedule_type == "shift":
        # Resolve to a plain clock time, then fall through to "daily" —
        # "next occurrence of this HH:MM" is the same computation whether
        # that time happens to be a shift boundary or not. This also makes
        # overnight shifts (end < start) work for free: the target minute
        # wraps via modulo, and "next occurrence of a wall-clock time" needs
        # no special-casing for which calendar day the shift logically began.
        shift = (shifts_config or {}).get(shift_name)
        if not shift:
            return None
        try:
            start_min = _hm_to_min(shift["start"])
            end_min = _hm_to_min(shift["end"])
        except Exception:
            return None
        if shift_event == "end":
            target_min = end_min
        else:  # "start" (offset 0) or "offset" (signed minutes from start)
            target_min = (start_min + (shift_offset_min or 0)) % 1440
        time_of_day = f"{target_min // 60:02d}:{target_min % 60:02d}"
        schedule_type = "daily"

    if schedule_type == "hourly":
        try:
            _, minute = [int(x) for x in str(time_of_day).split(":")[:2]]
            interval = max(1, min(int(interval_hours), 24))
        except Exception:
            return None
        hours_today = range(0, 24, interval)
        for h in hours_today:
            candidate = after.replace(hour=h, minute=minute, second=0, microsecond=0)
            if candidate > after:
                return candidate
        tomorrow = after + timedelta(days=1)
        return tomorrow.replace(hour=hours_today[0], minute=minute, second=0, microsecond=0)

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


def _run_due(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes, get_shifts_config=None):
    with app.app_context():
        now = datetime.now()
        shifts_config = get_shifts_config() if get_shifts_config else {}
        due = ScheduledAnnouncement.query.filter(
            ScheduledAnnouncement.is_enabled.is_(True),
            ScheduledAnnouncement.next_run_at.isnot(None),
            ScheduledAnnouncement.next_run_at <= now,
        ).all()
        for sched in due:
            try:
                # Claim this run BEFORE dispatching: advance next_run_at (and
                # disable one-offs) and commit first. If dispatch_broadcast
                # then hangs or raises, the schedule is already moved past
                # "due" and won't be picked up and re-fired on the next tick.
                sched.next_run_at = compute_next_run(
                    sched.schedule_type, sched.scheduled_at, sched.days_of_week, sched.time_of_day,
                    after=now, interval_hours=sched.interval_hours, shift_name=sched.shift_name,
                    shift_event=sched.shift_event, shift_offset_min=sched.shift_offset_min,
                    shifts_config=shifts_config,
                )
                if sched.schedule_type == "once":
                    sched.is_enabled = False
                db.session.commit()

                zone_codes = list(sched.zone_ids or [])
                if sched.plant_wide:
                    zone_codes = all_zone_codes()

                if not zone_codes:
                    log.warning("[Scheduler] '%s' has no target zones — skipping", sched.name)
                    status = "failed"
                else:
                    clip_path = str(_clip_abs_path(sched.clip.file_path)) if (sched.clip_id and sched.clip) else None
                    receipts = dispatch_broadcast(
                        zone_codes,
                        message=sched.message if not clip_path else None,
                        clip_path=clip_path,
                        language=sched.language,
                        alert_category=sched.type_code or "Normal",
                        alert_source=f"Scheduled: {sched.name}",
                        announcement_type="scheduled",
                        type_code=sched.type_code,
                        play_count_override=sched.play_count_override,
                        requires_ack_override=sched.requires_ack_override,
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
                db.session.commit()
            except Exception as e:
                log.error("[Scheduler] Failed running '%s': %s", sched.name, e)
                db.session.rollback()


def _loop(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes, get_shifts_config=None):
    log.info("[Scheduler] Started — checking every %ss", _CHECK_INTERVAL_SEC)
    while True:
        try:
            _run_due(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes, get_shifts_config)
        except Exception as e:
            log.error("[Scheduler] loop error: %s", e)
        time.sleep(_CHECK_INTERVAL_SEC)


def start(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes,
         interval_sec: int = 20, get_shifts_config=None):
    """Call once at app startup."""
    global _CHECK_INTERVAL_SEC, _started
    if _started:
        return
    _CHECK_INTERVAL_SEC = interval_sec
    _started = True
    threading.Thread(
        target=_loop,
        args=(app, db, ScheduledAnnouncement, dispatch_broadcast, all_zone_codes, get_shifts_config),
        daemon=True, name="scheduler",
    ).start()