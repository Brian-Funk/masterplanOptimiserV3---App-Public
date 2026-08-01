"""
Tasks API Endpoints
Full CRUD + finalise + person swap for masterplan pipeline.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional, List
import logging

from app.db.database import get_db
from app.models.task import Task
from app.models.event import Event
from app.models.assignment import Assignment
from app.models.assignment import AssignmentSource
from app.models.task_instance import TaskInstance
from app.core.task_payload_normalisation import normalise_concrete_person_id_list
from app.schemas.masterplan import (
    FinalizeRequest, FinalizeResponse,
    PersonSwapRequest, PersonSwapResponse,
    TaskInstancePayload,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/")
async def get_tasks(
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get tasks for a specific event."""
    tasks = db.query(Task).filter(Task.event_id == event_id).all()
    return tasks


@router.get("/{task_id}")
async def get_task(
    task_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get a single task by ID, scoped to event."""
    task = db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this event")
    return task


@router.put("/{task_id}")
async def update_task(
    task_id: int,
    updates: dict,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Update a task's fields. Used for masterplan edits."""
    task = db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this event")

    allowed_fields = {"title", "description", "constraints", "optimised", "final", "additional"}
    for key, value in updates.items():
        if key in allowed_fields:
            setattr(task, key, value)

    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}/swap-person")
async def swap_person(
    task_id: int,
    swap: PersonSwapRequest,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """
    Swap a person in a task's final field.
    """
    task = db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this event")

    final_data = dict(task.final or {})
    if not final_data:
        raise HTTPException(status_code=400, detail="Task has no finalised data")

    # Swap in assigned_persons
    assigned = list(final_data.get("assigned_persons", []))
    if swap.old_person_id not in assigned:
        raise HTTPException(
            status_code=400,
            detail=f"Person {swap.old_person_id} is not assigned to this task"
        )
    assigned = [swap.new_person_id if p == swap.old_person_id else p for p in assigned]
    final_data["assigned_persons"] = assigned

    # Swap in field_assignments
    field_assignments = dict(final_data.get("field_assignments", {}))
    for field_id, person_ids in field_assignments.items():
        if isinstance(person_ids, list) and swap.old_person_id in person_ids:
            field_assignments[field_id] = [
                swap.new_person_id if p == swap.old_person_id else p
                for p in person_ids
            ]
    final_data["field_assignments"] = field_assignments

    task.final = final_data
    db.commit()
    db.refresh(task)

    # Also update Assignment records if they exist
    assignment = db.query(Assignment).filter(
        Assignment.task_id == task_id,
        Assignment.person_id == swap.old_person_id
    ).first()
    if assignment:
        assignment.person_id = swap.new_person_id
        db.commit()

    logger.info(f"Swapped person {swap.old_person_id} -> {swap.new_person_id} on task {task_id}")
    return PersonSwapResponse(status="success", message=f"Person swapped successfully")


@router.post("/finalize")
async def finalize_schedule(
    request: FinalizeRequest,
    db: Session = Depends(get_db),
):
    """
    Finalise the optimised schedule: persist all task instances from localStorage to the DB.
    """
    event_id = request.event_id
    logger.info(f"Finalise request: event_id={event_id}, {len(request.task_instances)} task instances")

    # Verify event exists
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Delete existing tasks for this event (finalise replaces everything)
    existing_tasks = db.query(Task).filter(Task.event_id == event_id).all()
    existing_task_ids = [t.id for t in existing_tasks]
    
    if existing_task_ids:
        db.query(Assignment).filter(Assignment.task_id.in_(existing_task_ids)).delete(synchronize_session=False)
        db.query(Task).filter(Task.event_id == event_id).delete(synchronize_session=False)
    
    db.flush()

    # Build a mapping from localStorage IDs to new DB IDs
    tasks_created = 0
    id_mapping = {}  # old_id -> new_task

    # Get or create a "finalize" assignment source (required by NOT NULL constraint)
    finalize_source = db.query(AssignmentSource).filter(AssignmentSource.code == "finalize").first()
    if not finalize_source:
        finalize_source = AssignmentSource(
            code="finalize",
            name="Schedule Finalisation",
            description="Assignments created during schedule finalisation",
            color_hex="#4CAF50",
            is_active=True,
        )
        db.add(finalize_source)
        db.flush()

    try:
        for idx, instance in enumerate(request.task_instances):
            # Build constraints from field_values + existing constraints
            constraints = instance.constraints or {}
            if instance.field_values:
                constraints["field_values"] = instance.field_values

            # Store the date in additional metadata
            additional = instance.additional or {}
            additional["date"] = instance.date
            additional["day_index"] = instance.day_index

            # Resolve task_type_id: use instance value, or look up from template, or default to 1
            resolved_task_type_id = instance.task_type_id
            if resolved_task_type_id is None and instance.template_id:
                from app.models.task_template import TaskTemplate
                tmpl = db.query(TaskTemplate).filter(TaskTemplate.id == instance.template_id).first()
                if tmpl:
                    resolved_task_type_id = tmpl.task_type_id
            if resolved_task_type_id is None:
                resolved_task_type_id = 1  # fallback default

            task = Task(
                event_id=event_id,
                task_template_id=instance.template_id,
                task_type_id=resolved_task_type_id,
                title=instance.name or "Untitled",
                constraints=constraints,
                optimised=instance.optimised or {},
                final=instance.final or instance.optimised or {},
                additional=additional,
                is_floating=instance.is_floating or False,
                is_transfer=instance.is_transfer or False,
            )
            db.add(task)
            db.flush()  # Get the new task ID

            local_id = instance.id or idx
            id_mapping[local_id] = task
            tasks_created += 1

            # Create Assignment records from final.assigned_persons
            final_data = task.final or {}
            assigned_persons = normalise_concrete_person_id_list(
                final_data.get("assigned_persons", []),
            )
            final_data["assigned_persons"] = assigned_persons
            for person_id in assigned_persons:
                # Ensure person_id is an int (may be float from JSON)
                try:
                    pid = int(person_id)
                except (TypeError, ValueError):
                    logger.warning(f"Skipping invalid person_id {person_id} for task {task.id}")
                    continue
                assignment = Assignment(
                    event_id=event_id,
                    person_id=pid,
                    task_id=task.id,
                    assignment_source_id=finalize_source.id,
                    is_locked=False,
                    meta_data={
                        "source": "finalize",
                        "date": instance.date,
                    }
                )
                db.add(assignment)

        # Update event status
        event.status = "finalised"

        # NOTE: We intentionally keep TaskInstance records so the frontend
        # can continue displaying and editing the schedule after restart.
        # TaskInstances are the frontend's working state; Tasks are the
        # publishing mirror used by Google Calendar export.

        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to finalise event {event_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Finalisation failed: {str(e)}")

    logger.info(f"Finalised {tasks_created} tasks for event {event_id}")
    return FinalizeResponse(
        status="success",
        message=f"Schedule finalised with {tasks_created} tasks",
        tasks_created=tasks_created,
        event_status="finalised"
    )


@router.delete("/{task_id}")
async def delete_task(
    task_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Delete a task."""
    task = db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this event")

    # Delete related assignments
    db.query(Assignment).filter(Assignment.task_id == task_id).delete()
    db.delete(task)
    db.commit()
    return {"status": "success", "message": "Task deleted"}
