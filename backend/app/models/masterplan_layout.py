"""
MasterplanLayout Model
Stores purely cosmetic visual overrides per task for the masterplan view.
"""
from sqlalchemy import Column, Integer, Float, String, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.db.database import Base


class MasterplanLayout(Base):
    """Visual presentation overrides for tasks in the masterplan calendar view."""
    __tablename__ = "masterplan_layouts"
    __table_args__ = (
        UniqueConstraint("task_id", name="uq_masterplan_layouts_task_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False, unique=True)

    # Cosmetic overrides
    visual_height = Column(Float, nullable=True)      # Vertical size override (px or multiplier)
    visual_x_offset = Column(Float, nullable=True)     # Horizontal position offset (percentage points)
    visual_width = Column(Float, nullable=True)         # Horizontal width override (percentage points)
    custom_color = Column(String, nullable=True)        # Hex colour override
    sort_order = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
