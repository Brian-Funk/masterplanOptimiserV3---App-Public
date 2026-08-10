"""General Schedule APIs for Audience Teams and Session Elements."""
from datetime import date, datetime, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.event import Event
from app.models.general_schedule import (
    AudienceCategory,
    AudienceTeam,
    GeneralSchedulePublishState,
    ScheduleView,
    SessionElement,
    SessionElementType,
)
from app.models.location import Location
from app.models.person import Person
from app.core.rich_template import validate_rich_template

router = APIRouter()

SESSION_ELEMENT_COLOURS = {
    "#fca5a5",
    "#fecaca",
    "#fdba74",
    "#fde68a",
    "#86efac",
    "#6ee7b7",
    "#7dd3fc",
    "#a5b4fc",
    "#c4b5fd",
    "#d8b4fe",
    "#cbd5e1",
}
DEFAULT_SESSION_ELEMENT_COLOUR = "#7dd3fc"
DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE = (
    "<b>{start_time}-{end_time}</b> {title}<br>"
    "{location} - {audience_teams}"
)


def _require_event(db: Session, event_id: int) -> Event:
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _ensure_default_category(db: Session, event_id: int) -> AudienceCategory:
    category = (
        db.query(AudienceCategory)
        .filter(AudienceCategory.event_id == event_id)
        .order_by(AudienceCategory.sort_order, AudienceCategory.id)
        .first()
    )
    if category:
        return category
    category = AudienceCategory(event_id=event_id, name="General", sort_order=0)
    db.add(category)
    db.flush()
    return category


def _ensure_default_session_type(db: Session, event_id: int) -> SessionElementType:
    session_type = (
        db.query(SessionElementType)
        .filter(SessionElementType.event_id == event_id)
        .order_by(SessionElementType.sort_order, SessionElementType.id)
        .first()
    )
    if session_type:
        return session_type
    session_type = SessionElementType(
        event_id=event_id,
        name="General",
        description="Default Session Element type",
        colour=DEFAULT_SESSION_ELEMENT_COLOUR,
        sort_order=0,
        copy_template_html=DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
    )
    db.add(session_type)
    db.flush()
    return session_type


def _parse_time(value: str, field_name: str) -> int:
    try:
        parsed = datetime.strptime(value, "%H:%M")
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must use HH:MM format.",
        ) from None
    return parsed.hour * 60 + parsed.minute


def _validate_date(value: str) -> None:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date must use YYYY-MM-DD format.",
        ) from None


def _normalise_session_colour(value: Optional[str], *, strict: bool = True) -> str:
    if value in SESSION_ELEMENT_COLOURS:
        return value
    if value in (None, ""):
        return DEFAULT_SESSION_ELEMENT_COLOUR
    if not strict:
        return DEFAULT_SESSION_ELEMENT_COLOUR
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Session Element colour must use one of the preset colours.",
    )


def _validate_category(db: Session, event_id: int, category_id: Optional[int]) -> Optional[int]:
    if category_id is None:
        return _ensure_default_category(db, event_id).id
    exists = (
        db.query(AudienceCategory.id)
        .filter(AudienceCategory.event_id == event_id, AudienceCategory.id == category_id)
        .first()
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audience category not found in this event.",
        )
    return category_id


def _validate_session_type(db: Session, event_id: int, type_id: Optional[int]) -> int:
    if type_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session Element type is required.",
        )
    exists = (
        db.query(SessionElementType.id)
        .filter(SessionElementType.event_id == event_id, SessionElementType.id == type_id)
        .first()
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session Element type not found in this event.",
        )
    return type_id


def _session_type_colour(db: Session, event_id: int, type_id: Optional[int]) -> str:
    if type_id is None:
        return DEFAULT_SESSION_ELEMENT_COLOUR
    session_type = (
        db.query(SessionElementType)
        .filter(SessionElementType.event_id == event_id, SessionElementType.id == type_id)
        .first()
    )
    return _normalise_session_colour(session_type.colour if session_type else None, strict=False)


def _normalise_team_ids(db: Session, event_id: int, ids: List[int]) -> List[int]:
    normalised: list[int] = []
    seen: set[int] = set()
    for raw_id in ids or []:
        try:
            team_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if team_id in seen:
            continue
        seen.add(team_id)
        normalised.append(team_id)

    existing_ids = {
        team.id
        for team in db.query(AudienceTeam)
        .filter(AudienceTeam.event_id == event_id, AudienceTeam.id.in_(normalised))
        .all()
    }
    missing = [team_id for team_id in normalised if team_id not in existing_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audience team not found in this event.",
        )
    return normalised


def _normalise_schedule_view_ids(db: Session, event_id: int, ids: List[int]) -> List[int]:
    normalised: list[int] = []
    seen: set[int] = set()
    for raw_id in ids or []:
        try:
            view_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if view_id in seen:
            continue
        seen.add(view_id)
        normalised.append(view_id)

    if not normalised:
        return []

    existing_ids = {
        view.id
        for view in db.query(ScheduleView)
        .filter(ScheduleView.event_id == event_id, ScheduleView.id.in_(normalised))
        .all()
    }
    missing = [view_id for view_id in normalised if view_id not in existing_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Schedule view not found in this event.",
        )
    return normalised


def _validate_location(db: Session, event_id: int, location_id: Optional[int]) -> None:
    if location_id is None:
        return
    exists = (
        db.query(Location.id)
        .filter(Location.event_id == event_id, Location.id == location_id)
        .first()
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location not found in this event.",
        )


def _validate_person(db: Session, event_id: int, person_id: Optional[int]) -> None:
    if person_id is None:
        return
    exists = (
        db.query(Person.id)
        .filter(Person.event_id == event_id, Person.id == person_id)
        .first()
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Responsible person not found in this event.",
        )


def _validate_session_payload(
    db: Session,
    event_id: int,
    payload: "SessionElementCreate | SessionElementUpdate",
    *,
    existing: Optional[SessionElement] = None,
) -> dict:
    fields_set = getattr(payload, "model_fields_set", set())
    title = payload.title if "title" in fields_set else (existing.title if existing else None)
    date = payload.date if "date" in fields_set else (existing.date if existing else None)
    start_time = payload.start_time if "start_time" in fields_set else (existing.start_time if existing else None)
    end_time = payload.end_time if "end_time" in fields_set else (existing.end_time if existing else None)
    attendee_team_ids = (
        payload.attendee_team_ids
        if "attendee_team_ids" in fields_set
        else (existing.attendee_team_ids if existing else [])
    )
    schedule_view_ids = (
        payload.schedule_view_ids
        if "schedule_view_ids" in fields_set
        else (existing.schedule_view_ids if existing else [])
    )
    session_element_type_id = (
        payload.session_element_type_id
        if "session_element_type_id" in fields_set
        else (existing.session_element_type_id if existing else None)
    )
    location_id = payload.location_id if "location_id" in fields_set else (existing.location_id if existing else None)
    responsible_person_id = (
        payload.responsible_person_id
        if "responsible_person_id" in fields_set
        else (existing.responsible_person_id if existing else None)
    )

    if not str(title or "").strip():
        raise HTTPException(status_code=400, detail="Title is required.")
    if not date:
        raise HTTPException(status_code=400, detail="Date is required.")
    _validate_date(date)
    if start_time is None or end_time is None:
        raise HTTPException(status_code=400, detail="Start and end time are required.")
    start_minutes = _parse_time(start_time, "start_time")
    end_minutes = _parse_time(end_time, "end_time")
    if end_minutes <= start_minutes:
        raise HTTPException(status_code=400, detail="End time must be after start time.")
    return {
        "title": str(title).strip(),
        "date": date,
        "start_time": start_time,
        "end_time": end_time,
        "visibility": "public",
        "session_element_type_id": _validate_session_type(db, event_id, session_element_type_id),
        "attendee_team_ids": _normalise_team_ids(db, event_id, attendee_team_ids or []),
        "schedule_view_ids": _normalise_schedule_view_ids(db, event_id, schedule_view_ids or []),
        "location_id": location_id,
        "responsible_person_id": responsible_person_id,
    }


def _schedule_boundary_offset_hour(event: Event) -> int:
    """Return the event's after-midnight working-day boundary hour."""
    day_range = (event.meta_data or {}).get("schedule_day_range")
    if not isinstance(day_range, dict):
        return 0
    try:
        start_hour = int(day_range.get("startHour"))
        end_hour = int(day_range.get("endHour"))
    except (TypeError, ValueError):
        return 0
    if 0 <= start_hour <= 23 and start_hour < end_hour <= 36:
        return max(0, end_hour - 24)
    return 0


def _working_date_for_element(element: SessionElement, offset_hour: int) -> str:
    """Resolve an element's public working day from its stored date and clock time."""
    actual_date = date.fromisoformat(element.date)
    if offset_hour > 0 and _parse_time(element.start_time, "start_time") < offset_hour * 60:
        actual_date -= timedelta(days=1)
    return actual_date.isoformat()


def _actual_date_for_working_slot(working_date: str, start_time: str, offset_hour: int) -> str:
    """Convert a public working day and time into the date stored in the database."""
    actual_date = date.fromisoformat(working_date)
    if offset_hour > 0 and _parse_time(start_time, "start_time") < offset_hour * 60:
        actual_date += timedelta(days=1)
    return actual_date.isoformat()


def _apply_id_change(current: List[int], change: "BulkIdChange") -> List[int]:
    """Apply a normalised assignment operation while preserving stable ordering."""
    if change.operation == "replace":
        return list(change.ids)
    if change.operation == "remove":
        removed = set(change.ids)
        return [item_id for item_id in current if item_id not in removed]
    result = list(current)
    for item_id in change.ids:
        if item_id not in result:
            result.append(item_id)
    return result


class AudienceCategoryCreate(BaseModel):
    name: str
    sort_order: Optional[float] = 0


class AudienceCategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[float] = None


class AudienceCategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    name: str
    sort_order: Optional[float] = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


class SessionElementTypeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = 0
    copy_template_html: Optional[str] = None

    @field_validator("copy_template_html")
    @classmethod
    def validate_copy_template_html(cls, value: Optional[str]) -> Optional[str]:
        return validate_rich_template(value)


class SessionElementTypeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = None
    copy_template_html: Optional[str] = None

    @field_validator("copy_template_html")
    @classmethod
    def validate_copy_template_html(cls, value: Optional[str]) -> Optional[str]:
        return validate_rich_template(value)


class SessionElementTypeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    name: str
    description: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = 0
    copy_template_html: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


class AudienceTeamCreate(BaseModel):
    name: str
    category_id: Optional[int] = None
    short_name: Optional[str] = None
    description: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = 0


class AudienceTeamUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[int] = None
    short_name: Optional[str] = None
    description: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = None


class AudienceTeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    category_id: Optional[int] = None
    name: str
    short_name: Optional[str] = None
    description: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


class ScheduleViewCreate(BaseModel):
    name: str
    sort_order: Optional[float] = 0


class ScheduleViewUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[float] = None


class ScheduleViewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    name: str
    sort_order: Optional[float] = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


class ReorderItem(BaseModel):
    id: int
    sort_order: float


class ReorderRequest(BaseModel):
    items: List[ReorderItem]


class SessionElementCreate(BaseModel):
    title: str
    date: str
    start_time: str
    end_time: str
    session_element_type_id: Optional[int] = None
    location_id: Optional[int] = None
    responsible_person_id: Optional[int] = None
    responsible_text: Optional[str] = None
    location_text: Optional[str] = None
    location_note: Optional[str] = None
    attendee_team_ids: List[int] = []
    schedule_view_ids: List[int] = []
    visibility: str = "public"
    description: Optional[str] = None
    category: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = 0


class SessionElementUpdate(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    session_element_type_id: Optional[int] = None
    location_id: Optional[int] = None
    responsible_person_id: Optional[int] = None
    responsible_text: Optional[str] = None
    location_text: Optional[str] = None
    location_note: Optional[str] = None
    attendee_team_ids: Optional[List[int]] = None
    schedule_view_ids: Optional[List[int]] = None
    visibility: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = None


class SessionElementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    session_element_type_id: Optional[int] = None
    title: str
    date: str
    start_time: str
    end_time: str
    location_id: Optional[int] = None
    responsible_person_id: Optional[int] = None
    responsible_text: Optional[str] = None
    location_text: Optional[str] = None
    location_note: Optional[str] = None
    attendee_team_ids: List[int]
    schedule_view_ids: List[int]
    visibility: str
    description: Optional[str] = None
    category: Optional[str] = None
    colour: Optional[str] = None
    sort_order: Optional[float] = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_serializer("created_at", "updated_at")
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None

    @field_validator("attendee_team_ids", "schedule_view_ids", mode="before")
    @classmethod
    def serialize_list_fields(cls, value: list[int] | None) -> list[int]:
        return value or []


class CopySessionElementsRequest(BaseModel):
    element_ids: List[int]
    target_dates: List[str]


class BulkIdChange(BaseModel):
    """Add, remove, or replace an ID-backed assignment on selected items."""

    operation: Literal["add", "remove", "replace"]
    ids: List[int] = Field(default_factory=list, max_length=1000)


class BulkSessionElementUpdate(BaseModel):
    """Apply one atomic set of changes to multiple Session Elements."""

    element_ids: List[int] = Field(..., min_length=1, max_length=1000)
    schedule_view_ids: Optional[List[int]] = Field(default=None, max_length=100)
    attendee_team_ids: Optional[List[int]] = Field(default=None, max_length=1000)
    schedule_view_change: Optional[BulkIdChange] = None
    attendee_team_change: Optional[BulkIdChange] = None
    session_element_type_id: Optional[int] = None
    location_id: Optional[int] = None
    working_date: Optional[str] = None
    shift_minutes: Optional[int] = Field(default=None, ge=-1439, le=1439)


class BulkSessionElementCreate(BaseModel):
    """Create a validated collection of Session Elements in one transaction."""

    items: List[SessionElementCreate] = Field(..., min_length=1, max_length=1000)


class GeneralSchedulePublishStateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_id: int
    fingerprint: Optional[str] = None
    published_at: Optional[str] = None
    publish_failed_at: Optional[str] = None
    item_count: int = 0
    last_error: Optional[str] = None
    day_records: dict[str, dict[str, object]] = Field(default_factory=dict)


class GeneralSchedulePublishStateUpdate(BaseModel):
    fingerprint: Optional[str] = None
    published_at: Optional[str] = None
    publish_failed_at: Optional[str] = None
    item_count: int = 0
    last_error: Optional[str] = None
    day_records: dict[str, dict[str, object]] = Field(default_factory=dict)


@router.get("/categories", response_model=List[AudienceCategoryResponse])
async def list_audience_categories(event_id: int = Query(...), db: Session = Depends(get_db)):
    _require_event(db, event_id)
    db.commit()
    return (
        db.query(AudienceCategory)
        .filter(AudienceCategory.event_id == event_id)
        .order_by(AudienceCategory.sort_order, AudienceCategory.name)
        .all()
    )


@router.post("/categories", response_model=AudienceCategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_audience_category(
    payload: AudienceCategoryCreate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    _require_event(db, event_id)
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")
    category = AudienceCategory(
        event_id=event_id,
        name=payload.name.strip(),
        sort_order=payload.sort_order or 0,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.put("/categories/{category_id}", response_model=AudienceCategoryResponse)
async def update_audience_category(
    category_id: int,
    payload: AudienceCategoryUpdate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    category = (
        db.query(AudienceCategory)
        .filter(AudienceCategory.event_id == event_id, AudienceCategory.id == category_id)
        .first()
    )
    if not category:
        raise HTTPException(status_code=404, detail="Audience category not found.")
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Name is required.")
        category.name = payload.name.strip()
    if payload.sort_order is not None:
        category.sort_order = payload.sort_order
    db.commit()
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_audience_category(
    category_id: int,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    category = (
        db.query(AudienceCategory)
        .filter(AudienceCategory.event_id == event_id, AudienceCategory.id == category_id)
        .first()
    )
    if not category:
        raise HTTPException(status_code=404, detail="Audience category not found.")
    fallback = _ensure_default_category(db, event_id)
    if fallback.id == category.id:
        raise HTTPException(status_code=400, detail="The default audience category cannot be deleted.")
    for team in db.query(AudienceTeam).filter(AudienceTeam.event_id == event_id, AudienceTeam.category_id == category.id):
        team.category_id = fallback.id
    db.delete(category)
    db.commit()
    return None


@router.get("/session-element-types", response_model=List[SessionElementTypeResponse])
async def list_session_element_types(event_id: int = Query(...), db: Session = Depends(get_db)):
    _require_event(db, event_id)
    db.commit()
    return (
        db.query(SessionElementType)
        .filter(SessionElementType.event_id == event_id)
        .order_by(SessionElementType.sort_order, SessionElementType.name)
        .all()
    )


@router.post("/session-element-types", response_model=SessionElementTypeResponse, status_code=status.HTTP_201_CREATED)
async def create_session_element_type(
    payload: SessionElementTypeCreate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    _require_event(db, event_id)
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")
    session_type = SessionElementType(
        event_id=event_id,
        name=payload.name.strip(),
        description=payload.description,
        colour=_normalise_session_colour(payload.colour, strict=False),
        sort_order=payload.sort_order or 0,
        copy_template_html=payload.copy_template_html or DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
    )
    db.add(session_type)
    db.commit()
    db.refresh(session_type)
    return session_type


@router.put("/session-element-types/{type_id}", response_model=SessionElementTypeResponse)
async def update_session_element_type(
    type_id: int,
    payload: SessionElementTypeUpdate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    session_type = (
        db.query(SessionElementType)
        .filter(SessionElementType.event_id == event_id, SessionElementType.id == type_id)
        .first()
    )
    if not session_type:
        raise HTTPException(status_code=404, detail="Session Element type not found.")
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Name is required.")
        session_type.name = payload.name.strip()
    if "description" in payload.model_fields_set:
        session_type.description = payload.description
    if "colour" in payload.model_fields_set:
        session_type.colour = _normalise_session_colour(payload.colour, strict=False)
    if payload.sort_order is not None:
        session_type.sort_order = payload.sort_order
    if "copy_template_html" in payload.model_fields_set:
        session_type.copy_template_html = payload.copy_template_html or DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE
    db.commit()
    db.refresh(session_type)
    return session_type


@router.delete("/session-element-types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session_element_type(
    type_id: int,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    session_type = (
        db.query(SessionElementType)
        .filter(SessionElementType.event_id == event_id, SessionElementType.id == type_id)
        .first()
    )
    if not session_type:
        raise HTTPException(status_code=404, detail="Session Element type not found.")
    used_count = (
        db.query(SessionElement)
        .filter(
            SessionElement.event_id == event_id,
            SessionElement.session_element_type_id == session_type.id,
        )
        .count()
    )
    if used_count > 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "This Session Element Type is used by existing Session "
                "Elements. Update or delete those elements before deleting "
                "the type."
            ),
        )
    db.delete(session_type)
    db.commit()
    return None


@router.get("/teams", response_model=List[AudienceTeamResponse])
async def list_audience_teams(event_id: int = Query(...), db: Session = Depends(get_db)):
    _require_event(db, event_id)
    db.commit()
    return (
        db.query(AudienceTeam)
        .filter(AudienceTeam.event_id == event_id)
        .order_by(AudienceTeam.sort_order, AudienceTeam.name)
        .all()
    )


@router.post("/teams", response_model=AudienceTeamResponse, status_code=status.HTTP_201_CREATED)
async def create_audience_team(
    payload: AudienceTeamCreate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    _require_event(db, event_id)
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")
    team = AudienceTeam(
        event_id=event_id,
        category_id=_validate_category(db, event_id, payload.category_id),
        name=payload.name.strip(),
        short_name=payload.short_name,
        description=payload.description,
        colour=payload.colour,
        sort_order=payload.sort_order or 0,
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.put("/teams/reorder")
async def reorder_audience_teams(
    payload: ReorderRequest,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    _require_event(db, event_id)
    ids = [item.id for item in payload.items]
    teams = (
        db.query(AudienceTeam)
        .filter(AudienceTeam.event_id == event_id, AudienceTeam.id.in_(ids))
        .all()
    )
    team_by_id = {team.id: team for team in teams}
    for item in payload.items:
        if item.id in team_by_id:
            team_by_id[item.id].sort_order = item.sort_order
    db.commit()
    return {"status": "ok"}


@router.put("/teams/{team_id}", response_model=AudienceTeamResponse)
async def update_audience_team(
    team_id: int,
    payload: AudienceTeamUpdate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    team = (
        db.query(AudienceTeam)
        .filter(AudienceTeam.event_id == event_id, AudienceTeam.id == team_id)
        .first()
    )
    if not team:
        raise HTTPException(status_code=404, detail="Audience team not found.")
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Name is required.")
        team.name = payload.name.strip()
    if "category_id" in payload.model_fields_set:
        team.category_id = _validate_category(db, event_id, payload.category_id)
    for field in ("short_name", "description", "colour", "sort_order"):
        value = getattr(payload, field)
        if value is not None:
            setattr(team, field, value)
    db.commit()
    db.refresh(team)
    return team


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_audience_team(
    team_id: int,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    team = (
        db.query(AudienceTeam)
        .filter(AudienceTeam.event_id == event_id, AudienceTeam.id == team_id)
        .first()
    )
    if not team:
        raise HTTPException(status_code=404, detail="Audience team not found.")
    db.delete(team)
    db.commit()
    return None


@router.get("/schedule-views", response_model=List[ScheduleViewResponse])
async def list_schedule_views(event_id: int = Query(...), db: Session = Depends(get_db)):
    """List event-scoped public schedule views."""
    _require_event(db, event_id)
    return (
        db.query(ScheduleView)
        .filter(ScheduleView.event_id == event_id)
        .order_by(ScheduleView.sort_order, ScheduleView.name)
        .all()
    )


@router.post("/schedule-views", response_model=ScheduleViewResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule_view(
    payload: ScheduleViewCreate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Create an event-scoped public schedule view."""
    _require_event(db, event_id)
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Name is required.")
    view = ScheduleView(
        event_id=event_id,
        name=payload.name.strip(),
        sort_order=payload.sort_order or 0,
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


@router.put("/schedule-views/{view_id}", response_model=ScheduleViewResponse)
async def update_schedule_view(
    view_id: int,
    payload: ScheduleViewUpdate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Update an event-scoped public schedule view."""
    view = (
        db.query(ScheduleView)
        .filter(ScheduleView.event_id == event_id, ScheduleView.id == view_id)
        .first()
    )
    if not view:
        raise HTTPException(status_code=404, detail="Schedule view not found.")
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(status_code=400, detail="Name is required.")
        view.name = payload.name.strip()
    if payload.sort_order is not None:
        view.sort_order = payload.sort_order
    db.commit()
    db.refresh(view)
    return view


@router.delete("/schedule-views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule_view(
    view_id: int,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Delete a public schedule view and remove it from existing elements."""
    view = (
        db.query(ScheduleView)
        .filter(ScheduleView.event_id == event_id, ScheduleView.id == view_id)
        .first()
    )
    if not view:
        raise HTTPException(status_code=404, detail="Schedule view not found.")
    for element in db.query(SessionElement).filter(SessionElement.event_id == event_id).all():
        element.schedule_view_ids = [
            existing_id for existing_id in (element.schedule_view_ids or [])
            if existing_id != view_id
        ]
    db.delete(view)
    db.commit()
    return None


@router.get("/session-elements", response_model=List[SessionElementResponse])
async def list_session_elements(event_id: int = Query(...), db: Session = Depends(get_db)):
    _require_event(db, event_id)
    return (
        db.query(SessionElement)
        .filter(SessionElement.event_id == event_id)
        .order_by(
            SessionElement.date,
            SessionElement.start_time,
            SessionElement.sort_order,
            SessionElement.title,
        )
        .all()
    )


@router.post("/session-elements", response_model=SessionElementResponse, status_code=status.HTTP_201_CREATED)
async def create_session_element(
    payload: SessionElementCreate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    _require_event(db, event_id)
    validated = _validate_session_payload(db, event_id, payload)
    _validate_location(db, event_id, payload.location_id)
    _validate_person(db, event_id, payload.responsible_person_id)
    element = SessionElement(
        event_id=event_id,
        **validated,
        responsible_text=payload.responsible_text,
        location_text=None,
        location_note=None,
        description=payload.description,
        category=None,
        colour=_session_type_colour(db, event_id, validated["session_element_type_id"]),
        sort_order=payload.sort_order or 0,
    )
    db.add(element)
    db.commit()
    db.refresh(element)
    return element


@router.patch("/session-elements/bulk", response_model=List[SessionElementResponse])
async def bulk_update_session_elements(
    payload: BulkSessionElementUpdate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Apply validated assignment, timing, type, and location changes atomically."""
    event = _require_event(db, event_id)
    element_ids = list(dict.fromkeys(payload.element_ids))
    if not element_ids:
        raise HTTPException(status_code=400, detail="Select at least one Session Element.")
    fields_set = payload.model_fields_set
    change_fields = fields_set - {"element_ids"}
    if not change_fields:
        raise HTTPException(status_code=400, detail="No bulk changes supplied.")
    if payload.schedule_view_ids is not None and payload.schedule_view_change is not None:
        raise HTTPException(
            status_code=400,
            detail="Use either schedule_view_ids or schedule_view_change, not both.",
        )
    if payload.attendee_team_ids is not None and payload.attendee_team_change is not None:
        raise HTTPException(
            status_code=400,
            detail="Use either attendee_team_ids or attendee_team_change, not both.",
        )
    elements = (
        db.query(SessionElement)
        .filter(
            SessionElement.event_id == event_id,
            SessionElement.id.in_(element_ids),
        )
        .all()
    )
    if len(elements) != len(element_ids):
        raise HTTPException(status_code=404, detail="One or more Session Elements were not found.")

    schedule_change = payload.schedule_view_change
    if payload.schedule_view_ids is not None:
        schedule_change = BulkIdChange(operation="replace", ids=payload.schedule_view_ids)
    if schedule_change is not None:
        schedule_change.ids = _normalise_schedule_view_ids(db, event_id, schedule_change.ids)

    attendee_change = payload.attendee_team_change
    if payload.attendee_team_ids is not None:
        attendee_change = BulkIdChange(operation="replace", ids=payload.attendee_team_ids)
    if attendee_change is not None:
        attendee_change.ids = _normalise_team_ids(db, event_id, attendee_change.ids)

    session_type_id = None
    if "session_element_type_id" in fields_set:
        session_type_id = _validate_session_type(
            db,
            event_id,
            payload.session_element_type_id,
        )
    if "location_id" in fields_set:
        _validate_location(db, event_id, payload.location_id)

    target_working_date = payload.working_date
    if target_working_date is not None:
        _validate_date(target_working_date)
        if target_working_date < str(event.start_date) or target_working_date > str(event.end_date):
            raise HTTPException(
                status_code=400,
                detail="Working date must be within the selected event.",
            )

    offset_hour = _schedule_boundary_offset_hour(event)
    proposed: dict[int, dict[str, object]] = {}
    for element in elements:
        updates: dict[str, object] = {}
        start_minutes = _parse_time(element.start_time, "start_time")
        end_minutes = _parse_time(element.end_time, "end_time")
        shift_minutes = payload.shift_minutes or 0
        next_start = start_minutes + shift_minutes
        next_end = end_minutes + shift_minutes
        if shift_minutes and not (0 <= next_start < next_end < 24 * 60):
            raise HTTPException(
                status_code=400,
                detail=f'Time shift moves "{element.title}" outside one calendar day.',
            )
        next_start_time = f"{next_start // 60:02d}:{next_start % 60:02d}"
        next_end_time = f"{next_end // 60:02d}:{next_end % 60:02d}"
        working_date = target_working_date or _working_date_for_element(element, offset_hour)
        if working_date < str(event.start_date) or working_date > str(event.end_date):
            raise HTTPException(
                status_code=400,
                detail=f'Working date for "{element.title}" is outside the selected event.',
            )
        if shift_minutes or target_working_date is not None:
            updates.update(
                date=_actual_date_for_working_slot(working_date, next_start_time, offset_hour),
                start_time=next_start_time,
                end_time=next_end_time,
            )
        if session_type_id is not None:
            updates.update(
                session_element_type_id=session_type_id,
                colour=_session_type_colour(db, event_id, session_type_id),
            )
        if "location_id" in fields_set:
            updates["location_id"] = payload.location_id
        if schedule_change is not None:
            updates["schedule_view_ids"] = _apply_id_change(
                list(element.schedule_view_ids or []),
                schedule_change,
            )
        if attendee_change is not None:
            updates["attendee_team_ids"] = _apply_id_change(
                list(element.attendee_team_ids or []),
                attendee_change,
            )
        proposed[element.id] = updates

    for element in elements:
        for field, value in proposed[element.id].items():
            setattr(element, field, value)
    db.commit()
    for element in elements:
        db.refresh(element)
    return sorted(elements, key=lambda element: element_ids.index(element.id))


@router.post(
    "/session-elements/bulk-create",
    response_model=List[SessionElementResponse],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_session_elements(
    payload: BulkSessionElementCreate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Create multiple public schedule items only when every row is valid."""
    _require_event(db, event_id)
    created: list[SessionElement] = []
    for item in payload.items:
        validated = _validate_session_payload(db, event_id, item)
        _validate_location(db, event_id, item.location_id)
        _validate_person(db, event_id, item.responsible_person_id)
        created.append(
            SessionElement(
                event_id=event_id,
                **validated,
                responsible_text=item.responsible_text,
                location_text=None,
                location_note=None,
                description=item.description,
                category=None,
                colour=_session_type_colour(
                    db,
                    event_id,
                    validated["session_element_type_id"],
                ),
                sort_order=item.sort_order or 0,
            )
        )
    db.add_all(created)
    db.commit()
    for element in created:
        db.refresh(element)
    return created


@router.put("/session-elements/{element_id}", response_model=SessionElementResponse)
async def update_session_element(
    element_id: int,
    payload: SessionElementUpdate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    element = (
        db.query(SessionElement)
        .filter(SessionElement.event_id == event_id, SessionElement.id == element_id)
        .first()
    )
    if not element:
        raise HTTPException(status_code=404, detail="Session Element not found.")
    validated = _validate_session_payload(db, event_id, payload, existing=element)
    _validate_location(db, event_id, validated["location_id"])
    _validate_person(db, event_id, validated["responsible_person_id"])
    for field, value in validated.items():
        setattr(element, field, value)
    for field in ("responsible_text", "description", "sort_order"):
        if field in payload.model_fields_set:
            setattr(element, field, getattr(payload, field))
    element.location_text = None
    element.location_note = None
    element.category = None
    element.visibility = "public"
    element.colour = _session_type_colour(db, event_id, validated["session_element_type_id"])
    db.commit()
    db.refresh(element)
    return element


@router.delete("/session-elements/{element_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session_element(
    element_id: int,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    element = (
        db.query(SessionElement)
        .filter(SessionElement.event_id == event_id, SessionElement.id == element_id)
        .first()
    )
    if not element:
        raise HTTPException(status_code=404, detail="Session Element not found.")
    db.delete(element)
    db.commit()
    return None


@router.post("/session-elements/{element_id}/duplicate", response_model=SessionElementResponse)
async def duplicate_session_element(
    element_id: int,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    element = (
        db.query(SessionElement)
        .filter(SessionElement.event_id == event_id, SessionElement.id == element_id)
        .first()
    )
    if not element:
        raise HTTPException(status_code=404, detail="Session Element not found.")
    duplicate = SessionElement(
        event_id=event_id,
        session_element_type_id=element.session_element_type_id,
        title=f"{element.title} copy",
        date=element.date,
        start_time=element.start_time,
        end_time=element.end_time,
        location_id=element.location_id,
        responsible_person_id=element.responsible_person_id,
        responsible_text=element.responsible_text,
        location_text=None,
        location_note=None,
        attendee_team_ids=list(element.attendee_team_ids or []),
        schedule_view_ids=list(element.schedule_view_ids or []),
        visibility="public",
        description=element.description,
        category=None,
        colour=_session_type_colour(db, event_id, element.session_element_type_id),
        sort_order=(element.sort_order or 0) + 0.01,
    )
    db.add(duplicate)
    db.commit()
    db.refresh(duplicate)
    return duplicate


@router.post("/session-elements/copy", response_model=List[SessionElementResponse])
async def copy_session_elements(
    payload: CopySessionElementsRequest,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    event = _require_event(db, event_id)
    for target_date in payload.target_dates:
        _validate_date(target_date)
    source_elements = (
        db.query(SessionElement)
        .filter(SessionElement.event_id == event_id, SessionElement.id.in_(payload.element_ids))
        .order_by(SessionElement.date, SessionElement.start_time, SessionElement.sort_order)
        .all()
    )
    day_range = (event.meta_data or {}).get("schedule_day_range")
    offset_hour = 0
    if isinstance(day_range, dict):
        try:
            start_hour = int(day_range.get("startHour"))
            end_hour = int(day_range.get("endHour"))
            if 0 <= start_hour <= 23 and start_hour < end_hour <= 36:
                offset_hour = max(0, end_hour - 24)
        except (TypeError, ValueError):
            offset_hour = 0

    created: list[SessionElement] = []
    for target_date in payload.target_dates:
        for element in source_elements:
            actual_target = date.fromisoformat(target_date)
            start_hour = int(element.start_time.split(":", 1)[0])
            if offset_hour > 0 and start_hour < offset_hour:
                actual_target += timedelta(days=1)
            copy = SessionElement(
                event_id=event_id,
                session_element_type_id=element.session_element_type_id,
                title=element.title,
                date=actual_target.isoformat(),
                start_time=element.start_time,
                end_time=element.end_time,
                location_id=element.location_id,
                responsible_person_id=element.responsible_person_id,
                responsible_text=element.responsible_text,
                location_text=None,
                location_note=None,
                attendee_team_ids=list(element.attendee_team_ids or []),
                schedule_view_ids=list(element.schedule_view_ids or []),
                visibility="public",
                description=element.description,
                category=None,
                colour=_session_type_colour(db, event_id, element.session_element_type_id),
                sort_order=element.sort_order,
            )
            db.add(copy)
            created.append(copy)
    db.commit()
    for element in created:
        db.refresh(element)
    return created


@router.get("/publish-state/{event_id}", response_model=GeneralSchedulePublishStateResponse)
async def get_general_schedule_publish_state(event_id: int, db: Session = Depends(get_db)):
    _require_event(db, event_id)
    state = (
        db.query(GeneralSchedulePublishState)
        .filter(GeneralSchedulePublishState.event_id == event_id)
        .first()
    )
    if state is None:
        return GeneralSchedulePublishStateResponse(event_id=event_id)
    return state


@router.put("/publish-state/{event_id}", response_model=GeneralSchedulePublishStateResponse)
async def save_general_schedule_publish_state(
    event_id: int,
    payload: GeneralSchedulePublishStateUpdate,
    db: Session = Depends(get_db),
):
    _require_event(db, event_id)
    state = (
        db.query(GeneralSchedulePublishState)
        .filter(GeneralSchedulePublishState.event_id == event_id)
        .first()
    )
    if state is None:
        state = GeneralSchedulePublishState(event_id=event_id)
        db.add(state)
    state.fingerprint = payload.fingerprint
    state.published_at = payload.published_at
    state.publish_failed_at = payload.publish_failed_at
    state.item_count = payload.item_count
    state.last_error = payload.last_error
    state.day_records = payload.day_records
    db.commit()
    db.refresh(state)
    return state
