"""
Flow Validation Endpoint
API endpoint to validate task flow and check feasibility
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import sys
import os
import asyncio
from pathlib import Path

# Import database dependencies
from app.db.database import get_db
from app.core.debug_logging import debug_print
from app.core.solver_exclusions import filter_solver_active_tasks

# Import normalizer
from app.core.normalizer import (
    Task, Person, Location, Capability,
    NormalizedFlowInput,
    normalize_flow_input,
    minutes_to_time_str
)

# Add compute directory to path
# Navigate from this file: backend/app/api/v1/flow_check.py -> masterplanOptimiserV2/compute/src
compute_path = Path(__file__).resolve().parent.parent.parent.parent.parent / "compute" / "src"
debug_print(f"[Flow Check] Computed path: {compute_path}")
debug_print(f"[Flow Check] Path exists: {compute_path.exists()}")
debug_print(f"[Flow Check] Path absolute: {compute_path.absolute()}")

if compute_path.exists():
    sys.path.insert(0, str(compute_path))
    debug_print(f"[Flow Check] Added {compute_path} to sys.path")
else:
    debug_print(f"[Flow Check] WARNING: compute_path does not exist: {compute_path}")

try:
    from flow_checker import check_flow
    debug_print("[Flow Check] Successfully imported check_flow from flow_checker")
except ImportError as e:
    debug_print(f"[Flow Check] ERROR: Could not import flow_checker: {e}")
    debug_print(f"[Flow Check] sys.path: {sys.path}")
    # Fallback if import fails
    def check_flow(normalized_input, max_time_seconds=30.0, *, include_diagnostics=False):
        errors = ["Flow checker is unavailable because the optimisation dependency could not be loaded."]
        diagnostics = {
            "schema_version": 1,
            "status": "undetermined",
            "checked_scope": "full",
            "summary": errors[0],
            "issues": [],
        }
        return (errors, diagnostics) if include_diagnostics else errors
except Exception as e:
    debug_print(f"[Flow Check] ERROR: Unexpected error importing flow_checker: {e}")
    def check_flow(normalized_input, max_time_seconds=30.0, *, include_diagnostics=False):
        errors = ["Flow checker is unavailable because it could not be initialised."]
        diagnostics = {
            "schema_version": 1,
            "status": "undetermined",
            "checked_scope": "full",
            "summary": errors[0],
            "issues": [],
        }
        return (errors, diagnostics) if include_diagnostics else errors

router = APIRouter()


# ============================================================================
# Pydantic Models for API Request/Response
# ============================================================================

class FlowCheckRequest(BaseModel):
    # Current Desktop clients always provide the event so persisted solver
    # exclusions can be enforced. Keep this optional for older diagnostic
    # callers that submit synthetic, non-persisted tasks.
    event_id: Optional[int] = None
    tasks: List[Task]
    persons: List[Person]
    locations: List[Location]
    capabilities: List[Capability]
    working_day_date: Optional[str] = None
    working_day_boundary_offset_hour: int = 0


class FlowCheckResponse(BaseModel):
    """Compatibility errors plus structured feasibility diagnostics."""

    errors: List[str]
    feasible: bool
    diagnostics: Dict[str, Any]


# ============================================================================
# API Endpoint
# ============================================================================

@router.post("/check", response_model=FlowCheckResponse)
async def check_flow_endpoint(
    request: FlowCheckRequest,
    db: Session = Depends(get_db),
    skip_floating: bool = Query(False, description="Skip floating task candidate expansion for faster checks"),
):
    """
    Check if task assignments are feasible for the given capability.

    Returns list of errors if infeasible, empty list if feasible.
    """
    try:
        active_tasks = request.tasks
        if request.event_id is not None:
            active_tasks = filter_solver_active_tasks(
                db,
                request.event_id,
                request.tasks,
            )
        if request.tasks and not active_tasks:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "NO_ACTIVE_TASKS",
                    "message": "Nothing to check because all tasks are ignored.",
                },
            )

        debug_print("=" * 80)
        debug_print("FLOW CHECK API - RAW INPUT DATA")
        debug_print("=" * 80)

        debug_print(f"Tasks: {len(active_tasks)}")
        debug_print(f"Ignored tasks removed: {len(request.tasks) - len(active_tasks)}")
        debug_print(f"Persons: {len(request.persons)}")
        debug_print(f"Locations: {len(request.locations)}")
        debug_print(f"Capabilities: {len(request.capabilities)}")

        debug_print(f"\n--- RAW TASKS ---")
        for i, task in enumerate(active_tasks):
            debug_print(f"\nTask {i+1}:")
            debug_print(f"  ID: {task.id}")
            debug_print(f"  Name: {task.name}")
            debug_print(f"  Task Type ID: {task.task_type_id}")
            debug_print(f"  Template ID: {task.template_id}")
            debug_print(f"  Location ID: {task.location_id}")
            debug_print(f"  Date: {task.date}")
            if task.field_values:
                debug_print(f"  Field Values: {task.field_values}")

        debug_print(f"\n--- RAW PERSONS ---")
        for i, person in enumerate(request.persons):
            debug_print(f"\nPerson {i+1}:")
            debug_print(f"  ID: {person.id}")
            debug_print(f"  Name: {person.first_name} {person.last_name}")
            debug_print(f"  Home Location: {person.home_location_id}")
            debug_print(f"  Unavailability intervals: {len(person.unavailabilities)}")

        debug_print(f"\n--- RAW LOCATIONS ---")
        for loc in request.locations:
            debug_print(f"  Location {loc.id}: {loc.name}")

        debug_print(f"\n--- RAW CAPABILITIES ---")
        for cap in request.capabilities:
            debug_print(f"  Capability {cap.id}: {cap.machine_name} ({cap.name})")

        debug_print("\n" + "=" * 80)

        # Normalise the input data
        normalized = normalize_flow_input(
            active_tasks,
            request.persons,
            request.locations,
            request.capabilities,
            db=db,
            working_day_date=request.working_day_date,
            working_day_boundary_offset_hour=request.working_day_boundary_offset_hour,
        )
        normalized.capability_names = {
            capability.machine_name: capability.name
            for capability in request.capabilities
        }
        normalized.location_names = {
            location.id: location.name for location in request.locations
        }

        debug_print("\n" + "=" * 80)
        debug_print("FLOW CHECK API - NORMALIZED DATA")
        debug_print("=" * 80)

        debug_print(f"\nNormalised Tasks: {len(normalized.tasks)}")
        debug_print(f"Normalised Floating Tasks: {len(normalized.floating_tasks)}")
        debug_print(f"Normalised Transfers: {len(normalized.transfers)}")
        debug_print(f"Normalised Persons: {len(normalized.persons)}")

        debug_print(f"\n--- NORMALIZED PERSONS ---")
        for i, person in enumerate(normalized.persons):
            debug_print(f"\nNormPerson {i+1}:")
            debug_print(f"  ID: {person.id}")
            debug_print(f"  Home Location ID: {person.home_location_id}")
            debug_print(f"  Capabilities: {person.capabilities}")

        debug_print(f"\n--- NORMALIZED TASKS ---")
        for i, task in enumerate(normalized.tasks):
            debug_print(f"\nNormTask {i+1}:")
            debug_print(f"  ID: {task.id}")
            debug_print(f"  Name: {task.name}")
            debug_print(f"  Location ID: {task.location_id}")
            debug_print(f"  Time: {minutes_to_time_str(task.start_time)} -> {minutes_to_time_str(task.end_time)} ({task.end_time - task.start_time} min)")
            debug_print(f"  Requirements: {task.requirements}")
            debug_print(f"  Preassigned Person IDs: {task.preassigned_person_ids}")

        debug_print(f"\n--- NORMALIZED FLOATING TASKS ---")
        for i, ftask in enumerate(normalized.floating_tasks):
            debug_print(f"\nNormFloatingTask {i+1}:")
            debug_print(f"  ID: {ftask.id}")
            debug_print(f"  Name: {ftask.name}")
            debug_print(f"  Location ID: {ftask.location_id}")
            debug_print(f"  Window: {minutes_to_time_str(ftask.window_start_time)} -> {minutes_to_time_str(ftask.window_end_time)}")
            debug_print(f"  Duration: {ftask.duration} min")
            debug_print(f"  Requirements: {ftask.requirements}")
            debug_print(f"  Preassigned Person IDs: {ftask.preassigned_person_ids}")

        debug_print(f"\n--- NORMALIZED TRANSFERS ---")
        for i, transfer in enumerate(normalized.transfers):
            debug_print(f"\nNormTransfer {i+1}:")
            debug_print(f"  ID: {transfer.id}")
            debug_print(f"  Route: {transfer.from_location_id} -> {transfer.to_location_id}")
            debug_print(f"  Time: {minutes_to_time_str(transfer.depart_time)} -> {minutes_to_time_str(transfer.arrive_time)} ({transfer.arrive_time - transfer.depart_time} min)")
            debug_print(f"  Capacity: {transfer.capacity}")
            debug_print(f"  Requirements: {transfer.requirements}")
            debug_print(f"  Optional Capacity Slots: {transfer.optional_capacity_slots}")

        if normalized.errors:
            debug_print(f"\n  NORMALISATION WARNINGS: {len(normalized.errors)}")
            for error in normalized.errors:
                debug_print(f"  - {error}")

        debug_print("\n" + "=" * 80)
        debug_print("\n" + "=" * 80)

        # Add any parsing errors to the result
        if normalized.errors:
            debug_print(f"Normalisation warnings: {normalized.errors}")

        # Skip floating tasks for fast auto-checks (avoids expensive candidate expansion)
        if skip_floating:
            debug_print("[Flow Check] skip_floating=True  -  clearing floating tasks for faster solve")
            normalized.floating_tasks = []

        # Call the flow checker with normalised data (in thread pool to avoid blocking event loop)
        # Use a generous timeout so large masterplans never get false infeasibility from timeouts
        flow_errors, diagnostics = await asyncio.to_thread(
            check_flow,
            normalized,
            600.0,
            include_diagnostics=True,
        )

        # Combine normalization errors with flow check errors
        all_errors = normalized.errors + flow_errors
        if normalized.errors:
            input_issues = [
                {
                    "code": "NORMALISATION_PROBLEM",
                    "category": "input",
                    "severity": "error",
                    "message": message,
                    "task_ids": [],
                    "person_ids": [],
                    "transfer_ids": [],
                    "location_ids": [],
                    "capability_ids": [],
                    "facts": [],
                    "suggestions": ["Correct the named input before checking the schedule again."],
                }
                for message in normalized.errors
            ]
            diagnostics["status"] = "invalid_input"
            diagnostics["issues"] = input_issues + diagnostics.get("issues", [])
            diagnostics["summary"] = (
                f"The schedule input has {len(input_issues)} problem"
                f"{'s' if len(input_issues) != 1 else ''} that must be corrected."
            )
        diagnostics["checked_scope"] = "fixed_tasks" if skip_floating else "full"

        return FlowCheckResponse(
            errors=all_errors,
            feasible=len(all_errors) == 0,
            diagnostics=diagnostics,
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        debug_print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Flow check failed: {str(e)}")
