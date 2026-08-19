"""
Flow Checker - Validates task assignments and resource flow for capabilities using CP-SAT.

This module checks if tasks can be feasibly assigned given:
- Available persons with specific capabilities
- Task requirements (location, time, capability needs)
- Transfer constraints between locations

Uses Google OR-Tools CP-SAT solver to determine satisfiability.
"""

from typing import List, Dict, Any, Optional, Set, Tuple
from dataclasses import dataclass, field
from ortools.sat.python import cp_model

from debug_logging import debug_print as print
from infeasibility_diagnostics import (
    DiagnosticIssue,
    core_fallback_issue,
    diagnostics_payload,
    legacy_message_issue,
    preflight_issues,
)


def minutes_to_time_str(minutes: int) -> str:
    """Convert minutes since midnight to HH:MM string."""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"


@dataclass
class NormPerson:
    """Normalised person input used by the flow checker and optimiser."""

    id: int
    home_location_id: Optional[int]
    capabilities: List[str]  # canonical capability ids (machine_names like "is_ho")
    
    # Maximum working minutes per day (None = no limit)
    max_work_minutes_per_day: Optional[int] = None
    
    # List of unavailable intervals (start_time, end_time) in minutes since midnight
    # Example: [(0, 480), (1320, 1440)] means unavailable 00:00-08:00 and 22:00-24:00
    unavailable_intervals: List[Tuple[int, int]] = field(default_factory=list)
    
    # Initial fatigue carry-over from previous day (0.0 = fresh start)
    initial_fatigue: float = 0.0
    name: str = ""


@dataclass
class NormTask:
    """Normalised fixed task with timing, location, and capability demand."""

    id: int
    name: str
    location_id: Optional[int]  # None means "any location"  -  solver picks
    start_time: int  # minutes since midnight (e.g., 420 = 07:00)
    end_time: int    # minutes since midnight (e.g., 480 = 08:00)
    requirements: Dict[str, int]  # capability_id -> count
    preassigned_person_ids: List[int] = field(default_factory=list)  # List of fixed assigned persons
    
    # Optional: for tasks that move people between locations (like transfers)
    from_location_id: Optional[int] = None  # Starting location (defaults to location_id)
    to_location_id: Optional[int] = None    # Ending location (defaults to location_id)
    
    # Per-field requirement tracking: field_id -> {cap_name: count}
    field_requirements: Dict[str, Dict[str, int]] = field(default_factory=dict)
    counts_towards_work_time: bool = True


@dataclass
class NormTransfer:
    """Normalised transfer leg that can move people between locations."""

    id: int
    from_location_id: int
    to_location_id: int
    depart_time: int  # minutes since midnight
    arrive_time: int  # minutes since midnight
    capacity: int
    requirements: Dict[str, int]  # capability_id -> count (same as tasks)
    optional_capacity_slots: int = 0  # Dynamic passenger seats beyond locked passengers and capability staff
    field_requirements: Dict[str, Dict[str, int]] = field(default_factory=dict)  # field_id -> {cap_name: count}
    transferee_field_id: Optional[str] = None  # field_id for the transferee field
    locked_person_ids: List[int] = field(default_factory=list)  # Direct transfer passengers from persons_list fields
    person_field_assignments: Dict[str, List[int]] = field(default_factory=dict)  # field_id -> direct passenger ids
    counts_towards_work_time: bool = True


@dataclass
class NormFloatingTask:
    """Normalised task that may be scheduled within a bounded time window."""

    id: int
    name: str
    location_id: Optional[int]  # None means "any location"  -  solver picks
    
    # Time window in which this task must be done
    window_start_time: int  # minutes since midnight
    window_end_time: int    # minutes since midnight
    
    duration: int           # minimum duration in minutes
    
    # capability_id -> count (same semantics as NormTask.requirements)
    requirements: Dict[str, int]
    
    # Optional preassigned organisers (list of fixed assigned persons)
    preassigned_person_ids: List[int] = field(default_factory=list)
    counts_towards_work_time: bool = True


@dataclass
class NormalizedFlowInput:
    """Complete normalised schedule input consumed by flow feasibility checks."""

    persons: List[NormPerson]
    tasks: List[NormTask]        # "normal" tasks that consume capability
    transfers: List[NormTransfer]
    errors: List[str]            # warnings/errors from parsing
    floating_tasks: List[NormFloatingTask] = field(default_factory=list)  # tasks that can float within a time window
    capability_names: Dict[str, str] = field(default_factory=dict)
    location_names: Dict[int, str] = field(default_factory=dict)


@dataclass
class TimeSegment:
    """Represents a continuous time period where task set is constant."""
    start_time: int  # minutes since midnight
    end_time: int    # minutes since midnight
    task_indices: List[int]  # indices of tasks active in this segment
    transfer_indices: List[int]  # indices of transfers active in this segment


def _unmatched_transfer_role_slots(
    transfer: NormTransfer,
    persons: List[NormPerson],
) -> List[Tuple[str, str]]:
    """Return required allocation slots lacking distinct eligible people."""
    locked_person_ids = set(getattr(transfer, "locked_person_ids", []))
    slots: List[Tuple[str, str]] = []
    for field_id, field_caps in getattr(
        transfer, "field_requirements", {}
    ).items():
        for cap_name, count in field_caps.items():
            slots.extend((field_id, cap_name) for _ in range(max(0, count)))

    matched_person_to_slot: Dict[int, int] = {}

    def assign(slot_index: int, visited: Set[int]) -> bool:
        _field_id, cap_name = slots[slot_index]
        for person in persons:
            if (
                person.id in locked_person_ids
                or person.id in visited
                or cap_name not in person.capabilities
            ):
                continue
            visited.add(person.id)
            previous_slot = matched_person_to_slot.get(person.id)
            if previous_slot is None or assign(previous_slot, visited):
                matched_person_to_slot[person.id] = slot_index
                return True
        return False

    matched_slots = {
        slot_index
        for slot_index in range(len(slots))
        if assign(slot_index, set())
    }
    return [slot for index, slot in enumerate(slots) if index not in matched_slots]


def generate_time_segments(
    tasks: List[NormTask], 
    transfers: List[NormTransfer],
    floating_tasks: List[NormFloatingTask]
) -> List[TimeSegment]:
    """
    Generate time segments from task, transfer, and floating task time boundaries.
    
    Each time segment is a period where the set of active tasks/transfers is constant.
    Segment boundaries occur at every task/transfer start or end time.
    
    Args:
        tasks: List of normalised tasks
        transfers: List of normalised transfers
        floating_tasks: List of floating tasks with time windows
        
    Returns:
        List of TimeSegment objects in chronological order
    """
    # Collect all unique time points
    time_points = set()
    for task in tasks:
        time_points.add(task.start_time)
        time_points.add(task.end_time)
    for transfer in transfers:
        time_points.add(transfer.depart_time)
        time_points.add(transfer.arrive_time)
    
    print(f"DEBUG generate_time_segments: {len(floating_tasks)} floating tasks")
    for ft in floating_tasks:
        print(f"  Floating task '{ft.name}': window {ft.window_start_time}-{ft.window_end_time}, duration {ft.duration}")
        time_points.add(ft.window_start_time)
        time_points.add(ft.window_end_time)
        # Add internal time points based on duration to create finer-grained segments
        # This allows multiple floating tasks with the same duration to be scheduled
        # sequentially within the same window (e.g., 10:00, 11:00, 12:00 for 1-hour tasks)
        if ft.duration > 0:
            t = ft.window_start_time
            while t + ft.duration <= ft.window_end_time:
                time_points.add(t)
                time_points.add(t + ft.duration)
                t += ft.duration
                print(f"    Added time point: {t - ft.duration} and {t}")
    
    # Sort time points
    sorted_times = sorted(time_points)
    
    if len(sorted_times) < 2:
        return []
    
    # Create segments between consecutive time points
    segments = []
    for i in range(len(sorted_times) - 1):
        start = sorted_times[i]
        end = sorted_times[i + 1]
        
        # Find which tasks are active in this segment
        # A task is active if: start_time <= segment_start < task.end_time
        active_tasks = []
        for idx, task in enumerate(tasks):
            if task.start_time <= start < task.end_time:
                active_tasks.append(idx)
        
        # Find which transfers are active in this segment
        # A transfer is active during [depart_time, arrive_time)
        active_transfers = []
        for idx, transfer in enumerate(transfers):
            if transfer.depart_time <= start < transfer.arrive_time:
                active_transfers.append(idx)
        
        segments.append(TimeSegment(
            start_time=start,
            end_time=end,
            task_indices=active_tasks,
            transfer_indices=active_transfers
        ))
    
    return segments


def _can_person_reach(person, target_location_id, target_segment_idx, segments, transfers) -> bool:
    """Check if a person can physically reach a location by a given time segment."""
    reachable = set()  # set of (location_id, segment_idx)
    
    if person.home_location_id is not None:
        reachable.add((person.home_location_id, 0))
    
    for s_idx in range(len(segments)):
        if s_idx > 0:
            prev_locs = {loc for loc, si in reachable if si == s_idx - 1}
            for loc in prev_locs:
                reachable.add((loc, s_idx))
        
        for transfer in transfers:
            if segments[s_idx].start_time == transfer.arrive_time:
                depart_seg_idx = None
                for ds_idx, dseg in enumerate(segments):
                    if dseg.start_time == transfer.depart_time:
                        depart_seg_idx = ds_idx
                        break
                if depart_seg_idx is not None and (transfer.from_location_id, depart_seg_idx) in reachable:
                    locked_person_ids = set(getattr(transfer, "locked_person_ids", []))
                    has_dynamic_seat = getattr(transfer, "optional_capacity_slots", 0) > 0
                    has_legacy_open_capacity = transfer.capacity is None or transfer.capacity >= 999
                    can_staff_transfer = any(
                        count > 0 and capability in person.capabilities
                        for capability, count in transfer.requirements.items()
                    )
                    can_board = (
                        person.id in locked_person_ids
                        or has_dynamic_seat
                        or has_legacy_open_capacity
                        or can_staff_transfer
                    )
                    if can_board:
                        reachable.add((transfer.to_location_id, s_idx))
        
        if (target_location_id, target_segment_idx) in reachable:
            return True
    
    return (target_location_id, target_segment_idx) in reachable


def check_flow(
    normalized_input: NormalizedFlowInput,
    max_time_seconds: float = 30.0,
    *,
    include_diagnostics: bool = False,
) -> List[str] | Tuple[List[str], Dict[str, Any]]:
    """
    Check if the given tasks can be feasibly assigned using CP-SAT.
    
    Args:
        normalized_input: NormalizedFlowInput containing all normalised data
        max_time_seconds: Solver time limit in seconds (default 30.0)
    
    Returns:
        List of error messages by default. When ``include_diagnostics`` is true,
        return ``(errors, diagnostics)`` for API callers.
    """
    errors = []

    def result(
        current_errors: List[str],
        status: str,
        issues: List[DiagnosticIssue],
    ) -> List[str] | Tuple[List[str], Dict[str, Any]]:
        payload = diagnostics_payload(status, issues)
        if include_diagnostics:
            return current_errors, payload
        return current_errors
    
    print("=" * 80)
    print("FLOW CHECKER - CT-SAT SOLVER")
    print("=" * 80)
    
    # Extract data
    persons = normalized_input.persons
    tasks = normalized_input.tasks
    transfers = normalized_input.transfers
    floating_tasks = getattr(normalized_input, "floating_tasks", [])
    
    preflight = preflight_issues(normalized_input)
    if preflight:
        return result(
            [issue.message for issue in preflight],
            "invalid_input",
            preflight,
        )

    for transfer in transfers:
        unmatched_slots = _unmatched_transfer_role_slots(transfer, persons)
        if unmatched_slots:
            missing = ", ".join(
                f"{field_id} ({cap_name})"
                for field_id, cap_name in unmatched_slots
            )
            message = (
                f"Transfer {transfer.id} cannot assign distinct eligible people "
                f"to every allocation field; missing: {missing}"
            )
            issue = legacy_message_issue(message, normalized_input)
            return result([message], "invalid_input", [issue])
    
    if not tasks and not transfers and not floating_tasks:
        return result([], "feasible", [])  # Nothing to check
    
    # Generate time segments (including floating task windows)
    segments = generate_time_segments(tasks, transfers, floating_tasks)
    
    print(f"\n--- TIME SEGMENTS ({len(segments)}) ---")
    for i, seg in enumerate(segments):
        print(f"Segment {i}: {minutes_to_time_str(seg.start_time)} -> {minutes_to_time_str(seg.end_time)}")
        print(f"  Active tasks: {seg.task_indices}")
        print(f"  Active transfers: {seg.transfer_indices}")
    
    # --- EXPAND FLOATING TASKS INTO CANDIDATE FIXED TASKS ---
    floating_candidates: Dict[int, List[int]] = {}  # ft_idx -> list of task indices
    original_num_tasks = len(tasks)
    
    if floating_tasks:
        print(f"\n--- EXPANDING {len(floating_tasks)} FLOATING TASKS ---")
    
    for ft_idx, ft in enumerate(floating_tasks):
        floating_candidates[ft_idx] = []
        
        for s_idx, seg in enumerate(segments):
            seg_start = seg.start_time
            seg_end = seg.end_time
            seg_len = seg_end - seg_start
            
            # Only consider starting segments fully inside the floating window
            if seg_start < ft.window_start_time:
                continue
            
            # Check if the task can fit starting at this segment
            # It may span multiple consecutive segments
            task_end = seg_start + ft.duration
            
            # Task must end within the floating window
            if task_end > ft.window_end_time:
                continue
            
            # Create a candidate NormTask that starts at this segment
            # (it may span multiple consecutive segments)
            candidate_task = NormTask(
                id=ft.id,
                name=f"{ft.name} [floating@seg{s_idx}]",
                location_id=ft.location_id,
                start_time=seg_start,
                end_time=task_end,
                requirements=dict(ft.requirements),
                preassigned_person_ids=ft.preassigned_person_ids,
                counts_towards_work_time=(
                    getattr(ft, "counts_towards_work_time", True) is not False
                ),
            )
            
            tasks.append(candidate_task)
            new_task_idx = len(tasks) - 1
            floating_candidates[ft_idx].append(new_task_idx)
            print(f"  Floating task '{ft.name}' (ID: {ft.id}) -> candidate at segment {s_idx}: task index {new_task_idx}")
        
        # Check if any feasible slots exist
        if not floating_candidates[ft_idx]:
            errors.append(
                f"Floating task '{ft.name}' (ID: {ft.id}) has no feasible time slot within its window "
                f"({minutes_to_time_str(ft.window_start_time)}-{minutes_to_time_str(ft.window_end_time)}, "
                f"duration: {ft.duration} min)."
            )
    
    # Build reverse map: task_idx -> floating task index (ft_idx)
    task_to_floating: Dict[int, int] = {}
    for ft_idx, cand_task_indices in floating_candidates.items():
        for t_idx in cand_task_indices:
            task_to_floating[t_idx] = ft_idx
    
    # --- REBUILD SEGMENT TASK INDICES AFTER FLOATING EXPANSION ---
    # At this point, `tasks` now includes both original tasks and floating candidates.
    # We must update each segment's task_indices so that:
    #   - capability/location constraints
    #   - assigned-person constraints
    #   - no-double-booking
    # all "see" the floating candidates.
    # 
    # A task is active in a segment if the segment starts during the task's execution.
    # This matches the optimiser's task_segments mapping.
    for seg in segments:
        seg.task_indices = []

    for t_idx, task in enumerate(tasks):
        for s_idx, seg in enumerate(segments):
            # A task is active in every segment it spans
            if task.start_time <= seg.start_time < task.end_time:
                seg.task_indices.append(t_idx)
    
    if floating_tasks:
        print(f"\n--- REBUILT SEGMENT TASK INDICES ---")
        for i, seg in enumerate(segments):
            print(f"Segment {i}: {minutes_to_time_str(seg.start_time)} -> {minutes_to_time_str(seg.end_time)}")
            print(f"  Active tasks: {seg.task_indices}")
    
    # Collect all unique capabilities and locations
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
        if task.from_location_id is not None:
            all_locations.add(task.from_location_id)
        if task.to_location_id is not None:
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
    print(f"Persons: {num_persons}")
    print(f"Tasks: {num_tasks}")
    print(f"Transfers: {num_transfers}")
    print(f"Capabilities: {num_capabilities}")
    print(f"Locations: {num_locations}")
    print(f"Segments: {num_segments}")
    
    # Map each task index to the segment index where it is active (by start_time)
    task_segment_idx: Dict[int, Optional[int]] = {}
    for t_idx, task in enumerate(tasks):
        seg_for_task = None
        for s_idx, seg in enumerate(segments):
            if t_idx in seg.task_indices:
                seg_for_task = s_idx
                break
        task_segment_idx[t_idx] = seg_for_task
    task_segment_indices: Dict[int, List[int]] = {
        t_idx: [
            s_idx
            for s_idx, seg in enumerate(segments)
            if t_idx in seg.task_indices
        ]
        for t_idx in range(num_tasks)
    }
    
    # availability[p][s] = True if person p is available in segment s
    availability = [[True for _ in range(num_segments)] for _ in range(num_persons)]
    
    for p_idx, person in enumerate(persons):
        for s_idx, seg in enumerate(segments):
            seg_start = seg.start_time
            seg_end = seg.end_time
            # Mark as unavailable if this segment overlaps any unavailable interval
            for (ua_start, ua_end) in person.unavailable_intervals:
                # overlap if ua_start < seg_end and seg_start < ua_end
                if ua_start < seg_end and seg_start < ua_end:
                    availability[p_idx][s_idx] = False
                    break

    def person_available_for_task(p_idx: int, t_idx: int) -> bool:
        active_segments = task_segment_indices.get(t_idx, [])
        return bool(active_segments) and all(availability[p_idx][s_idx] for s_idx in active_segments)
    
    # Build CP-SAT model
    model = cp_model.CpModel()
    
    # Decision variables
    # x[p][t][c]: person p covers capability c for task t
    x = {}
    for p in range(num_persons):
        for t in range(num_tasks):
            for c in range(num_capabilities):
                x[p, t, c] = model.NewBoolVar(f'x_p{p}_t{t}_c{c}')
    
    # assigned[p][t]: person p is the assigned person for task t
    assigned = {}
    for p in range(num_persons):
        for t in range(num_tasks):
            assigned[p, t] = model.NewBoolVar(f'assigned_p{p}_t{t}')
    
    # z[p][s][l]: person p is at location l in segment s
    z = {}
    for p in range(num_persons):
        for s in range(num_segments):
            for l in range(num_locations):
                z[p, s, l] = model.NewBoolVar(f'z_p{p}_s{s}_l{l}')
    
    # y[p][k]: person p uses transfer k
    y = {}
    for p in range(num_persons):
        for k in range(num_transfers):
            y[p, k] = model.NewBoolVar(f'y_p{p}_k{k}')

    transfer_role = {}
    for k, transfer in enumerate(transfers):
        locked_person_ids = set(getattr(transfer, "locked_person_ids", []))
        for field_id, field_caps in getattr(
            transfer, "field_requirements", {}
        ).items():
            for cap_name, count in field_caps.items():
                if count <= 0:
                    continue
                for p, person in enumerate(persons):
                    if (
                        person.id in locked_person_ids
                        or cap_name not in person.capabilities
                    ):
                        continue
                    transfer_role[p, k, field_id, cap_name] = model.NewBoolVar(
                        f'transfer_role_p{p}_k{k}_{field_id}_{cap_name}'
                    )
    
    # task_fully_covered[t]: task t has all capability requirements satisfied
    task_fully_covered = []
    for t in range(num_tasks):
        var = model.NewBoolVar(f'task_fully_covered_{t}')
        task_fully_covered.append(var)
    
    # float_choice[ft_idx, t_idx]: choose which candidate segment for floating task ft_idx
    float_choice = {}
    for ft_idx, cand_task_indices in floating_candidates.items():
        for t_idx in cand_task_indices:
            float_choice[ft_idx, t_idx] = model.NewBoolVar(f'float_choice_ft{ft_idx}_t{t_idx}')
    
    # Duration in minutes for each task
    task_durations = [0] * num_tasks
    for t_idx, task in enumerate(tasks):
        task_durations[t_idx] = task.end_time - task.start_time
    transfer_durations = []
    for transfer in transfers:
        duration = transfer.arrive_time - transfer.depart_time
        if duration < 0:
            duration += 24 * 60
        transfer_durations.append(max(0, duration))
    
    # working[p, t]: person p works on task t in any role (assigned or capability)
    working = {}
    for p in range(num_persons):
        for t in range(num_tasks):
            working[p, t] = model.NewBoolVar(f'working_p{p}_t{t}')
    
    # Link working to assigned and x
    for p in range(num_persons):
        for t in range(num_tasks):
            # If person is assigned or has any capability on this task, they are working on it
            model.Add(working[p, t] >= assigned[p, t])
            model.Add(working[p, t] >= sum(x[p, t, c] for c in range(num_capabilities)))
            # At most one role per task (tighter constraint than cross-segment no-double-booking)
            model.Add(assigned[p, t] + sum(x[p, t, c] for c in range(num_capabilities)) <= 1)
    
    # Total work time per person in minutes
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
    
    # Enforce maximum work time per person if specified
    for p_idx, person in enumerate(persons):
        if person.max_work_minutes_per_day is not None:
            model.Add(work_time[p_idx] <= int(person.max_work_minutes_per_day))
    
    print("\n--- ADDING CONSTRAINTS ---")
    
    # 4.1 Initial location (first segment), with unavailability-aware teleport
    if num_segments > 0:
        first_seg_start = segments[0].start_time

        for p_idx, person in enumerate(persons):
            # Check if the person had any unavailability interval that ended before
            # the first segment starts. If so, we assume they could have travelled
            # anywhere during that off-time, so we DO NOT fix their location in the
            # first segment.
            had_unavailability_before_first_segment = False
            for (ua_start, ua_end) in getattr(person, "unavailable_intervals", []):
                if ua_end <= first_seg_start:
                    had_unavailability_before_first_segment = True
                    break

            # Check if person is preassigned to any task in first segment
            preassigned_first_segment_location = None
            for t_idx, task in enumerate(tasks):
                if person.id in task.preassigned_person_ids:
                    # Check if this task is active in first segment
                    if t_idx in segments[0].task_indices:
                        preassigned_first_segment_location = task.location_id
                        break
            
            if preassigned_first_segment_location is not None:
                # Person is preassigned to a task in first segment - must start at task location
                task_loc_idx = location_to_idx[preassigned_first_segment_location]
                model.Add(z[p_idx, 0, task_loc_idx] == 1)
                for l in range(num_locations):
                    if l != task_loc_idx:
                        model.Add(z[p_idx, 0, l] == 0)
            elif (
                not had_unavailability_before_first_segment
                and person.home_location_id is not None
                and person.home_location_id in location_to_idx
            ):
                # Person has not been "off-grid" yet => start at home location
                home_loc_idx = location_to_idx[person.home_location_id]
                model.Add(z[p_idx, 0, home_loc_idx] == 1)
                for l in range(num_locations):
                    if l != home_loc_idx:
                        model.Add(z[p_idx, 0, l] == 0)
            else:
                # Person had an unavailability window before we ever 'see' them in a segment.
                # We do NOT constrain their starting location here. Combined with:
                #   - 4.2 exactly one location per person per segment
                #   - availability & assignment constraints
                # this means:
                #   - They can reappear in ANY one location in the first segment.
                #   - This matches the notion "during unavailability, they can travel
                #     wherever, and it's their responsibility to be at the right place
                #     when they become available again."
                pass
        print("[OK] 4.1 Initial locations (unavailability-aware)")
    
    # 4.2 Exactly one location per person per segment
    for p in range(num_persons):
        for s in range(num_segments):
            model.Add(sum(z[p, s, l] for l in range(num_locations)) == 1)
    print("[OK] 4.2 One location per person per segment")
    
    # 4.3 Location propagation via transfers and moving tasks, respecting unavailability
    for p in range(num_persons):
        for s in range(1, num_segments):
            for l in range(num_locations):
                # If the person is available in both previous and current segment,
                # enforce normal propagation (stay or arrive by transfer/moving task).
                if availability[p][s-1] and availability[p][s]:
                    incoming_transfers = []
                    for k, transfer in enumerate(transfers):
                        to_loc_idx = location_to_idx[transfer.to_location_id]
                        # Transfer ends when it reaches arrive_time
                        # Check if this segment starts at the transfer's arrival time
                        if to_loc_idx == l and segments[s].start_time == transfer.arrive_time:
                            incoming_transfers.append(k)
                    
                    # Also check for tasks that move people to this location
                    incoming_moving_tasks = []
                    for t_idx, task in enumerate(tasks):
                        if task.to_location_id is not None:
                            to_loc_idx = location_to_idx[task.to_location_id]
                            # Task ends at end_time, so person arrives at to_location at end_time
                            if to_loc_idx == l and segments[s].start_time == task.end_time:
                                incoming_moving_tasks.append(t_idx)
                    
                    # Person can be at (s,l) if they:
                    # 1. Were at (s-1,l) (stayed)
                    # 2. Arrived via transfer
                    # 3. Arrived via a moving task
                    model.Add(
                        z[p, s, l] <= z[p, s-1, l] + 
                        sum(y[p, k] for k in incoming_transfers) +
                        sum(working[p, t] for t in incoming_moving_tasks)
                    )
                else:
                    # If the person is unavailable in s-1 or s, we do NOT constrain z[p, s, l]
                    # by z[p, s-1, l]. Combined with the "exactly one location per segment"
                    # constraint and the fact that we forbid tasks/transfers when unavailable,
                    # this means:
                    #   - During unavailability, their location is irrelevant.
                    #   - As soon as they become available again, they may be assigned
                    #     to ANY single location.
                    pass
    print("[OK] 4.3 Location propagation")
    
    # 4.4 Transfer boarding and arrival conditions
    for p_idx, person in enumerate(persons):
        for k, transfer in enumerate(transfers):
            # Find segment indices where transfer departs and arrives
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
                
                # Must be at origin location to board
                model.Add(y[p_idx, k] <= z[p_idx, depart_segment, from_loc_idx])
                
                # If you board the transfer, you MUST be at destination when it arrives
                if arrive_segment is not None:
                    # y[p,k] => z[p,arrive,to_loc] (implication)
                    # Equivalent to: z[p,arrive,to_loc] >= y[p,k]
                    model.Add(z[p_idx, arrive_segment, to_loc_idx] >= y[p_idx, k])
                
                # Cannot use transfer if unavailable at departure or arrival segment
                if not availability[p_idx][depart_segment]:
                    model.Add(y[p_idx, k] == 0)
                if arrive_segment is not None and not availability[p_idx][arrive_segment]:
                    model.Add(y[p_idx, k] == 0)
    print("[OK] 4.4 Transfer boarding")
    
    # 4.5 Transfer capacity and capability requirements
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

        # Total capacity constraint
        if transfer.capacity is not None and transfer.capacity < 999:
            model.Add(sum(y[p, k] for p in range(num_persons)) <= transfer.capacity)
        
        field_requirements = getattr(transfer, "field_requirements", {})
        if field_requirements:
            for field_id, field_caps in field_requirements.items():
                for cap_name, count in field_caps.items():
                    if count <= 0:
                        continue
                    slot_vars = [
                        var
                        for (p_idx, transfer_idx, role_field_id, role_cap), var
                        in transfer_role.items()
                        if transfer_idx == k
                        and role_field_id == field_id
                        and role_cap == cap_name
                    ]
                    model.Add(sum(slot_vars) == count)
                    for p in range(num_persons):
                        role_var = transfer_role.get((p, k, field_id, cap_name))
                        if role_var is not None:
                            model.Add(role_var <= y[p, k])
            for p in range(num_persons):
                person_roles = [
                    var
                    for (p_idx, transfer_idx, _field_id, _cap), var
                    in transfer_role.items()
                    if p_idx == p and transfer_idx == k
                ]
                if person_roles:
                    model.Add(sum(person_roles) <= 1)
        else:
            for cap_name, count in transfer.requirements.items():
                if cap_name in capability_to_idx:
                    people_with_cap = [
                        p for p in range(num_persons)
                        if cap_name in persons[p].capabilities
                    ]
                    if people_with_cap:
                        model.Add(sum(y[p, k] for p in people_with_cap) >= count)
    print("[OK] 4.5 Transfer capacity and requirements")
    
    # 4.6 Task feasibility
    # 4.6.0 Any-location auxiliary variables
    # For tasks with location_id == None, the solver chooses the location.
    # task_loc_choice[t, l] = 1 iff task t takes place at location l
    task_loc_choice = {}
    any_location_task_indices = [t_idx for t_idx, task in enumerate(tasks) if task.location_id is None
                                 and not (task.from_location_id is not None and task.to_location_id is not None)]

    for t_idx in any_location_task_indices:
        for l in range(num_locations):
            task_loc_choice[t_idx, l] = model.NewBoolVar(f'task_loc_choice_t{t_idx}_l{l}')

        # Task takes place at exactly one location (if covered)
        model.Add(
            sum(task_loc_choice[t_idx, l] for l in range(num_locations))
            == task_fully_covered[t_idx]
        )
    print(f"[OK] 4.6.0 Any-location variables for {len(any_location_task_indices)} tasks")

    # 4.6.1 Capability & location consistency + availability
    for p_idx, person in enumerate(persons):
        for t_idx, task in enumerate(tasks):
            task_segment = task_segment_idx[t_idx]
            if task_segment is None:
                continue
            
            # For tasks with movement (from_location -> to_location), person must be at from_location
            if task.from_location_id is not None and task.to_location_id is not None:
                # Moving task: must start at from_location
                from_loc_idx = location_to_idx[task.from_location_id]
                task_loc_idx = from_loc_idx
                for c_idx, cap_name in enumerate(capabilities):
                    has_cap = 1 if cap_name in person.capabilities else 0
                    model.Add(x[p_idx, t_idx, c_idx] <= has_cap)
                    model.Add(x[p_idx, t_idx, c_idx] <= z[p_idx, task_segment, task_loc_idx])
                    if not person_available_for_task(p_idx, t_idx):
                        model.Add(x[p_idx, t_idx, c_idx] == 0)
            elif task.location_id is not None:
                # Regular task with fixed location
                task_loc_idx = location_to_idx[task.location_id]
                for c_idx, cap_name in enumerate(capabilities):
                    has_cap = 1 if cap_name in person.capabilities else 0
                    model.Add(x[p_idx, t_idx, c_idx] <= has_cap)
                    model.Add(x[p_idx, t_idx, c_idx] <= z[p_idx, task_segment, task_loc_idx])
                    if not person_available_for_task(p_idx, t_idx):
                        model.Add(x[p_idx, t_idx, c_idx] == 0)
            else:
                # Any-location task: person must be at whichever location the solver picks
                for c_idx, cap_name in enumerate(capabilities):
                    has_cap = 1 if cap_name in person.capabilities else 0
                    model.Add(x[p_idx, t_idx, c_idx] <= has_cap)
                    if not person_available_for_task(p_idx, t_idx):
                        model.Add(x[p_idx, t_idx, c_idx] == 0)
                    else:
                        for l in range(num_locations):
                            # x[p,t,c] AND task_loc_choice[t,l] => z[p,seg,l]
                            model.Add(
                                x[p_idx, t_idx, c_idx] + task_loc_choice[t_idx, l] - 1
                                <= z[p_idx, task_segment, l]
                            )
    print("[OK] 4.6.1 Capability & location consistency (with any-location support)")
    
    # 4.6.1b Task movement constraints (similar to 4.4 for transfers)
    for p in range(num_persons):
        for t_idx, task in enumerate(tasks):
            # Only apply to tasks with movement
            if task.from_location_id is not None and task.to_location_id is not None:
                task_segment = task_segment_idx[t_idx]
                if task_segment is None:
                    continue
                
                from_loc_idx = location_to_idx[task.from_location_id]
                to_loc_idx = location_to_idx[task.to_location_id]
                
                # If working on this moving task (assigned or capability), must be at from_location when task starts
                model.Add(working[p, t_idx] <= z[p, task_segment, from_loc_idx])
                
                # Find the segment when task ends
                end_segment = None
                for s_idx, seg in enumerate(segments):
                    if seg.start_time == task.end_time:
                        end_segment = s_idx
                        break
                
                # If working on this task, must be at to_location when task ends
                if end_segment is not None:
                    model.Add(z[p, end_segment, to_loc_idx] >= working[p, t_idx])
    print("[OK] 4.6.1b Task movement constraints")
    
    # 4.6.2 Required capability counts and task_fully_covered linkage
    # Build required_count lookup for easier access
    required_count = {}
    for t_idx, task in enumerate(tasks):
        required_count[t_idx] = {}
        for cap_name, req in task.requirements.items():
            if cap_name in capability_to_idx:
                c_idx = capability_to_idx[cap_name]
                required_count[t_idx][c_idx] = req
    
    # Link task_fully_covered to capability coverage
    for t in range(num_tasks):
        for c in range(num_capabilities):
            req = required_count.get(t, {}).get(c, 0)
            if req > 0:
                # If task_fully_covered[t] == 1, then sum(x[p][t][c]) >= req
                # Equivalent to: sum(x[p][t][c]) >= req * task_fully_covered[t]
                model.Add(
                    sum(x[p, t, c] for p in range(num_persons)) >= req * task_fully_covered[t]
                )
    
    # Handle tasks with no capability requirements - they are always fully covered
    # (except floating task candidates, which are handled by float_choice constraints)
    for t in range(num_tasks):
        if all(required_count.get(t, {}).get(c, 0) == 0 for c in range(num_capabilities)):
            # Skip floating task candidates - their coverage is linked to choice variables
            if t not in task_to_floating:
                model.Add(task_fully_covered[t] == 1)
    
    # Legacy transfer capability requirements. Structured transfers are
    # already constrained by exact distinct field-level slots above.
    for k_idx, transfer in enumerate(transfers):
        if getattr(transfer, "field_requirements", {}):
            continue
        for cap_name, required_count_val in transfer.requirements.items():
            if cap_name in capability_to_idx and required_count_val > 0:
                # Count persons with this capability who use the transfer
                persons_with_cap = [p for p in range(num_persons) if cap_name in persons[p].capabilities]
                model.Add(sum(y[p, k_idx] for p in persons_with_cap) >= required_count_val)
    

    print("[OK] 4.6.2 Required capability counts")
    
    # 4.6.3 Floating task constraints
    # Each floating task must be scheduled in exactly one candidate slot
    for ft_idx, cand_task_indices in floating_candidates.items():
        if cand_task_indices:
            model.Add(
                sum(float_choice[ft_idx, t_idx] for t_idx in cand_task_indices) == 1
            )
    
    # Link floating candidates to choice variables
    for ft_idx, cand_task_indices in floating_candidates.items():
        for t_idx in cand_task_indices:
            choice_var = float_choice[ft_idx, t_idx]
            
            # If not chosen, no one can be assigned to this candidate
            for p in range(num_persons):
                model.Add(assigned[p, t_idx] <= choice_var)
                # If not chosen, capability assignments must be 0
                for c in range(num_capabilities):
                    model.Add(x[p, t_idx, c] <= choice_var)
            
            # Link task_fully_covered to float_choice for candidates
            # If chosen, must be fully covered; if not chosen, cannot be covered
            model.Add(task_fully_covered[t_idx] == choice_var)
    
    print("[OK] 4.6.3 Floating task choice constraints")
    
    # 4.7 Assigned person constraints
    # 4.7.1 Exact direct assignment constraints
    # Direct person selections are hard constraints. Only selected people may be
    # assigned through the direct assignment variable.
    for t_idx, task in enumerate(tasks):
        if t_idx in task_to_floating:
            if not task.preassigned_person_ids:
                model.Add(sum(assigned[p, t_idx] for p in range(num_persons)) == 0)
            continue

        valid_preassigned = {
            person_to_idx[person_id]
            for person_id in task.preassigned_person_ids
            if person_id in person_to_idx
        }

        if not task.preassigned_person_ids:
            model.Add(sum(assigned[p, t_idx] for p in range(num_persons)) == 0)
        else:
            print(f"  Task {task.id} ({task.name}): Direct assignments locked to: {task.preassigned_person_ids}")
            for p in range(num_persons):
                model.Add(assigned[p, t_idx] == (1 if p in valid_preassigned else 0))
    print("[OK] 4.7.1 Exact direct assignments")
    
    # 4.7.2 Preassigned tasks
    # For static tasks: preassigned person MUST be assigned
    # For floating tasks: preassigned person must be assigned to EXACTLY ONE of the candidates (the chosen one)
    
    # Group preassigned constraints by floating task
    floating_preassigned: Dict[int, List[int]] = {}  # ft_idx -> list of preassigned person indices
    
    for t_idx, task in enumerate(tasks):
        if task.preassigned_person_ids:
            # Check if this task is a floating candidate
            if t_idx in task_to_floating:
                # This is a floating candidate - handle specially
                ft_idx = task_to_floating[t_idx]
                if ft_idx not in floating_preassigned:
                    # Store preassigned persons for this floating task (only need to do once)
                    floating_preassigned[ft_idx] = []
                    for person_id in task.preassigned_person_ids:
                        if person_id in person_to_idx:
                            floating_preassigned[ft_idx].append(person_to_idx[person_id])
            else:
                # This is a static task - apply constraint directly
                for person_id in task.preassigned_person_ids:
                    if person_id in person_to_idx:
                        p_fixed = person_to_idx[person_id]
                        model.Add(assigned[p_fixed, t_idx] == 1)
    
    # For floating tasks with preassigned persons:
    # The preassigned person must be assigned to the chosen candidate
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

        for t_idx in cand_task_indices:
            for p in range(num_persons):
                if p not in preassigned_persons:
                    model.Add(assigned[p, t_idx] == 0)
    
    print("[OK] 4.7.2 Preassigned tasks")
    
    # 4.7.3 Assigned person must be at task location/time and available
    for p in range(num_persons):
        for t_idx, task in enumerate(tasks):
            task_segment = task_segment_idx[t_idx]
            if task_segment is None:
                continue
            
            # For moving tasks, assigned person must start at from_location
            if task.from_location_id is not None and task.to_location_id is not None:
                task_loc_idx = location_to_idx[task.from_location_id]
                model.Add(assigned[p, t_idx] <= z[p, task_segment, task_loc_idx])
            elif task.location_id is not None:
                task_loc_idx = location_to_idx[task.location_id]
                model.Add(assigned[p, t_idx] <= z[p, task_segment, task_loc_idx])
            else:
                # Any-location task: assigned person must be at whichever location the solver picks
                if not person_available_for_task(p, t_idx):
                    model.Add(assigned[p, t_idx] == 0)
                else:
                    for l in range(num_locations):
                        model.Add(
                            assigned[p, t_idx] + task_loc_choice[t_idx, l] - 1
                            <= z[p, task_segment, l]
                        )
            # Cannot be assigned if unavailable in this segment
            if not person_available_for_task(p, t_idx):
                model.Add(assigned[p, t_idx] == 0)
    print("[OK] 4.7.3 Assigned person at location (with any-location support)")
    
    # 4.7.4 Assigned person is separate from capability slots
    for t_idx, task in enumerate(tasks):
        if task.preassigned_person_ids:
            for person_id in task.preassigned_person_ids:
                if person_id in person_to_idx:
                    p_fixed = person_to_idx[person_id]
                    for c in range(num_capabilities):
                        model.Add(x[p_fixed, t_idx, c] == 0)
    print("[OK] 4.7.4 Assigned person separate from capability slots")
    
    # 4.8 No double-booking in same segment
    for p in range(num_persons):
        for s_idx, segment in enumerate(segments):
            vars_in_segment = []
            
            # Add assigned variables for tasks in this segment
            for t_idx in segment.task_indices:
                vars_in_segment.append(assigned[p, t_idx])
            
            # Add capability variables for tasks in this segment
            for t_idx in segment.task_indices:
                for c in range(num_capabilities):
                    vars_in_segment.append(x[p, t_idx, c])
            
            # Add transfer variables for transfers active in this segment
            for k_idx in segment.transfer_indices:
                vars_in_segment.append(y[p, k_idx])
            
            if vars_in_segment:
                model.Add(sum(vars_in_segment) <= 1)
    print("[OK] 4.8 No double-booking")
    
    # Objective: Maximize the number of fully covered tasks
    model.Maximize(sum(task_fully_covered[t] for t in range(num_tasks)))
    
    # Solve
    print("\n--- SOLVING ---")
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time_seconds
    status = solver.Solve(model)
    
    print(f"Status: {solver.StatusName(status)}")
    print(f"Solve time: {solver.WallTime():.2f}s")
    
    if status == cp_model.INFEASIBLE:
        print("\n[WARNING] INFEASIBLE - No solution found")
        print("\n--- INFEASIBILITY ANALYSIS ---")
        
        for t_idx, task in enumerate(tasks):
            task_segment_idx = None
            for s_idx, seg in enumerate(segments):
                if t_idx in seg.task_indices:
                    task_segment_idx = s_idx
                    break
            
            if task_segment_idx is None:
                errors.append(f"Task '{task.name}' (ID: {task.id}): No time segment found  -  check task times")
                continue
                
            segment = segments[task_segment_idx]
            time_str = f"{minutes_to_time_str(segment.start_time)}-{minutes_to_time_str(segment.end_time)}"
            
            # --- Capability checks ---
            for cap_name, required_count in task.requirements.items():
                if cap_name not in capability_to_idx:
                    errors.append(
                        f"Task '{task.name}' (ID: {task.id}) at {time_str}: "
                        f"Requires capability '{cap_name}' which doesn't exist"
                    )
                    continue
                    
                persons_with_cap = [p for p in persons if cap_name in p.capabilities]
                total_with_cap = len(persons_with_cap)
                
                if total_with_cap < required_count:
                    errors.append(
                        f"Task '{task.name}' (ID: {task.id}) at {time_str}: "
                        f"Not enough '{cap_name}'  -  needs {required_count}, only {total_with_cap} exist"
                    )
                    continue
                
                # Check availability during this segment
                available_with_cap = [
                    p for p in persons_with_cap
                    if person_available_for_task(person_to_idx[p.id], t_idx)
                ]
                
                if len(available_with_cap) < required_count:
                    unavailable_ids = [
                        p.id for p in persons_with_cap
                        if not person_available_for_task(person_to_idx[p.id], t_idx)
                    ]
                    errors.append(
                        f"Task '{task.name}' (ID: {task.id}) at {time_str}: "
                        f"Not enough available '{cap_name}'  -  needs {required_count}, "
                        f"only {len(available_with_cap)} of {total_with_cap} available. "
                        f"Unavailable: persons {unavailable_ids}"
                    )
                    continue

                # Reachability: can enough people physically get to the location?
                if task.location_id is not None:
                    can_reach = []
                    cannot_reach = []
                    for p in available_with_cap:
                        if _can_person_reach(p, task.location_id, task_segment_idx, segments, transfers):
                            can_reach.append(p.id)
                        else:
                            cannot_reach.append(p.id)
                    
                    if len(can_reach) < required_count:
                        errors.append(
                            f"Task '{task.name}' (ID: {task.id}) at {time_str} in Location {task.location_id}: "
                            f"Not enough '{cap_name}' can reach this location  -  needs {required_count}, "
                            f"only {len(can_reach)} reachable. "
                            f"Cannot reach: persons {cannot_reach}"
                        )

            # --- Preassigned person checks ---
            if task.preassigned_person_ids:
                for pid in task.preassigned_person_ids:
                    if pid not in person_to_idx:
                        errors.append(
                            f"Task '{task.name}' (ID: {task.id}) at {time_str}: "
                            f"Preassigned person {pid} not found"
                        )
                        continue
                    
                    p_idx = person_to_idx[pid]
                    person = persons[p_idx]
                    
                    if not person_available_for_task(p_idx, t_idx):
                        errors.append(
                            f"Task '{task.name}' (ID: {task.id}) at {time_str}: "
                            f"Preassigned person {pid} is unavailable at this time"
                        )
                    elif task.location_id is not None and not _can_person_reach(
                        person, task.location_id, task_segment_idx, segments, transfers
                    ):
                        errors.append(
                            f"Task '{task.name}' (ID: {task.id}) at {time_str} in Location {task.location_id}: "
                            f"Preassigned person {pid} cannot reach this location"
                        )

        # --- Concurrent demand: do overlapping tasks in a segment exceed capacity? ---
        for s_idx, segment in enumerate(segments):
            if len(segment.task_indices) <= 1:
                continue
            time_str = f"{minutes_to_time_str(segment.start_time)}-{minutes_to_time_str(segment.end_time)}"
            total_demand: dict[str, int] = {}
            task_names = []
            for t_idx in segment.task_indices:
                t = tasks[t_idx]
                task_names.append(f"'{t.name}' (ID: {t.id})")
                for cap, cnt in t.requirements.items():
                    total_demand[cap] = total_demand.get(cap, 0) + cnt
            
            for cap_name, demand in total_demand.items():
                supply = sum(
                    1 for p in persons
                    if cap_name in p.capabilities and availability[person_to_idx[p.id]][s_idx]
                )
                if demand > supply:
                    errors.append(
                        f"Time {time_str}: Overlapping tasks need {demand} '{cap_name}' "
                        f"but only {supply} available. Tasks: {', '.join(task_names)}"
                    )

        if not errors:
            fallback = core_fallback_issue(normalized_input)
            errors.append(fallback.message)
            
    elif status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        print("\n[OK] FEASIBLE - Valid assignment exists")
        
        # Print solution summary for debug
        fully_covered_count = sum(1 for t in range(num_tasks) if solver.Value(task_fully_covered[t]) == 1)
        print(f"\nFully covered tasks: {fully_covered_count}/{num_tasks}")
        
        # Check uncovered tasks and diagnose why
        for t_idx, task in enumerate(tasks):
            if solver.Value(task_fully_covered[t_idx]) == 1:
                continue
            
            # Skip unchosen floating-task candidates
            ft_idx = task_to_floating.get(t_idx)
            if ft_idx is not None:
                choice_var = float_choice.get((ft_idx, t_idx))
                if choice_var is not None and solver.Value(choice_var) == 0:
                    continue
            
            task_segment_idx = None
            for s_idx, seg in enumerate(segments):
                if t_idx in seg.task_indices:
                    task_segment_idx = s_idx
                    break
            
            if task_segment_idx is None:
                continue
                
            segment = segments[task_segment_idx]
            time_str = f"{minutes_to_time_str(segment.start_time)}-{minutes_to_time_str(segment.end_time)}"
            task_has_errors = False
            
            for cap_name, req_count in task.requirements.items():
                if cap_name not in capability_to_idx:
                    continue
                c_idx = capability_to_idx[cap_name]
                assigned_count = sum(1 for p in range(num_persons) if solver.Value(x[p, t_idx, c_idx]) == 1)
                missing = req_count - assigned_count
                
                if missing > 0:
                    # Diagnose WHY people couldn't be assigned
                    persons_with_cap = [p for p in persons if cap_name in p.capabilities]
                    available_with_cap = [
                        p for p in persons_with_cap
                        if person_available_for_task(person_to_idx[p.id], t_idx)
                    ]
                    
                    reason = ""
                    if len(persons_with_cap) < req_count:
                        reason = f"  -  only {len(persons_with_cap)} exist with this capability"
                    elif len(available_with_cap) < req_count:
                        reason = f"  -  only {len(available_with_cap)} of {len(persons_with_cap)} available at this time"
                    else:
                        # Enough exist and are available  -  must be location/booking conflict
                        # Check how many other tasks compete for this capability in this segment
                        competing_demand = 0
                        competing_names = []
                        for other_t_idx in segment.task_indices:
                            if other_t_idx == t_idx:
                                continue
                            other_task = tasks[other_t_idx]
                            other_req = other_task.requirements.get(cap_name, 0)
                            if other_req > 0:
                                competing_demand += other_req
                                competing_names.append(other_task.name)
                        
                        if competing_demand > 0:
                            total_demand = req_count + competing_demand
                            reason = (
                                f"  -  {len(available_with_cap)} available but {total_demand} needed at this time "
                                f"(also needed by: {', '.join(competing_names)})"
                            )
                        elif task.location_id is not None:
                            reachable = sum(
                                1 for p in available_with_cap
                                if _can_person_reach(p, task.location_id, task_segment_idx, segments, transfers)
                            )
                            if reachable < req_count:
                                reason = f"  -  only {reachable} can reach this location in time"
                            else:
                                reason = "  -  location/scheduling conflict with other tasks"
                        else:
                            reason = "  -  scheduling conflict with other tasks"
                    
                    loc_label = f"in Location {task.location_id}" if task.location_id is not None else ""
                    errors.append(
                        f"Task '{task.name}' (ID: {task.id}) at {time_str} {loc_label}: "
                        f"Needs {req_count} '{cap_name}', got {assigned_count}{reason}"
                    )
                    task_has_errors = True
            
            if not task_has_errors:
                loc_label = f"in Location {task.location_id}" if task.location_id is not None else ""
                errors.append(
                    f"Task '{task.name}' (ID: {task.id}) at {time_str} {loc_label}: "
                    f"Cannot be fully covered  -  scheduling conflict"
                )
    
    else:
        print(f"Solver returned status: {solver.StatusName(status)}")
    
    print("\n" + "=" * 80)
    
    if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE, cp_model.INFEASIBLE]:
        issue = DiagnosticIssue(
            code="SOLVER_UNDETERMINED",
            category="solver",
            message=(
                "The flow checker stopped before it could prove whether all "
                "requirements are satisfiable."
            ),
            facts=(("Solver status", solver.StatusName(status)),),
            suggestions=("Run the check again or increase the solver time limit.",),
        )
        return result([issue.message], "undetermined", [issue])
    if errors:
        issues = [legacy_message_issue(message, normalized_input) for message in errors]
        return result(errors, "infeasible", issues)
    return result([], "feasible", [])
