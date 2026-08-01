"""
Task Types API endpoints - Root-admin only
"""
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_serializer, ConfigDict

from app.db.database import get_db
from app.core.event_deletion import cleanup_orphaned_event_scoped_data
from app.models.task import TaskType

router = APIRouter()


# Pydantic schemas
class TaskTypeCreate(BaseModel):
    """Values accepted when creating a task type."""

    name: str
    description: str | None = None
    color: str | None = None
    sort_order: int = 0
    fatigue_score: int = 0
    counts_towards_work_time: bool = True


class TaskTypeUpdate(BaseModel):
    """Optional task-type fields accepted by the update endpoint."""

    name: str | None = None
    description: str | None = None
    color: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    fatigue_score: int | None = None
    counts_towards_work_time: bool | None = None


class TaskTypeResponse(BaseModel):
    """Task-type data returned to desktop clients."""

    model_config = ConfigDict(from_attributes=True)
    
    id: int
    name: str
    description: str | None
    color: str | None
    sort_order: int
    is_active: bool
    fatigue_score: int
    counts_towards_work_time: bool
    created_at: datetime | None
    updated_at: datetime | None

    @field_serializer('created_at', 'updated_at')
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


# Endpoints
@router.get("/", response_model=List[TaskTypeResponse])
async def list_task_types(
    db: Session = Depends(get_db),
):
    """Get all task types"""
    task_types = db.query(TaskType).filter(TaskType.is_active == True).all()
    return task_types


@router.get("/{task_type_id}", response_model=TaskTypeResponse)
async def get_task_type(
    task_type_id: int,
    db: Session = Depends(get_db),
):
    """Get a specific task type"""
    task_type = db.query(TaskType).filter(TaskType.id == task_type_id).first()
    if not task_type:
        raise HTTPException(status_code=404, detail="Task type not found")
    return task_type


@router.post("/", response_model=TaskTypeResponse, status_code=status.HTTP_201_CREATED)
async def create_task_type(
    task_type: TaskTypeCreate,
    db: Session = Depends(get_db),
):
    """Create a new task type"""
    # Check for duplicate name
    existing = db.query(TaskType).filter(
        TaskType.name == task_type.name
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task type with name '{task_type.name}' already exists"
        )
    
    db_task_type = TaskType(**task_type.model_dump())
    db.add(db_task_type)
    db.commit()
    db.refresh(db_task_type)
    return db_task_type


@router.put("/{task_type_id}", response_model=TaskTypeResponse)
async def update_task_type(
    task_type_id: int,
    task_type: TaskTypeUpdate,
    db: Session = Depends(get_db),
):
    """Update a task type"""
    db_task_type = db.query(TaskType).filter(TaskType.id == task_type_id).first()
    if not db_task_type:
        raise HTTPException(status_code=404, detail="Task type not found")
    
    # Check for duplicate name if being updated
    if task_type.name and task_type.name != db_task_type.name:
        existing = db.query(TaskType).filter(
            TaskType.name == task_type.name
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Task type with name '{task_type.name}' already exists"
            )
    
    # Update fields
    update_data = task_type.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_task_type, field, value)
    
    db.commit()
    db.refresh(db_task_type)
    return db_task_type


@router.delete("/{task_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_type(
    task_type_id: int,
    db: Session = Depends(get_db),
):
    """Delete a task type"""
    cleanup_orphaned_event_scoped_data(db)

    db_task_type = db.query(TaskType).filter(TaskType.id == task_type_id).first()
    if not db_task_type:
        raise HTTPException(status_code=404, detail="Task type not found")
    
    # Check if task type is being used by any templates
    from app.models.task_template import TaskTemplate
    templates_using_type = db.query(TaskTemplate).filter(
        TaskTemplate.task_type_id == task_type_id
    ).count()
    if templates_using_type > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete task type: {templates_using_type} template(s) are using this task type"
        )

    # Check if task type is being used by any tasks
    from app.models.task import Task
    tasks_using_type = db.query(Task).filter(
        Task.task_type_id == task_type_id
    ).count()
    if tasks_using_type > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete task type: {tasks_using_type} task(s) are using this task type"
        )

    # Check if task type is being used by any calendar export formats
    from app.models.calendar_export_format import CalendarExportFormat
    cef_using_type = db.query(CalendarExportFormat).filter(
        CalendarExportFormat.task_type_id == task_type_id
    ).count()
    if cef_using_type > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete task type: {cef_using_type} calendar export format(s) are using this task type"
        )

    # Check if task type is being used by any task instances
    from app.models.task_instance import TaskInstance
    instances_using_type = db.query(TaskInstance).filter(
        TaskInstance.task_type_id == task_type_id
    ).count()
    if instances_using_type > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete task type: {instances_using_type} task instance(s) are using this task type"
        )

    db.delete(db_task_type)
    db.commit()
    return None
