"""
Optimisation Job Model
Tracks background optimisation tasks
"""
from sqlalchemy import Column, Integer, String, DateTime, JSON, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.database import Base
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.event import Event


class OptimizationJob(Base):
    """
    Represents a background optimisation job for a specific event day.
    Only one job can run at a time across all events.
    """
    __tablename__ = "optimization_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False, index=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD format
    
    # Status: pending, running, completed, infeasible, undetermined, failed
    status = Column(String, nullable=False, default="pending", index=True)
    
    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Results
    result_data = Column(JSON, nullable=True)  # Stores assignments and fatigue stats
    error_message = Column(String, nullable=True)
    
    # Solver progress tracking
    compute_request_id = Column(String, nullable=True)  # UUID for polling compute progress
    progress_data = Column(JSON, nullable=True)  # Latest progress snapshots from solver
    
    # Test mode flag (for 10-second test runs)
    is_test_run = Column(Boolean, nullable=False, default=False)
    
    # Relationship to event
    event = relationship("Event", back_populates="optimization_jobs")
    
    def __repr__(self):
        return f"<OptimizationJob(id={self.id}, event_id={self.event_id}, date={self.date}, status={self.status})>"
