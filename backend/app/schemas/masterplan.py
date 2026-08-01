"""
Pydantic Schemas for Masterplan API
Covers: task finalization, masterplan layouts, description templates, task descriptions
"""
from pydantic import BaseModel, field_validator
from typing import List, Dict, Any, Optional
from datetime import datetime
import math

from app.core.task_payload_normalisation import normalise_task_json_id_lists


# =============================================================================
# Task Finalization
# =============================================================================

class TaskInstancePayload(BaseModel):
    """A single task instance from localStorage being finalised to the backend."""
    class Config:
        extra = "allow"  # Allow extra fields from localStorage

    id: Optional[int] = None  # localStorage-generated ID (may be absent)
    name: Optional[str] = "Untitled"
    task_type_id: Optional[int] = None  # May be null from localStorage
    event_id: int
    date: str  # YYYY-MM-DD
    day_index: Optional[int] = None
    template_id: Optional[int] = None  # maps to task_template_id

    @field_validator("id", "task_type_id", "event_id", "day_index", "template_id", mode="before")
    @classmethod
    def coerce_float_to_int(cls, v: Any) -> Any:
        """localStorage IDs from Date.now() can have fractional parts."""
        if isinstance(v, float):
            return int(math.floor(v))
        return v

    @field_validator("field_values", "optimised", "final", "constraints", "additional", mode="before")
    @classmethod
    def normalise_json_id_lists(cls, v: Any) -> Any:
        """Deduplicate person ID lists before finalising task payloads."""
        return normalise_task_json_id_lists(v)

    is_floating: Optional[bool] = False
    is_transfer: Optional[bool] = False

    # Field values from template form
    field_values: Optional[Dict[str, Any]] = None

    # Optimisation results
    optimised: Optional[Dict[str, Any]] = None
    final: Optional[Dict[str, Any]] = None

    # Extra metadata
    constraints: Optional[Dict[str, Any]] = None
    additional: Optional[Dict[str, Any]] = None


class FinalizeRequest(BaseModel):
    """Request to finalise all tasks for an event (all days at once)."""
    event_id: int
    task_instances: List[TaskInstancePayload]


class FinalizeResponse(BaseModel):
    """Response after finalizing."""
    status: str
    message: str
    tasks_created: int
    event_status: str


# =============================================================================
# Person Swap
# =============================================================================

class PersonSwapRequest(BaseModel):
    """Swap a person assigned to a task."""
    old_person_id: int
    new_person_id: int


class PersonSwapResponse(BaseModel):
    status: str
    message: str


# =============================================================================
# Masterplan Layout (cosmetic overrides)
# =============================================================================

class MasterplanLayoutCreate(BaseModel):
    """Create/update a layout override for a task."""
    visual_height: Optional[float] = None
    visual_x_offset: Optional[float] = None
    visual_width: Optional[float] = None
    custom_color: Optional[str] = None
    sort_order: Optional[int] = None


class MasterplanLayoutResponse(BaseModel):
    id: int
    event_id: int
    task_id: int
    visual_height: Optional[float] = None
    visual_x_offset: Optional[float] = None
    visual_width: Optional[float] = None
    custom_color: Optional[str] = None
    sort_order: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MasterplanLayoutBulkItem(BaseModel):
    task_id: int
    visual_height: Optional[float] = None
    visual_x_offset: Optional[float] = None
    visual_width: Optional[float] = None
    custom_color: Optional[str] = None
    sort_order: Optional[int] = None


class MasterplanLayoutBulkRequest(BaseModel):
    event_id: int
    layouts: List[MasterplanLayoutBulkItem]


# =============================================================================
# Event Status
# =============================================================================

class EventStatusUpdate(BaseModel):
    """Update event status."""
    status: str  # draft | optimised | finalised | published


class EventStatusResponse(BaseModel):
    id: int
    name: str
    status: str
