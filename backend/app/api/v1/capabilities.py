"""
Capabilities API endpoints
"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_serializer, ConfigDict

from app.db.database import get_db
from app.core.event_deletion import cleanup_orphaned_event_scoped_data
from app.models.capability import Capability, CapabilityType
from app.models.event import Event
from app.core.identifier_validation import validate_machine_name

router = APIRouter()


# Pydantic schemas
class CapabilityCreate(BaseModel):
    machine_name: str
    name: str
    description: str | None = None
    capability_type_id: int


class CapabilityUpdate(BaseModel):
    machine_name: str | None = None
    name: str | None = None
    description: str | None = None
    capability_type_id: int | None = None


class CapabilityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    machine_name: str
    name: str
    description: str | None
    capability_type_id: int | None
    created_at: datetime | None
    updated_at: datetime | None

    @field_serializer('created_at', 'updated_at')
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


@router.get("", response_model=List[CapabilityResponse])
async def get_capabilities(
    event_id: Optional[int] = Query(None, description="If provided, filter to capabilities enabled for this event"),
    db: Session = Depends(get_db),
):
    """Get all capabilities, optionally filtered by event's enabled list"""
    capabilities = db.query(Capability).outerjoin(
        CapabilityType, Capability.capability_type_id == CapabilityType.id
    ).order_by(
        CapabilityType.sort_order.asc().nullsfirst(),
        Capability.machine_name.asc(),
        Capability.id.asc(),
    ).all()

    if event_id is not None:
        event = db.query(Event).filter(Event.id == event_id).first()
        if event and event.enabled_capability_ids is not None:
            enabled = set(event.enabled_capability_ids)
            capabilities = [c for c in capabilities if c.id in enabled]

    return capabilities


@router.get("/{capability_id}", response_model=CapabilityResponse)
async def get_capability(
    capability_id: int,
    db: Session = Depends(get_db),
):
    """Get a specific capability by ID"""
    capability = db.query(Capability).filter(Capability.id == capability_id).first()
    if not capability:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Capability not found"
        )
    return capability


@router.post("", response_model=CapabilityResponse, status_code=status.HTTP_201_CREATED)
async def create_capability(
    capability_data: CapabilityCreate,
    db: Session = Depends(get_db),
):
    """Create a new capability"""
    try:
        machine_name = validate_machine_name(capability_data.machine_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    # Check if machine_name already exists
    existing = db.query(Capability).filter(
        Capability.machine_name == machine_name
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Capability with machine_name '{machine_name}' already exists"
        )
    
    capability = Capability(
        machine_name=machine_name,
        name=capability_data.name,
        description=capability_data.description,
        capability_type_id=capability_data.capability_type_id
    )
    
    db.add(capability)
    db.commit()
    db.refresh(capability)
    
    return capability


@router.put("/{capability_id}", response_model=CapabilityResponse)
async def update_capability(
    capability_id: int,
    capability_data: CapabilityUpdate,
    db: Session = Depends(get_db),
):
    """Update a capability"""
    capability = db.query(Capability).filter(Capability.id == capability_id).first()
    if not capability:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Capability not found"
        )
    
    # Check if new machine_name conflicts with existing
    if capability_data.machine_name:
        try:
            machine_name = validate_machine_name(capability_data.machine_name)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

        if machine_name != capability.machine_name:
            existing = db.query(Capability).filter(
                Capability.machine_name == machine_name
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Capability with machine_name '{machine_name}' already exists"
                )
            capability.machine_name = machine_name
    
    if capability_data.name is not None:
        capability.name = capability_data.name
    
    if capability_data.description is not None:
        capability.description = capability_data.description
    
    if capability_data.capability_type_id is not None:
        capability.capability_type_id = capability_data.capability_type_id
    
    db.commit()
    db.refresh(capability)
    
    return capability


@router.delete("/{capability_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_capability(
    capability_id: int,
    db: Session = Depends(get_db),
):
    """Delete a capability"""
    cleanup_orphaned_event_scoped_data(db)

    capability = db.query(Capability).filter(Capability.id == capability_id).first()
    if not capability:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Capability not found"
        )
    
    # Check if capability is in use
    from app.models.capability import PersonCapability, TaskCapabilityRequirement
    
    person_usage = db.query(PersonCapability).filter(
        PersonCapability.capability_id == capability_id
    ).first()
    if person_usage:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete capability that is assigned to persons"
        )
    
    task_usage = db.query(TaskCapabilityRequirement).filter(
        TaskCapabilityRequirement.capability_id == capability_id
    ).first()
    if task_usage:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete capability that is required by tasks"
        )

    # Check if capability is enabled in any event
    events_using = db.query(Event).filter(
        Event.enabled_capability_ids.isnot(None)
    ).all()
    for ev in events_using:
        if capability_id in (ev.enabled_capability_ids or []):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete capability that is enabled in project '{ev.name}'"
            )

    db.delete(capability)
    db.commit()

    return None
