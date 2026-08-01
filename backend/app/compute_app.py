"""
Compute sub-application  —  mounted at /compute by the main backend app.

This is a self-contained FastAPI app that exposes the optimisation endpoints
previously served by a separate compute process on port 8765.  Merging into
the backend eliminates ~250 MB of duplicated OR-Tools / Python runtime in the
packaged desktop app.

Security notes
--------------
* Auth (X-Desktop-Token) is enforced by the **parent** app's middleware.
  This sub-app must NOT duplicate that check.
* The parent's 5 MB body-size middleware exempts /compute paths so that
  large optimisation payloads can reach this sub-app's own 50 MB limit.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.debug_logging import debug_print

# compute/src is on sys.path via PyInstaller --paths ../compute/src
from fatigue_optimizer import OptimizationConfig, ProgressCallback, optimize_with_fatigue

logger = logging.getLogger("compute")

# ---------------------------------------------------------------------------
# Sub-app
# ---------------------------------------------------------------------------

compute_app = FastAPI(title="Masterplan Optimiser Compute", version="1.0.0")

_MAX_BODY_SIZE = 50 * 1024 * 1024  # 50 MB


@compute_app.middleware("http")
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


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class OptimizeDayRequest(BaseModel):
    event_id: int
    date: str
    normalized_input: Dict[str, Any]
    request_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@compute_app.get("/health")
async def health():
    """Health check endpoint with uptime info."""
    uptime = (datetime.utcnow() - _start_time).total_seconds()
    return {
        "status": "healthy",
        "pid": os.getpid(),
        "started_at": _start_time.isoformat(),
        "uptime_seconds": round(uptime, 1),
    }


@compute_app.get("/")
async def root():
    return {"message": "Masterplan Optimiser Service", "status": "ready"}


@compute_app.get("/optimize/progress/{request_id}")
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


@compute_app.post("/optimize/day")
async def optimize_day(request: OptimizeDayRequest):
    """Run optimisation for a specific day using the fatigue optimiser."""
    debug_print("\n" + "=" * 80)
    debug_print("OPTIMISATION REQUEST RECEIVED")
    debug_print("=" * 80)
    debug_print(f"Event ID: {request.event_id}")
    debug_print(f"Date: {request.date}")

    debug_print(f"\n--- NORMALIZED INPUT SUMMARY ---")
    debug_print(f"Tasks: {len(request.normalized_input.get('tasks', []))}")
    debug_print(f"Persons: {len(request.normalized_input.get('persons', []))}")
    debug_print(f"Transfers: {len(request.normalized_input.get('transfers', []))}")
    debug_print(f"Floating Tasks: {len(request.normalized_input.get('floating_tasks', []))}")
    debug_print(f"Errors: {len(request.normalized_input.get('errors', []))}")

    try:
        from flow_checker import (
            NormFloatingTask,
            NormPerson,
            NormTask,
            NormTransfer,
            NormalizedFlowInput,
            generate_time_segments,
        )

        debug_print("\n--- CONVERTING INPUT TO NORMALIZED OBJECTS ---")

        # Convert persons
        persons = []
        for p in request.normalized_input.get("persons", []):
            unavailable = []
            for interval in p.get("unavailable_intervals", []):
                if isinstance(interval, dict):
                    unavailable.append((interval["start"], interval["end"]))
                elif isinstance(interval, (list, tuple)) and len(interval) == 2:
                    unavailable.append(tuple(interval))

            person = NormPerson(
                id=p["id"],
                home_location_id=p.get("initial_location_id"),
                capabilities=p.get("capabilities", []),
                max_work_minutes_per_day=p.get("max_work_minutes_per_day"),
                unavailable_intervals=unavailable,
                initial_fatigue=float(p.get("initial_fatigue", 0.0)),
            )
            person.name = p.get("name", "") or f"Person {p['id']}"
            persons.append(person)

        # Convert tasks
        tasks = []
        for t in request.normalized_input.get("tasks", []):
            task = NormTask(
                id=t["id"],
                name=t["name"],
                location_id=t["location_id"],
                start_time=t["start_time"],
                end_time=t["end_time"],
                requirements=t.get("required_capabilities", {}),
                preassigned_person_ids=t.get("preassigned_person_ids", []),
                field_requirements=t.get("field_requirements", {}),
                counts_towards_work_time=t.get("counts_towards_work_time", True) is not False,
            )
            task.fatigue_per_minute = t.get("fatigue_per_minute", 1.0)
            tasks.append(task)

        # Convert transfers
        transfers = []
        for tr in request.normalized_input.get("transfers", []):
            transfers.append(
                NormTransfer(
                    id=tr["id"],
                    from_location_id=tr["from_location_id"],
                    to_location_id=tr["to_location_id"],
                    depart_time=tr["depart_time"],
                    arrive_time=tr["arrive_time"],
                    capacity=tr["capacity"],
                    requirements=tr.get("required_capabilities", {}),
                    optional_capacity_slots=tr.get("optional_capacity_slots", 0),
                    field_requirements=tr.get("field_requirements", {}),
                    transferee_field_id=tr.get("transferee_field_id"),
                    locked_person_ids=tr.get("locked_person_ids", []),
                    person_field_assignments=tr.get("person_field_assignments", {}),
                    counts_towards_work_time=tr.get("counts_towards_work_time", True) is not False,
                )
            )

        # Convert floating tasks
        floating_tasks = []
        for ft in request.normalized_input.get("floating_tasks", []):
            if ft.get("candidates") and len(ft["candidates"]) > 0:
                candidates = ft["candidates"]
                first_candidate = candidates[0]
                window_start = min(c["start_time"] for c in candidates)
                window_end = max(c["end_time"] for c in candidates)
                duration = first_candidate["end_time"] - first_candidate["start_time"]

                floating_task = NormFloatingTask(
                    id=ft["id"],
                    name=ft["name"],
                    location_id=first_candidate["location_id"],
                    window_start_time=window_start,
                    window_end_time=window_end,
                    duration=duration,
                    requirements=first_candidate.get("required_capabilities", {}),
                    preassigned_person_ids=first_candidate.get("preassigned_person_ids", []),
                    counts_towards_work_time=first_candidate.get("counts_towards_work_time", True) is not False,
                )
                floating_task.fatigue_per_minute = first_candidate.get("fatigue_per_minute", 1.0)
                floating_tasks.append(floating_task)

        normalized = NormalizedFlowInput(
            persons=persons,
            tasks=tasks,
            transfers=transfers,
            floating_tasks=floating_tasks,
            errors=request.normalized_input.get("errors", []),
            capability_names=request.normalized_input.get("capability_names", {}),
            location_names=request.normalized_input.get("location_names", {}),
        )

        debug_print(f"Converted: {len(persons)} persons, {len(tasks)} tasks, {len(transfers)} transfers, {len(floating_tasks)} floating")

        # Expand floating tasks into candidates
        segments = generate_time_segments(tasks, transfers, floating_tasks)
        expanded_tasks = list(tasks)

        if floating_tasks:
            debug_print(f"\n--- PRE-EXPANDING {len(floating_tasks)} FLOATING TASKS ---")
            for ft in floating_tasks:
                for s_idx, seg in enumerate(segments):
                    seg_start = seg.start_time
                    if seg_start < ft.window_start_time:
                        continue
                    if seg_start + ft.duration > ft.window_end_time:
                        continue

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
                    if hasattr(ft, "fatigue_per_minute"):
                        candidate_task.fatigue_per_minute = ft.fatigue_per_minute
                    expanded_tasks.append(candidate_task)
                    debug_print(f"  '{ft.name}' -> candidate at seg{s_idx}: task[{len(expanded_tasks)-1}]")

        debug_print(f"Total expanded tasks: {len(expanded_tasks)}")

        # Build solver config
        debug_print("\n--- CALLING FATIGUE OPTIMISER ---")
        solver_config = None
        raw_config = request.normalized_input.get("solver_config")
        if raw_config:
            solver_config = OptimizationConfig(
                scale=raw_config.get("scale", 100),
                break_threshold_min=raw_config.get("break_threshold_min", 30),
                break_effect=raw_config.get("break_effect", -0.5),
                max_time_seconds=raw_config.get("max_time_seconds", 30.0),
            )
            debug_print(
                f"Solver config: scale={solver_config.scale}, "
                f"break_threshold={solver_config.break_threshold_min}min, "
                f"break_effect={solver_config.break_effect}, "
                f"max_time={solver_config.max_time_seconds}s"
            )

        request_id = request.request_id or uuid.uuid4().hex
        max_time = (solver_config or OptimizationConfig()).max_time_seconds

        cb = ProgressCallback(scale=100)
        _active_callbacks[request_id] = cb
        _active_timeouts[request_id] = max_time

        try:
            result = await asyncio.to_thread(
                optimize_with_fatigue,
                normalized_input=normalized,
                config=solver_config,
                callback=cb,
            )
        finally:
            _active_callbacks.pop(request_id, None)
            _active_timeouts.pop(request_id, None)

        debug_print(f"\n--- OPTIMISATION COMPLETE ---")
        debug_print(f"Status: {result.status}")
        debug_print(f"Assignments: {len(result.assignments)} tasks assigned")
        debug_print(f"Solve time: {result.solve_time:.2f}s")

        if result.errors:
            debug_print(f"Errors: {len(result.errors)}")
            for error in result.errors:
                debug_print(f"  - {error}")
        debug_print("=" * 80 + "\n")

        # Build response
        task_person_map: Dict[int, set] = {}

        for task_id, person_ids in result.assignments.items():
            task_person_map.setdefault(task_id, set()).update(person_ids)

        for (task_id, _cap), person_ids in result.capability_assignments.items():
            task_person_map.setdefault(task_id, set()).update(person_ids)

        if result.transfer_assignments:
            for transfer_id, person_ids in result.transfer_assignments.items():
                task_person_map.setdefault(transfer_id, set()).update(person_ids)

        assignments_list = []
        for task_id, person_ids in task_person_map.items():
            if task_id not in result.task_details:
                debug_print(f"WARNING: Task {task_id} not found in task details")
                continue
            task_detail = result.task_details[task_id]
            output_task_id = task_detail["original_id"]
            for person_id in person_ids:
                assignments_list.append(
                    {
                        "person_id": person_id,
                        "task_id": output_task_id,
                        "start_time": task_detail["start_time"],
                        "end_time": task_detail["end_time"],
                        "location_id": task_detail["location_id"],
                        "fatigue_contributed": result.fatigue_per_person.get(person_id, 0.0),
                    }
                )

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
                "per_person": result.fatigue_per_person,
            },
            "solve_time": result.solve_time,
            "errors": result.errors,
            "request_id": request_id,
            "progress_snapshots": result.progress_snapshots or [],
            "diagnostics": result.diagnostics,
        }

    except Exception as e:
        debug_print(f"\n--- OPTIMISATION FAILED ---")
        debug_print(f"ERROR: {str(e)}")
        import traceback

        traceback.print_exc()
        debug_print("=" * 80 + "\n")
        raise HTTPException(status_code=500, detail=f"Optimisation failed: {str(e)}")
