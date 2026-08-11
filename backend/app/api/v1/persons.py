"""
Persons API Endpoints
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, EmailStr, field_serializer, ConfigDict, Field

from app.db.database import get_db
from app.models.person import Person
from app.models.privacy import PersonUnavailability
from app.models.assignment import Assignment
from app.models.capability import Capability, CapabilityType, PersonCapability
from app.models.group import GroupMembership

router = APIRouter()


def _get_person_capability_machine_names(db: Session, person_id: int) -> List[str]:
    capabilities = db.query(Capability).join(
        PersonCapability, PersonCapability.capability_id == Capability.id
    ).outerjoin(
        CapabilityType, Capability.capability_type_id == CapabilityType.id
    ).filter(
        PersonCapability.person_id == person_id
    ).order_by(
        CapabilityType.sort_order.asc().nullsfirst(),
        Capability.machine_name.asc(),
        Capability.id.asc(),
    ).all()
    return [cap.machine_name for cap in capabilities]

# Pydantic schemas
class PersonUnavailabilityIn(BaseModel):
    """A reason-free local datetime interval used for scheduling."""

    starts_at: datetime
    ends_at: datetime


class PersonCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    capabilities: List[str] = Field(default_factory=list)  # List of capability machine_names
    unavailabilities: List[PersonUnavailabilityIn] = Field(default_factory=list)
    max_hours_per_day: Optional[float] = None
    home_location_id: int
    google_email: Optional[str] = None


class PersonUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    capabilities: Optional[List[str]] = None  # List of capability machine_names
    unavailabilities: Optional[List[PersonUnavailabilityIn]] = None
    max_hours_per_day: Optional[float | None] = None
    home_location_id: Optional[int] = None
    google_email: Optional[str | None] = None


class PersonResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    evidence_subject_id: str
    first_name: str
    last_name: str
    email: Optional[str] = None
    capabilities: List[str] = Field(default_factory=list)
    unavailabilities: List[dict[str, datetime]] = Field(default_factory=list)
    max_hours_per_day: Optional[float] = None
    home_location_id: Optional[int] = None
    google_email: Optional[str] = None
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    @field_serializer('created_at', 'updated_at')
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


def _replace_unavailabilities(
    db: Session,
    person: Person,
    intervals: List[PersonUnavailabilityIn],
) -> None:
    """Replace one person's reason-free operational unavailability intervals."""

    db.query(PersonUnavailability).filter(
        PersonUnavailability.person_id == person.id,
    ).delete(synchronize_session=False)
    for interval in intervals:
        starts_at = interval.starts_at
        ends_at = interval.ends_at
        if starts_at.tzinfo is not None:
            starts_at = starts_at.replace(tzinfo=None)
        if ends_at.tzinfo is not None:
            ends_at = ends_at.replace(tzinfo=None)
        if ends_at <= starts_at:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unavailability end must be after its start.",
            )
        db.add(PersonUnavailability(
            event_id=person.event_id,
            person_id=person.id,
            starts_at=starts_at,
            ends_at=ends_at,
        ))


def _person_response(db: Session, person: Person) -> dict:
    """Build the current typed person response without arbitrary profile data."""

    intervals = db.query(PersonUnavailability).filter(
        PersonUnavailability.person_id == person.id,
    ).order_by(PersonUnavailability.starts_at, PersonUnavailability.id).all()
    return {
        "id": person.id,
        "evidence_subject_id": person.evidence_subject_id,
        "first_name": person.first_name,
        "last_name": person.last_name,
        "email": person.email,
        "capabilities": _get_person_capability_machine_names(db, person.id),
        "unavailabilities": [
            {"starts_at": row.starts_at, "ends_at": row.ends_at}
            for row in intervals
        ],
        "max_hours_per_day": person.max_hours_per_day,
        "home_location_id": person.home_location_id,
        "google_email": person.google_email,
        "created_at": person.created_at,
        "updated_at": person.updated_at,
    }


@router.get("", response_model=List[PersonResponse])
@router.get("/", response_model=List[PersonResponse])
async def get_persons(
    event_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Get persons for an event."""
    if not event_id:
        return []
    
    # Get all persons for this event
    persons = db.query(Person).filter(Person.event_id == event_id).all()
    
    return [_person_response(db, person) for person in persons]


@router.get("/{person_id}", response_model=PersonResponse)
async def get_person(
    person_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get a specific person by ID, scoped to event"""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.event_id == event_id,
    ).first()
    if not person:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found in this event"
        )
    
    return _person_response(db, person)


@router.post("", response_model=PersonResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=PersonResponse, status_code=status.HTTP_201_CREATED)
async def create_person(
    person_data: PersonCreate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Create a new person"""
    # Check if email already exists for this event (only if email is provided)
    if person_data.email:
        existing = db.query(Person).filter(
            Person.email == person_data.email,
            Person.event_id == event_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Person with email '{person_data.email}' already exists in this event"
            )
    
    # Create person
    person = Person(
        event_id=event_id,
        first_name=person_data.first_name,
        last_name=person_data.last_name,
        email=person_data.email,
        max_hours_per_day=person_data.max_hours_per_day,
        home_location_id=person_data.home_location_id,
        google_email=person_data.google_email
    )
    db.add(person)
    db.flush()
    db.refresh(person)
    _replace_unavailabilities(db, person, person_data.unavailabilities)
    
    # Add capabilities
    if person_data.capabilities:
        for cap_machine_name in person_data.capabilities:
            capability = db.query(Capability).filter(
                Capability.machine_name == cap_machine_name
            ).first()
            if capability:
                person_cap = PersonCapability(
                    person_id=person.id,
                    capability_id=capability.id
                )
                db.add(person_cap)
    db.commit()
    return _person_response(db, person)


@router.put("/{person_id}", response_model=PersonResponse)
async def update_person(
    person_id: int,
    person_data: PersonUpdate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Update a person"""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.event_id == event_id
    ).first()
    if not person:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found in this event"
        )
    
    # Check email uniqueness if being updated (within the same event)
    if person_data.email and person_data.email != (person.email or ""):
        existing = db.query(Person).filter(
            Person.email == person_data.email,
            Person.event_id == event_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Person with email '{person_data.email}' already exists in this event"
            )
    
    # Update fields
    if person_data.first_name is not None:
        person.first_name = person_data.first_name
    if person_data.last_name is not None:
        person.last_name = person_data.last_name
    if "email" in person_data.model_fields_set:
        person.email = person_data.email
    if person_data.unavailabilities is not None:
        _replace_unavailabilities(db, person, person_data.unavailabilities)
    if person_data.max_hours_per_day is not None:
        person.max_hours_per_day = person_data.max_hours_per_day
    if person_data.home_location_id is not None:
        person.home_location_id = person_data.home_location_id
    if person_data.google_email is not None:
        person.google_email = person_data.google_email
    
    # Update capabilities if provided
    if person_data.capabilities is not None:
        # Remove existing capabilities
        db.query(PersonCapability).filter(
            PersonCapability.person_id == person.id
        ).delete()
        
        # Add new capabilities
        for cap_machine_name in person_data.capabilities:
            capability = db.query(Capability).filter(
                Capability.machine_name == cap_machine_name
            ).first()
            if capability:
                person_cap = PersonCapability(
                    person_id=person.id,
                    capability_id=capability.id
                )
                db.add(person_cap)
    
    db.commit()
    db.refresh(person)
    
    return _person_response(db, person)


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_person(
    person_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Delete a person"""
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.event_id == event_id
    ).first()
    if not person:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found in this event"
        )
    
    # Delete associated capabilities
    db.query(PersonCapability).filter(PersonCapability.person_id == person.id).delete()
    
    # Delete associated assignments
    db.query(Assignment).filter(Assignment.person_id == person.id).delete()
    
    # Delete group memberships
    db.query(GroupMembership).filter(GroupMembership.person_id == person.id).delete()
    db.query(PersonUnavailability).filter(
        PersonUnavailability.person_id == person.id,
    ).delete()
    
    # Delete person
    db.delete(person)
    db.commit()
    
    return None

