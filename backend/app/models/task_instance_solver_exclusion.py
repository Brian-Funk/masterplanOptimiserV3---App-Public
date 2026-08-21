"""Solver-only exclusions for persistent CMI diagnostic work."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlalchemy.sql import func

from app.db.database import Base


class TaskInstanceSolverExclusion(Base):
    """Mark one task instance as excluded from flow checks and optimisation."""

    __tablename__ = "task_instance_solver_exclusions"

    task_instance_id = Column(
        Integer,
        ForeignKey("task_instances.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
