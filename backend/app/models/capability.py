"""
Capability Models
"""
from sqlalchemy import Column, Integer, String, ForeignKey, Text, Boolean, DateTime
from sqlalchemy.sql import func
from app.db.database import Base

class CapabilityType(Base):
    """Root-Admin configurable capability categories"""
    __tablename__ = "capability_types"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text)
    color = Column(String)  # Hex colour code
    sort_order = Column(Integer, default=0)  # Lower values appear first
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class Capability(Base):
    """Root-Admin configurable skills/permissions"""
    __tablename__ = "capabilities"
    
    id = Column(Integer, primary_key=True, index=True)
    machine_name = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    capability_type_id = Column(Integer, ForeignKey("capability_types.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class TaskCapabilityRequirement(Base):
    """Links tasks to required capabilities"""
    __tablename__ = "task_capability_requirements"
    
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    capability_id = Column(Integer, ForeignKey("capabilities.id"), nullable=False)
    required_count = Column(Integer, default=1)
    notes = Column(Text)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class PersonCapability(Base):
    """Links persons to their capabilities"""
    __tablename__ = "person_capabilities"
    
    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False)
    capability_id = Column(Integer, ForeignKey("capabilities.id"), nullable=False)
    level = Column(Integer)  # Optional skill level
    notes = Column(Text)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
