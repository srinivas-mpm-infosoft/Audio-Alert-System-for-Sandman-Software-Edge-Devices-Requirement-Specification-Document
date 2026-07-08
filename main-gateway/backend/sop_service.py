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
        language=step.language or "EN",
        alert_category="High",
        alert_source=f"SOP: {execution.sop_name} — step {execution.current_step_index + 1}",
        announcement_type="sop",
    )
    for r in receipts:
        db.session.add(SopStepExecution(
            execution_id=execution.id, sop_id=sop.id, step_id=step.id,
            step_number=execution.current_step_index + 1, event_type="played",
            audio_mode=step.audio_mode, zone_code=r.get("zone_code"),
            language=step.language, operator=execution.started_by,
            retry_count=execution.retry_count,
        ))
    db.session.commit()
    return receipts


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


def acknowledge(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes, execution_id, user):
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


def cancel(app, db, SopExecution, SopStepExecution, execution_id, user):
    with app.app_context():
        execution = SopExecution.query.filter_by(execution_code=execution_id).first()
        if not execution:
            return None, "Execution not found"
        if execution.status in ("COMPLETED", "CANCELLED", "FAILED"):
            return execution.to_dict(), None

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

def _check_timeouts(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes):
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


def _loop(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes):
    log.info("[SOP] Timeout/replay checker started — every %ss", _CHECK_INTERVAL_SEC)
    while True:
        try:
            _check_timeouts(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes)
        except Exception as e:
            log.error("[SOP] loop error: %s", e)
        time.sleep(_CHECK_INTERVAL_SEC)


def start_timeout_checker(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes, interval_sec=5):
    global _started, _CHECK_INTERVAL_SEC
    if _started:
        return
    _CHECK_INTERVAL_SEC = interval_sec
    _started = True
    threading.Thread(
        target=_loop,
        args=(app, db, SopExecution, SopStepExecution, dispatch_broadcast, all_zone_codes),
        daemon=True, name="sop-timeout",
    ).start()