"""
Assignment Models
"""
from sqlalchemy import Column, Integer, String, ForeignKey, Text, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.db.database import Base

class AssignmentSource(Base):
    """Root-Admin configurable assignment sources"""
    __tablename__ = "assignment_sources"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    color_hex = Column(String(7))
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class Assignment(Base):
    """Links persons to tasks (allocation results) - task_id is optional to allow persons without tasks"""
    __tablename__ = "assignments"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)  # Optional - persons can exist without task assignments
    assignment_source_id = Column(Integer, ForeignKey("assignment_sources.id"), nullable=True)  # Optional when no task assigned
    is_locked = Column(Boolean, default=False)
    meta_data = Column(JSON, default=dict)  # Optimiser scores, comments, etc.
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
