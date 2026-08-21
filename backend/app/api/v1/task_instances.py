"""
TaskInstance API  -  CRUD endpoints for pre-finalisation task instances.

These replace browser localStorage as the source of truth for draft task
scheduling data, enabling multi-user collaboration on the same event.
"""
import math
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.task_payload_normalisation import normalise_task_json_id_lists
from app.core.solver_exclusions import (
    delete_solver_exclusions_for_task_ids,
    get_solver_excluded_task_ids,
)
from app.models.task_instance import TaskInstance
from app.models.task_instance_solver_exclusion import TaskInstanceSolverExclusion
from app.models.task_template import TaskTemplate

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TaskInstanceCreate(BaseModel):
    """Create a single task instance."""
    name: Optional[str] = "Untitled"
    event_id: int
    template_id: Optional[int] = None
    task_type_id: Optional[int] = None
    date: str                               # "YYYY-MM-DD"
    day_index: Optional[int] = None
    is_floating: Optional[bool] = None
    is_transfer: Optional[bool] = None
    field_values: Optional[Dict[str, Any]] = None
    optimised: Optional[Dict[str, Any]] = None
    final: Optional[Dict[str, Any]] = None
    constraints: Optional[Dict[str, Any]] = None
    additional: Optional[Dict[str, Any]] = None

    @field_validator("event_id", "template_id", "task_type_id", "day_index", mode="before")
    @classmethod
    def coerce_float(cls, v: Any) -> Any:
        if isinstance(v, float):
            return int(math.floor(v))
        return v

    @field_validator("field_values", "optimised", "final", "constraints", "additional", mode="before")
    @classmethod
    def normalise_json_id_lists(cls, v: Any) -> Any:
        """Deduplicate ID lists before storing task instance payloads."""
        return normalise_task_json_id_lists(v)


class TaskInstanceUpdate(BaseModel):
    """Partial update for a task instance  -  all fields optional."""
    name: Optional[str] = None
    template_id: Optional[int] = None
    task_type_id: Optional[int] = None
    date: Optional[str] = None
    day_index: Optional[int] = None
    is_floating: Optional[bool] = None
    is_transfer: Optional[bool] = None
    field_values: Optional[Dict[str, Any]] = None
    optimised: Optional[Dict[str, Any]] = None
    final: Optional[Dict[str, Any]] = None
    constraints: Optional[Dict[str, Any]] = None
    additional: Optional[Dict[str, Any]] = None

    @field_validator("field_values", "optimised", "final", "constraints", "additional", mode="before")
    @classmethod
    def normalise_json_id_lists(cls, v: Any) -> Any:
        """Deduplicate ID lists before updating task instance payloads."""
        return normalise_task_json_id_lists(v)


class TaskInstanceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    event_id: int
    template_id: Optional[int] = None
    task_type_id: Optional[int] = None
    date: str
    day_index: Optional[int] = None
    is_floating: bool
    is_transfer: bool
    field_values: Optional[Dict[str, Any]] = None
    optimised: Optional[Dict[str, Any]] = None
    final: Optional[Dict[str, Any]] = None
    constraints: Optional[Dict[str, Any]] = None
    additional: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class BulkOptimisedItem(BaseModel):
    """A single optimised-result write for the bulk endpoint."""
    id: int
    optimised: Dict[str, Any]
    final: Optional[Dict[str, Any]] = None


class BulkOptimisedRequest(BaseModel):
    items: List[BulkOptimisedItem]


class SolverExclusionUpdate(BaseModel):
    """Set one event-scoped collection of tasks active or ignored."""

    task_instance_ids: List[int] = Field(min_length=1, max_length=10000)
    ignored: bool


class SolverExclusionResponse(BaseModel):
    """The complete reconciled ignored-task set for an event."""

    ignored_task_instance_ids: List[int]


def _derive_template_flags(
    db: Session,
    template_id: Optional[int],
    is_floating: Optional[bool],
    is_transfer: Optional[bool],
) -> tuple[bool, bool]:
    """Return task instance flags, using template metadata when payload flags are omitted."""
    template = None
    if template_id is not None:
        template = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()

    if is_floating is not None:
        resolved_is_floating = bool(is_floating)
    else:
        resolved_is_floating = bool(template.is_floating) if template else False

    if is_transfer is not None:
        resolved_is_transfer = bool(is_transfer)
    else:
        resolved_is_transfer = bool(template.is_transfer) if template else False

    return resolved_is_floating, resolved_is_transfer


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[TaskInstanceResponse])
@router.get("/", response_model=List[TaskInstanceResponse])
def list_task_instances(
    event_id: int = Query(...),
    date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List all task instances for an event, optionally filtered by date."""
    q = db.query(TaskInstance).filter(TaskInstance.event_id == event_id)
    if date:
        q = q.filter(TaskInstance.date == date)
    return q.order_by(TaskInstance.id).all()


@router.get("/solver-exclusions", response_model=SolverExclusionResponse)
def list_solver_exclusions(
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """List persistent diagnostic exclusions without changing task records."""

    return SolverExclusionResponse(
        ignored_task_instance_ids=sorted(
            get_solver_excluded_task_ids(db, event_id),
        ),
    )


@router.put("/solver-exclusions", response_model=SolverExclusionResponse)
def set_solver_exclusions(
    body: SolverExclusionUpdate,
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Atomically ignore or include task instances scoped to one event."""

    requested_ids = set(body.task_instance_ids)
    existing_ids = {
        int(row[0])
        for row in (
            db.query(TaskInstance.id)
            .filter(
                TaskInstance.event_id == event_id,
                TaskInstance.id.in_(requested_ids),
            )
            .all()
        )
    }
    if existing_ids != requested_ids:
        raise HTTPException(
            status_code=404,
            detail="One or more task instances were not found in this event.",
        )

    if body.ignored:
        already_ignored = {
            int(row[0])
            for row in (
                db.query(TaskInstanceSolverExclusion.task_instance_id)
                .filter(
                    TaskInstanceSolverExclusion.task_instance_id.in_(requested_ids),
                )
                .all()
            )
        }
        for task_instance_id in sorted(requested_ids - already_ignored):
            db.add(
                TaskInstanceSolverExclusion(task_instance_id=task_instance_id),
            )
    else:
        delete_solver_exclusions_for_task_ids(db, requested_ids)

    db.commit()
    return SolverExclusionResponse(
        ignored_task_instance_ids=sorted(
            get_solver_excluded_task_ids(db, event_id),
        ),
    )


@router.get("/{instance_id}", response_model=TaskInstanceResponse)
def get_task_instance(
    instance_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get a single task instance by ID, scoped to event."""
    inst = db.query(TaskInstance).filter(
        TaskInstance.id == instance_id,
        TaskInstance.event_id == event_id,
    ).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Task instance not found in this event")
    return inst


@router.post("", response_model=TaskInstanceResponse, status_code=201)
@router.post("/", response_model=TaskInstanceResponse, status_code=201)
def create_task_instance(
    data: TaskInstanceCreate,
    db: Session = Depends(get_db),
):
    """Create a single task instance."""
    is_floating, is_transfer = _derive_template_flags(
        db,
        data.template_id,
        data.is_floating,
        data.is_transfer,
    )
    inst = TaskInstance(
        name=data.name or "Untitled",
        event_id=data.event_id,
        template_id=data.template_id,
        task_type_id=data.task_type_id,
        date=data.date,
        day_index=data.day_index,
        is_floating=is_floating,
        is_transfer=is_transfer,
        field_values=data.field_values,
        optimised=data.optimised,
        final=data.final,
        constraints=data.constraints,
        additional=data.additional,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


@router.post("/bulk", response_model=List[TaskInstanceResponse], status_code=201)
def create_task_instances_bulk(
    items: List[TaskInstanceCreate],
    db: Session = Depends(get_db),
):
    """Create multiple task instances in one call."""
    if not items:
        return []

    created = []
    for data in items:
        is_floating, is_transfer = _derive_template_flags(
            db,
            data.template_id,
            data.is_floating,
            data.is_transfer,
        )
        inst = TaskInstance(
            name=data.name or "Untitled",
            event_id=data.event_id,
            template_id=data.template_id,
            task_type_id=data.task_type_id,
            date=data.date,
            day_index=data.day_index,
            is_floating=is_floating,
            is_transfer=is_transfer,
            field_values=data.field_values,
            optimised=data.optimised,
            final=data.final,
            constraints=data.constraints,
            additional=data.additional,
        )
        db.add(inst)
        created.append(inst)

    db.commit()
    for inst in created:
        db.refresh(inst)
    return created


@router.put("/{instance_id}", response_model=TaskInstanceResponse)
def update_task_instance(
    instance_id: int,
    data: TaskInstanceUpdate,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Update a task instance (partial  -  only set fields are applied)."""
    inst = db.query(TaskInstance).filter(
        TaskInstance.id == instance_id,
        TaskInstance.event_id == event_id,
    ).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Task instance not found in this event")

    update_data = data.model_dump(exclude_unset=True)
    if "template_id" in update_data:
        derived_is_floating, derived_is_transfer = _derive_template_flags(
            db,
            update_data.get("template_id"),
            update_data.get("is_floating") if "is_floating" in update_data else None,
            update_data.get("is_transfer") if "is_transfer" in update_data else None,
        )
        update_data.setdefault("is_floating", derived_is_floating)
        update_data.setdefault("is_transfer", derived_is_transfer)

    for key, value in update_data.items():
        setattr(inst, key, value)

    db.commit()
    db.refresh(inst)
    return inst


@router.patch("/bulk-optimised", response_model=List[TaskInstanceResponse])
def bulk_set_optimised(
    body: BulkOptimisedRequest,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Write optimisation results to multiple task instances at once."""
    if not body.items:
        return []

    ids = [item.id for item in body.items]
    instances = db.query(TaskInstance).filter(
        TaskInstance.id.in_(ids),
        TaskInstance.event_id == event_id,
    ).all()
    inst_map = {inst.id: inst for inst in instances}

    updated = []
    for item in body.items:
        inst = inst_map.get(item.id)
        if not inst:
            continue
        inst.optimised = item.optimised
        inst.final = item.final if item.final is not None else item.optimised
        updated.append(inst)

    db.commit()
    for inst in updated:
        db.refresh(inst)
    return updated


@router.delete("/{instance_id}", status_code=204)
def delete_task_instance(
    instance_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Delete a single task instance."""
    inst = db.query(TaskInstance).filter(
        TaskInstance.id == instance_id,
        TaskInstance.event_id == event_id,
    ).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Task instance not found in this event")

    delete_solver_exclusions_for_task_ids(db, {inst.id})
    db.delete(inst)
    db.commit()
    return None


@router.delete("", status_code=204)
def delete_task_instances_for_event(
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Delete all task instances for an event."""
    task_ids = {
        int(row[0])
        for row in (
            db.query(TaskInstance.id)
            .filter(TaskInstance.event_id == event_id)
            .all()
        )
    }
    delete_solver_exclusions_for_task_ids(db, task_ids)
    db.query(TaskInstance).filter(TaskInstance.event_id == event_id).delete()
    db.commit()
    return None


@router.post("/restore", response_model=List[TaskInstanceResponse])
def restore_from_tasks(
    event_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """
    Restore task instances from the Tasks table.

    When task instances have been lost (e.g. older finalise deleted them)
    but Task records still exist, this endpoint recreates TaskInstance
    records so the frontend can display and edit the schedule again.

    Only runs if no task instances exist for the event.
    """
    from app.models.task import Task

    # If instances already exist, return them as-is
    existing = db.query(TaskInstance).filter(TaskInstance.event_id == event_id).count()
    if existing > 0:
        logger.info(f"[restore] Event {event_id} already has {existing} task instances, skipping restore")
        return db.query(TaskInstance).filter(TaskInstance.event_id == event_id).order_by(TaskInstance.id).all()

    # Check for Tasks to restore from
    tasks = db.query(Task).filter(Task.event_id == event_id).all()
    if not tasks:
        logger.info(f"[restore] No tasks found for event {event_id}, nothing to restore")
        return []

    logger.info(f"[restore] Restoring {len(tasks)} task instances from Tasks for event {event_id}")

    created = []
    for task in tasks:
        additional = task.additional or {}
        date = additional.get("date", "")
        day_index = additional.get("day_index")
        is_floating, is_transfer = _derive_template_flags(
            db,
            task.task_template_id,
            None,
            None,
        )

        inst = TaskInstance(
            name=task.title or "Untitled",
            event_id=task.event_id,
            template_id=task.task_template_id,
            task_type_id=task.task_type_id,
            date=date,
            day_index=day_index,
            is_floating=is_floating,
            is_transfer=is_transfer,
            field_values=(task.constraints or {}).get("field_values"),
            optimised=task.optimised,
            final=task.final,
            constraints=task.constraints,
            additional=task.additional,
        )
        db.add(inst)
        created.append(inst)

    db.commit()
    for inst in created:
        db.refresh(inst)

    logger.info(f"[restore] Created {len(created)} task instances from Tasks")
    return created
