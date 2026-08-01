"""
Background Optimisation Task Runner
Handles the actual execution of optimisation in background threads
"""
import os
import time
import uuid
import httpx
from datetime import datetime
from typing import Dict, Any
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.models.optimization_job import OptimizationJob
from app.core.config import settings
from app.core.optimization_writer import write_optimization_results


def run_optimization_background(
    job_id: int,
    normalized_input: Dict[str, Any],
    test_mode: bool = False
) -> None:
    """
    Execute optimisation in background thread.
    
    This function:
    1. Updates job status to "running"
    2. Calls compute service with real optimiser
    3. Writes results to task.optimised and Assignment records
    4. Updates job with results or error
    5. Handles all exceptions gracefully
    
    Args:
        job_id: ID of the OptimizationJob record
        normalized_input: Normalised data ready for compute service
        test_mode: Ignored - always uses real optimiser
    """
    db = SessionLocal()
    
    try:
        # Get job and update to running
        job = db.query(OptimizationJob).filter(OptimizationJob.id == job_id).first()
        if not job:
            print(f"[Optimization Runner] ERROR: Job {job_id} not found")
            return
        
        job.status = "running"
        job.started_at = datetime.utcnow()
        
        # Generate a request_id so we can poll solver progress while POST blocks
        request_id = uuid.uuid4().hex
        job.compute_request_id = request_id
        db.commit()
        
        print(f"[Optimization Runner] Job {job_id} started for {job.date} (request_id={request_id})")
        print(f"[Optimization Runner] Calling real optimiser...")
        
        # Call compute service (blocking - passes request_id so compute
        # registers a ProgressCallback that the status endpoint can query)
        result = call_compute_service_sync(normalized_input, request_id)
        print(f"[Optimization Runner] Optimiser completed: {result.get('status')}")
        
        # Write results to database if successful
        # CP-SAT returns "OPTIMAL" or "FEASIBLE" for successful solves
        if result.get("status") in ("OPTIMAL", "FEASIBLE"):
            # In desktop mode the local DB has no task/person records (data
            # lives in localStorage / the remote server), so we skip the
            # DB write. The frontend reads results from job.result_data.
            if settings.ENVIRONMENT == "desktop":
                print(f"[Optimization Runner] Desktop mode  -  skipping DB write (frontend reads result_data)")
            else:
                print(f"[Optimization Runner] Writing results to database...")
                write_optimization_results(
                    db=db,
                    event_id=normalized_input.get("event_id"),
                    date=normalized_input.get("date"),
                    result=result
                )
                print(f"[Optimization Runner] Results written successfully")
        else:
            print(f"[Optimization Runner] Optimisation failed or infeasible, preserving old data")
        
        # Preserve solver outcomes as distinct terminal states. Operational
        # failures remain "failed" and keep using error_message.
        solver_status = result.get("status")
        if solver_status in ("OPTIMAL", "FEASIBLE"):
            job.status = "completed"
        elif solver_status == "INFEASIBLE":
            job.status = "infeasible"
        elif solver_status == "UNKNOWN":
            job.status = "undetermined"
        else:
            job.status = "failed"
            job.error_message = f"Unexpected solver status: {solver_status or 'missing'}"
        job.completed_at = datetime.utcnow()
        job.result_data = result
        # Persist final progress data so the frontend can display it after completion
        job.progress_data = {
            "snapshots": result.get("progress_snapshots", []),
            "is_running": False,
            "max_time_seconds": normalized_input.get("solver_config", {}).get("max_time_seconds", 30),
            "solver_status": result.get("status"),
            "diagnostics": result.get("diagnostics"),
        }
        db.commit()
        
        elapsed = (job.completed_at - job.started_at).total_seconds()
        print(f"[Optimization Runner] Job {job_id} finished as {job.status} in {elapsed:.1f}s")
        
    except Exception as e:
        # Handle errors gracefully - preserve old data on failure
        print(f"[Optimization Runner] ERROR in job {job_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        
        try:
            job = db.query(OptimizationJob).filter(OptimizationJob.id == job_id).first()
            if job:
                job.status = "failed"
                job.error_message = str(e)
                job.completed_at = datetime.utcnow()
                db.commit()
                print(f"[Optimization Runner] Job marked as failed, old data preserved")
        except Exception as commit_error:
            print(f"[Optimization Runner] ERROR updating failed job: {str(commit_error)}")
    
    finally:
        db.close()


def call_compute_service_sync(normalized_input: Dict[str, Any], request_id: str = None) -> Dict[str, Any]:
    """
    Synchronous call to compute service.
    
    Args:
        normalized_input: Dictionary with tasks, persons, transfers, etc.
        request_id: Optional UUID for progress tracking on compute side.
    
    Returns:
        Dictionary with optimisation results
    
    Raises:
        httpx.HTTPError: If compute service call fails
    """
    compute_service_url = settings.OPTIMIZER_URL
    
    print(f"[Optimization Runner] Calling compute service at {compute_service_url}")
    
    auth_headers = {}
    desktop_token = os.getenv("DESKTOP_AUTH_TOKEN")
    if desktop_token:
        auth_headers["x-desktop-token"] = desktop_token

    # Health check first  -  fast probe to detect a dead service early
    try:
        with httpx.Client(timeout=5.0) as probe:
            health = probe.get(f"{compute_service_url}/health", headers=auth_headers)
            info = health.json()
            print(f"[Optimization Runner] Compute service healthy  -  PID={info.get('pid')}, uptime={info.get('uptime_seconds')}s")
    except httpx.ConnectError:
        print(f"[Optimization Runner] HEALTH CHECK FAILED  -  compute service is NOT reachable at {compute_service_url}")
        print(f"[Optimization Runner] The compute process has likely crashed. Check Electron console for '[Optimizer LIFECYCLE]' messages.")
        raise RuntimeError(
            f"Compute service is not running at {compute_service_url}. "
            f"Restart the desktop app to recover."
        )
    except Exception as health_err:
        print(f"[Optimization Runner] Health check warning: {health_err}  -  proceeding anyway")
    
    try:
        with httpx.Client(timeout=3600.0) as client:  # 1 hour timeout
            response = client.post(
                f"{compute_service_url}/optimize/day",
                headers=auth_headers,
                json={
                    "event_id": normalized_input.get("event_id"),
                    "date": normalized_input.get("date"),
                    "normalized_input": normalized_input,
                    "request_id": request_id,
                }
            )
            
            # If error, try to get detailed error message from response
            if response.status_code != 200:
                try:
                    error_detail = response.json().get("detail", "Unknown error")
                    print(f"[Optimization Runner] Compute service error: {error_detail}")
                except:
                    error_detail = response.text
                    print(f"[Optimization Runner] Compute service error (raw): {error_detail}")
                
                response.raise_for_status()
            
            return response.json()
    except httpx.ConnectError as e:
        print(f"[Optimization Runner] CONNECTION REFUSED: {str(e)}")
        print(f"[Optimization Runner] The compute service at {compute_service_url} is not running.")
        print(f"[Optimization Runner] This usually means the process crashed. Check Electron DevTools for '[Optimizer LIFECYCLE]' exit logs.")
        raise
    except httpx.HTTPError as e:
        print(f"[Optimization Runner] HTTP error: {str(e)}")
        raise
