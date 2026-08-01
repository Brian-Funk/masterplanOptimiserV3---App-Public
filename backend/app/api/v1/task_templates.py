"""
Task Templates API endpoints - Root-admin only
Supports flexible field definitions for templates
"""
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_serializer, ConfigDict, Field
from app.core.data_minimisation import FieldPurpose, FieldVisibility

from app.db.database import get_db
from app.core.local_operator import local_operator_subject
from app.models.data_policy import FieldClassificationAudit
from app.models.task_template import TaskTemplate
from app.core.event_deletion import cleanup_orphaned_event_scoped_data
from app.core.identifier_validation import validate_machine_name

router = APIRouter()


# Pydantic schemas
class TemplateField(BaseModel):
    """
    Represents a single field in a template.
    
    Supported types:
    - persons_list: List of person IDs
    - capabilities_list: List of capability machine_names
    - datetime: Single date/time value
    - time_range: Start and end datetime
    - duration: Duration in minutes
    - text: Free text
    - location: Location ID
    - number: Numeric value
    - assignee_range: Min/max assignees
    """
    id: str  # Unique field identifier within template
    name: str  # Display name
    type: str  # Field type (persons_list, capabilities_list, datetime, etc.)
    category: str = "arbitrary"  # Field category: arbitrary or conditions
    locked: bool = False  # If true, optimiser won't change this field's value
    required: bool = False  # Must be filled in by admin
    optimised: bool = False  # If true, field is set by optimiser
    config: dict = Field(default_factory=dict)  # Type-specific configuration (min, max, etc.)
    purpose: FieldPurpose = "operational_instruction"
    visibility: FieldVisibility = "never_publish"
    classification_reviewed: bool = False
    public_visibility_confirmed: bool = False


class TaskTemplateCreate(BaseModel):
    machine_name: str
    name: str
    description: str | None = None
    task_type_id: int | None = None
    fields: List[TemplateField] = Field(default_factory=list)
    is_floating: bool = False
    is_transfer: bool = False


class TaskTemplateUpdate(BaseModel):
    machine_name: str | None = None
    name: str | None = None
    description: str | None = None
    task_type_id: int | None = None
    fields: List[TemplateField] | None = None
    is_active: bool | None = None
    is_floating: bool | None = None
    is_transfer: bool | None = None


class TaskTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    machine_name: str
    name: str
    description: str | None
    task_type_id: int | None
    fields: list
    is_active: bool
    is_floating: bool
    is_transfer: bool
    created_at: datetime | None
    updated_at: datetime | None

    @field_serializer('created_at', 'updated_at')
    def serialize_dt(self, dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None


def _validate_public_visibility(fields: list[TemplateField] | list[dict]) -> None:
    for field in fields:
        value = field if isinstance(field, dict) else field.model_dump()
        if value.get("visibility") == "public" and not value.get("public_visibility_confirmed"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Field {value.get('name') or value.get('id')} requires explicit "
                    "confirmation before it may be classified as public"
                ),
            )


def _audit_classification_changes(
    db: Session,
    template_id: int,
    previous_fields: list[dict],
    new_fields: list[dict],
) -> None:
    previous = {
        field.get("id"): field
        for field in previous_fields
        if isinstance(field, dict) and isinstance(field.get("id"), str)
    }
    current = {
        field.get("id"): field
        for field in new_fields
        if isinstance(field, dict) and isinstance(field.get("id"), str)
    }
    changes: list[tuple[str, dict | None, dict | None]] = []
    for field_id in sorted(set(previous) | set(current)):
        before = previous.get(field_id)
        after = current.get(field_id)
        before_identity = (
            before.get("purpose") if before else None,
            before.get("visibility") if before else None,
        )
        after_identity = (
            after.get("purpose") if after else None,
            after.get("visibility") if after else None,
        )
        if before_identity != after_identity:
            changes.append((field_id, before, after))
    if not changes:
        return
    subject = local_operator_subject(db)
    for field_id, before, after in changes:
        db.add(FieldClassificationAudit(
            template_id=template_id,
            field_id=field_id,
            previous_purpose=before.get("purpose") if before else None,
            previous_visibility=before.get("visibility") if before else None,
            new_purpose=after.get("purpose") if after else None,
            new_visibility=after.get("visibility") if after else None,
            operator_subject=subject,
        ))


# Endpoints
@router.get("/", response_model=List[TaskTemplateResponse])
async def list_templates(
    db: Session = Depends(get_db),
):
    """Get all task templates"""
    templates = db.query(TaskTemplate).filter(TaskTemplate.is_active == True).all()
    return templates


@router.get("/{template_id}", response_model=TaskTemplateResponse)
async def get_template(
    template_id: int,
    db: Session = Depends(get_db),
):
    """Get a specific task template"""
    template = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Task template not found")
    return template


@router.post("/", response_model=TaskTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    template: TaskTemplateCreate,
    db: Session = Depends(get_db),
):
    """Create a new task template"""
    try:
        machine_name = validate_machine_name(template.machine_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    # Check for duplicate machine_name
    existing = db.query(TaskTemplate).filter(
        TaskTemplate.machine_name == machine_name
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template with machine_name '{machine_name}' already exists"
        )
    
    _validate_public_visibility(template.fields)
    db_template = TaskTemplate(**{**template.model_dump(), "machine_name": machine_name})
    
    # Validate: transfer templates with dynamic_transfer_allocation must have a transferee field
    if template.is_transfer and template.fields:
        has_dynamic_allocation = any(f.type == "dynamic_transfer_allocation" for f in template.fields)
        has_transferee = any(f.type == "transferee" for f in template.fields)
        if has_dynamic_allocation and not has_transferee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transfer templates with Dynamic Allocation Limit must include a 'transferee' field"
            )
    
    db.add(db_template)
    db.flush()
    _audit_classification_changes(db, db_template.id, [], db_template.fields or [])
    db.commit()
    db.refresh(db_template)
    return db_template


@router.put("/{template_id}", response_model=TaskTemplateResponse)
async def update_template(
    template_id: int,
    template: TaskTemplateUpdate,
    db: Session = Depends(get_db),
):
    """Update a task template"""
    db_template = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not db_template:
        raise HTTPException(status_code=404, detail="Task template not found")
    
    # Check for duplicate machine_name if being updated
    if template.machine_name:
        try:
            machine_name = validate_machine_name(template.machine_name)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

        if machine_name != db_template.machine_name:
            existing = db.query(TaskTemplate).filter(
                TaskTemplate.machine_name == machine_name
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Template with machine_name '{machine_name}' already exists"
                )
            template.machine_name = machine_name
    
    # Update fields
    update_data = template.model_dump(exclude_unset=True)
    previous_fields = [dict(field) for field in (db_template.fields or []) if isinstance(field, dict)]
    
    # Validate: transfer templates with dynamic_transfer_allocation must have a transferee field
    is_transfer = update_data.get('is_transfer', db_template.is_transfer)
    fields_to_check = update_data.get('fields', db_template.fields or [])
    _validate_public_visibility(fields_to_check)
    if is_transfer and fields_to_check:
        field_types = [f.get('type') if isinstance(f, dict) else getattr(f, 'type', None) for f in fields_to_check]
        has_dynamic_allocation = 'dynamic_transfer_allocation' in field_types
        has_transferee = 'transferee' in field_types
        if has_dynamic_allocation and not has_transferee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transfer templates with Dynamic Allocation Limit must include a 'transferee' field"
            )
    
    for field, value in update_data.items():
        setattr(db_template, field, value)

    if "fields" in update_data:
        _audit_classification_changes(
            db,
            db_template.id,
            previous_fields,
            update_data["fields"],
        )
    
    db.commit()
    db.refresh(db_template)
    return db_template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
):
    """Delete a task template"""
    cleanup_orphaned_event_scoped_data(db)

    db_template = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not db_template:
        raise HTTPException(status_code=404, detail="Task template not found")
    
    # Check if template is being used by any tasks
    from app.models.task import Task
    tasks_using_template = db.query(Task).filter(
        Task.task_template_id == template_id
    ).count()
    
    if tasks_using_template > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete template: {tasks_using_template} task(s) are using this template"
        )

    # Check if template is being used by any task instances
    from app.models.task_instance import TaskInstance
    instances_using = db.query(TaskInstance).filter(
        TaskInstance.template_id == template_id
    ).count()
    if instances_using > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete template: {instances_using} task instance(s) are using this template"
        )

    db.delete(db_template)
    db.commit()
    return None
