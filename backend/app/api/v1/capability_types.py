"""
Capability Types API endpoints - Root-admin only
"""
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_serializer, ConfigDict

from app.db.database import get_db
from app.models.capability import CapabilityType

router = APIRouter()


# Pydantic schemas
class CapabilityTypeCreate(BaseModel):
    name: str
    description: str | None = None
    color: str | None = None
    sort_order: int = 0


class CapabilityTypeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CapabilityTypeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    name: str
    description: str | None
    color: str | None
    sort_order: int
    is_active: bool
    created_at: datetime | None
    updated_at: datetime | None

    @field_serializer('created_at', 'updated_at')
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


# Endpoints
@router.get("/", response_model=List[CapabilityTypeResponse])
async def list_capability_types(
    db: Session = Depends(get_db),
):
    """Get all capability types, sorted by sort_order"""
    capability_types = db.query(CapabilityType).filter(
        CapabilityType.is_active == True
    ).order_by(CapabilityType.sort_order).all()
    return capability_types


@router.get("/{capability_type_id}", response_model=CapabilityTypeResponse)
async def get_capability_type(
    capability_type_id: int,
    db: Session = Depends(get_db),
):
    """Get a specific capability type"""
    capability_type = db.query(CapabilityType).filter(
        CapabilityType.id == capability_type_id
    ).first()
    if not capability_type:
        raise HTTPException(status_code=404, detail="Capability type not found")
    return capability_type


@router.post("/", response_model=CapabilityTypeResponse, status_code=status.HTTP_201_CREATED)
async def create_capability_type(
    capability_type: CapabilityTypeCreate,
    db: Session = Depends(get_db),
):
    """Create a new capability type"""
    # Check for duplicate name
    existing = db.query(CapabilityType).filter(
        CapabilityType.name == capability_type.name
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Capability type with name '{capability_type.name}' already exists"
        )
    
    # Create new capability type
    db_capability_type = CapabilityType(
        name=capability_type.name,
        description=capability_type.description,
        color=capability_type.color,
        sort_order=capability_type.sort_order
    )
    db.add(db_capability_type)
    db.commit()
    db.refresh(db_capability_type)
    
    return db_capability_type


@router.put("/{capability_type_id}", response_model=CapabilityTypeResponse)
async def update_capability_type(
    capability_type_id: int,
    capability_type_update: CapabilityTypeUpdate,
    db: Session = Depends(get_db),
):
    """Update a capability type"""
    # Get existing capability type
    db_capability_type = db.query(CapabilityType).filter(
        CapabilityType.id == capability_type_id
    ).first()
    if not db_capability_type:
        raise HTTPException(status_code=404, detail="Capability type not found")
    
    # Check for duplicate name if name is being changed
    if capability_type_update.name and capability_type_update.name != db_capability_type.name:
        existing = db.query(CapabilityType).filter(
            CapabilityType.name == capability_type_update.name
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Capability type with name '{capability_type_update.name}' already exists"
            )
    
    # Update fields
    update_data = capability_type_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_capability_type, field, value)
    
    db.commit()
    db.refresh(db_capability_type)
    
    return db_capability_type


@router.delete("/{capability_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_capability_type(
    capability_type_id: int,
    db: Session = Depends(get_db),
):
    """Delete a capability type"""
    # Get existing capability type
    db_capability_type = db.query(CapabilityType).filter(
        CapabilityType.id == capability_type_id
    ).first()
    if not db_capability_type:
        raise HTTPException(status_code=404, detail="Capability type not found")
    
    # Block deletion if any capability references this type
    from app.models.capability import Capability
    cap_count = db.query(Capability).filter(
        Capability.capability_type_id == capability_type_id
    ).count()
    if cap_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete capability type: {cap_count} capability/capabilities are using this type"
        )

    db.delete(db_capability_type)
    db.commit()

    return None
