"""
Groups API Endpoints
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from typing import Optional, List, Any
from datetime import datetime
from pydantic import BaseModel, field_serializer, ConfigDict

from app.db.database import get_db
from app.models.group import Group

router = APIRouter()


def _coerce_member_id(raw_id: Any) -> Optional[int]:
    """Return a numeric member ID when the incoming value is ID-like."""
    try:
        member_id = int(raw_id)
    except (TypeError, ValueError):
        return None
    return member_id


def _normalise_group_members(members: Optional[List[Any]]) -> List[dict[str, int | str]]:
    """Return supported person and group members with duplicates removed."""
    if not members:
        return []

    deduped: List[dict[str, int | str]] = []
    seen_members: set[tuple[str, int]] = set()
    for member in members:
        member_type = "person"
        raw_id = member

        if isinstance(member, dict):
            member_type = member.get("type") or "person"
            raw_id = member.get("id")

        if member_type not in {"person", "group"}:
            continue

        member_id = _coerce_member_id(raw_id)
        if member_id is None:
            continue

        member_key = (member_type, member_id)
        if member_key in seen_members:
            continue

        seen_members.add(member_key)
        deduped.append({"type": member_type, "id": member_id})

    return deduped


def _group_includes_target(
    db: Session,
    event_id: int,
    start_group_id: int,
    target_group_id: int,
    visited: Optional[set[int]] = None,
) -> bool:
    """Return whether a group reaches another group through included groups."""
    if start_group_id == target_group_id:
        return True

    visited = visited or set()
    if start_group_id in visited:
        return False
    visited.add(start_group_id)

    group = db.query(Group).filter(
        Group.id == start_group_id,
        Group.event_id == event_id,
    ).first()
    if not group:
        return False

    members = _normalise_group_members(
        group.meta_data.get("members", []) if group.meta_data else []
    )
    included_group_ids = [
        int(member["id"]) for member in members if member["type"] == "group"
    ]
    return any(
        _group_includes_target(
            db,
            event_id,
            included_group_id,
            target_group_id,
            visited,
        )
        for included_group_id in included_group_ids
    )


def _validate_group_members(
    db: Session,
    event_id: int,
    members: List[dict[str, int | str]],
    current_group_id: Optional[int] = None,
) -> None:
    """Validate included groups before persisting group membership JSON."""
    included_group_ids = [
        int(member["id"]) for member in members if member["type"] == "group"
    ]
    if not included_group_ids:
        return

    existing_group_ids = {
        group.id
        for group in db.query(Group).filter(
            Group.event_id == event_id,
            Group.id.in_(included_group_ids),
        )
    }
    missing_group_ids = [
        group_id for group_id in included_group_ids if group_id not in existing_group_ids
    ]
    if missing_group_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Included group not found in this event.",
        )

    if current_group_id is None:
        return

    if current_group_id in included_group_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This would create a circular group reference.",
        )

    if any(
        _group_includes_target(db, event_id, included_group_id, current_group_id)
        for included_group_id in included_group_ids
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This would create a circular group reference.",
        )


# Pydantic schemas
class GroupCreate(BaseModel):
    name: str
    group_type_id: Optional[int] = None
    attributes: Optional[dict[str, str]] = None  # name-text pairs like {"leader": "Sarah", "assistant": "Tom"}
    members: Optional[List[Any]] = None  # List of members: {"type": "person"|"group", "id": 1}


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    group_type_id: Optional[int] = None
    attributes: Optional[dict[str, str]] = None
    members: Optional[List[Any]] = None


class GroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    event_id: int
    name: str
    group_type_id: Optional[int]
    attributes: dict[str, str]
    members: List[Any]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    @field_serializer('created_at', 'updated_at')
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


@router.get("", response_model=List[GroupResponse])
@router.get("/", response_model=List[GroupResponse])
async def get_groups(
    event_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Get groups for an event"""
    if not event_id:
        return []
    
    groups = db.query(Group).filter(Group.event_id == event_id).all()
    
    # Add attributes and members from meta_data to response
    for group in groups:
        group.attributes = group.meta_data.get("attributes", {}) if group.meta_data else {}
        group.members = group.meta_data.get("members", []) if group.meta_data else []
    
    return groups


@router.get("/{group_id}", response_model=GroupResponse)
async def get_group(
    group_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get a specific group by ID, scoped to event"""
    group = db.query(Group).filter(
        Group.id == group_id,
        Group.event_id == event_id,
    ).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found in this event"
        )
    
    group.attributes = group.meta_data.get("attributes", {}) if group.meta_data else {}
    group.members = group.meta_data.get("members", []) if group.meta_data else []
    return group


@router.post("", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    group_data: GroupCreate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Create a new group"""
    members = _normalise_group_members(group_data.members)
    _validate_group_members(db, event_id, members)

    # Create group
    meta_data = {
        "attributes": group_data.attributes or {},
        "members": members,
    }
    group = Group(
        event_id=event_id,
        name=group_data.name,
        group_type_id=group_data.group_type_id,
        meta_data=meta_data
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    
    group.attributes = group.meta_data.get("attributes", {}) if group.meta_data else {}
    group.members = group.meta_data.get("members", []) if group.meta_data else []
    return group


@router.put("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: int,
    group_data: GroupUpdate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Update a group"""
    group = db.query(Group).filter(
        Group.id == group_id,
        Group.event_id == event_id
    ).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found in this event"
        )
    
    # Update fields
    if group_data.name is not None:
        group.name = group_data.name
    if group_data.group_type_id is not None:
        group.group_type_id = group_data.group_type_id
    
    # Ensure meta_data exists
    if not group.meta_data:
        group.meta_data = {}
    
    # Create a new dict to ensure SQLAlchemy detects the change
    updated_meta_data = dict(group.meta_data)
    
    if group_data.attributes is not None:
        updated_meta_data["attributes"] = group_data.attributes
    
    if group_data.members is not None:
        members = _normalise_group_members(group_data.members)
        _validate_group_members(db, event_id, members, current_group_id=group_id)
        updated_meta_data["members"] = members
    
    # Assign the new dict and flag as modified
    group.meta_data = updated_meta_data
    flag_modified(group, "meta_data")
    
    db.commit()
    db.refresh(group)
    
    group.attributes = group.meta_data.get("attributes", {}) if group.meta_data else {}
    group.members = group.meta_data.get("members", []) if group.meta_data else []
    return group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Delete a group"""
    group = db.query(Group).filter(
        Group.id == group_id,
        Group.event_id == event_id
    ).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found in this event"
        )
    
    db.delete(group)
    db.commit()
    return None
