"""
Locations API Endpoints
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, List, Any
from datetime import datetime
from pydantic import BaseModel, field_serializer, ConfigDict

from app.db.database import get_db
from app.models.location import Location
from app.models.person import Person
from app.models.task import Task

router = APIRouter()


# Pydantic schemas
class LocationCreate(BaseModel):
    name: str
    address: Optional[str] = None
    details: Optional[dict[str, Any]] = None


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    details: Optional[dict[str, Any]] = None


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    event_id: int
    name: Optional[str]
    address: Optional[str]
    details: Optional[dict[str, Any]]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    @field_serializer('created_at', 'updated_at')
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


@router.get("", response_model=List[LocationResponse])
@router.get("/", response_model=List[LocationResponse])
async def get_locations(
    event_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Get locations for an event"""
    if not event_id:
        return []
    
    locations = db.query(Location).filter(Location.event_id == event_id).all()
    return locations


@router.get("/{location_id}", response_model=LocationResponse)
async def get_location(
    location_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get a specific location by ID, scoped to event"""
    location = db.query(Location).filter(
        Location.id == location_id,
        Location.event_id == event_id,
    ).first()
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found in this event"
        )
    
    return location


@router.post("", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    location_data: LocationCreate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Create a new location"""
    location = Location(
        event_id=event_id,
        name=location_data.name,
        address=location_data.address,
        details=location_data.details or {}
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    
    return location


@router.put("/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: int,
    location_data: LocationUpdate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Update a location"""
    location = db.query(Location).filter(
        Location.id == location_id,
        Location.event_id == event_id
    ).first()
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found in this event"
        )
    
    if location_data.name is not None:
        location.name = location_data.name
    if location_data.address is not None:
        location.address = location_data.address
    if location_data.details is not None:
        location.details = location_data.details
    
    db.commit()
    db.refresh(location)
    
    return location


@router.delete("/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_location(
    location_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Delete a location"""
    location = db.query(Location).filter(
        Location.id == location_id,
        Location.event_id == event_id
    ).first()
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found in this event"
        )
    
    # Handle cascading deletes and updates
    # 1. Set home_location_id to NULL for persons that reference this location
    db.query(Person).filter(
        Person.event_id == event_id,
        Person.home_location_id == location_id
    ).update({"home_location_id": None})
    
    # 2. Update tasks that have this location assigned in their optimised or final fields
    # Tasks store location assignments in the optimised and final JSON fields
    tasks_to_update = db.query(Task).filter(
        Task.event_id == event_id
    ).all()
    
    for task in tasks_to_update:
        # Check and update optimised field
        if task.optimised and isinstance(task.optimised, dict):
            if task.optimised.get("location") == location_id:
                updated_optimised = task.optimised.copy()
                updated_optimised.pop("location", None)
                task.optimised = updated_optimised
        
        # Check and update final field
        if task.final and isinstance(task.final, dict):
            if task.final.get("location") == location_id:
                updated_final = task.final.copy()
                updated_final.pop("location", None)
                task.final = updated_final
    
    # 4. Delete the location itself
    db.delete(location)
    db.commit()
    return None
