"""Transactional local erasure and privacy-safe server report creation."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.event_deletion import delete_event_scoped_data
from app.models.assignment import Assignment
from app.models.capability import PersonCapability
from app.models.event import Event
from app.models.event_publish_state import EventPublishState
from app.models.general_schedule import GeneralSchedulePublishState, SessionElement
from app.models.group import GroupMembership
from app.models.optimization_job import OptimizationJob
from app.models.person import Person
from app.models.privacy import DesktopDeletionOutbox, PersonUnavailability
from app.models.task import Task


REPORT_COUNT_KEYS = (
    "persons",
    "assignments",
    "capability_links",
    "group_memberships",
    "unavailability_intervals",
    "task_references",
    "optimisation_records",
    "publish_records",
    "cached_records",
    "tracked_exports",
    "integration_references",
)


def canonical_json(value: Any) -> str:
    """Return the canonical JSON representation used by the server contract."""

    return json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":"))


def _redact_person_reference(value: Any, person_id: int, parent_key: str = "") -> Any:
    """Remove a person identifier from known operational reference shapes."""

    if isinstance(value, dict):
        direct_ids = {
            value.get("person_id"),
            value.get("responsible_person_id"),
        }
        if person_id in direct_ids:
            return None
        result = {}
        for key, entry in value.items():
            cleaned = _redact_person_reference(entry, person_id, key)
            if cleaned is not None:
                result[key] = cleaned
        return result
    if isinstance(value, list):
        result = []
        person_list = any(token in parent_key.lower() for token in ("person", "attendee", "assigned"))
        for entry in value:
            if person_list and isinstance(entry, int) and entry == person_id:
                continue
            cleaned = _redact_person_reference(entry, person_id, parent_key)
            if cleaned is not None:
                result.append(cleaned)
        return result
    return value


def _delete_optional_person_links(db: Session, person_id: int) -> int:
    """Delete current optional link tables when their feature is installed."""

    tables = set(inspect(db.get_bind()).get_table_names())
    deleted = 0
    for table in ("user_persons",):
        if table in tables:
            result = db.execute(
                text(f"DELETE FROM {table} WHERE person_id = :person_id"),
                {"person_id": person_id},
            )
            deleted += max(0, result.rowcount or 0)
    return deleted


def _delete_subject(db: Session, event: Event, person: Person) -> dict[str, int]:
    """Delete a subject and all locally controlled duplicate representations."""

    counts = {key: 0 for key in REPORT_COUNT_KEYS}
    counts["persons"] = 1
    counts["assignments"] = db.query(Assignment).filter(Assignment.person_id == person.id).count()
    counts["capability_links"] = db.query(PersonCapability).filter(
        PersonCapability.person_id == person.id,
    ).count()
    counts["group_memberships"] = db.query(GroupMembership).filter(
        GroupMembership.person_id == person.id,
    ).count()
    counts["unavailability_intervals"] = db.query(PersonUnavailability).filter(
        PersonUnavailability.person_id == person.id,
    ).count()

    db.query(Assignment).filter(Assignment.person_id == person.id).delete(synchronize_session=False)
    db.query(PersonCapability).filter(
        PersonCapability.person_id == person.id,
    ).delete(synchronize_session=False)
    db.query(GroupMembership).filter(
        GroupMembership.person_id == person.id,
    ).delete(synchronize_session=False)
    db.query(PersonUnavailability).filter(
        PersonUnavailability.person_id == person.id,
    ).delete(synchronize_session=False)
    _delete_optional_person_links(db, person.id)

    for task in db.query(Task).filter(Task.event_id == event.id):
        changed = False
        for field in ("constraints", "optimised", "final", "additional"):
            current = getattr(task, field)
            cleaned = _redact_person_reference(current, person.id, field)
            if cleaned != current:
                setattr(task, field, cleaned)
                changed = True
        if changed:
            counts["task_references"] += 1

    counts["task_references"] += db.query(SessionElement).filter(
        SessionElement.event_id == event.id,
        SessionElement.responsible_person_id == person.id,
    ).count()
    db.query(SessionElement).filter(
        SessionElement.event_id == event.id,
        SessionElement.responsible_person_id == person.id,
    ).update({"responsible_person_id": None}, synchronize_session=False)

    counts["optimisation_records"] = db.query(OptimizationJob).filter(
        OptimizationJob.event_id == event.id,
    ).count()
    db.query(OptimizationJob).filter(
        OptimizationJob.event_id == event.id,
    ).delete(synchronize_session=False)
    counts["publish_records"] = (
        db.query(EventPublishState).filter(EventPublishState.event_id == event.id).count()
        + db.query(GeneralSchedulePublishState).filter(
            GeneralSchedulePublishState.event_id == event.id,
        ).count()
    )
    db.query(EventPublishState).filter(
        EventPublishState.event_id == event.id,
    ).delete(synchronize_session=False)
    db.query(GeneralSchedulePublishState).filter(
        GeneralSchedulePublishState.event_id == event.id,
    ).delete(synchronize_session=False)
    if person.google_email:
        counts["integration_references"] = 1
    db.delete(person)
    db.flush()
    return counts


def _event_counts(db: Session, event_id: int) -> dict[str, int]:
    """Count bounded record categories before a whole-event deletion."""

    persons = db.query(Person).filter(Person.event_id == event_id).all()
    person_ids = [person.id for person in persons]
    counts = {key: 0 for key in REPORT_COUNT_KEYS}
    counts["persons"] = len(persons)
    counts["assignments"] = db.query(Assignment).filter(Assignment.event_id == event_id).count()
    if person_ids:
        counts["capability_links"] = db.query(PersonCapability).filter(
            PersonCapability.person_id.in_(person_ids),
        ).count()
        counts["group_memberships"] = db.query(GroupMembership).filter(
            GroupMembership.person_id.in_(person_ids),
        ).count()
        counts["unavailability_intervals"] = db.query(PersonUnavailability).filter(
            PersonUnavailability.person_id.in_(person_ids),
        ).count()
    counts["task_references"] = db.query(Task).filter(Task.event_id == event_id).count()
    counts["optimisation_records"] = db.query(OptimizationJob).filter(
        OptimizationJob.event_id == event_id,
    ).count()
    counts["publish_records"] = (
        db.query(EventPublishState).filter(EventPublishState.event_id == event_id).count()
        + db.query(GeneralSchedulePublishState).filter(
            GeneralSchedulePublishState.event_id == event_id,
        ).count()
    )
    counts["integration_references"] = sum(1 for person in persons if person.google_email)
    return counts


def stage_deletion_report(
    db: Session,
    *,
    work_order: dict[str, Any],
    claim_capability: str,
    server_url: str,
    publish_secret: str,
) -> DesktopDeletionOutbox:
    """Erase local data and create its report in the same database transaction."""

    required = {"version", "work_order_id", "event_ref", "subject_ref", "operation"}
    if not required.issubset(work_order) or work_order.get("version") != 1:
        raise ValueError("Unsupported deletion work order")
    existing = db.query(DesktopDeletionOutbox).filter(
        DesktopDeletionOutbox.work_order_id == work_order["work_order_id"],
    ).first()
    if existing is not None:
        return existing
    event = db.query(Event).filter(Event.evidence_id == work_order["event_ref"]).first()
    if event is None:
        raise ValueError("The deletion work order does not match a local event")
    operation = work_order["operation"]
    outstanding: list[str] = []
    if operation == "delete_subject":
        subject_ref = work_order.get("subject_ref")
        person = db.query(Person).filter(
            Person.event_id == event.id,
            Person.evidence_subject_id == subject_ref,
        ).first()
        if person is None:
            # A previously completed local removal is a successful idempotent
            # outcome. The zero-count report lets Server continue without
            # requiring an operator to recreate data just to delete it again.
            counts = {key: 0 for key in REPORT_COUNT_KEYS}
        else:
            counts = _delete_subject(db, event, person)
            if counts["integration_references"]:
                outstanding.append("external_integration_copy")
    elif operation == "delete_event" and work_order.get("subject_ref") is None:
        counts = _event_counts(db, event.id)
        delete_event_scoped_data(db, event.id)
    else:
        raise ValueError("The deletion work order operation is invalid")

    report = {
        "version": 1,
        "work_order_id": work_order["work_order_id"],
        "event_ref": work_order["event_ref"],
        "subject_ref": work_order.get("subject_ref"),
        "operation": operation,
        "outcome": "deleted",
        "deleted_counts": counts,
        "outstanding_actions": outstanding,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    report_json = canonical_json(report)
    row = DesktopDeletionOutbox(
        work_order_id=work_order["work_order_id"],
        event_ref=work_order["event_ref"],
        subject_ref=work_order.get("subject_ref"),
        operation=operation,
        server_url=server_url.rstrip("/"),
        publish_secret=publish_secret,
        claim_capability=claim_capability,
        report_json=report_json,
        report_sha256=hashlib.sha256(report_json.encode("utf-8")).hexdigest(),
        state="pending",
    )
    db.add(row)
    db.flush()
    return row
