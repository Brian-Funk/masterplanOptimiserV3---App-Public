"""Event publish-state persistence endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.event import Event
from app.models.event_publish_state import EventPublishState


router = APIRouter()

PublishScope = Literal["all", "partial", "none"]
PublishTarget = Literal["google", "mp-backend", "both", "none"]


class PublishedDayRecord(BaseModel):
    """Publish metadata for one event day."""

    fingerprint: str | None = None
    publishedAt: str | None = None
    failedAt: str | None = None
    failureMessage: str | None = None


class EventPublishStateResponse(BaseModel):
    """Non-sensitive publish state for one event."""

    event_id: int
    published_schedule_fingerprint: str | None = None
    published_schedule_scope: PublishScope = "none"
    published_at: str | None = None
    publish_failed_at: str | None = None
    day_records: dict[str, PublishedDayRecord] = Field(default_factory=dict)
    last_publish_target: PublishTarget | None = None
    last_publish_result_summary: str | None = None


class EventPublishStateSavePayload(BaseModel):
    """Complete publish state supplied after a successful publish action."""

    published_schedule_fingerprint: str | None = None
    published_schedule_scope: PublishScope = "none"
    published_at: str | None = None
    publish_failed_at: str | None = None
    day_records: dict[str, PublishedDayRecord] = Field(default_factory=dict)
    last_publish_target: PublishTarget | None = None
    last_publish_result_summary: str | None = None


class EventPublishFailurePayload(BaseModel):
    """Failure metadata recorded after one or more publish targets fail."""

    day_ids: list[str] = Field(default_factory=list)
    failed_at: str
    failure_message: str = "Publish failed."
    last_publish_target: PublishTarget | None = None
    last_publish_result_summary: str | None = None


def _ensure_event(db: Session, event_id: int) -> Event:
    """Return the event or raise 404 if it does not exist."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _normalise_day_records(value: object) -> dict[str, PublishedDayRecord]:
    """Coerce stored JSON into the frontend's day-record shape."""
    if not isinstance(value, dict):
        return {}

    records: dict[str, PublishedDayRecord] = {}
    for day_id, record in value.items():
        if not isinstance(day_id, str) or not isinstance(record, dict):
            continue
        records[day_id] = PublishedDayRecord(
            fingerprint=record.get("fingerprint")
            if isinstance(record.get("fingerprint"), str)
            else None,
            publishedAt=record.get("publishedAt")
            if isinstance(record.get("publishedAt"), str)
            else None,
            failedAt=record.get("failedAt")
            if isinstance(record.get("failedAt"), str)
            else None,
            failureMessage=record.get("failureMessage")
            if isinstance(record.get("failureMessage"), str)
            else None,
        )
    return records


def _serialise_day_records(
    records: dict[str, PublishedDayRecord],
) -> dict[str, dict[str, str | None]]:
    """Return JSON-safe day records without credentials or secrets."""
    return {
        day_id: {
            "fingerprint": record.fingerprint,
            "publishedAt": record.publishedAt,
            "failedAt": record.failedAt,
            "failureMessage": record.failureMessage,
        }
        for day_id, record in records.items()
    }


def _row_to_response(
    event_id: int,
    row: EventPublishState | None,
) -> EventPublishStateResponse:
    """Convert a database row into the public response contract."""
    if not row:
        return EventPublishStateResponse(event_id=event_id)

    scope = row.published_schedule_scope
    if scope not in ("all", "partial", "none"):
        scope = "none"

    target = row.last_publish_target
    if target not in ("google", "mp-backend", "both", "none", None):
        target = None

    return EventPublishStateResponse(
        event_id=event_id,
        published_schedule_fingerprint=row.published_schedule_fingerprint,
        published_schedule_scope=scope,
        published_at=row.published_at,
        publish_failed_at=row.publish_failed_at,
        day_records=_normalise_day_records(row.day_records),
        last_publish_target=target,
        last_publish_result_summary=row.last_publish_result_summary,
    )


def _get_or_create_row(db: Session, event_id: int) -> EventPublishState:
    """Fetch or create the publish-state row for one event."""
    row = (
        db.query(EventPublishState)
        .filter(EventPublishState.event_id == event_id)
        .first()
    )
    if row:
        return row
    row = EventPublishState(event_id=event_id, day_records={})
    db.add(row)
    return row


@router.get("/{event_id}", response_model=EventPublishStateResponse)
async def get_event_publish_state(event_id: int, db: Session = Depends(get_db)):
    """Read persisted publish-state metadata for one event."""
    _ensure_event(db, event_id)
    row = (
        db.query(EventPublishState)
        .filter(EventPublishState.event_id == event_id)
        .first()
    )
    return _row_to_response(event_id, row)


@router.put("/{event_id}", response_model=EventPublishStateResponse)
async def save_event_publish_state(
    event_id: int,
    payload: EventPublishStateSavePayload,
    db: Session = Depends(get_db),
):
    """Replace one event's non-sensitive publish-state metadata."""
    _ensure_event(db, event_id)
    row = _get_or_create_row(db, event_id)
    row.published_schedule_fingerprint = payload.published_schedule_fingerprint
    row.published_schedule_scope = payload.published_schedule_scope
    row.published_at = payload.published_at
    row.publish_failed_at = payload.publish_failed_at
    row.day_records = _serialise_day_records(payload.day_records)
    row.last_publish_target = payload.last_publish_target
    row.last_publish_result_summary = payload.last_publish_result_summary
    db.commit()
    db.refresh(row)
    return _row_to_response(event_id, row)


@router.post("/{event_id}/failure", response_model=EventPublishStateResponse)
async def record_event_publish_failure(
    event_id: int,
    payload: EventPublishFailurePayload,
    db: Session = Depends(get_db),
):
    """Record publish failure metadata for the affected days."""
    _ensure_event(db, event_id)
    row = _get_or_create_row(db, event_id)
    records = _normalise_day_records(row.day_records)
    for day_id in payload.day_ids:
        previous = records.get(day_id, PublishedDayRecord())
        records[day_id] = PublishedDayRecord(
            fingerprint=previous.fingerprint,
            publishedAt=previous.publishedAt,
            failedAt=payload.failed_at,
            failureMessage=payload.failure_message,
        )
    row.publish_failed_at = payload.failed_at
    row.day_records = _serialise_day_records(records)
    row.last_publish_target = payload.last_publish_target
    row.last_publish_result_summary = payload.last_publish_result_summary
    db.commit()
    db.refresh(row)
    return _row_to_response(event_id, row)


@router.delete("/{event_id}")
async def clear_event_publish_state(event_id: int, db: Session = Depends(get_db)):
    """Clear persisted publish-state metadata for one event."""
    _ensure_event(db, event_id)
    (
        db.query(EventPublishState)
        .filter(EventPublishState.event_id == event_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"status": "success", "message": "Publish state cleared"}
