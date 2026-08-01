"""
Person Model
"""
import uuid

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float
from sqlalchemy.sql import func
from app.db.database import Base

class Person(Base):
    """Real-world individuals participating in events"""
    __tablename__ = "persons"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_subject_id = Column(
        String(36), nullable=False, unique=True,
        default=lambda: str(uuid.uuid4()), index=True,
    )
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, nullable=True)  # Not unique globally, unique per event
    phone = Column(String)
    google_email = Column(String, nullable=True)  # Linked Google account email for calendar invites
    
    # Working constraints
    max_hours_per_day = Column(Float, nullable=True)  # Maximum working hours per day
    
    # Starting location for optimisation
    home_location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)  # Default starting location each day
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
