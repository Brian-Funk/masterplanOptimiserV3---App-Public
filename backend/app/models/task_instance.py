"""
TaskInstance Model  -  pre-finalization working state for task scheduling.

Task instances represent draft/in-progress task assignments that live
in the database instead of browser localStorage.  They are promoted
to real Task + Assignment records when the event is finalized.
"""
from sqlalchemy import Column, Integer, String, Date, Boolean, JSON, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.db.database import Base


class TaskInstance(Base):
    """Pre-finalization task instance  -  mirrors the localStorage shape."""
    __tablename__ = "task_instances"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    # ── Identity ───────────────────────────────────────────────────────
    name = Column(String, nullable=False, default="Untitled")
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("task_templates.id", ondelete="SET NULL"), nullable=True)
    task_type_id = Column(Integer, ForeignKey("task_types.id", ondelete="SET NULL"), nullable=True)

    # ── Scheduling ─────────────────────────────────────────────────────
    date = Column(String, nullable=False)         # "YYYY-MM-DD"
    day_index = Column(Integer, nullable=True)     # 0-based day within event

    # ── Flags ──────────────────────────────────────────────────────────
    is_floating = Column(Boolean, default=False)
    is_transfer = Column(Boolean, default=False)

    # ── JSON blobs ─────────────────────────────────────────────────────
    field_values = Column(JSON, default=dict)      # Template form inputs
    optimised = Column(JSON, nullable=True)        # Frozen optimiser output
    final = Column(JSON, nullable=True)            # Editable admin adjustments
    constraints = Column(JSON, nullable=True)      # Extra constraints
    additional = Column(JSON, nullable=True)       # Extra metadata

    # ── Timestamps ─────────────────────────────────────────────────────
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
