"""
Task Template Model - Root-admin defined templates with arbitrary fields
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, JSON, ForeignKey
from sqlalchemy.sql import func
from app.db.database import Base


class TaskTemplate(Base):
    """
    Root-admin defined task templates with flexible field definitions.
    Templates define custom fields that admins fill in when creating tasks.
    
    Field structure in 'fields' JSON array:
    [
      {
        "id": "field_1",
        "name": "Required Capabilities",
        "type": "capabilities_list",
        "category": "conditions",
        "locked": false,
        "required": false,
        "config": {}              // Type-specific configuration
      },
      {
        "id": "field_2",
        "name": "Start & End Time",
        "type": "start_end_time",
        "category": "conditions",
        "locked": false,
        "required": false,
        "config": {}
      },
      {
        "id": "field_3",
        "name": "Notes",
        "type": "text",
        "category": "arbitrary",
        "locked": false,
        "required": false,
        "config": {}
      }
    ]
    
    Field categories:
    - "arbitrary": Informational fields that don't affect optimisation (number, text, location)
    - "conditions": Constraints that influence optimisation (time_range, duration, capabilities_list, start_end_time, persons_list)
    
    Supported field types by category:
    
    Conditions:
    - "time_range": Start and end datetime range (allowable time window)
    - "duration": Duration in minutes
    - "capabilities_list": List of required capability machine_names
    - "start_end_time": Required specific time slots
    - "persons_list": List of required person IDs
    
    Arbitrary:
    - "text": Free text field
    - "number": Numeric value
    - "location": Location ID
    """
    __tablename__ = "task_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Template identification
    machine_name = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    task_type_id = Column(Integer, ForeignKey("task_types.id"))  # Reference to task type
    
    # Dynamic field definitions
    # Array of field objects defining what admins can configure
    fields = Column(JSON, default=list)
    
    # Task classification for optimisation
    # - is_floating: True = Floating task (time_range + duration), False = Static task (start_end_time)
    # - is_transfer: True = Transfer task (different start/end locations), False = Normal task (single location)
    is_floating = Column(Boolean, default=False, nullable=False)
    is_transfer = Column(Boolean, default=False, nullable=False)
    
    # Metadata
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
