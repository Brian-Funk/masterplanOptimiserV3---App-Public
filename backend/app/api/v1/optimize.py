"""
Optimisation API Endpoints
Handles starting optimisation jobs and querying their status
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List
from datetime import datetime
import httpx
import os

from app.db.database import get_db
from app.models.task import TaskType
from app.models.optimization_job import OptimizationJob
from app.schemas.optimization import (
    OptimizeRequest,
    OptimizeStartResponse,
    JobStatusResponse,
    JobListResponse,
    JobSummary
)
from app.core.normalizer_optimization import normalize_optimization_input
from app.core.optimization_runner import run_optimization_background
from app.api.v1.app_settings import get_solver_settings
from app.core.config import settings as app_settings
from app.core.debug_logging import debug_print
from app.core.solver_exclusions import filter_solver_active_tasks

router = APIRouter()


# ============================================================================
# API Endpoints
# ============================================================================

@router.post("/day", response_model=OptimizeStartResponse)
async def start_optimization(
    request: OptimizeRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Start optimisation for a specific day in the background.
    
    Constraints:
    - Only ONE optimisation can run at a time across all events
    - If an optimisation is already running, returns error
    - If optimisation already exists for this day and is pending/running, returns existing job
    
    Flow:
    1. Check if any optimisation is currently running
    2. Check if optimisation already exists for this event+date
    3. Normalise input data (including TaskType fatigue scores)
    4. Create job record in database
    5. Schedule background task
    6. Return immediately with job_id
    """
    debug_print("\n" + ">"*80)
    debug_print(">>> POST /api/v1/optimize/day ENDPOINT CALLED <<<")
    debug_print(">"*80 + "\n")
    
    try:
        active_tasks = filter_solver_active_tasks(
            db,
            request.event_id,
            request.tasks,
        )
        if not active_tasks:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "NO_ACTIVE_TASKS",
                    "message": "Nothing to optimise because all tasks are ignored.",
                },
            )

        # DEBUG: Print raw request data
        debug_print("\n" + "="*80)
        debug_print("OPTIMISATION REQUEST RECEIVED")
        debug_print("="*80)
        debug_print(f"Event ID: {request.event_id}")
        debug_print(f"Date: {request.date}")
        debug_print(f"Test Mode: {request.test_mode}")
        debug_print(f"Number of tasks: {len(active_tasks)}")
        debug_print(f"Ignored tasks removed: {len(request.tasks) - len(active_tasks)}")
        debug_print(f"Number of persons: {len(request.persons)}")
        debug_print(f"Number of locations: {len(request.locations)}")
        debug_print(f"Number of capabilities: {len(request.capabilities)}")
        
        # Print first few tasks for inspection
        debug_print("\nFirst 3 tasks:")
        for i, task in enumerate(active_tasks[:3]):
            debug_print(f"  Task {i}: {task.model_dump()}")
        
        debug_print("="*80 + "\n")
        
        # CONSTRAINT: Only ONE optimisation can run at a time
        running_job = db.query(OptimizationJob).filter(
            or_(
                OptimizationJob.status == "running",
                OptimizationJob.status == "pending"
            )
        ).first()
        
        if running_job:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Another optimisation is already running (Job {running_job.id} for {running_job.date}). Please wait for it to complete."
            )
        
        # Check if optimisation already exists for this event+date
        existing_job = db.query(OptimizationJob).filter(
            OptimizationJob.event_id == request.event_id,
            OptimizationJob.date == request.date
        ).first()
        
        if existing_job:
            # If job is completed or failed, we can create a new one (rerun)
            if existing_job.status in ["completed", "infeasible", "undetermined", "failed"]:
                # Delete old job to create fresh one
                db.delete(existing_job)
                db.commit()
            else:
                # Job is still pending/running, return existing
                return OptimizeStartResponse(
                    job_id=existing_job.id,
                    status=existing_job.status,
                    message=f"Optimisation already {existing_job.status} for this day"
                )
        
        debug_print("=" * 80)
        debug_print(f"OPTIMISATION API - Starting for Event {request.event_id}, Date {request.date}")
        debug_print(f"Test Mode: {request.test_mode}")
        debug_print(f"Tasks: {len(active_tasks)}, Persons: {len(request.persons)}")
        debug_print("=" * 80)
        
        # Use fatigue scores from the request (sent by frontend).
        # The local DB may not have TaskType records when running in
        # desktop-remote mode, so we rely on what the frontend sends.
        task_type_fatigue_map = dict(request.fatigue_scores) if request.fatigue_scores else {}
        if not task_type_fatigue_map:
            # Fallback: try loading from local DB
            task_types = db.query(TaskType).all()
            for tt in task_types:
                task_type_fatigue_map[tt.id] = (
                    float(tt.fatigue_score) if tt.fatigue_score is not None else 1.0
                )
        
        # Normalise input data with database access for field types
        normalized_input = normalize_optimization_input(
            tasks=active_tasks,
            persons=request.persons,
            locations=request.locations,
            capabilities=request.capabilities,
            task_type_fatigue_map=task_type_fatigue_map,
            db=db,
            event_id=request.event_id,
            working_day_date=request.date,
            working_day_boundary_offset_hour=request.working_day_boundary_offset_hour,
        )
        
        debug_print(f"Normalised: {len(normalized_input.tasks)} tasks, {len(normalized_input.persons)} persons")
        if normalized_input.errors:
            debug_print(f"Normalisation warnings: {len(normalized_input.errors)}")
        
        # Create job record
        job = OptimizationJob(
            event_id=request.event_id,
            date=request.date,
            status="pending",
            is_test_run=request.test_mode,
            created_at=datetime.utcnow()
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        
        debug_print(f"Created job {job.id} with status 'pending'")
        
        # Prepare normalised input as dictionary for background task
        normalized_dict = {
            "event_id": request.event_id,
            "date": request.date,
            "tasks": [
                {
                    "id": t.id,
                    "name": t.name,
                    "location_id": t.location_id,
                    "start_time": t.start_time,
                    "end_time": t.end_time,
                    "required_capabilities": t.required_capabilities,
                    "preassigned_person_ids": t.preassigned_person_ids,
                    "fatigue_per_minute": t.fatigue_per_minute,
                    "counts_towards_work_time": t.counts_towards_work_time,
                    "field_requirements": t.field_requirements
                }
                for t in normalized_input.tasks
            ],
            "persons": [
                {
                    "id": p.id,
                    "name": p.name,
                    "initial_location_id": p.initial_location_id,
                    "capabilities": p.capabilities,
                    "max_work_minutes_per_day": p.max_work_minutes_per_day,
                    "unavailable_intervals": p.unavailable_intervals,
                    "initial_fatigue": p.initial_fatigue
                }
                for p in normalized_input.persons
            ],
            "transfers": [
                {
                    "id": t.id,
                    "from_location_id": t.from_location_id,
                    "to_location_id": t.to_location_id,
                    "depart_time": t.depart_time,
                    "arrive_time": t.arrive_time,
                    "capacity": t.capacity,
                    "required_capabilities": t.required_capabilities,
                    "optional_capacity_slots": t.optional_capacity_slots,
                    "field_requirements": t.field_requirements,
                    "transferee_field_id": t.transferee_field_id,
                    "locked_person_ids": t.locked_person_ids,
                    "person_field_assignments": t.person_field_assignments,
                    "counts_towards_work_time": t.counts_towards_work_time,
                }
                for t in normalized_input.transfers
            ],
            "floating_tasks": [
                {
                    "id": ft.id,
                    "name": ft.name,
                    "candidates": [
                        {
                            "id": c.id,
                            "name": c.name,
                            "location_id": c.location_id,
                            "start_time": c.start_time,
                            "end_time": c.end_time,
                            "required_capabilities": c.required_capabilities,
                            "preassigned_person_ids": c.preassigned_person_ids,
                            "fatigue_per_minute": c.fatigue_per_minute,
                            "counts_towards_work_time": c.counts_towards_work_time,
                        }
                        for c in ft.candidates
                    ]
                }
                for ft in normalized_input.floating_tasks
            ],
            "errors": normalized_input.errors
        }
        normalized_dict["capability_names"] = {
            capability.machine_name: capability.name
            for capability in request.capabilities
        }
        normalized_dict["location_names"] = {
            location.id: location.name for location in request.locations
        }
        
        # Attach solver tuning parameters from AppSettings
        solver_cfg = get_solver_settings(db)
        normalized_dict["solver_config"] = {
            "scale": solver_cfg["solver_fatigue_scale"],
            "break_threshold_min": solver_cfg["solver_break_threshold_min"],
            "break_effect": solver_cfg["solver_break_recovery_bonus"],
            "max_time_seconds": solver_cfg["solver_max_time_seconds"],
        }
        debug_print(f"Solver config from settings: max_time={solver_cfg['solver_max_time_seconds']}s, "
              f"scale={solver_cfg['solver_fatigue_scale']}, "
              f"break_threshold={solver_cfg['solver_break_threshold_min']}min")
        
        # Schedule background task (always uses real optimiser)
        background_tasks.add_task(
            run_optimization_background,
            job_id=job.id,
            normalized_input=normalized_dict,
            test_mode=False  # Always use real optimiser
        )
        
        debug_print(f"Scheduled background task for job {job.id}")
        debug_print("=" * 80)
        
        return OptimizeStartResponse(
            job_id=job.id,
            status="pending",
            message=f"Optimisation started for {request.date}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start optimisation: {str(e)}"
        )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: int,
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get detailed status of a specific optimisation job."""
    job = db.query(OptimizationJob).filter(
        OptimizationJob.id == job_id,
        OptimizationJob.event_id == event_id,
    ).first()
    
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )
    
    # Calculate elapsed time
    elapsed_seconds = None
    if job.started_at:
        end_time = job.completed_at if job.completed_at else datetime.utcnow()
        elapsed_seconds = (end_time - job.started_at).total_seconds()
    
    # Fetch live progress from compute service when job is running
    progress_data = job.progress_data
    if job.status == "running" and job.compute_request_id:
        compute_url = app_settings.OPTIMIZER_URL
        progress_url = f"{compute_url}/optimize/progress/{job.compute_request_id}"
        try:
            progress_headers = {}
            desktop_token = os.getenv("DESKTOP_AUTH_TOKEN")
            if desktop_token:
                progress_headers["x-desktop-token"] = desktop_token
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(progress_url, headers=progress_headers)
            if resp.status_code == 200:
                progress_data = resp.json()
                snap_count = len(progress_data.get("snapshots", []))
                if snap_count > 0:
                    debug_print(f"[Optimize API] Progress proxy: {snap_count} snapshots from compute")
            else:
                debug_print(f"[Optimize API] Progress proxy: HTTP {resp.status_code} from {progress_url}")
        except Exception as exc:
            debug_print(f"[Optimize API] Progress proxy error for {progress_url}: {exc}")
    
    return JobStatusResponse(
        id=job.id,
        event_id=job.event_id,
        date=job.date,
        status=job.status,
        is_test_run=job.is_test_run,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        elapsed_seconds=elapsed_seconds,
        result_data=job.result_data,
        error_message=job.error_message,
        progress_data=progress_data
    )


@router.get("/jobs", response_model=JobListResponse)
async def get_jobs_for_event(
    event_id: int,
    db: Session = Depends(get_db),
):
    """Get all optimisation jobs for an event."""
    jobs = db.query(OptimizationJob).filter(
        OptimizationJob.event_id == event_id
    ).order_by(OptimizationJob.date).all()
    
    # Find currently running job
    running_job = db.query(OptimizationJob).filter(
        or_(
            OptimizationJob.status == "running",
            OptimizationJob.status == "pending"
        )
    ).first()
    
    job_summaries = [
        JobSummary(
            id=job.id,
            date=job.date,
            status=job.status,
            is_test_run=job.is_test_run,
            created_at=job.created_at,
            completed_at=job.completed_at
        )
        for job in jobs
    ]
    
    running_summary = None
    if running_job:
        running_summary = JobSummary(
            id=running_job.id,
            date=running_job.date,
            status=running_job.status,
            is_test_run=running_job.is_test_run,
            created_at=running_job.created_at,
            completed_at=running_job.completed_at
        )
    
    return JobListResponse(
        jobs=job_summaries,
        running_job=running_summary
    )


@router.post("/clear-stuck-jobs")
async def clear_stuck_jobs(
    db: Session = Depends(get_db),
):
    """
    Emergency endpoint to clear stuck optimisation jobs.
    Sets all "running" or "pending" jobs to "failed" status.
    Use this when an optimisation crashed and didn't properly update its status.
    """
    # Find all stuck jobs
    stuck_jobs = db.query(OptimizationJob).filter(
        or_(
            OptimizationJob.status == "running",
            OptimizationJob.status == "pending"
        )
    ).all()
    
    if not stuck_jobs:
        return {"message": "No stuck jobs found", "cleared_count": 0}
    
    # Mark them as failed
    for job in stuck_jobs:
        job.status = "failed"
        job.error_message = "Job was stuck and manually cleared"
        job.completed_at = datetime.utcnow()
    
    db.commit()
    
    return {
        "message": f"Cleared {len(stuck_jobs)} stuck job(s)",
        "cleared_count": len(stuck_jobs),
        "cleared_jobs": [{"id": job.id, "date": str(job.date)} for job in stuck_jobs]
    }


@router.post("/cleanup-on-close")
async def cleanup_on_close(
    db: Session = Depends(get_db),
):
    """
    Cleanup endpoint to be called when the application is closing.
    Cancels all running/pending optimisation jobs.
    
    This is called automatically by the frontend on window.beforeunload.
    """
    # Find all running or pending jobs
    active_jobs = db.query(OptimizationJob).filter(
        or_(
            OptimizationJob.status == "running",
            OptimizationJob.status == "pending"
        )
    ).all()
    
    if not active_jobs:
        return {"message": "No active jobs to cancel", "cancelled_count": 0}
    
    # Cancel them
    for job in active_jobs:
        job.status = "failed"
        job.error_message = "Job cancelled due to application closure"
        job.completed_at = datetime.utcnow()
    
    db.commit()
    
    return {
        "message": f"Cancelled {len(active_jobs)} active job(s)",
        "cancelled_count": len(active_jobs),
        "cancelled_jobs": [{"id": job.id, "date": str(job.date)} for job in active_jobs]
    }
