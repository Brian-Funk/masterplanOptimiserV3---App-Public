"""
Calendar Export Format Model
Stores per-task-type export templates for Google Calendar publishing.
"""
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, JSON
from sqlalchemy.sql import func
from app.db.database import Base


class CalendarExportFormat(Base):
    """
    Defines how a task type is exported to Google Calendar.
    Each task type can have one export format.

    title_template and description_template support variable interpolation
    via {variable_name} syntax.  Available variables depend on the task's
    template fields plus built-in variables like {title}, {task_type}, etc.
    """
    __tablename__ = "calendar_export_formats"

    id = Column(Integer, primary_key=True, index=True)
    task_type_id = Column(Integer, ForeignKey("task_types.id"), unique=True, nullable=False)

    # Editable fields
    title_template = Column(String, nullable=False, default="{title}")
    description_template = Column(String, nullable=False, default="")
    color_id = Column(String, nullable=True)  # Google Calendar colour ID (1-11)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
