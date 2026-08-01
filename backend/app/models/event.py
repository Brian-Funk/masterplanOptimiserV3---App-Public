"""
Event Model
"""
import uuid

from sqlalchemy import Column, Integer, String, Date, JSON, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.optimization_job import OptimizationJob

class Event(Base):
    """Represents a single EYP event or session"""
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_id = Column(
        String(36), nullable=False, unique=True,
        default=lambda: str(uuid.uuid4()), index=True,
    )
    name = Column(String, nullable=False)
    location = Column(String)
    start_date = Column(Date)
    end_date = Column(Date)
    meta_data = Column(JSON, default=dict)
    status = Column(String, default="draft")  # draft | optimised | finalised | published
    google_calendar_id = Column(String, nullable=True)  # Google Calendar ID for publishing
    enabled_capability_ids = Column(JSON, nullable=True)  # Subset of global capability IDs enabled for this event (null = all)
    mp_backend_url = Column(String, nullable=True)  # MP-Backend server URL for this event
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    optimization_jobs = relationship("OptimizationJob", back_populates="event")
