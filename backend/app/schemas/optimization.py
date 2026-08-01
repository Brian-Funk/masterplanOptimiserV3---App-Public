"""
Pydantic Schemas for Optimisation API
"""
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime


# Request Models (matching flow_check exactly)
class OptimizationTask(BaseModel):
    """Task for optimisation - matches flow checker structure exactly."""
    # Allow all task fields to pass through (same as flow checker)
    class Config:
        extra = "allow"  # Allow additional fields from localStorage
    
    # Core identification
    id: int
    
    # Flow checker fields
    location_id: Optional[int] = None  # Can be null for floating tasks
    is_floating: bool = False
    is_transfer: bool = False
    
    # Additional fields that normalizer may need (all optional since they come from localStorage)
    name: Optional[str] = None
    task_type_id: Optional[int] = None
    event_id: Optional[int] = None
    date: Optional[str] = None
    template_id: Optional[int] = None
    start_time: Optional[int] = None  # minutes since midnight
    end_time: Optional[int] = None
    preassigned_person_id: Optional[int] = None
    field_values: Optional[Dict[str, Any]] = None
    constraints: Optional[Dict[str, Any]] = None  # For backwards compatibility
    counts_towards_work_time: bool = True


class OptimizationPerson(BaseModel):
    """Person for optimisation - matches flow checker structure exactly."""
    class Config:
        extra = "allow"  # Allow additional fields from database
    
    # Required fields
    id: int
    first_name: str
    last_name: str
    # Optional fields - allow flexible structure
    home_location_id: Optional[int] = None
    initial_location_id: Optional[int] = None
    capabilities: Optional[Any] = None  # Can be list or dict
    unavailabilities: List[Dict[str, str]] = Field(default_factory=list)
    max_hours_per_day: Optional[float] = None
    initial_fatigue: Optional[float] = 0.0  # Carry-over from previous day


class OptimizationLocation(BaseModel):
    """Location for optimisation - matches flow checker structure exactly."""
    class Config:
        extra = "allow"  # Allow additional fields from database
    
    id: int
    name: str


class OptimizationCapability(BaseModel):
    """Capability for optimisation - matches flow checker structure exactly."""
    class Config:
        extra = "allow"  # Allow additional fields from database
    
    id: int
    name: str
    machine_name: str


class OptimizeRequest(BaseModel):
    """Request to start optimisation for a day - matches flow checker structure."""
    event_id: int
    date: str  # YYYY-MM-DD
    working_day_boundary_offset_hour: int = 0
    test_mode: bool = False
    tasks: List[OptimizationTask]
    persons: List[OptimizationPerson]
    locations: List[OptimizationLocation]
    capabilities: List[OptimizationCapability]
    fatigue_scores: Dict[int, float]  # task_type_id -> fatigue_per_minute


# Response Models
class OptimizeStartResponse(BaseModel):
    """Response when optimisation is started."""
    job_id: int
    status: str
    message: str


class JobStatusResponse(BaseModel):
    """Detailed status of an optimisation job."""
    id: int
    event_id: int
    date: str
    status: str  # pending, running, completed, infeasible, undetermined, failed
    is_test_run: bool
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    elapsed_seconds: Optional[float]
    result_data: Optional[Dict[str, Any]]
    error_message: Optional[str]
    progress_data: Optional[Dict[str, Any]] = None


class JobSummary(BaseModel):
    """Brief summary for job listings"""
    id: int
    date: str
    status: str
    is_test_run: bool
    created_at: datetime
    completed_at: Optional[datetime]


class JobListResponse(BaseModel):
    """List of jobs for an event"""
    jobs: List[JobSummary]
    running_job: Optional[JobSummary]  # Currently running job (if any)
