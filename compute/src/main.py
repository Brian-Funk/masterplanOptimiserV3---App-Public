"""
Optimiser FastAPI Service
Wraps optimisation algorithms in an HTTP API
"""
import sys
import os
import logging
import asyncio
import uuid
from datetime import datetime

# Add src directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Configure logging to stdout with timestamps
logging.basicConfig(
    level=logging.INFO,
    format="[Compute %(asctime)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("compute")

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from typing import List, Dict, Any, Optional
import httpx
from fatigue_optimizer import optimize_with_fatigue, OptimizationConfig, ProgressCallback

class Settings(BaseSettings):
    """Runtime settings for the standalone compute service."""

    BACKEND_URL: str = "http://127.0.0.1:8000"
    OPTIMIZER_HOST: str = "127.0.0.1"
    OPTIMIZER_PORT: int = 8765
    
    class Config:
        env_file = ".env"

settings = Settings()
app = FastAPI(title="Masterplan Optimiser Service", version="1.0.0")

# ---------------------------------------------------------------------------
# Security middleware  -  desktop auth token + body size limit
# ---------------------------------------------------------------------------

_DESKTOP_AUTH_TOKEN = os.getenv("DESKTOP_AUTH_TOKEN")
_MAX_BODY_SIZE = 50 * 1024 * 1024  # 50 MB


@app.middleware("http")
async def check_desktop_token(request: Request, call_next):
    """Reject requests without a valid desktop auth token."""
    if _DESKTOP_AUTH_TOKEN and request.url.path not in ("/health", "/"):
        token = request.headers.get("x-desktop-token")
        if token != _DESKTOP_AUTH_TOKEN:
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """Reject request bodies larger than the configured limit."""
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_BODY_SIZE:
        return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)

_start_time = datetime.utcnow()

# Active solver callbacks keyed by request_id for progress reporting
_active_callbacks: Dict[str, ProgressCallback] = {}
# Store max_time_seconds per request for ETA calculation
_active_timeouts: Dict[str, float] = {}

@app.on_event("startup")
async def on_startup():
    """Log compute service startup metadata."""
    logger.info(f"Compute service STARTED at {_start_time.isoformat()} on {settings.OPTIMIZER_HOST}:{settings.OPTIMIZER_PORT}")
    logger.info(f"PID: {os.getpid()}")

@app.on_event("shutdown")
async def on_shutdown():
    """Log compute service shutdown metadata."""
    logger.warning(f"Compute service SHUTTING DOWN at {datetime.utcnow().isoformat()} (was up since {_start_time.isoformat()})")


# ============================================================================
# Request/Response Models
# ============================================================================

class OptimizeDayRequest(BaseModel):
    """Request body for solving one event day."""

    event_id: int
    date: str
    normalized_input: Dict[str, Any]  # Contains tasks, persons, transfers, floating_tasks, errors
    request_id: Optional[str] = None  # Backend can supply a request_id for progress polling


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/health")
async def health():
    """Health check endpoint with uptime info."""
    uptime = (datetime.utcnow() - _start_time).total_seconds()
    return {
        "status": "healthy",
        "pid": os.getpid(),
        "started_at": _start_time.isoformat(),
        "uptime_seconds": round(uptime, 1),
    }

@app.get("/")
async def root():
    """Readiness endpoint for the compute service root."""
    return {"message": "Masterplan Optimiser Service", "status": "ready"}


@app.get("/optimize/progress/{request_id}")
async def get_progress(request_id: str):
    """Return intermediate solver snapshots for a running optimisation."""
    cb = _active_callbacks.get(request_id)
    if cb is None:
        return {"snapshots": [], "is_running": False, "max_time_seconds": None}
    return {
        "snapshots": list(cb.snapshots),
        "is_running": True,
        "max_time_seconds": _active_timeouts.get(request_id),
    }


@app.post("/optimize/day")
async def optimize_day(request: OptimizeDayRequest):
    """
    Run optimisation for a specific day using the fatigue optimiser.
    """
    print("\n" + "="*80)
    print("OPTIMISATION REQUEST RECEIVED")
    print("="*80)
    print(f"Event ID: {request.event_id}")
    print(f"Date: {request.date}")
    
    # Summary counts
    print(f"\n--- NORMALIZED INPUT SUMMARY ---")
    print(f"Tasks: {len(request.normalized_input.get('tasks', []))}")
    print(f"Persons: {len(request.normalized_input.get('persons', []))}")
    print(f"Transfers: {len(request.normalized_input.get('transfers', []))}") 
    print(f"Floating Tasks: {len(request.normalized_input.get('floating_tasks', []))}")
    print(f"Errors: {len(request.normalized_input.get('errors', []))}")
    
    try:
        # Import flow_checker structures to convert dict to proper objects
        from flow_checker import NormalizedFlowInput, NormPerson, NormTask, NormTransfer, NormFloatingTask
        
        # Convert dict to NormalizedFlowInput object
        print("\n--- CONVERTING INPUT TO NORMALIZED OBJECTS ---")
        
        # Convert persons
        persons = []
        for p in request.normalized_input.get('persons', []):
            # Convert unavailable_intervals to list of tuples
            unavailable = []
            for interval in p.get('unavailable_intervals', []):
                if isinstance(interval, dict):
                    unavailable.append((interval['start'], interval['end']))
                elif isinstance(interval, (list, tuple)) and len(interval) == 2:
                    unavailable.append(tuple(interval))
            
            person = NormPerson(
                id=p['id'],
                home_location_id=p.get('initial_location_id'),
                capabilities=p.get('capabilities', []),
                max_work_minutes_per_day=p.get('max_work_minutes_per_day'),
                unavailable_intervals=unavailable,
                initial_fatigue=float(p.get('initial_fatigue', 0.0))
            )
            person.name = p.get('name', '') or f"Person {p['id']}"
            persons.append(person)
        
        # Convert tasks - NormTask uses 'requirements' not 'required_capabilities'
        tasks = []
        for t in request.normalized_input.get('tasks', []):
            task = NormTask(
                id=t['id'],
                name=t['name'],
                location_id=t['location_id'],
                start_time=t['start_time'],
                end_time=t['end_time'],
                requirements=t.get('required_capabilities', {}),  # Map to 'requirements'
                preassigned_person_ids=t.get('preassigned_person_ids', []),
                field_requirements=t.get('field_requirements', {}),
                counts_towards_work_time=t.get('counts_towards_work_time', True) is not False,
            )
            # Add fatigue_per_minute as dynamic attribute (not in dataclass)
            task.fatigue_per_minute = t.get('fatigue_per_minute', 1.0)
            tasks.append(task)
        
        # Convert transfers
        transfers = []
        for tr in request.normalized_input.get('transfers', []):
            transfers.append(NormTransfer(
                id=tr['id'],
                from_location_id=tr['from_location_id'],
                to_location_id=tr['to_location_id'],
                depart_time=tr['depart_time'],
                arrive_time=tr['arrive_time'],
                capacity=tr['capacity'],
                requirements=tr.get('required_capabilities', {}),
                optional_capacity_slots=tr.get('optional_capacity_slots', 0),
                field_requirements=tr.get('field_requirements', {}),
                transferee_field_id=tr.get('transferee_field_id'),
                locked_person_ids=tr.get('locked_person_ids', []),
                person_field_assignments=tr.get('person_field_assignments', {}),
                counts_towards_work_time=tr.get('counts_towards_work_time', True) is not False,
            ))
        
        # Convert floating tasks - simpler structure without candidates
        floating_tasks = []
        for ft in request.normalized_input.get('floating_tasks', []):
            # If backend sends candidates, compute window from all candidates
            if ft.get('candidates') and len(ft['candidates']) > 0:
                candidates = ft['candidates']
                first_candidate = candidates[0]
                
                # Window is the span of all candidates (earliest start to latest end)
                window_start = min(c['start_time'] for c in candidates)
                window_end = max(c['end_time'] for c in candidates)
                
                # Duration is from the first candidate (all should have same duration)
                duration = first_candidate['end_time'] - first_candidate['start_time']
                
                floating_task = NormFloatingTask(
                    id=ft['id'],
                    name=ft['name'],
                    location_id=first_candidate['location_id'],
                    window_start_time=window_start,
                    window_end_time=window_end,
                    duration=duration,
                    requirements=first_candidate.get('required_capabilities', {}),
                    preassigned_person_ids=first_candidate.get('preassigned_person_ids', []),
                    counts_towards_work_time=first_candidate.get('counts_towards_work_time', True) is not False,
                )
                floating_task.fatigue_per_minute = first_candidate.get('fatigue_per_minute', 1.0)
                floating_tasks.append(floating_task)
        
        normalized = NormalizedFlowInput(
            persons=persons,
            tasks=tasks,
            transfers=transfers,
            floating_tasks=floating_tasks,
            errors=request.normalized_input.get('errors', []),
            capability_names=request.normalized_input.get('capability_names', {}),
            location_names=request.normalized_input.get('location_names', {}),
        )
        
        print(f"Converted: {len(persons)} persons, {len(tasks)} tasks, {len(transfers)} transfers, {len(floating_tasks)} floating")
        
        # Expand floating tasks into candidates BEFORE calling optimiser
        # This replicates the logic from fatigue_optimizer.py so we have access to the expanded tasks
        from flow_checker import NormTask, generate_time_segments
        
        segments = generate_time_segments(tasks, transfers, floating_tasks)
        expanded_tasks = list(tasks)  # Start with static tasks
        
        if floating_tasks:
            print(f"\n--- PRE-EXPANDING {len(floating_tasks)} FLOATING TASKS ---")
            for ft in floating_tasks:
                for s_idx, seg in enumerate(segments):
                    seg_start = seg.start_time
                    
                    # Check if task can fit starting at this segment
                    if seg_start < ft.window_start_time:
                        continue
                    if seg_start + ft.duration > ft.window_end_time:
                        continue
                    
                    # Create candidate task with actual scheduled times
                    candidate_task = NormTask(
                        id=ft.id,
                        name=f"{ft.name} [floating@seg{s_idx}]",
                        location_id=ft.location_id,
                        start_time=seg_start,
                        end_time=seg_start + ft.duration,
                        requirements=dict(ft.requirements),
                        preassigned_person_ids=ft.preassigned_person_ids,
                        counts_towards_work_time=ft.counts_towards_work_time,
                    )
                    
                    # Copy fatigue_per_minute if floating task has it
                    if hasattr(ft, 'fatigue_per_minute'):
                        candidate_task.fatigue_per_minute = ft.fatigue_per_minute
                    
                    expanded_tasks.append(candidate_task)
                    print(f"  '{ft.name}' -> candidate at seg{s_idx}: task[{len(expanded_tasks)-1}]")
        
        print(f"Total expanded tasks: {len(expanded_tasks)}")
        
        # Call the actual fatigue optimiser
        print("\n--- CALLING FATIGUE OPTIMISER ---")
        
        # Build solver config from request (if provided by backend)
        solver_config = None
        raw_config = request.normalized_input.get("solver_config")
        if raw_config:
            solver_config = OptimizationConfig(
                scale=raw_config.get("scale", 100),
                break_threshold_min=raw_config.get("break_threshold_min", 30),
                break_effect=raw_config.get("break_effect", -0.5),
                max_time_seconds=raw_config.get("max_time_seconds", 30.0),
            )
            print(f"Solver config: scale={solver_config.scale}, break_threshold={solver_config.break_threshold_min}min, "
                  f"break_effect={solver_config.break_effect}, max_time={solver_config.max_time_seconds}s")
        
        # Use backend-supplied request_id if available, else generate one
        request_id = request.request_id or uuid.uuid4().hex
        max_time = (solver_config or OptimizationConfig()).max_time_seconds
        
        # Create callback externally and register so GET /optimize/progress
        # can read intermediate snapshots while the solver is running.
        cb = ProgressCallback(scale=100)  # Scale will be reset by optimize_with_fatigue
        _active_callbacks[request_id] = cb
        _active_timeouts[request_id] = max_time
        
        try:
            # Run in thread so event loop stays responsive for progress polls
            result = await asyncio.to_thread(
                optimize_with_fatigue,
                normalized_input=normalized,
                config=solver_config,
                callback=cb,
            )
        finally:
            _active_callbacks.pop(request_id, None)
            _active_timeouts.pop(request_id, None)
        
        print(f"\n--- OPTIMISATION COMPLETE ---")
        print(f"Status: {result.status}")
        print(f"Assignments dict keys: {list(result.assignments.keys())}")
        print(f"Assignments: {len(result.assignments)} tasks assigned")
        
        # Debug: Show assignment details
        if result.assignments:
            for task_id, person_ids in list(result.assignments.items())[:3]:
                print(f"  Task {task_id}: {len(person_ids)} persons -> {person_ids}")
        
        print(f"Solve time: {result.solve_time:.2f}s")
        
        if result.errors:
            print(f"Errors: {len(result.errors)}")
            for error in result.errors:
                print(f"  - {error}")
        
        print("="*80 + "\n")
        
        # Build task lookup dictionary using our pre-expanded tasks
        # These have the actual scheduled start/end times for floating task candidates
        task_lookup = {t.id: t for t in expanded_tasks}
        
        print(f"\nBuilding response:")
        print(f"  Task lookup has {len(task_lookup)} tasks (pre-expanded)")
        print(f"  Task IDs in lookup: {list(task_lookup.keys())}")
        print(f"  Assignment task IDs (preassigned): {list(result.assignments.keys())}")
        print(f"  Capability assignment task IDs: {[task_id for (task_id, cap_name) in result.capability_assignments.keys()]}")
        
        # Track which persons are working on which tasks (either preassigned or capability provider)
        task_person_map = {}  # task_id -> set of person_ids
        
        # Add preassigned persons
        for task_id, person_ids in result.assignments.items():
            if task_id not in task_person_map:
                task_person_map[task_id] = set()
            task_person_map[task_id].update(person_ids)
        
        # Add capability providers
        for (task_id, cap_name), person_ids in result.capability_assignments.items():
            if task_id not in task_person_map:
                task_person_map[task_id] = set()
            task_person_map[task_id].update(person_ids)
        
        # Add transfer assignments
        if result.transfer_assignments:
            for transfer_id, person_ids in result.transfer_assignments.items():
                if transfer_id not in task_person_map:
                    task_person_map[transfer_id] = set()
                task_person_map[transfer_id].update(person_ids)
        
        # Convert to assignment list for backend
        assignments_list = []
        for task_id, person_ids in task_person_map.items():
            # Get task details from optimiser result
            if task_id not in result.task_details:
                print(f"WARNING: Task {task_id} not found in task details (available: {list(result.task_details.keys())})")
                continue
            
            task_detail = result.task_details[task_id]
            
            # Use original floating task ID for API response
            output_task_id = task_detail['original_id']
            
            for person_id in person_ids:
                # Use task details from optimiser (which has correct timing for selected candidates)
                assignments_list.append({
                    "person_id": person_id,
                    "task_id": output_task_id,  # Use original floating task ID for API response
                    "start_time": task_detail['start_time'],
                    "end_time": task_detail['end_time'],
                    "location_id": task_detail['location_id'],
                    "fatigue_contributed": result.fatigue_per_person.get(person_id, 0.0)
                })
        
        print(f"Returning {len(assignments_list)} assignments in response")
        print(f"  Assignments: {[(a['person_id'], a['task_id']) for a in assignments_list]}")
        
        # Build field_assignments response (task/transfer id -> {field_id -> [person_ids]})
        # Convert integer keys to strings for JSON serialization
        field_assignments_response = {}
        if result.field_assignments:
            for task_id, field_map in result.field_assignments.items():
                field_assignments_response[str(task_id)] = field_map
        
        return {
            "status": result.status,
            "assignments": assignments_list,
            "field_assignments": field_assignments_response,
            "fatigue_stats": {
                "min": result.fatigue_min,
                "max": result.fatigue_max,
                "range": result.fatigue_range,
                "per_person": result.fatigue_per_person
            },
            "solve_time": result.solve_time,
            "errors": result.errors,
            "request_id": request_id,
            "progress_snapshots": result.progress_snapshots or [],
            "diagnostics": result.diagnostics,
        }
        
    except Exception as e:
        print(f"\n--- OPTIMISATION FAILED ---")
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        print("="*80 + "\n")
        
        raise HTTPException(
            status_code=500,
            detail=f"Optimisation failed: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    
    print("="*80)
    print("STARTING COMPUTE SERVICE")
    print(f"Host: {settings.OPTIMIZER_HOST}")
    print(f"Port: {settings.OPTIMIZER_PORT}")
    print(f"PID:  {os.getpid()}")
    print(f"Time: {datetime.utcnow().isoformat()}")
    print("="*80)
    
    try:
        # Pass app object directly (not string) so PyInstaller frozen imports work
        uvicorn.run(
            app,
            host=settings.OPTIMIZER_HOST,
            port=settings.OPTIMIZER_PORT,
        )
    except Exception as e:
        print(f"\n{'!'*80}")
        print(f"COMPUTE SERVICE CRASHED: {e}")
        import traceback
        traceback.print_exc()
        print(f"{'!'*80}\n")
        sys.exit(1)
