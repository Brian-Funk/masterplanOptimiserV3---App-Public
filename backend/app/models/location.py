"""  
Location Model
"""
from sqlalchemy import Column, Integer, String, ForeignKey, JSON, DateTime
from sqlalchemy.sql import func
from app.db.database import Base

class Location(Base):
    """Named locations for tasks and schedules"""
    __tablename__ = "locations"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    name = Column(String, nullable=False, default="Unnamed Location")
    address = Column(String, nullable=True)  # Address shown in Google Calendar
    details = Column(JSON, default=dict)  # Additional metadata
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
