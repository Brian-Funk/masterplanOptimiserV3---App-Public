"""
Masterplan Layout API Endpoints
Manages cosmetic visual overrides for tasks in the masterplan view.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional, List
import logging

from app.db.database import get_db
from app.models.masterplan_layout import MasterplanLayout
from app.models.task import Task
from app.schemas.masterplan import (
    MasterplanLayoutCreate,
    MasterplanLayoutResponse,
    MasterplanLayoutBulkRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/", response_model=List[MasterplanLayoutResponse])
async def get_layouts(
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Get all layout overrides for an event."""
    layouts = db.query(MasterplanLayout).filter(
        MasterplanLayout.event_id == event_id
    ).all()
    return layouts


@router.put("/bulk/upsert")
async def bulk_upsert_layouts(
    request: MasterplanLayoutBulkRequest,
    db: Session = Depends(get_db),
):
    """Batch upsert layout overrides for an event."""
    updated = 0
    created = 0

    for item in request.layouts:
        layout = db.query(MasterplanLayout).filter(
            MasterplanLayout.task_id == item.task_id,
            MasterplanLayout.event_id == request.event_id
        ).first()

        if layout:
            if item.visual_height is not None:
                layout.visual_height = item.visual_height
            if item.visual_x_offset is not None:
                layout.visual_x_offset = item.visual_x_offset
            if item.visual_width is not None:
                layout.visual_width = item.visual_width
            if item.custom_color is not None:
                layout.custom_color = item.custom_color
            if item.sort_order is not None:
                layout.sort_order = item.sort_order
            updated += 1
        else:
            layout = MasterplanLayout(
                event_id=request.event_id,
                task_id=item.task_id,
                visual_height=item.visual_height,
                visual_x_offset=item.visual_x_offset,
                visual_width=item.visual_width,
                custom_color=item.custom_color,
                sort_order=item.sort_order,
            )
            db.add(layout)
            created += 1

    db.commit()
    return {"status": "success", "created": created, "updated": updated}


@router.put("/{task_id}", response_model=MasterplanLayoutResponse)
async def upsert_layout(
    task_id: int,
    data: MasterplanLayoutCreate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Create or update a layout override for a specific task."""
    task = db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    layout = db.query(MasterplanLayout).filter(
        MasterplanLayout.task_id == task_id
    ).first()

    if layout:
        # Update existing
        if data.visual_height is not None:
            layout.visual_height = data.visual_height
        if data.visual_x_offset is not None:
            layout.visual_x_offset = data.visual_x_offset
        if data.visual_width is not None:
            layout.visual_width = data.visual_width
        if data.custom_color is not None:
            layout.custom_color = data.custom_color
        if data.sort_order is not None:
            layout.sort_order = data.sort_order
    else:
        # Create new
        layout = MasterplanLayout(
            event_id=task.event_id,
            task_id=task_id,
            visual_height=data.visual_height,
            visual_x_offset=data.visual_x_offset,
            visual_width=data.visual_width,
            custom_color=data.custom_color,
            sort_order=data.sort_order,
        )
        db.add(layout)

    db.commit()
    db.refresh(layout)
    return layout


@router.delete("/event/{event_id}")
async def delete_all_layouts_for_event(
    event_id: int,
    db: Session = Depends(get_db),
):
    """Delete all layout overrides for an event (reset cosmetic changes)."""
    count = db.query(MasterplanLayout).filter(
        MasterplanLayout.event_id == event_id
    ).delete()
    db.commit()
    return {"status": "success", "deleted": count}


@router.delete("/{task_id}")
async def delete_layout(
    task_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Delete a layout override for a task."""
    layout = db.query(MasterplanLayout).filter(
        MasterplanLayout.task_id == task_id,
        MasterplanLayout.event_id == event_id,
    ).first()
    if not layout:
        raise HTTPException(status_code=404, detail="Layout not found")

    db.delete(layout)
    db.commit()
    return {"status": "success", "message": "Layout deleted"}
