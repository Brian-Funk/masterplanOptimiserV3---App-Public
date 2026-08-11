"""
Calendar Export Format API Endpoints
CRUD for per-task-type Google Calendar export templates.
"""
import logging
import re
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator

from app.db.database import get_db
from app.models.calendar_export_format import CalendarExportFormat
from app.models.task import TaskType
from app.models.task_template import TaskTemplate
from app.models.person import Person
from app.core.rich_template import validate_rich_template

logger = logging.getLogger(__name__)
router = APIRouter()


def _sanitize_field_name(name: str) -> str:
    """Convert a human field name to a safe variable key."""
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    s = s.strip('_')
    return s or "field"


class ExportFormatCreate(BaseModel):
    task_type_id: int
    title_template: str = "{title}"
    description_template: str = ""
    color_id: Optional[str] = None

    @field_validator("description_template")
    @classmethod
    def validate_description_template(cls, value: str) -> str:
        return validate_rich_template(value) or ""


class ExportFormatUpdate(BaseModel):
    title_template: Optional[str] = None
    description_template: Optional[str] = None
    color_id: Optional[str] = None

    @field_validator("description_template")
    @classmethod
    def validate_description_template(cls, value: Optional[str]) -> Optional[str]:
        return validate_rich_template(value)


class ExportFormatResponse(BaseModel):
    id: int
    task_type_id: int
    title_template: str
    description_template: str
    color_id: Optional[str] = None


class TemplateVariableInfo(BaseModel):
    name: str
    label: str
    source: str  # "built-in" | "template-field"


@router.get("/", response_model=List[ExportFormatResponse])
async def list_export_formats(db: Session = Depends(get_db)):
    """List all export formats."""
    return db.query(CalendarExportFormat).all()


@router.get("/{task_type_id}", response_model=ExportFormatResponse)
async def get_export_format(task_type_id: int, db: Session = Depends(get_db)):
    """Get export format for a specific task type."""
    fmt = db.query(CalendarExportFormat).filter(
        CalendarExportFormat.task_type_id == task_type_id
    ).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Export format not found")
    return fmt


@router.put("/{task_type_id}", response_model=ExportFormatResponse)
async def upsert_export_format(
    task_type_id: int,
    data: ExportFormatCreate,
    db: Session = Depends(get_db),
):
    """Create or update export format for a task type."""
    tt = db.query(TaskType).filter(TaskType.id == task_type_id).first()
    if not tt:
        raise HTTPException(status_code=404, detail="Task type not found")

    fmt = db.query(CalendarExportFormat).filter(
        CalendarExportFormat.task_type_id == task_type_id
    ).first()

    if fmt:
        if data.title_template is not None:
            fmt.title_template = data.title_template
        if data.description_template is not None:
            fmt.description_template = data.description_template
        fmt.color_id = data.color_id
    else:
        fmt = CalendarExportFormat(
            task_type_id=task_type_id,
            title_template=data.title_template,
            description_template=data.description_template,
            color_id=data.color_id,
        )
        db.add(fmt)

    db.commit()
    db.refresh(fmt)
    return fmt


@router.delete("/{task_type_id}", status_code=204)
async def delete_export_format(task_type_id: int, db: Session = Depends(get_db)):
    """Delete export format for a task type."""
    fmt = db.query(CalendarExportFormat).filter(
        CalendarExportFormat.task_type_id == task_type_id
    ).first()
    if not fmt:
        raise HTTPException(status_code=404, detail="Export format not found")
    db.delete(fmt)
    db.commit()


@router.get("/{task_type_id}/variables", response_model=List[TemplateVariableInfo])
async def get_template_variables(
    task_type_id: int,
    event_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Get available template variables for a task type.
    Combines built-in variables with template-defined fields.
    """
    tt = db.query(TaskType).filter(TaskType.id == task_type_id).first()
    if not tt:
        raise HTTPException(status_code=404, detail="Task type not found")

    # Built-in variables always available
    variables: List[dict] = [
        {"name": "title", "label": "Task Title", "source": "built-in"},
        {"name": "task_type", "label": "Task Type Name", "source": "built-in"},
        {"name": "description", "label": "Task Description", "source": "built-in"},
        {"name": "location", "label": "Location Name", "source": "built-in"},
        {"name": "location_address", "label": "Location Address", "source": "built-in"},
        {"name": "start_time", "label": "Start Time", "source": "built-in"},
        {"name": "end_time", "label": "End Time", "source": "built-in"},
        {"name": "date", "label": "Date", "source": "built-in"},
        {"name": "persons", "label": "Assigned Persons", "source": "built-in"},
    ]

    # Add fields from templates that use this task type
    templates = db.query(TaskTemplate).filter(
        TaskTemplate.task_type_id == task_type_id
    ).all()
    seen_names = set()
    for tmpl in templates:
        for field in (tmpl.fields or []):
            field_name = field.get("name", "")
            if not field_name:
                continue
            var_name = f"field.{_sanitize_field_name(field_name)}"
            if var_name not in seen_names:
                seen_names.add(var_name)
                variables.append({
                    "name": var_name,
                    "label": field_name,
                    "source": "template-field",
                })

    # Add per-person contact-email variables if event_id is provided
    if event_id:
        persons = db.query(Person).filter(Person.event_id == event_id).all()
        for person in persons:
            sanitized = _sanitize_field_name(f"{person.first_name} {person.last_name}")
            full_name = f"{person.first_name} {person.last_name}"
            variables.append({
                "name": f"person.{sanitized}.email",
                "label": f"{full_name}  -  Email",
                "source": "person",
            })

    return variables
