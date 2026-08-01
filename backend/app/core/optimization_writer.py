"""
Optimisation Result Writer

Writes optimiser results back to the database:
1. Updates task.optimised field with assigned persons, times, and locations
2. Creates Assignment records linking persons to tasks
"""
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from datetime import datetime

from app.models.task import Task
from app.models.assignment import Assignment, AssignmentSource


def write_optimization_results(
    db: Session,
    event_id: int,
    date: str,
    result: Dict[str, Any]
) -> None:
    """
    Write optimisation results to database.
    
    IMPORTANT: This function writes to BOTH task.optimised AND task.final fields.
    - task.optimised = Optimiser's original output (preserved, never changes)
    - task.final = Current schedule state (initially same as optimised)
    
    When user makes manual adjustments:
    - Only task.final is updated (preserves task.optimised)
    - User can "Reset to optimised" to copy optimised → final
    
    See OPTIMISATION_STRUCTURE.md for complete field separation:
    - task.constraints = INPUT (what to optimise)
    - task.optimised = OUTPUT (optimiser's solution, preserved)
    - task.final = CURRENT STATE (initially = optimised, can be edited)
    - task.additional = METADATA (never touched by optimiser)
    
    Args:
        db: Database session
        event_id: Event ID
        date: Date string (YYYY-MM-DD) - used for logging only
        result: Optimisation result with assignments and fatigue stats
        
    Side Effects:
        - Updates task.optimised AND task.final fields for each task
        - Creates Assignment records for person-task pairs
        - Deletes old optimiser assignments for this event
    """
    print(f"\n[Optimization Writer] Writing results for Event {event_id}, Date {date}")
    
    # Get all task IDs from the optimisation result
    task_ids_in_result = set()
    for assignment in result.get("assignments", []):
        task_ids_in_result.add(assignment["task_id"])
    
    if not task_ids_in_result:
        print("[Optimization Writer] WARNING: No task IDs found in optimisation result")
        return
    
    print(f"[Optimization Writer] Found {len(task_ids_in_result)} tasks in optimisation result")
    print(f"[Optimization Writer] Task IDs from optimiser: {list(task_ids_in_result)}")
    
    # Get these specific tasks from database
    tasks = db.query(Task).filter(
        Task.event_id == event_id,
        Task.id.in_(list(task_ids_in_result))
    ).all()
    
    print(f"[Optimization Writer] Found {len(tasks)} matching tasks in database")
    
    if len(tasks) == 0:
        # Debug: Check what tasks exist for this event
        all_event_tasks = db.query(Task.id, Task.title).filter(Task.event_id == event_id).all()
        print(f"[Optimization Writer] DEBUG: All task IDs for event {event_id}: {[(t.id, t.title) for t in all_event_tasks]}")
    
    if not tasks:
        print("[Optimization Writer] WARNING: No tasks found for this date")
        return
    
    # Get or create "optimizer" assignment source
    optimizer_source = db.query(AssignmentSource).filter(
        AssignmentSource.code == "optimizer"
    ).first()
    
    if not optimizer_source:
        print("[Optimization Writer] Creating 'optimizer' assignment source")
        optimizer_source = AssignmentSource(
            code="optimizer",
            name="Optimiser",
            description="Automated optimisation algorithm",
            color_hex="#9333EA",  # Purple
            is_active=True
        )
        db.add(optimizer_source)
        db.commit()
        db.refresh(optimizer_source)
    
    # Group assignments by task_id
    assignments_by_task: Dict[int, List[Dict[str, Any]]] = {}
    for assignment in result.get("assignments", []):
        task_id = assignment["task_id"]
        if task_id not in assignments_by_task:
            assignments_by_task[task_id] = []
        assignments_by_task[task_id].append(assignment)
    
    print(f"[Optimization Writer] Processing {len(assignments_by_task)} tasks with assignments")
    print(f"[Optimization Writer] Task IDs in assignments: {list(assignments_by_task.keys())}")
    
    # Update each task's optimised field
    updated_count = 0
    for task in tasks:
        print(f"[Optimization Writer] Processing task {task.id} (title: {task.title})")
        
        if task.id in assignments_by_task:
            task_assignments = assignments_by_task[task.id]
            print(f"[Optimization Writer]   Task {task.id} has {len(task_assignments)} assignments")
            
            # All assignments for a task should have same times and location
            first_assignment = task_assignments[0]
            print(f"[Optimization Writer]   First assignment: {first_assignment}")
            
            # Prepare optimisation result - COMPLETE structure with all fields
            # Frontend needs: assigned_persons, start_time, end_time, location
            optimization_result = {
                "assigned_persons": [a["person_id"] for a in task_assignments],
                "start_time": first_assignment["start_time"],
                "end_time": first_assignment["end_time"],
                "location": first_assignment["location_id"]
            }
            
            # Include per-field assignments if available
            # field_assignments is keyed by string task_id in the compute response
            all_field_assignments = result.get("field_assignments", {})
            task_field_map = all_field_assignments.get(str(task.id), {})
            if task_field_map:
                optimization_result["field_assignments"] = task_field_map
            
            print(f"[Optimization Writer]   Prepared result: {optimization_result}")
            print(f"[Optimization Writer]   BEFORE - task.optimised: {task.optimised}")
            print(f"[Optimization Writer]   BEFORE - task.final: {task.final}")
            
            # Write to BOTH task.optimised AND task.final
            # - task.optimised = Preserved original (never changes after optimisation)
            # - task.final = Current state (initially same, can be edited by user)
            task.optimised = optimization_result.copy()
            task.final = optimization_result.copy()
            updated_count += 1
            
            print(f"[Optimization Writer]   AFTER - task.optimised: {task.optimised}")
            print(f"[Optimization Writer]   AFTER - task.final: {task.final}")
            print(f"[Optimization Writer]   ✓ Updated task {task.id}: {len(task_assignments)} persons assigned")
        else:
            # Task has no assignments (e.g., floating task not scheduled)
            # Clear optimised field or leave as-is depending on requirements
            # For now, we'll leave it as-is to preserve old data on failure
            print(f"[Optimization Writer] Task {task.id} has no assignments (skipping)")
    
    print(f"[Optimization Writer] Updated {updated_count} tasks with optimised data")
    
    # Delete old optimiser assignments for these tasks
    task_ids = [t.id for t in tasks]
    deleted = db.query(Assignment).filter(
        Assignment.event_id == event_id,
        Assignment.task_id.in_(task_ids),
        Assignment.assignment_source_id == optimizer_source.id
    ).delete(synchronize_session=False)
    
    print(f"[Optimization Writer] Deleted {deleted} old optimiser assignments")
    
    # Create new Assignment records
    new_assignments = []
    for assignment in result.get("assignments", []):
        db_assignment = Assignment(
            event_id=event_id,
            person_id=assignment["person_id"],
            task_id=assignment["task_id"],
            assignment_source_id=optimizer_source.id,
            is_locked=False,
            meta_data={
                "fatigue_contributed": assignment.get("fatigue_contributed", 0),
                "start_time": assignment.get("start_time"),
                "end_time": assignment.get("end_time"),
                "location_id": assignment.get("location_id"),
                "optimization_date": datetime.utcnow().isoformat(),
                "solve_time": result.get("solve_time", 0)
            }
        )
        new_assignments.append(db_assignment)
    
    db.bulk_save_objects(new_assignments)
    
    print(f"[Optimization Writer] Created {len(new_assignments)} new Assignment records")
    
    # Commit all changes
    print(f"[Optimization Writer] *** COMMITTING TO DATABASE ***")
    print(f"[Optimization Writer] Summary: Updated {updated_count} tasks with optimised+final fields")
    db.commit()
    print(f"[Optimization Writer] ✓ Database commit successful")
    
    # Verify what was written
    print(f"[Optimization Writer] *** VERIFICATION: Re-reading tasks from database ***")
    verification_tasks = db.query(Task).filter(
        Task.event_id == event_id,
        Task.id.in_(list(task_ids_in_result))
    ).all()
    for vtask in verification_tasks[:3]:  # Show first 3
        print(f"[Optimization Writer] Task {vtask.id}: optimised={vtask.optimised}, final={vtask.final}")
    
    print(f"[Optimization Writer] Successfully wrote optimisation results\n")


def clear_optimization_results(
    db: Session,
    event_id: int,
    date: str
) -> None:
    """
    Clear optimisation results for a specific event.
    Useful for re-running optimisation or resetting to manual state.
    
    Args:
        db: Database session
        event_id: Event ID
        date: Date string (YYYY-MM-DD) - used for logging only
        
    Side Effects:
        - Clears task.optimised field for all tasks in this event
        - Deletes Assignment records from optimiser source
    """
    print(f"\n[Optimization Writer] Clearing results for Event {event_id}, Date {date}")
    
    # Get optimiser source
    optimizer_source = db.query(AssignmentSource).filter(
        AssignmentSource.code == "optimizer"
    ).first()
    
    if not optimizer_source:
        print("[Optimization Writer] No optimiser source found, nothing to clear")
        return
    
    # Get all tasks for this event
    tasks = db.query(Task).filter(
        Task.event_id == event_id
    ).all()
    
    # Clear optimised field
    for task in tasks:
        if task.optimised:
            task.optimised = None
    
    # Delete optimiser assignments
    task_ids = [t.id for t in tasks]
    deleted = db.query(Assignment).filter(
        Assignment.event_id == event_id,
        Assignment.task_id.in_(task_ids),
        Assignment.assignment_source_id == optimizer_source.id
    ).delete(synchronize_session=False)
    
    db.commit()
    
    print(f"[Optimization Writer] Cleared {len(tasks)} tasks and {deleted} assignments\n")
