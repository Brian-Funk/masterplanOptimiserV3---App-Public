"""
Fatigue-Based Optimisation using CP-SAT

This module optimises task assignments to minimise fatigue range across all persons.
Features:
- Task fatigue: Each task contributes fatigue based on duration and fatigue_per_minute rate
- Break recovery: Idle periods >= threshold provide fatigue recovery
- Task locking: Optional constraints to enforce continuity between tasks
- Hard coverage: All normal tasks must be fully covered
"""

from typing import Dict, List, Optional, Tuple, Set, Union, Any
from dataclasses import dataclass, field
from ortools.sat.python import cp_model
import time

from debug_logging import debug_print as print
from infeasibility_diagnostics import (
    AssumptionRegistry,
    DiagnosticIssue,
    core_fallback_issue,
    diagnostics_payload,
    legacy_message_issue,
    preflight_issues,
    task_requirement_issue,
)

# Import structures from flow_checker
from flow_checker import (
    NormPerson,
    NormTask,
    NormTransfer,
    NormFloatingTask,
    NormalizedFlowInput,
    TimeSegment,
    generate_time_segments,
    minutes_to_time_str,
)


@dataclass
class OptimizationConfig:
    """Configuration for fatigue optimisation."""
    scale: int = 100  # Scale fatigue floats to integers for CP-SAT
    break_threshold_min: int = 30  # Minimum minutes for a segment to count as a break
    break_effect: float = -0.5  # Fatigue recovery per minute of break (negative = reduces fatigue)
    max_time_seconds: float = 30.0  # Max solver time


class ProgressCallback(cp_model.CpSolverSolutionCallback):
    """Collects intermediate solution snapshots during CP-SAT search."""

    def __init__(self, scale: int):
        super().__init__()
        self._scale = scale
        self.snapshots: List[Dict[str, Any]] = []
        self._start = time.monotonic()

    def on_solution_callback(self):
        """Record solver objective and search metadata for progress polling."""
        self.snapshots.append({
            "solution_count": len(self.snapshots) + 1,
            "objective_value": self.ObjectiveValue() / self._scale,
            "best_bound": self.BestObjectiveBound() / self._scale,
            "wall_time": round(time.monotonic() - self._start, 2),
            "num_conflicts": self.NumConflicts(),
            "num_branches": self.NumBranches(),
        })


@dataclass
class OptimizationResult:
    """Result of optimisation."""
    status: str  # "OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"
    assignments: Dict[int, List[int]]  # task_id -> list of person_ids assigned
    capability_assignments: Dict[Tuple[int, str], List[int]]  # (task_id, capability) -> list of person_ids
    fatigue_per_person: Dict[int, float]  # person_id -> fatigue value
    breaks_per_person: Dict[int, int]  # person_id -> number of breaks
    fatigue_min: float
    fatigue_max: float
    fatigue_range: float
    solve_time: float
    errors: List[str]
    transfer_assignments: Dict[int, List[int]] = None  # transfer_id -> list of person_ids boarding
    task_details: Dict[Union[int, str], Dict[str, Any]] = None  # task_id -> {start_time, end_time, location_id, original_id}
    field_assignments: Dict[int, Dict[str, List[int]]] = None  # task/transfer_id -> {field_id -> [person_ids]}
    progress_snapshots: List[Dict[str, Any]] = None  # Intermediate solution snapshots
    diagnostics: Dict[str, Any] = None  # Versioned, structured feasibility explanation


def optimize_with_fatigue(
    normalized_input: NormalizedFlowInput,
    config: OptimizationConfig = None,
    callback: ProgressCallback = None,
) -> OptimizationResult:
    """
    Optimise task assignments to minimise fatigue range across all persons.
    
    Args:
        normalized_input: NormalisedFlowInput with persons, tasks, transfers, floating_tasks
        config: Optimisation configuration
        callback: Optional external ProgressCallback for live progress tracking
    
    Returns:
        OptimizationResult with assignments and fatigue analysis
    """
    if config is None:
        config = OptimizationConfig()
    
    SCALE = config.scale
    BREAK_THRESHOLD_MIN = config.break_threshold_min
    BREAK_EFFECT_PER_MIN = config.break_effect  # recovery per minute of break
    
    errors = []
    
    print("=" * 80)
    print("FATIGUE OPTIMISER - CP-SAT")
    print("=" * 80)
    print(f"Config: scale={SCALE}, break_threshold={BREAK_THRESHOLD_MIN}min, break_effect_per_min={BREAK_EFFECT_PER_MIN}")
    
    # Extract data
    persons = normalized_input.persons
    tasks = list(normalized_input.tasks)  # Make a copy since we'll extend it
    transfers = normalized_input.transfers
    floating_tasks = getattr(normalized_input, "floating_tasks", [])

    preflight = preflight_issues(normalized_input)
    if preflight:
        return _empty_result(
            "INFEASIBLE",
            0.0,
            [issue.message for issue in preflight],
            persons,
            diagnostics_payload("invalid_input", preflight),
        )
    
    if not tasks and not transfers and not floating_tasks:
        return _empty_result(
            "OPTIMAL", 0.0, [], persons, diagnostics_payload("feasible", [])
        )
    
    # Generate time segments
    segments = generate_time_segments(tasks, transfers, floating_tasks)
    
    print(f"\n--- TIME SEGMENTS ({len(segments)}) ---")
    for i, seg in enumerate(segments):
        duration = seg.end_time - seg.start_time
        print(f"Segment {i}: {minutes_to_time_str(seg.start_time)}-{minutes_to_time_str(seg.end_time)} ({duration}min)")
    
    # === EXPAND FLOATING TASKS ===
    floating_candidates: Dict[int, List[int]] = {}
    original_num_tasks = len(tasks)
    
    if floating_tasks:
        print(f"\n--- EXPANDING {len(floating_tasks)} FLOATING TASKS ---")
    
    for ft_idx, ft in enumerate(floating_tasks):
        floating_candidates[ft_idx] = []
        
        for s_idx, seg in enumerate(segments):
            seg_start = seg.start_time
            seg_end = seg.end_time
            seg_len = seg_end - seg_start
            
            # Check if task can fit starting at this segment
            # Task must start at or after window_start
            if seg_start < ft.window_start_time:
                continue
            
            # Task must end at or before window_end
            if seg_start + ft.duration > ft.window_end_time:
                continue
            
            # Create candidate task with UNIQUE ID to avoid collisions in assignments dict
            # We'll store the original floating task ID separately for tracking
            candidate_task_id = f"{ft.id}_cand_{s_idx}"  # e.g., "1770042197058_cand_3"
            
            candidate_task = NormTask(
                id=candidate_task_id,
                name=f"{ft.name} [floating@seg{s_idx}]",
                location_id=ft.location_id,
                start_time=seg_start,
                end_time=seg_start + ft.duration,
                requirements=dict(ft.requirements),
                preassigned_person_ids=ft.preassigned_person_ids,
                counts_towards_work_time=(
                    getattr(ft, "counts_towards_work_time", True) is not False
                ),
            )
            
            # Store original floating task ID as an attribute for response mapping
            candidate_task.original_floating_task_id = ft.id
            
            # Copy fatigue_per_minute if floating task has it
            if hasattr(ft, 'fatigue_per_minute'):
                candidate_task.fatigue_per_minute = ft.fatigue_per_minute
            
            tasks.append(candidate_task)
            new_task_idx = len(tasks) - 1
            floating_candidates[ft_idx].append(new_task_idx)
            print(f"  '{ft.name}' -> candidate at seg{s_idx}: task[{new_task_idx}]")
        
        if not floating_candidates[ft_idx]:
            errors.append(f"Floating task '{ft.name}' has no feasible time slot")
    
    # Early return if any floating task has no feasible candidates
    if errors:
        issues = [legacy_message_issue(message, normalized_input) for message in errors]
        return _empty_result(
            "INFEASIBLE",
            0.0,
            errors,
            persons,
            diagnostics_payload("infeasible", issues),
        )
    
    # Validate: Tasks without capability requirements must have preassigned people
    for task in tasks:
        has_requirements = task.requirements and any(count > 0 for count in task.requirements.values())
        has_preassigned = task.preassigned_person_ids and len(task.preassigned_person_ids) > 0
        
        if not has_requirements and not has_preassigned:
            errors.append(f"Task '{task.name}' has no capability requirements and no preassigned people")
    
    if errors:
        issues = [legacy_message_issue(message, normalized_input) for message in errors]
        return _empty_result(
            "INFEASIBLE",
            0.0,
            errors,
            persons,
            diagnostics_payload("invalid_input", issues),
        )
    
    # Build reverse map: task_idx -> floating task index
    task_to_floating: Dict[int, int] = {}
    for ft_idx, cand_task_indices in floating_candidates.items():
        for t_idx in cand_task_indices:
            task_to_floating[t_idx] = ft_idx
    
    # Rebuild segment task indices
    # A task is active in a segment if the segment STARTS during the task's execution
    # This matches flow_checker.py's logic: task.start_time <= segment_start < task.end_time
    for seg in segments:
        seg.task_indices = []
    
    for t_idx, task in enumerate(tasks):
        for s_idx, seg in enumerate(segments):
            # Task is active if segment starts during task execution
            if task.start_time <= seg.start_time < task.end_time:
                seg.task_indices.append(t_idx)
    
    # === COLLECT CAPABILITIES AND LOCATIONS ===
    all_capabilities = set()
    all_locations = set()
    
    for person in persons:
        all_capabilities.update(person.capabilities)
        if person.home_location_id is not None:
            all_locations.add(person.home_location_id)
    
    for task in tasks:
        all_capabilities.update(task.requirements.keys())
        if task.location_id is not None:
            all_locations.add(task.location_id)
        if hasattr(task, 'from_location_id') and task.from_location_id is not None:
            all_locations.add(task.from_location_id)
        if hasattr(task, 'to_location_id') and task.to_location_id is not None:
            all_locations.add(task.to_location_id)
    
    for transfer in transfers:
        all_capabilities.update(transfer.requirements.keys())
        all_locations.add(transfer.from_location_id)
        all_locations.add(transfer.to_location_id)
    
    capabilities = sorted(all_capabilities)
    locations = sorted(all_locations)
    
    # Create index mappings
    person_to_idx = {p.id: i for i, p in enumerate(persons)}
    capability_to_idx = {c: i for i, c in enumerate(capabilities)}
    location_to_idx = {loc: i for i, loc in enumerate(locations)}
    idx_to_location = {i: loc for i, loc in enumerate(locations)}
    
    num_persons = len(persons)
    num_tasks = len(tasks)
    num_capabilities = len(capabilities)
    num_locations = len(locations)
    num_segments = len(segments)
    num_transfers = len(transfers)
    
    print(f"\n--- PROBLEM SIZE ---")
    print(f"Persons: {num_persons}, Tasks: {num_tasks}, Transfers: {num_transfers}")
    print(f"Capabilities: {num_capabilities}, Locations: {num_locations}, Segments: {num_segments}")
    
    print(f"\n--- DEBUG: CAPABILITIES ---")
    print(f"All capabilities found: {capabilities}")
    print(f"Capability to index mapping: {capability_to_idx}")
    
    print(f"\n--- DEBUG: PERSON CAPABILITIES ---")
    for p_idx, person in enumerate(persons):
        print(f"Person {person.id} ({person.home_location_id if hasattr(person, 'home_location_id') else 'N/A'}): {person.capabilities}")
    
    # Map task to all segments it spans - using flow_checker logic
    task_segments: Dict[int, List[int]] = {}
    for t_idx, task in enumerate(tasks):
        task_segments[t_idx] = []
        for s_idx, seg in enumerate(segments):
            # Use flow_checker logic: task is active if segment starts during task execution
            if task.start_time <= seg.start_time < task.end_time:
                task_segments[t_idx].append(s_idx)
    
    print(f"\n--- DEBUG: TASK SEGMENT MAPPING ---")
    for t_idx, task in enumerate(tasks):
        print(f"Task {t_idx} ({task.name}): spans segments {task_segments[t_idx]} (start: {task.start_time}, end: {task.end_time})")
    
    # Availability matrix
    availability = [[True for _ in range(num_segments)] for _ in range(num_persons)]
    
    for p_idx, person in enumerate(persons):
        for s_idx, seg in enumerate(segments):
            seg_start = seg.start_time
            seg_end = seg.end_time
            for (ua_start, ua_end) in getattr(person, 'unavailable_intervals', []):
                if ua_start < seg_end and seg_start < ua_end:
                    availability[p_idx][s_idx] = False
                    break
    
    # Debug: print availability matrix (if there's unavailability)
    if any(hasattr(p, 'unavailable_intervals') and p.unavailable_intervals for p in persons):
        print("\n--- AVAILABILITY MATRIX ---")
        for p_idx, person in enumerate(persons):
            avail_str = ", ".join([f"Seg{s}:{'Y' if availability[p_idx][s] else 'N'}" for s in range(num_segments)])
            print(f"Person {person.id}: {avail_str}")
            if hasattr(person, 'unavailable_intervals') and person.unavailable_intervals:
                print(f"  Unavailable: {person.unavailable_intervals}")
    
    # Calculate task fatigue costs
    task_fatigue_cost = []
    for t_idx, task in enumerate(tasks):
        duration = task.end_time - task.start_time
        fatigue_rate = getattr(task, 'fatigue_per_minute', 0.0)
        cost = round(fatigue_rate * duration * SCALE)
        task_fatigue_cost.append(cost)
    
    print(f"\n--- FATIGUE COSTS ---")
    print(f"Task fatigue costs: min={min(task_fatigue_cost) if task_fatigue_cost else 0}, max={max(task_fatigue_cost) if task_fatigue_cost else 0}")

    # Pre-compute per-segment break recovery costs (scaled integers).
    # Each segment that qualifies as a break recovers proportional to its duration.
    break_cost_per_seg = []
    for seg in segments:
        seg_dur = seg.end_time - seg.start_time
        if seg_dur >= BREAK_THRESHOLD_MIN:
            break_cost_per_seg.append(round(BREAK_EFFECT_PER_MIN * seg_dur * SCALE))
        else:
            break_cost_per_seg.append(0)
    print(f"Break recovery/min: {BREAK_EFFECT_PER_MIN} (threshold {BREAK_THRESHOLD_MIN}min)")
    if break_cost_per_seg:
        non_zero = [c for c in break_cost_per_seg if c != 0]
        if non_zero:
            print(f"Break segment costs (non-zero): min={min(non_zero)}, max={max(non_zero)}")
    
    # === BUILD CP-SAT MODEL ===
    model = cp_model.CpModel()
    assumptions = AssumptionRegistry(model)
    
    # Decision variables
    x = {}  # x[p,t,c]: person p covers capability c for task t
    for p in range(num_persons):
        for t in range(num_tasks):
            for c in range(num_capabilities):
                x[p, t, c] = model.NewBoolVar(f'x_p{p}_t{t}_c{c}')
    
    assigned = {}  # assigned[p,t]: person p is assigned (organizer) for task t
    for p in range(num_persons):
        for t in range(num_tasks):
            assigned[p, t] = model.NewBoolVar(f'assigned_p{p}_t{t}')
    
    z = {}  # z[p,s,l]: person p is at location l in segment s
    for p in range(num_persons):
        for s in range(num_segments):
            for l in range(num_locations):
                z[p, s, l] = model.NewBoolVar(f'z_p{p}_s{s}_l{l}')
    
    y = {}  # y[p,k]: person p uses transfer k
    for p in range(num_persons):
        for k in range(num_transfers):
            y[p, k] = model.NewBoolVar(f'y_p{p}_k{k}')
    
    task_fully_covered = []  # task_fully_covered[t]: task t has all requirements satisfied
    for t in range(num_tasks):
        var = model.NewBoolVar(f'task_fully_covered_{t}')
        task_fully_covered.append(var)
    
    float_choice = {}  # float_choice[ft_idx, t_idx]: choose which candidate for floating task
    for ft_idx, cand_task_indices in floating_candidates.items():
        for t_idx in cand_task_indices:
            float_choice[ft_idx, t_idx] = model.NewBoolVar(f'float_choice_ft{ft_idx}_t{t_idx}')
    
    # === CREATE TASK_ACTIVE VARIABLES ===
    # These indicate whether a person is working on a task in a specific segment
    # (either assigned or providing a capability for that task)
    task_active_vars = {}  # (p, s_idx, t_idx) -> BoolVar
    
    for p in range(num_persons):
        for s_idx, segment in enumerate(segments):
            for t_idx in segment.task_indices:
                activity_vars = [assigned[p, t_idx]]
                for c in range(num_capabilities):
                    activity_vars.append(x[p, t_idx, c])
                
                # Create a boolean: is person working on this task in this segment?
                task_active = model.NewBoolVar(f'task_active_p{p}_s{s_idx}_t{t_idx}')
                # task_active is 1 if any of the activity vars for this task is 1
                model.AddMaxEquality(task_active, activity_vars)
                task_active_vars[(p, s_idx, t_idx)] = task_active
    
    task_durations = [task.end_time - task.start_time for task in tasks]
    transfer_durations = []
    for transfer in transfers:
        duration = transfer.arrive_time - transfer.depart_time
        if duration < 0:
            duration += 24 * 60
        transfer_durations.append(max(0, duration))
    
    working = {}  # working[p,t]: person p works on task t (in any segment)
    for p in range(num_persons):
        for t in range(num_tasks):
            working[p, t] = model.NewBoolVar(f'working_p{p}_t{t}')
    
    # Link working to task_active across all segments
    # Person works on a task if they're active on it in ANY segment it spans
    for p in range(num_persons):
        for t in range(num_tasks):
            task_active_for_this_task = []
            for s_idx, segment in enumerate(segments):
                if t in segment.task_indices and (p, s_idx, t) in task_active_vars:
                    task_active_for_this_task.append(task_active_vars[(p, s_idx, t)])
            
            if task_active_for_this_task:
                # working is true if task_active in any segment
                model.AddMaxEquality(working[p, t], task_active_for_this_task)
            else:
                model.Add(working[p, t] == 0)
    
    # Total work time per person
    work_task_durations = [
        duration
        if getattr(task, "counts_towards_work_time", True) is not False
        else 0
        for task, duration in zip(tasks, task_durations)
    ]
    work_transfer_durations = [
        duration
        if getattr(transfer, "counts_towards_work_time", True) is not False
        else 0
        for transfer, duration in zip(transfers, transfer_durations)
    ]
    max_possible_time = (sum(work_task_durations) if work_task_durations else 0) + (
        sum(work_transfer_durations) if work_transfer_durations else 0
    )
    work_time = {}
    for p in range(num_persons):
        work_time[p] = model.NewIntVar(0, max_possible_time, f'work_time_p{p}')
        model.Add(
            work_time[p] ==
            sum(work_task_durations[t] * working[p, t] for t in range(num_tasks)) +
            sum(work_transfer_durations[k] * y[p, k] for k in range(num_transfers))
        )
    
    # Enforce maximum work time per person
    for p_idx, person in enumerate(persons):
        if hasattr(person, 'max_work_minutes_per_day') and person.max_work_minutes_per_day is not None:
            model.Add(work_time[p_idx] <= int(person.max_work_minutes_per_day))
    
    # === IDLE AND BREAK VARIABLES ===
    idle = {}  # idle[p,s]: person p is idle (available but not working) in segment s
    for p in range(num_persons):
        for s in range(num_segments):
            idle[p, s] = model.NewBoolVar(f'idle_p{p}_s{s}')
    
    break_seg = {}  # break_seg[p,s]: segment s counts as a break for person p
    for p in range(num_persons):
        for s in range(num_segments):
            break_seg[p, s] = model.NewBoolVar(f'break_p{p}_s{s}')
    
    print("\n--- ADDING CONSTRAINTS ---")
    
    # === INITIAL LOCATION ===
    print("\n--- DEBUG: INITIAL LOCATION CONSTRAINTS ---")
    if num_segments > 0:
        first_seg_start = segments[0].start_time
        for p_idx, person in enumerate(persons):
            # Check if person had unavailability before first segment
            had_unavailability_before = False
            for (ua_start, ua_end) in getattr(person, "unavailable_intervals", []):
                if ua_end <= first_seg_start:
                    had_unavailability_before = True
                    break
            
            # Check if preassigned in first segment
            preassigned_first_loc = None
            for t_idx, task in enumerate(tasks):
                if person.id in task.preassigned_person_ids and t_idx in segments[0].task_indices:
                    preassigned_first_loc = task.location_id
                    break
            
            if preassigned_first_loc is not None:
                task_loc_idx = location_to_idx[preassigned_first_loc]
                model.Add(z[p_idx, 0, task_loc_idx] == 1)
                print(f"  Person {person.id}: Fixed to location {preassigned_first_loc} (idx {task_loc_idx}) - preassigned")
            elif not had_unavailability_before and person.home_location_id is not None and person.home_location_id in location_to_idx:
                home_loc_idx = location_to_idx[person.home_location_id]
                model.Add(z[p_idx, 0, home_loc_idx] == 1)
                print(f"  Person {person.id}: Fixed to home location {person.home_location_id} (idx {home_loc_idx})")
            else:
                print(f"  Person {person.id}: No initial location constraint (had_unavail={had_unavailability_before}, home={person.home_location_id})")
    print("[OK] Initial locations")
    
    # === ONE LOCATION PER SEGMENT ===
    for p in range(num_persons):
        for s in range(num_segments):
            if availability[p][s]:
                # Person must be at exactly one location when available
                model.Add(sum(z[p, s, l] for l in range(num_locations)) == 1)
            else:
                # Person is unavailable - they can be at any location or none
                # (we could force them to 0 locations, but allowing any is more flexible)
                model.Add(sum(z[p, s, l] for l in range(num_locations)) <= 1)
    print("[OK] One location per segment")
    
    # === LOCATION PROPAGATION ===
    for p in range(num_persons):
        for s in range(1, num_segments):
            for l in range(num_locations):
                if availability[p][s-1] and availability[p][s]:
                    # Find incoming transfers
                    incoming_transfers = []
                    for k, transfer in enumerate(transfers):
                        to_loc_idx = location_to_idx[transfer.to_location_id]
                        if to_loc_idx == l and segments[s].start_time == transfer.arrive_time:
                            incoming_transfers.append(k)
                    
                    # Find incoming moving tasks
                    incoming_moving_tasks = []
                    for t_idx, task in enumerate(tasks):
                        if hasattr(task, 'to_location_id') and task.to_location_id is not None:
                            to_loc_idx = location_to_idx[task.to_location_id]
                            if to_loc_idx == l and segments[s].start_time == task.end_time:
                                incoming_moving_tasks.append(t_idx)
                    
                    model.Add(
                        z[p, s, l] <= z[p, s-1, l] + 
                        sum(y[p, k] for k in incoming_transfers) +
                        sum(working[p, t] for t in incoming_moving_tasks)
                    )
    print("[OK] Location propagation")
    
    # === TRANSFER CONSTRAINTS ===
    for p_idx, person in enumerate(persons):
        for k, transfer in enumerate(transfers):
            depart_segment = None
            arrive_segment = None
            for s_idx, seg in enumerate(segments):
                if seg.start_time == transfer.depart_time:
                    depart_segment = s_idx
                if seg.start_time == transfer.arrive_time:
                    arrive_segment = s_idx
            
            if depart_segment is not None:
                from_loc_idx = location_to_idx[transfer.from_location_id]
                to_loc_idx = location_to_idx[transfer.to_location_id]
                
                model.Add(y[p_idx, k] <= z[p_idx, depart_segment, from_loc_idx])
                
                if arrive_segment is not None:
                    model.Add(z[p_idx, arrive_segment, to_loc_idx] >= y[p_idx, k])
                
                if not availability[p_idx][depart_segment]:
                    model.Add(y[p_idx, k] == 0)
                if arrive_segment is not None and not availability[p_idx][arrive_segment]:
                    model.Add(y[p_idx, k] == 0)
    print("[OK] Transfer boarding")
    
    # === TRANSFER CAPACITY ===
    for k, transfer in enumerate(transfers):
        locked_person_indices = [
            person_to_idx[person_id]
            for person_id in getattr(transfer, "locked_person_ids", [])
            if person_id in person_to_idx
        ]
        if locked_person_indices:
            print(
                f"  Transfer {transfer.id}: Direct passengers locked to: "
                f"{getattr(transfer, 'locked_person_ids', [])}"
            )
            for p_idx in locked_person_indices:
                model.Add(y[p_idx, k] == 1)

        if hasattr(transfer, 'capacity') and transfer.capacity is not None and transfer.capacity < 999:
            model.Add(sum(y[p, k] for p in range(num_persons)) <= transfer.capacity)
        
        for cap_name, count in transfer.requirements.items():
            if cap_name in capability_to_idx and count > 0:
                people_with_cap = [p for p in range(num_persons) if cap_name in persons[p].capabilities]
                if people_with_cap:
                    model.Add(sum(y[p, k] for p in people_with_cap) >= count)
    print("[OK] Transfer capacity")
    
    # === TASK FEASIBILITY ===
    # Any-location auxiliary variables (solver chooses location)
    task_loc_choice = {}
    any_location_task_indices = [t_idx for t_idx, task in enumerate(tasks)
                                 if task.location_id is None
                                 and not (hasattr(task, 'from_location_id') and task.from_location_id is not None
                                          and hasattr(task, 'to_location_id') and task.to_location_id is not None)]

    for t_idx in any_location_task_indices:
        for l in range(num_locations):
            task_loc_choice[t_idx, l] = model.NewBoolVar(f'task_loc_choice_t{t_idx}_l{l}')
        # Task takes place at exactly one location if covered
        model.Add(
            sum(task_loc_choice[t_idx, l] for l in range(num_locations))
            == task_fully_covered[t_idx]
        )
    print(f"[OK] Any-location variables for {len(any_location_task_indices)} tasks")

    print("\n--- DEBUG: TASK FEASIBILITY CONSTRAINTS ---")
    for p_idx, person in enumerate(persons):
        for t_idx, task in enumerate(tasks):
            if not task_segments[t_idx]:
                continue
            
            if hasattr(task, 'from_location_id') and task.from_location_id is not None and hasattr(task, 'to_location_id') and task.to_location_id is not None:
                # Moving task: fixed from_location
                from_loc_idx = location_to_idx[task.from_location_id]
                task_loc_idx = from_loc_idx
                
                for c_idx, cap_name in enumerate(capabilities):
                    has_cap = 1 if cap_name in person.capabilities else 0
                    model.Add(x[p_idx, t_idx, c_idx] <= has_cap)
                    for seg_idx in task_segments[t_idx]:
                        model.Add(x[p_idx, t_idx, c_idx] <= z[p_idx, seg_idx, task_loc_idx])
                        if not availability[p_idx][seg_idx]:
                            model.Add(x[p_idx, t_idx, c_idx] == 0)
            elif task.location_id is not None:
                # Regular task with fixed location
                task_loc_idx = location_to_idx[task.location_id]
                
                # Debug for first task only
                if t_idx == 0 and p_idx < 3:
                    print(f"Person {p_idx} (ID {person.id}) for Task {t_idx}:")
                    print(f"  Task location: {task.location_id}, Task loc_idx: {task_loc_idx}")
                    print(f"  Task segments: {task_segments[t_idx]}")
                
                for c_idx, cap_name in enumerate(capabilities):
                    has_cap = 1 if cap_name in person.capabilities else 0
                    model.Add(x[p_idx, t_idx, c_idx] <= has_cap)
                    for seg_idx in task_segments[t_idx]:
                        model.Add(x[p_idx, t_idx, c_idx] <= z[p_idx, seg_idx, task_loc_idx])
                        if not availability[p_idx][seg_idx]:
                            model.Add(x[p_idx, t_idx, c_idx] == 0)
            else:
                # Any-location task: person must be at whichever location the solver picks
                for c_idx, cap_name in enumerate(capabilities):
                    has_cap = 1 if cap_name in person.capabilities else 0
                    model.Add(x[p_idx, t_idx, c_idx] <= has_cap)
                    for seg_idx in task_segments[t_idx]:
                        if not availability[p_idx][seg_idx]:
                            model.Add(x[p_idx, t_idx, c_idx] == 0)
                        else:
                            for l in range(num_locations):
                                # x[p,t,c] AND task_loc_choice[t,l] => z[p,seg,l]
                                model.Add(
                                    x[p_idx, t_idx, c_idx] + task_loc_choice[t_idx, l] - 1
                                    <= z[p_idx, seg_idx, l]
                                )
    print("[OK] Capability & location consistency (with any-location support)")
    
    # === TASK MOVEMENT ===
    for p in range(num_persons):
        for t_idx, task in enumerate(tasks):
            if hasattr(task, 'from_location_id') and task.from_location_id is not None and hasattr(task, 'to_location_id') and task.to_location_id is not None:
                if not task_segments[t_idx]:
                    continue
                
                task_start_segment = task_segments[t_idx][0]
                from_loc_idx = location_to_idx[task.from_location_id]
                to_loc_idx = location_to_idx[task.to_location_id]
                
                model.Add(working[p, t_idx] <= z[p, task_start_segment, from_loc_idx])
                
                end_segment = None
                for s_idx, seg in enumerate(segments):
                    if seg.start_time == task.end_time:
                        end_segment = s_idx
                        break
                
                if end_segment is not None:
                    model.Add(z[p, end_segment, to_loc_idx] >= working[p, t_idx])
    print("[OK] Task movement")
    
    # === CAPABILITY REQUIREMENTS ===
    required_count = {}
    for t_idx, task in enumerate(tasks):
        required_count[t_idx] = {}
        print(f"[DEBUG] Task {t_idx} ({task.name}): requirements = {task.requirements}")
        for cap_name, req in task.requirements.items():
            print(f"[DEBUG]   Capability '{cap_name}' requires {req} persons")
            if cap_name in capability_to_idx:
                c_idx = capability_to_idx[cap_name]
                required_count[t_idx][c_idx] = req
                print(f"[DEBUG]   Mapped to capability index {c_idx}")
            else:
                print(f"[DEBUG]   WARNING: Capability '{cap_name}' not found in capability_to_idx!")
                print(f"[DEBUG]   Available capabilities: {list(capability_to_idx.keys())}")
    
    print(f"[DEBUG] required_count mapping: {required_count}")
    
    print(f"\n[DEBUG] Adding capability constraints:")
    for t in range(num_tasks):
        for c in range(num_capabilities):
            req = required_count.get(t, {}).get(c, 0)
            if req > 0:
                cap_name = capabilities[c]
                # Count how many persons have this capability
                eligible_persons = sum(1 for p in range(num_persons) if cap_name in persons[p].capabilities)
                print(f"  Task {t}, Cap {c} ('{cap_name}'): requires {req} persons, {eligible_persons} persons have it")
                # Exactly req persons must provide this capability (not more, not less)
                model.Add(sum(x[p, t, c] for p in range(num_persons)) == req * task_fully_covered[t])
            else:
                # If no capability required, no one should provide it
                for p in range(num_persons):
                    model.Add(x[p, t, c] == 0)
    
    # Tasks with no capability requirements are automatically fully covered
    # UNLESS they are floating task candidates (which are covered only if chosen)
    for t in range(num_tasks):
        if t not in task_to_floating and all(required_count.get(t, {}).get(c, 0) == 0 for c in range(num_capabilities)):
            model.Add(task_fully_covered[t] == 1)
    
    # For tasks with no requirements, link task_fully_covered to someone being assigned
    # (This ensures tasks without capability requirements still need a preassigned person)
    # Skip floating task candidates as they're handled by float_choice constraints
    for t in range(num_tasks):
        if t not in task_to_floating and all(required_count.get(t, {}).get(c, 0) == 0 for c in range(num_capabilities)):
            # At least one person must be assigned if task is covered
            model.Add(sum(assigned[p, t] for p in range(num_persons)) >= task_fully_covered[t])
    
    # === PERSON CAN FILL AT MOST ONE CAPABILITY SLOT PER TASK ===
    # Each person can provide at most one capability for a given task.
    # This ensures that a person with multiple capabilities (e.g., is_ho AND is_nurse)
    # cannot fill two separate capability slots on the same task.
    for p in range(num_persons):
        for t in range(num_tasks):
            model.Add(sum(x[p, t, c] for c in range(num_capabilities)) <= 1)
    print("[OK] At most one capability slot per person per task")

    # NOTE: 'assigned' and capability provision (x) are INDEPENDENT
    # - assigned[p,t] = 1: person is preassigned (doesn't count toward capability requirements)
    # - x[p,t,c] = 1: person provides capability c (fills capability requirements)
    # - A preassigned person can also provide capabilities, but doesn't have to
    # - Preassigned persons don't count toward the capability requirement sum
    print("[OK] Capability requirements")
    
    # === FLOATING TASK CONSTRAINTS ===
    for ft_idx, cand_task_indices in floating_candidates.items():
        if cand_task_indices:
            model.Add(sum(float_choice[ft_idx, t_idx] for t_idx in cand_task_indices) == 1)
    
    for ft_idx, cand_task_indices in floating_candidates.items():
        for t_idx in cand_task_indices:
            choice_var = float_choice[ft_idx, t_idx]
            
            for p in range(num_persons):
                model.Add(assigned[p, t_idx] <= choice_var)
                for c in range(num_capabilities):
                    model.Add(x[p, t_idx, c] <= choice_var)
            
            model.Add(task_fully_covered[t_idx] == choice_var)
    print("[OK] Floating task constraints")
    
    # === ASSIGNED PERSON CONSTRAINTS ===
    # 'assigned' is ONLY for directly preassigned persons.
    # If a user selected people for a task, that direct assignment is exact:
    # selected people must be assigned, and everyone else must not be assigned
    # through the direct assignment variable.
    for t_idx, task in enumerate(tasks):
        # For floating task candidates, handle them based on preassigned persons
        if t_idx in task_to_floating:
            # If floating task has NO preassigned persons, no one can be assigned
            # (they can only participate via capability provision x[p,t,c])
            if len(task.preassigned_person_ids) == 0:
                model.Add(sum(assigned[p, t_idx] for p in range(num_persons)) == 0)
            # If floating task has preassigned persons, exact assignment is
            # handled below once candidates are grouped by floating task.
            continue
            
        valid_preassigned = {
            person_to_idx[person_id]
            for person_id in task.preassigned_person_ids
            if person_id in person_to_idx
        }

        if not task.preassigned_person_ids:
            # No one can be assigned if there are no preassigned persons
            model.Add(sum(assigned[p, t_idx] for p in range(num_persons)) == 0)
        else:
            print(f"  Task {task.id} ({task.name}): Direct assignments locked to: {task.preassigned_person_ids}")
            for p in range(num_persons):
                model.Add(assigned[p, t_idx] == (1 if p in valid_preassigned else 0))
    print("[OK] Exact direct assignments")
    
    # === PREASSIGNED TASKS ===
    floating_preassigned: Dict[int, List[int]] = {}
    
    for t_idx, task in enumerate(tasks):
        if task.preassigned_person_ids:
            if t_idx in task_to_floating:
                ft_idx = task_to_floating[t_idx]
                if ft_idx not in floating_preassigned:
                    floating_preassigned[ft_idx] = []
                    for person_id in task.preassigned_person_ids:
                        if person_id in person_to_idx:
                            floating_preassigned[ft_idx].append(person_to_idx[person_id])
            else:
                for person_id in task.preassigned_person_ids:
                    if person_id in person_to_idx:
                        p_fixed = person_to_idx[person_id]
                        model.Add(assigned[p_fixed, t_idx] == 1)
    
    # For floating tasks with preassigned persons:
    # The preassigned person must be assigned to the chosen candidate
    # AND only preassigned persons can be assigned (others must be 0)
    for ft_idx, preassigned_persons in floating_preassigned.items():
        cand_task_indices = floating_candidates[ft_idx]
        original_task = tasks[cand_task_indices[0]]
        print(
            f"  Floating task {original_task.id} ({original_task.name}): "
            f"Direct assignments locked to: {original_task.preassigned_person_ids}"
        )
        for p_fixed in preassigned_persons:
            # For each candidate: if chosen, preassigned person must be assigned to it
            for t_idx in cand_task_indices:
                model.Add(assigned[p_fixed, t_idx] == float_choice[ft_idx, t_idx])
        
        # For non-preassigned persons, they cannot be assigned to this floating task
        for t_idx in cand_task_indices:
            for p in range(num_persons):
                if p not in preassigned_persons:
                    model.Add(assigned[p, t_idx] == 0)
    print("[OK] Preassigned tasks")
    
    # === ASSIGNED PERSON LOCATION ===
    for p in range(num_persons):
        for t_idx, task in enumerate(tasks):
            if not task_segments[t_idx]:
                continue
            
            if hasattr(task, 'from_location_id') and task.from_location_id is not None:
                task_loc_idx = location_to_idx[task.from_location_id]
                for seg_idx in task_segments[t_idx]:
                    model.Add(assigned[p, t_idx] <= z[p, seg_idx, task_loc_idx])
                    if not availability[p][seg_idx]:
                        model.Add(assigned[p, t_idx] == 0)
            elif task.location_id is not None:
                task_loc_idx = location_to_idx[task.location_id]
                for seg_idx in task_segments[t_idx]:
                    model.Add(assigned[p, t_idx] <= z[p, seg_idx, task_loc_idx])
                    if not availability[p][seg_idx]:
                        model.Add(assigned[p, t_idx] == 0)
            else:
                # Any-location task: assigned person must be at whichever location the solver picks
                for seg_idx in task_segments[t_idx]:
                    if not availability[p][seg_idx]:
                        model.Add(assigned[p, t_idx] == 0)
                    else:
                        for l in range(num_locations):
                            model.Add(
                                assigned[p, t_idx] + task_loc_choice[t_idx, l] - 1
                                <= z[p, seg_idx, l]
                            )
    print("[OK] Assigned person location (with any-location support)")
    
    # === ASSIGNED SEPARATE FROM CAPABILITY ===
    # Preassigned persons CANNOT also fill capability slots.
    # This ensures 1 assigned person + 1 capability requirement = 2 distinct people.
    for t_idx, task in enumerate(tasks):
        if task.preassigned_person_ids:
            for person_id in task.preassigned_person_ids:
                if person_id in person_to_idx:
                    p_fixed = person_to_idx[person_id]
                    for c in range(num_capabilities):
                        model.Add(x[p_fixed, t_idx, c] == 0)
    print("[OK] Assigned separate from capability")
    
    # === NO DOUBLE-BOOKING ===
    # Use the task_active variables created earlier
    # Person can be active in at most one task/transfer per segment
    # (task_active collapses assigned + all x vars for the same task into one boolean,
    #  so a preassigned person providing a capability still counts as one activity.
    #  The per-task constraint "sum(x[p,t,c]) <= 1" above already prevents one person
    #  from filling multiple capability slots on the same task.)
    
    for p in range(num_persons):
        for s_idx, segment in enumerate(segments):
            activity_vars = []
            
            # Add task_active vars for all tasks in this segment
            for t_idx in segment.task_indices:
                if (p, s_idx, t_idx) in task_active_vars:
                    activity_vars.append(task_active_vars[(p, s_idx, t_idx)])
            
            # Add transfer vars
            for k_idx in segment.transfer_indices:
                activity_vars.append(y[p, k_idx])
            
            # Person can be active in at most one task/transfer per segment
            if activity_vars:
                model.Add(sum(activity_vars) <= 1)
    print("[OK] No double-booking")
    
    # === IDLE SEGMENT TRACKING ===
    # First, determine which persons have any work assignments
    person_has_work = {}
    for p in range(num_persons):
        has_any_task = False
        for s_idx, segment in enumerate(segments):
            for t_idx in segment.task_indices:
                # Person has work if they could potentially be assigned to any task
                has_any_task = True
                break
            if has_any_task:
                break
        person_has_work[p] = has_any_task
    
    for p in range(num_persons):
        for s_idx, segment in enumerate(segments):
            busy_vars = []
            
            # Use task_active variables instead of raw assignment/capability vars
            for t_idx in segment.task_indices:
                if (p, s_idx, t_idx) in task_active_vars:
                    busy_vars.append(task_active_vars[(p, s_idx, t_idx)])
            
            for k_idx in segment.transfer_indices:
                busy_vars.append(y[p, k_idx])
            
            # Check availability first!
            if not availability[p][s_idx]:
                # Person is unavailable - cannot be idle or get breaks
                model.Add(idle[p, s_idx] == 0)
            elif busy_vars:
                busy_expr = sum(busy_vars)
                # Force idle to be exactly the inverse of busy
                model.Add(idle[p, s_idx] == 1 - busy_expr)
            elif person_has_work[p]:
                # Person has work in general and is available, so they can be idle between tasks
                # Force idle if available and not busy (to ensure breaks are counted)
                model.Add(idle[p, s_idx] == 1)
            else:
                # Person has no work
                model.Add(idle[p, s_idx] == 0)
    print("[OK] Idle segment tracking")
    
    # === BREAK QUALIFICATION ===
    # A break should only count if it's BETWEEN work periods, not before first work or after last work
    for p in range(num_persons):
        for s_idx, segment in enumerate(segments):
            seg_duration = segment.end_time - segment.start_time
            
            if seg_duration < BREAK_THRESHOLD_MIN:
                model.Add(break_seg[p, s_idx] == 0)
            else:
                # Check if there's work before and after this segment
                has_work_before = model.NewBoolVar(f'has_work_before_p{p}_s{s_idx}')
                has_work_after = model.NewBoolVar(f'has_work_after_p{p}_s{s_idx}')
                
                # Work before: any segment s < s_idx where person is working
                work_before_vars = []
                for s_before in range(s_idx):
                    for t_idx in segments[s_before].task_indices:
                        if (p, s_before, t_idx) in task_active_vars:
                            work_before_vars.append(task_active_vars[(p, s_before, t_idx)])
                
                if work_before_vars:
                    model.AddMaxEquality(has_work_before, work_before_vars)
                else:
                    model.Add(has_work_before == 0)
                
                # Work after: any segment s > s_idx where person is working
                work_after_vars = []
                for s_after in range(s_idx + 1, num_segments):
                    for t_idx in segments[s_after].task_indices:
                        if (p, s_after, t_idx) in task_active_vars:
                            work_after_vars.append(task_active_vars[(p, s_after, t_idx)])
                
                if work_after_vars:
                    model.AddMaxEquality(has_work_after, work_after_vars)
                else:
                    model.Add(has_work_after == 0)
                
                # Break only counts if idle AND has work before AND has work after
                # break_seg = idle AND has_work_before AND has_work_after
                is_between_work = model.NewBoolVar(f'is_between_work_p{p}_s{s_idx}')
                model.AddMultiplicationEquality(is_between_work, [has_work_before, has_work_after])
                
                # break_seg = idle AND is_between_work
                model.AddMultiplicationEquality(break_seg[p, s_idx], [idle[p, s_idx], is_between_work])
    print("[OK] Break qualification (forced)")
    
    # === FATIGUE CALCULATION ===
    # Compute per-person initial fatigue offsets (scaled to integer domain)
    initial_fatigue_scaled = [round(persons[p].initial_fatigue * SCALE) for p in range(num_persons)]
    max_initial = max(initial_fatigue_scaled) if initial_fatigue_scaled else 0
    min_initial = min(initial_fatigue_scaled) if initial_fatigue_scaled else 0
    
    # Calculate safe bounds for fatigue
    max_positive_fatigue = sum(max(0, cost) for cost in task_fatigue_cost)
    max_negative_fatigue = sum(min(0, cost) for cost in task_fatigue_cost)
    # Sum of all possible per-segment break recoveries (each may differ by duration)
    max_break_recovery = sum(c for c in break_cost_per_seg if c < 0)
    
    fatigue_lower_bound = min_initial + max_negative_fatigue + max_break_recovery
    fatigue_upper_bound = max_initial + max_positive_fatigue
    
    # Ensure valid bounds: upper >= lower, and both allow 0 (person with no work = 0 fatigue)
    fatigue_lower_bound = min(fatigue_lower_bound, 0)
    fatigue_upper_bound = max(fatigue_upper_bound, 0)
    if fatigue_upper_bound < fatigue_lower_bound:
        fatigue_upper_bound = fatigue_lower_bound
    
    # For individual persons, fatigue can be as low as initial_fatigue (or 0 if no work)
    # but the computed lower bound might be negative (if there are negative-fatigue tasks)
    per_person_lower_bound = min(0, int(fatigue_lower_bound))
    
    fatigue = {}
    for p in range(num_persons):
        fatigue[p] = model.NewIntVar(
            per_person_lower_bound,
            int(fatigue_upper_bound),
            f'fatigue_p{p}'
        )
        
        model.Add(
            fatigue[p] == 
            initial_fatigue_scaled[p] +
            sum(task_fatigue_cost[t] * working[p, t] for t in range(num_tasks)) +
            sum(break_cost_per_seg[s] * break_seg[p, s] for s in range(num_segments))
        )
    print(f"[OK] Fatigue calculation (per-person bounds: [{per_person_lower_bound}, {fatigue_upper_bound}], initial_fatigue range: [{min_initial}, {max_initial}])")
    
    # === FATIGUE RANGE MINIMIZATION ===
    # F_min and F_max are the actual min/max fatigue values across all persons
    F_max = model.NewIntVar(int(fatigue_lower_bound), int(fatigue_upper_bound), 'F_max')
    F_min = model.NewIntVar(int(fatigue_lower_bound), int(fatigue_upper_bound), 'F_min')
    fatigue_range = model.NewIntVar(0, int(fatigue_upper_bound - fatigue_lower_bound), 'fatigue_range')
    
    # F_max is the maximum fatigue, F_min is the minimum fatigue
    model.AddMaxEquality(F_max, [fatigue[p] for p in range(num_persons)])
    model.AddMinEquality(F_min, [fatigue[p] for p in range(num_persons)])
    
    model.Add(fatigue_range == F_max - F_min)
    print("[OK] Fatigue range variables")
    
    # === HARD TASK COVERAGE ===
    # All normal (non-floating) tasks must be fully covered
    for t_idx in range(original_num_tasks):
        if t_idx not in task_to_floating:
            assumptions.enforce(
                model.Add(task_fully_covered[t_idx] == 1),
                f"task_coverage_{t_idx}",
                task_requirement_issue(tasks[t_idx], normalized_input),
            )
    print(f"[OK] Hard coverage for {original_num_tasks} normal tasks")
    
    # === OBJECTIVE: MINIMIZE FATIGUE RANGE ===
    model.Minimize(fatigue_range)
    print("\n[OBJECTIVE] Minimize fatigue range")
    
    # === SOLVE ===
    print(f"\n--- SOLVING (max {config.max_time_seconds}s) ---")
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = config.max_time_seconds
    if callback is None:
        callback = ProgressCallback(SCALE)
    else:
        callback._scale = SCALE
        callback._start = time.monotonic()
    status = solver.Solve(model, callback)
    
    solve_time = solver.WallTime()
    status_name = solver.StatusName(status)
    print(f"Status: {status_name}")
    print(f"Solve time: {solve_time:.2f}s")
    print(f"Solutions found: {len(callback.snapshots)}")
    
    if status == cp_model.INFEASIBLE:
        issues = assumptions.issues_for_infeasibility(solver)
        if not issues:
            issues = [core_fallback_issue(normalized_input)]
        errors.extend(issue.message for issue in issues)
        return _empty_result(
            "INFEASIBLE",
            solve_time,
            errors,
            persons,
            diagnostics_payload("infeasible", issues),
        )
    
    if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
        issue = DiagnosticIssue(
            code="SOLVER_UNDETERMINED",
            category="solver",
            message=(
                "The optimiser stopped before it could prove whether a valid "
                "assignment exists."
            ),
            facts=(("Solver status", status_name),),
            suggestions=("Run the optimisation again or increase the solver time limit.",),
        )
        errors.append(issue.message)
        return _empty_result(
            "UNKNOWN",
            solve_time,
            errors,
            persons,
            diagnostics_payload("undetermined", [issue]),
        )
    
    # === EXTRACT SOLUTION ===
    print("\n--- SOLUTION ---")
    
    # Extract fatigue values
    fatigue_per_person = {}
    breaks_per_person = {}
    
    for p_idx, person in enumerate(persons):
        fatigue_val = solver.Value(fatigue[p_idx]) / SCALE
        fatigue_per_person[person.id] = fatigue_val
        
        num_breaks = sum(solver.Value(break_seg[p_idx, s]) for s in range(num_segments))
        breaks_per_person[person.id] = num_breaks
    
    fatigue_min_val = min(fatigue_per_person.values())
    fatigue_max_val = max(fatigue_per_person.values())
    fatigue_range_val = fatigue_max_val - fatigue_min_val
    
    print(f"\nFatigue: min={fatigue_min_val:.2f}, max={fatigue_max_val:.2f}, range={fatigue_range_val:.2f}")
    
    print("\n--- FATIGUE PER PERSON ---")
    for person in persons:
        fat = fatigue_per_person[person.id]
        brk = breaks_per_person[person.id]
        print(f"Person {person.id}: fatigue={fat:.2f}, breaks={brk}")
    
    # Extract assignments
    assignments = {}
    capability_assignments = {}
    
    print("\n--- TASK ASSIGNMENTS ---")
    for t_idx, task in enumerate(tasks):
        is_covered = solver.Value(task_fully_covered[t_idx]) == 1
        
        # Check if this is an unchosen floating candidate
        if t_idx in task_to_floating:
            ft_idx = task_to_floating[t_idx]
            if solver.Value(float_choice[ft_idx, t_idx]) == 0:
                continue  # Skip unchosen candidates
        
        assigned_persons = []
        for p_idx, person in enumerate(persons):
            if solver.Value(assigned[p_idx, t_idx]) == 1:
                assigned_persons.append(person.id)
        
        if assigned_persons:
            assignments[task.id] = assigned_persons
            print(f"Task {task.id} ({task.name}): assigned={assigned_persons}")

        if task.preassigned_person_ids and not task.requirements:
            expected = {pid for pid in task.preassigned_person_ids if pid in person_to_idx}
            unexpected = [pid for pid in assigned_persons if pid not in expected]
            if unexpected:
                print(
                    f"WARNING: Direct-only task {task.id} ({task.name}) "
                    f"has unexpected direct assignments: {unexpected}"
                )
        
        for cap_name, req in task.requirements.items():
            if cap_name in capability_to_idx:
                c_idx = capability_to_idx[cap_name]
                cap_persons = []
                for p_idx, person in enumerate(persons):
                    if solver.Value(x[p_idx, t_idx, c_idx]) == 1:
                        cap_persons.append(person.id)
                
                if cap_persons:
                    capability_assignments[(task.id, cap_name)] = cap_persons
                    print(f"  {cap_name}: {cap_persons}")
    
    # Extract transfer assignments
    transfer_assignments = {}
    if transfers:
        print("\n--- TRANSFER ASSIGNMENTS ---")
        for k, transfer in enumerate(transfers):
            boarding_persons = []
            for p_idx, person in enumerate(persons):
                if solver.Value(y[p_idx, k]) == 1:
                    boarding_persons.append(person.id)
            
            if boarding_persons:
                transfer_assignments[transfer.id] = boarding_persons
                print(f"Transfer {transfer.id} ({transfer.from_location_id} -> {transfer.to_location_id}): assigned={boarding_persons}")
    
    # Build task details mapping for response builder
    task_details = {}
    for t_idx, task in enumerate(tasks):
        original_id = getattr(task, 'original_floating_task_id', task.id)
        resolved_location_id = task.location_id
        
        # For any-location tasks, resolve the chosen location from the solver
        if task.location_id is None and t_idx in any_location_task_indices:
            if solver.Value(task_fully_covered[t_idx]) == 1:
                for l in range(num_locations):
                    if solver.Value(task_loc_choice[t_idx, l]) == 1:
                        resolved_location_id = locations[l]
                        print(f"  Any-location task '{task.name}' (ID: {task.id}): placed at location {resolved_location_id}")
                        break
        
        task_details[task.id] = {
            'start_time': task.start_time,
            'end_time': task.end_time,
            'location_id': resolved_location_id,
            'original_id': original_id
        }
    
    # Add transfer details
    for transfer in transfers:
        task_details[transfer.id] = {
            'start_time': transfer.depart_time,
            'end_time': transfer.arrive_time,
            'location_id': transfer.from_location_id,  # From location
            'original_id': transfer.id,
            'is_transfer': True,
            'to_location_id': transfer.to_location_id
        }
    
    # === BUILD FIELD ASSIGNMENTS ===
    # Maps task/transfer id -> {field_id -> [person_ids]}
    field_assignments = {}
    
    # Build person capabilities lookup
    person_caps_map = {person.id: set(person.capabilities) for person in persons}
    
    # Field assignments for regular tasks (using capability_assignments from x variables)
    for t_idx, task in enumerate(tasks):
        if not getattr(task, 'field_requirements', None):
            continue
        task_field_map = {}
        assigned_to_field = set()
        
        for field_id, field_caps in task.field_requirements.items():
            field_persons = []
            for cap_name, count in field_caps.items():
                # Get persons assigned to this capability for this task via x[p,t,c]
                cap_persons = capability_assignments.get((task.id, cap_name), [])
                for pid in cap_persons:
                    if pid not in assigned_to_field:
                        field_persons.append(pid)
                        assigned_to_field.add(pid)
            if field_persons:
                task_field_map[field_id] = field_persons
        
        # Any remaining assigned persons not matched to a capability field (e.g. preassigned)
        all_assigned = assignments.get(task.id, [])
        unassigned = [pid for pid in all_assigned if pid not in assigned_to_field]
        if unassigned:
            task_field_map['field_Assigned'] = unassigned
        
        if task_field_map:
            field_assignments[task.id] = task_field_map
    
    # Field assignments for transfers (using y variables + greedy capability matching)
    for k, transfer in enumerate(transfers):
        boarding = transfer_assignments.get(transfer.id, [])
        if not boarding:
            continue

        has_direct_person_fields = bool(getattr(transfer, "person_field_assignments", None))
        has_capability_fields = bool(getattr(transfer, "field_requirements", None))
        transferee_fid = getattr(transfer, 'transferee_field_id', None)
        if not has_direct_person_fields and not has_capability_fields and not transferee_fid:
            continue
        
        transfer_field_map = {}
        assigned_to_field = set()

        # Direct persons_list fields are fixed by the normaliser. Keep these
        # field assignments separate from capability staff and dynamic
        # transferees so the UI reflects what the organiser selected.
        for field_id, person_ids in getattr(transfer, "person_field_assignments", {}).items():
            direct_persons = [pid for pid in person_ids if pid in boarding]
            if direct_persons:
                transfer_field_map[field_id] = direct_persons
                assigned_to_field.update(direct_persons)
        
        # First pass: assign boarding persons to capability-required fields
        for field_id, field_caps in transfer.field_requirements.items():
            field_persons = []
            for cap_name, count in field_caps.items():
                # Find boarding persons with this capability (not yet assigned to a field)
                qualified = [pid for pid in boarding
                             if pid not in assigned_to_field
                             and cap_name in person_caps_map.get(pid, set())]
                for pid in qualified[:count]:
                    field_persons.append(pid)
                    assigned_to_field.add(pid)
            if field_persons:
                transfer_field_map[field_id] = field_persons
        
        # Remaining boarding persons → transferee field
        remaining = [pid for pid in boarding if pid not in assigned_to_field]
        if remaining:
            if transferee_fid:
                transfer_field_map[transferee_fid] = remaining
            else:
                transfer_field_map['_transferee'] = remaining
        
        if transfer_field_map:
            field_assignments[transfer.id] = transfer_field_map
    
    if field_assignments:
        print("\n--- FIELD ASSIGNMENTS ---")
        for tid, fmap in field_assignments.items():
            print(f"  Task/Transfer {tid}: {fmap}")
    
    print("\n" + "=" * 80)
    
    return OptimizationResult(
        status=status_name,
        assignments=assignments,
        capability_assignments=capability_assignments,
        transfer_assignments=transfer_assignments,
        fatigue_per_person=fatigue_per_person,
        breaks_per_person=breaks_per_person,
        fatigue_min=fatigue_min_val,
        fatigue_max=fatigue_max_val,
        fatigue_range=fatigue_range_val,
        solve_time=solve_time,
        errors=errors,
        task_details=task_details,
        field_assignments=field_assignments,
        progress_snapshots=callback.snapshots,
        diagnostics=diagnostics_payload("feasible", []),
    )


def _empty_result(
    status: str,
    solve_time: float,
    errors: List[str],
    persons: List[NormPerson] = None,
    diagnostics: Dict[str, Any] = None,
) -> OptimizationResult:
    """Create an empty result while preserving structured diagnostics."""
    if persons:
        fatigue_per_person = {p.id: p.initial_fatigue for p in persons}
        breaks_per_person = {p.id: 0 for p in persons}
    else:
        fatigue_per_person = {}
        breaks_per_person = {}
    
    fatigue_values = list(fatigue_per_person.values()) if fatigue_per_person else [0.0]
    
    return OptimizationResult(
        status=status,
        assignments={},
        capability_assignments={},
        transfer_assignments={},
        fatigue_per_person=fatigue_per_person,
        breaks_per_person=breaks_per_person,
        fatigue_min=min(fatigue_values),
        fatigue_max=max(fatigue_values),
        fatigue_range=max(fatigue_values) - min(fatigue_values),
        solve_time=solve_time,
        errors=errors,
        task_details={},
        diagnostics=diagnostics,
    )
