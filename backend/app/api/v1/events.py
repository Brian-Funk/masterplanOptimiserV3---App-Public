"""
Events API Endpoints
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import date
from pydantic import BaseModel
from app.core.event_deletion import delete_event_scoped_data
from app.db.database import get_db
from app.models.event import Event

logger = logging.getLogger(__name__)

from app.schemas.masterplan import EventStatusUpdate, EventStatusResponse

router = APIRouter()

class EventCreate(BaseModel):
    """Payload for creating or replacing an event record."""

    name: str
    location: str
    start_date: date
    end_date: date
    meta_data: Optional[Dict[str, Any]] = None

class EventCalendarUpdate(BaseModel):
    """Payload for updating the Google Calendar linked to an event."""

    google_calendar_id: Optional[str] = None


class PdfExportSettingsUpdate(BaseModel):
    """Event-specific presentation title used for local document exports."""

    title: str

@router.get("/")
async def get_events(
    db: Session = Depends(get_db),
):
    """Get all events"""
    events = db.query(Event).all()
    return events

@router.get("/{event_id}")
async def get_event(
    event_id: int, 
    db: Session = Depends(get_db),
):
    """Get a specific event"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    return event

@router.post("/")
async def create_event(
    event_data: EventCreate,
    db: Session = Depends(get_db),
):
    """Create a new event"""
    event = Event(
        name=event_data.name, 
        location=event_data.location,
        start_date=event_data.start_date,
        end_date=event_data.end_date,
        meta_data=event_data.meta_data or {}
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    
    return event

@router.put("/{event_id}")
async def update_event(
    event_id: int,
    event_data: EventCreate,
    db: Session = Depends(get_db),
):
    """Update an existing event"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    event.name = event_data.name
    event.location = event_data.location
    event.start_date = event_data.start_date
    event.end_date = event_data.end_date
    if event_data.meta_data is not None:
        event.meta_data = event_data.meta_data
    
    db.commit()
    db.refresh(event)
    
    return event

@router.patch("/{event_id}/calendar")
async def update_event_calendar(
    event_id: int,
    data: EventCalendarUpdate,
    db: Session = Depends(get_db),
):
    """Update only the Google Calendar ID on an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    event.google_calendar_id = data.google_calendar_id
    db.commit()
    db.refresh(event)
    return {"status": "ok", "google_calendar_id": event.google_calendar_id}


@router.get("/{event_id}/pdf-export-settings")
async def get_event_pdf_export_settings(
    event_id: int,
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    metadata = event.meta_data if isinstance(event.meta_data, dict) else {}
    configured = metadata.get("pdf_export_title")
    title = configured.strip() if isinstance(configured, str) else ""
    return {"title": title or event.name, "customised": bool(title)}


@router.put("/{event_id}/pdf-export-settings")
async def update_event_pdf_export_settings(
    event_id: int,
    payload: PdfExportSettingsUpdate,
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    title = " ".join(payload.title.split()).strip()
    if not title:
        raise HTTPException(status_code=400, detail="PDF title must not be blank")
    if len(title) > 120:
        raise HTTPException(status_code=400, detail="PDF title must be 120 characters or fewer")
    metadata = dict(event.meta_data) if isinstance(event.meta_data, dict) else {}
    metadata["pdf_export_title"] = title
    event.meta_data = metadata
    db.commit()
    db.refresh(event)
    return {"title": title, "customised": True}

@router.delete("/{event_id}")
async def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
):
    """Delete an event and all associated data."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    event_name = event.name

    try:
        delete_event_scoped_data(db, event_id)
        db.commit()

    except Exception as exc:
        db.rollback()
        logger.error(f"Error deleting event {event_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to delete event: {exc}")

    db.expire_all()
    return {"status": "success", "message": f"Event '{event_name}' deleted successfully"}


@router.put("/{event_id}/status", response_model=EventStatusResponse)
async def update_event_status(
    event_id: int,
    data: EventStatusUpdate,
    db: Session = Depends(get_db),
):
    """Update an event's status (draft | optimised | finalised | published)."""
    valid_statuses = {"draft", "optimised", "finalised", "published"}
    if data.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {valid_statuses}"
        )

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    event.status = data.status
    db.commit()
    db.refresh(event)

    resp = EventStatusResponse(id=event.id, name=event.name, status=event.status)
    return resp.model_dump()


class EnabledCapabilitiesUpdate(BaseModel):
    """Event-scoped capability availability payload."""

    enabled_capability_ids: Optional[List[int]] = None  # null = all enabled


@router.put("/{event_id}/capabilities")
async def update_event_capabilities(
    event_id: int,
    data: EnabledCapabilitiesUpdate,
    db: Session = Depends(get_db),
):
    """Update the enabled capabilities for an event. null = all enabled."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    event.enabled_capability_ids = data.enabled_capability_ids
    db.commit()
    db.refresh(event)

    return {
        "status": "ok",
        "event_id": event.id,
        "enabled_capability_ids": event.enabled_capability_ids,
    }
