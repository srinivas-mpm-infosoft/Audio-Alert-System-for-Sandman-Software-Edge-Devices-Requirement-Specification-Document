"""
sop_service.py — SOP Step-by-Step Audio Guidance execution engine (D4).

Implements the required state machine:
  NOT_STARTED -> PLAYING_STEP -> WAITING_FOR_ACKNOWLEDGEMENT -> (next step:
  PLAYING_STEP again, or COMPLETED). Also CANCELLED / FAILED.

Reuses dispatch_service.dispatch_broadcast (same pipeline as manual
broadcasts/schedules — translate/TTS or pre-recorded clip, deliver, log into
alert_logs with announcement_type="sop") for playing step audio, and
events_bus.publish() so the SOP Execution dashboard gets live state pushes
over the same /audio-alerts/dashboard/ws channel Live Voice Paging's device
health and announcement events already use — no separate WebSocket needed.

Every state transition writes a SopStepExecution audit row (operator,
timestamps, retry count, event type) per the required audit trail.

Follows scheduler_service.py's background-thread-with-app-context pattern
since this needs the ORM, not heartbeat_service.py's raw-pymysql pattern.
"""

import logging
import threading
import time
import uuid
from datetime import datetime

import events_bus

log = logging.getLogger("configuration_ui")

_started = False
_CHECK_INTERVAL_SEC = 5


def _play_current_step(execution, sop, SopStepExecution, db, dispatch_broadcast, all_zone_codes):
    step = sop.steps[execution.current_step_index]
    zone_codes = list(execution.zone_ids or [])
    if execution.plant_wide:
        zone_codes = all_zone_codes()

    clip_path = step.clip.file_path if (step.clip_id and step.clip) else None
    receipts = dispatch_broadcast(
        zone_codes,
        message=step.message if not clip_path else None,
        clip_path=clip_path,
        language=step.language,
        alert_category=step.type_code or "High",
        alert_source=f"SOP: {execution.sop_name} — step {execution.current_step_index + 1}",
        announcement_type="sop",
        type_code=step.type_code,
        play_count_override=step.play_count_override,
        requires_ack_override=step.requires_ack_override,
    )
    for r in receipts:
        db.session.add(SopStepExecution(
            execution_id=execution.id, sop_id=sop.id, step_id=step.id,
            step_number=execution.current_step_index + 1, event_type="played",
            audio_mode=step.audio_mode, zone_code=r.get("zone_code"),
            language=step.language, operator=execution.started_by,
            retry_count=execution.retry_count,
        ))
    # Remember what's now queued on each edge node so acknowledge()/cancel()/
    # timeout-replay can explicitly clear it — step audio is High priority,
    # which the edge node replays every ~20s on its own until it gets an
    # /acknowledge for that exact alert_id (advancing the SOP step here only
    # updates this DB row; it doesn't by itself stop the edge node's replay).
    execution.current_receipts = [
        {"device_ip": r["device_ip"], "alert_id": r["alert_id"]}
        for r in receipts if r.get("device_ip") and r.get("alert_id")
    ]
    db.session.commit()
    return receipts


def _clear_current_receipts(execution, acknowledge_on_edge):
    """Tell every edge node holding this step's audio to stop replaying it.
    Best-effort: an unreachable edge node shouldn't block the SOP state
    transition, it just means that one node keeps repeating until its own
    queue self-clears or it's restarted."""
    for r in (execution.current_receipts or []):
        try:
            acknowledge_on_edge(r["device_ip"], r["alert_id"])
        except Exception as e:
            log.warning("[SOP] acknowledge_on_edge(%s, %s) failed: %s",
                       r.get("device_ip"), r.get("alert_id"), e)
    execution.current_receipts = []


def start_execution(app, db, Sop, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes, sop_id, user):
    with app.app_context():
        sop = Sop.query.filter_by(sop_code=sop_id, is_active=True).first()
        if not sop:
            return None, "SOP not found or inactive"
        if not sop.steps:
            return None, "SOP has no steps configured"

        execution = SopExecution(
            execution_code=f"sopexec-{uuid.uuid4().hex[:10]}",
            sop_id=sop.id, sop_name=sop.name, status="PLAYING_STEP",
            current_step_index=0, zone_ids=sop.zone_ids, plant_wide=sop.plant_wide,
            started_by=user, started_at=datetime.now(),
        )
        db.session.add(execution)
        db.session.commit()

        try:
            _play_current_step(execution, sop, SopStepExecution, db, dispatch_broadcast, all_zone_codes)
            execution.status = "WAITING_FOR_ACKNOWLEDGEMENT"
            execution.step_started_at = datetime.now()
            db.session.commit()
        except Exception as e:
            log.error("[SOP] start_execution failed: %s", e)
            db.session.rollback()
            execution.status = "FAILED"
            execution.error = str(e)[:500]
            execution.completed_at = datetime.now()
            db.session.commit()

        out = execution.to_dict()
        events_bus.publish({"type": "sop_execution", **out})
        return out, None


def acknowledge(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes,
                execution_id, user, acknowledge_on_edge=None):
    with app.app_context():
        execution = SopExecution.query.filter_by(execution_code=execution_id).first()
        if not execution:
            return None, "Execution not found"
        if execution.status != "WAITING_FOR_ACKNOWLEDGEMENT":
            return None, f"Execution is not waiting for acknowledgement (status={execution.status})"

        sop = execution.sop
        step = sop.steps[execution.current_step_index]
        db.session.add(SopStepExecution(
            execution_id=execution.id, sop_id=sop.id, step_id=step.id,
            step_number=execution.current_step_index + 1, event_type="acknowledged",
            audio_mode=step.audio_mode, language=step.language,
            operator=user, retry_count=execution.retry_count,
        ))
        if acknowledge_on_edge:
            _clear_current_receipts(execution, acknowledge_on_edge)

        next_index = execution.current_step_index + 1
        if next_index >= len(sop.steps):
            execution.status = "COMPLETED"
            execution.completed_at = datetime.now()
            db.session.add(SopStepExecution(
                execution_id=execution.id, sop_id=sop.id, step_id=step.id,
                step_number=execution.current_step_index + 1, event_type="completed",
                audio_mode=step.audio_mode, operator=user,
            ))
            db.session.commit()
        else:
            execution.current_step_index = next_index
            execution.retry_count = 0
            execution.status = "PLAYING_STEP"
            db.session.commit()
            try:
                _play_current_step(execution, sop, SopStepExecution, db, dispatch_broadcast, all_zone_codes)
                execution.status = "WAITING_FOR_ACKNOWLEDGEMENT"
                execution.step_started_at = datetime.now()
            except Exception as e:
                log.error("[SOP] acknowledge->next step failed: %s", e)
                db.session.rollback()
                execution.status = "FAILED"
                execution.error = str(e)[:500]
                execution.completed_at = datetime.now()
            db.session.commit()

        out = execution.to_dict()
        events_bus.publish({"type": "sop_execution", **out})
        return out, None


def repeat_current_step(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes,
                        execution_id, user, acknowledge_on_edge=None):
    """Manually re-play the current step's audio right now — the SOP
    dashboard's "Repeat" button. Same clear-then-replay pattern as the
    automatic timeout replay, just operator-triggered instead of time-triggered."""
    with app.app_context():
        execution = SopExecution.query.filter_by(execution_code=execution_id).first()
        if not execution:
            return None, "Execution not found"
        if execution.status != "WAITING_FOR_ACKNOWLEDGEMENT":
            return None, f"Execution is not waiting for acknowledgement (status={execution.status})"

        sop = execution.sop
        step = sop.steps[execution.current_step_index]
        db.session.add(SopStepExecution(
            execution_id=execution.id, sop_id=sop.id, step_id=step.id,
            step_number=execution.current_step_index + 1, event_type="repeated",
            audio_mode=step.audio_mode, language=step.language,
            operator=user, retry_count=execution.retry_count,
        ))
        if acknowledge_on_edge:
            _clear_current_receipts(execution, acknowledge_on_edge)
        db.session.commit()

        try:
            _play_current_step(execution, sop, SopStepExecution, db, dispatch_broadcast, all_zone_codes)
            execution.step_started_at = datetime.now()
            db.session.commit()
        except Exception as e:
            log.error("[SOP] repeat_current_step failed: %s", e)
            db.session.rollback()
            return None, str(e)

        out = execution.to_dict()
        events_bus.publish({"type": "sop_execution", **out})
        return out, None


def cancel(app, db, SopExecution, SopStepExecution, execution_id, user, acknowledge_on_edge=None):
    with app.app_context():
        execution = SopExecution.query.filter_by(execution_code=execution_id).first()
        if not execution:
            return None, "Execution not found"
        if execution.status in ("COMPLETED", "CANCELLED", "FAILED"):
            return execution.to_dict(), None

        if acknowledge_on_edge:
            _clear_current_receipts(execution, acknowledge_on_edge)
        execution.status = "CANCELLED"
        execution.completed_at = datetime.now()
        db.session.add(SopStepExecution(
            execution_id=execution.id, sop_id=execution.sop_id, step_id=None,
            step_number=execution.current_step_index + 1, event_type="cancelled",
            operator=user, retry_count=execution.retry_count,
        ))
        db.session.commit()

        out = execution.to_dict()
        events_bus.publish({"type": "sop_execution", **out})
        return out, None


def has_active_execution(Sop, SopExecution, sop_db_id):
    return SopExecution.query.filter(
        SopExecution.sop_id == sop_db_id,
        SopExecution.status.in_(["PLAYING_STEP", "WAITING_FOR_ACKNOWLEDGEMENT"]),
    ).count() > 0


# ============================================================
# Background timeout/replay checker
# ============================================================

def _check_timeouts(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes,
                    acknowledge_on_edge=None):
    with app.app_context():
        now = datetime.now()
        due = SopExecution.query.filter(SopExecution.status == "WAITING_FOR_ACKNOWLEDGEMENT").all()
        for execution in due:
            sop = execution.sop
            if not sop or not execution.step_started_at:
                continue
            timeout = sop.ack_timeout_sec or 120
            if (now - execution.step_started_at).total_seconds() < timeout:
                continue
            try:
                step = sop.steps[execution.current_step_index]
                execution.retry_count = (execution.retry_count or 0) + 1
                db.session.add(SopStepExecution(
                    execution_id=execution.id, sop_id=sop.id, step_id=step.id,
                    step_number=execution.current_step_index + 1, event_type="timeout_replay",
                    audio_mode=step.audio_mode, language=step.language,
                    operator=execution.started_by, retry_count=execution.retry_count,
                ))
                # Clear the previous dispatch's queued audio before replaying —
                # otherwise the old copy keeps repeating on the edge node
                # alongside the new one, compounding on every retry.
                if acknowledge_on_edge:
                    _clear_current_receipts(execution, acknowledge_on_edge)
                db.session.commit()
                _play_current_step(execution, sop, SopStepExecution, db, dispatch_broadcast, all_zone_codes)
                execution.step_started_at = datetime.now()
                db.session.commit()
                events_bus.publish({"type": "sop_execution", **execution.to_dict()})
                log.info("[SOP] Replayed step %d for %s (retry %d)",
                        execution.current_step_index + 1, execution.execution_code, execution.retry_count)
            except Exception as e:
                log.error("[SOP] Timeout replay failed for %s: %s", execution.execution_code, e)
                db.session.rollback()


def _loop(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes, acknowledge_on_edge=None):
    log.info("[SOP] Timeout/replay checker started — every %ss", _CHECK_INTERVAL_SEC)
    while True:
        try:
            _check_timeouts(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes,
                           acknowledge_on_edge)
        except Exception as e:
            log.error("[SOP] loop error: %s", e)
        time.sleep(_CHECK_INTERVAL_SEC)


def start_timeout_checker(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes,
                          interval_sec=5, acknowledge_on_edge=None):
    global _started, _CHECK_INTERVAL_SEC
    if _started:
        return
    _CHECK_INTERVAL_SEC = interval_sec
    _started = True
    threading.Thread(
        target=_loop,
        args=(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes, acknowledge_on_edge),
        daemon=True, name="sop-timeout",
    ).start()