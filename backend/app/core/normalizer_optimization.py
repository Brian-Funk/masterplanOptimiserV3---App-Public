"""
Data Normaliser for Optimisation - Converts raw API data into standardised format for optimisation.

This module provides normalisation functions that transform API data (tasks, persons, locations, capabilities)
into a clean, standardised format specifically for the optimisation engine, including:
- Fatigue scores per task type
- Break definitions and recovery rates
- Person availability and constraints
"""

from typing import List, Dict, Optional, Any, Tuple
from dataclasses import dataclass, field
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.debug_logging import debug_print
from app.core.group_member_resolution import resolve_group_assignment_for_task
from app.core.unavailability import normalize_unavailable_intervals


# ============================================================================
# Helper Functions
# ============================================================================

def time_to_minutes(time_input: Any) -> Optional[int]:
    """
    Convert time to minutes since midnight.
    Accepts: int (already in minutes), str ("HH:MM"), or None
    """
    if time_input is None:
        return None
    if isinstance(time_input, int):
        return time_input
    if isinstance(time_input, str):
        try:
            hours, minutes = map(int, time_input.split(':'))
            return hours * 60 + minutes
        except (ValueError, AttributeError):
            return None
    return None


# ============================================================================
# Normalised Data Classes for Optimisation
# ============================================================================

@dataclass
class OptimNormPerson:
    """Person data for optimisation."""
    id: int
    name: str
    initial_location_id: Optional[int]
    capabilities: List[str]  # canonical capability ids (machine_names like "is_ho")
    
    # Maximum working minutes per day (None = no limit)
    max_work_minutes_per_day: Optional[int] = None
    
    # List of unavailable intervals (start_time, end_time) in minutes since midnight
    # Example: [(0, 480), (1320, 1440)] means unavailable 00:00-08:00 and 22:00-24:00
    unavailable_intervals: List[Tuple[int, int]] = field(default_factory=list)
    
    # Initial fatigue carry-over from previous day (0.0 = fresh start)
    initial_fatigue: float = 0.0


@dataclass
class OptimNormTask:
    """Task data for optimisation."""
    id: int
    name: str
    location_id: Optional[int]  # None means "any location"  -  solver picks
    start_time: int  # minutes since midnight (e.g., 420 = 07:00)
    end_time: int    # minutes since midnight (e.g., 480 = 08:00)
    required_capabilities: Dict[str, int]  # capability_id -> count
    preassigned_person_ids: List[int] = field(default_factory=list)  # Optional preassigned persons
    
    # Fatigue rate per minute for this task
    # Positive = straining work, Negative = recovery/break
    fatigue_per_minute: float = 1.0
    
    # Per-field requirement tracking: field_id -> {cap_name: count}
    field_requirements: Dict[str, Dict[str, int]] = field(default_factory=dict)
    counts_towards_work_time: bool = True


@dataclass
class OptimNormTransfer:
    """Transfer/transport data for optimisation."""
    id: int
    from_location_id: int
    to_location_id: int
    depart_time: int  # minutes since midnight
    arrive_time: int  # minutes since midnight
    capacity: int
    required_capabilities: Dict[str, int]  # capability_id -> count
    optional_capacity_slots: int = 0  # How many additional people can board beyond required_capabilities
    field_requirements: Dict[str, Dict[str, int]] = field(default_factory=dict)  # field_id -> {cap_name: count}
    transferee_field_id: Optional[str] = None  # field_id for the transferee field
    locked_person_ids: List[int] = field(default_factory=list)  # Direct transfer passengers from persons_list fields
    person_field_assignments: Dict[str, List[int]] = field(default_factory=dict)  # field_id -> direct passenger ids
    counts_towards_work_time: bool = True


@dataclass
class OptimNormFloatingTask:
    """Floating task (one of multiple time slot options) for optimisation."""
    id: int
    name: str
    candidates: List[OptimNormTask]  # Multiple possible time slots


@dataclass
class NormalizedOptimizationInput:
    """Complete normalised input for optimisation."""
    tasks: List[OptimNormTask]
    persons: List[OptimNormPerson]
    transfers: List[OptimNormTransfer]
    floating_tasks: List[OptimNormFloatingTask]
    errors: List[str]  # warnings/errors from parsing


# ============================================================================
# Pydantic Models for API Input
# ============================================================================

class OptimizationTask(BaseModel):
    """Task as received from API"""
    id: int
    name: Optional[str] = None
    task_type_id: int  # Required to fetch fatigue score
    template_id: Optional[int] = None
    location_id: Optional[int] = None  # None means "any location"  -  solver picks
    date: Optional[str] = None
    is_floating: bool = False  # True = floating task (time_range+duration), False = static task (start_end_time)
    is_transfer: bool = False  # True = transfer task
    counts_towards_work_time: bool = True
    start_time: Optional[int] = None  # minutes since midnight (only for static tasks)
    end_time: Optional[int] = None    # minutes since midnight (only for static tasks)
    num_persons_required: Optional[int] = 1
    preassigned_person_id: Optional[int] = None
    constraints: Optional[Dict[str, Any]] = None  # Optimisation inputs from task
    field_values: Optional[Dict[str, Any]] = None  # Template field values from task


class OptimizationPerson(BaseModel):
    """Person as received from API"""
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    home_location_id: Optional[int] = None
    initial_location_id: Optional[int] = None
    max_hours_per_day: Optional[float] = None
    capabilities: Optional[List[str]] = None
    unavailabilities: List[Dict[str, str]] = Field(default_factory=list)
    initial_fatigue: float = 0.0


class OptimizationLocation(BaseModel):
    """Location as received from API"""
    id: int
    name: str


class OptimizationCapability(BaseModel):
    """Capability as received from API"""
    id: Optional[int] = None
    machine_name: str
    name: str


# ============================================================================
# Normalization Functions
# ============================================================================

def minutes_to_time_str(minutes: int) -> str:
    """Convert minutes since midnight to HH:MM string."""
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"


def normalise_end_minutes(start_minutes: int, end_minutes: int) -> int:
    """Return a linear end time, allowing tasks to cross midnight."""
    if end_minutes <= start_minutes:
        return end_minutes + 24 * 60
    return end_minutes


def parse_time_to_minutes(time_str: str) -> int:
    """Convert HH:MM time string to minutes since midnight."""
    try:
        hours, minutes = map(int, time_str.split(':'))
        return hours * 60 + minutes
    except:
        return 0


def parse_dynamic_allocation_value(value: Any, task_id: int, task_name: Optional[str], field_id: str, errors: List[str]) -> int:
    """Parse a transfer dynamic passenger allocation field into a non-negative integer."""
    if value is None:
        return 0
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return 0
        try:
            parsed = int(stripped)
        except ValueError:
            errors.append(
                f"Transfer task {task_id} ({task_name}) has invalid dynamic allocation in {field_id}. Use a whole number."
            )
            return 0
        if parsed < 0:
            errors.append(
                f"Transfer task {task_id} ({task_name}) has invalid dynamic allocation in {field_id}. Use zero or a positive number."
            )
            return 0
        return parsed
    if isinstance(value, bool):
        errors.append(
            f"Transfer task {task_id} ({task_name}) has invalid dynamic allocation in {field_id}. Use a whole number."
        )
        return 0
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            errors.append(
                f"Transfer task {task_id} ({task_name}) has invalid dynamic allocation in {field_id}. Use a whole number."
            )
            return 0
        parsed = int(value)
        if parsed < 0:
            errors.append(
                f"Transfer task {task_id} ({task_name}) has invalid dynamic allocation in {field_id}. Use zero or a positive number."
            )
            return 0
        return parsed

    errors.append(
        f"Transfer task {task_id} ({task_name}) has invalid dynamic allocation in {field_id}. Use a whole number."
    )
    return 0


def normalize_optimization_input(
    tasks: List[OptimizationTask],
    persons: List[OptimizationPerson],
    locations: List[OptimizationLocation],
    capabilities: List[OptimizationCapability],
    task_type_fatigue_map: Dict[int, float],  # task_type_id -> fatigue_per_minute
    db: Optional[Session] = None,
    event_id: Optional[int] = None,
    working_day_date: Optional[str] = None,
    working_day_boundary_offset_hour: int = 0,
) -> NormalizedOptimizationInput:
    """
    Normalise optimisation input data.
    
    Args:
        tasks: Raw task data from API
        persons: Raw person data from API
        locations: Raw location data from API
        capabilities: Raw capability data from API
        task_type_fatigue_map: Mapping of task_type_id to fatigue_per_minute
        db: Optional database session for loading template field metadata
        event_id: Optional event scope for resolving live group references
        
    Returns:
        NormalizedOptimizationInput with all data in standardised format
    """
    debug_print("\n" + "="*80)
    debug_print("NORMALISING OPTIMISATION INPUT")
    debug_print("="*80)
    debug_print(f"Input counts:")
    debug_print(f"  - Tasks: {len(tasks)}")
    debug_print(f"  - Persons: {len(persons)}")
    debug_print(f"  - Locations: {len(locations)}")
    debug_print(f"  - Capabilities: {len(capabilities)}")
    debug_print(f"  - Task type fatigue scores: {len(task_type_fatigue_map)}")
    
    # Load template field type metadata from database if available
    template_fields_map = {}  # template_id -> {field_id -> field_type}
    template_flags_map = {}
    if db:
        from app.models.task_template import TaskTemplate
        templates = db.query(TaskTemplate).all()
        for template in templates:
            template_flags_map[template.id] = {
                "is_transfer": bool(template.is_transfer),
                "is_floating": bool(template.is_floating),
            }
            if template.fields:
                template_fields_map[template.id] = {}
                for field_def in template.fields:
                    if isinstance(field_def, dict) and 'id' in field_def and 'type' in field_def:
                        template_fields_map[template.id][field_def['id']] = field_def['type']
        debug_print(f"  - Loaded template metadata for {len(template_fields_map)} templates")
        # DEBUG: Print detailed template info
        for template_id, fields in template_fields_map.items():
            persons_fields = {fid: ftype for fid, ftype in fields.items() if ftype == 'persons_list'}
            if persons_fields:
                debug_print(f"    Template {template_id} has {len(persons_fields)} persons_list fields: {list(persons_fields.keys())}")
    else:
        debug_print("  - WARNING: No database session provided, field types unavailable")
    
    # Build person ID set for validation
    person_id_set = {p.id for p in persons}
    
    debug_print("\nTask type fatigue map:")
    for task_type_id, fatigue in task_type_fatigue_map.items():
        debug_print(f"  TaskType {task_type_id}: {fatigue} per minute")
    
    debug_print("\nRaw input data:")
    debug_print(f"\nFirst 3 tasks (raw):")
    for i, task in enumerate(tasks[:3]):
        debug_print(f"  Task {i}: {task.model_dump()}")
    
    debug_print(f"\nFirst 3 persons (raw):")
    for i, person in enumerate(persons[:3]):
        debug_print(f"  Person {i}: {person.model_dump()}")
    
    debug_print(f"\nAll locations:")
    for loc in locations:
        debug_print(f"  Location {loc.id}: {loc.name}")
    
    debug_print(f"\nAll capabilities:")
    for cap in capabilities:
        debug_print(f"  Capability {getattr(cap, 'id', None)}: {cap.name} ({cap.machine_name})")
    
    # Build capability ID to machine_name mapping for converting task requirements
    cap_id_to_machine_name = {
        cap.id: cap.machine_name
        for cap in capabilities
        if getattr(cap, "id", None) is not None
    }
    debug_print(f"\nCapability ID mapping: {cap_id_to_machine_name}")
    
    errors = []
    
    # Normalise persons
    norm_persons = []
    person_unavailability_map: Dict[int, List[Tuple[int, int]]] = {}
    for person in persons:
        caps = person.capabilities or []
        
        # Convert max hours to minutes
        max_work_minutes = None
        if person.max_hours_per_day:
            max_work_minutes = int(person.max_hours_per_day * 60)
        
        unavailable_intervals, unavailable_warnings = normalize_unavailable_intervals(
            person.unavailabilities,
            selected_working_date=working_day_date,
            working_day_boundary_offset_hour=working_day_boundary_offset_hour,
        )
        for warning in unavailable_warnings:
            errors.append(f"Person {person.id}: {warning}")
        person_unavailability_map[person.id] = unavailable_intervals
        
        # Determine initial location
        initial_loc = person.initial_location_id or person.home_location_id
        
        # Build full name
        name = f"{person.first_name or ''} {person.last_name or ''}".strip()
        if not name:
            name = f"Person {person.id}"
        
        norm_persons.append(OptimNormPerson(
            id=person.id,
            name=name,
            initial_location_id=initial_loc,
            capabilities=caps,
            max_work_minutes_per_day=max_work_minutes,
            unavailable_intervals=unavailable_intervals,
            initial_fatigue=float(person.initial_fatigue or 0.0)
        ))
    
    def resolve_person_field_for_task(
        field_value: Any,
        task_id: int,
        task_name: Optional[str],
        task_start: Optional[int],
        task_end: Optional[int],
        label: str,
    ) -> Tuple[List[int], List[str]]:
        resolved_assignment = resolve_group_assignment_for_task(
            field_value,
            db,
            person_id_set,
            event_id=event_id,
            person_unavailable_intervals=person_unavailability_map,
            task_start=task_start,
            task_end=task_end,
        )
        for excluded in resolved_assignment.excluded_persons:
            debug_print(
                f"  {label} {task_id} - Excluded {excluded.person_id} from "
                f"{excluded.group_name}: unavailable {excluded.unavailable_from}-{excluded.unavailable_to}"
            )
        for warning in resolved_assignment.warnings:
            if warning.startswith("All members of"):
                errors.append(f"{label} {task_id} ({task_name or 'Unnamed'}): {warning}")
        return resolved_assignment.person_ids, resolved_assignment.warnings

    # Build capability ID to machine_name mapping from capabilities list
    capability_map = {}
    for cap in capabilities:
        # OptimizationCapability is a Pydantic model with machine_name attribute
        capability_map[cap.machine_name] = cap.machine_name
    
    debug_print(f"\nCapability mapping for optimisation: {capability_map}")
    
    # Separate tasks into transfers, floating tasks, and static tasks
    norm_tasks = []
    norm_floating_tasks = []
    norm_transfers = []
    
    for task in tasks:
        counts_towards_work_time = (
            getattr(task, "counts_towards_work_time", True) is not False
        )
        template_flags = template_flags_map.get(task.template_id)
        # Template metadata is authoritative when available. Stored task
        # instance flags can be stale after template changes or imports.
        is_transfer = template_flags["is_transfer"] if template_flags else task.is_transfer
        is_floating = template_flags["is_floating"] if template_flags else task.is_floating
        
        if is_transfer:
            # TRANSFER TASK: Extract from/to locations and time
            from_loc = None
            to_loc = None
            start_time_minutes = None
            end_time_minutes = None
            capacity_requirements = {}
            dynamic_allocation_limit = None
            dynamic_allocation_seen = False
            per_field_requirements = {}  # field_id -> {cap_name: count}
            transferee_field_id = None
            locked_transfer_person_ids = []
            transfer_person_field_assignments = {}
            
            # Get field type map for this template
            template_field_types = template_fields_map.get(task.template_id, {})
            
            # Extract from field_values (like flow checker does)
            if task.field_values:
                # Extract time - look for field_time_ prefix
                for field_id, field_value in task.field_values.items():
                    if 'field_time' in field_id and isinstance(field_value, dict) and 'start' in field_value and 'end' in field_value:
                        start_time_minutes = parse_time_to_minutes(field_value['start'])
                        end_time_minutes = parse_time_to_minutes(field_value['end'])
                        break

            if start_time_minutes is None and task.start_time is not None:
                start_time_minutes = time_to_minutes(task.start_time)
            if end_time_minutes is None and task.end_time is not None:
                end_time_minutes = time_to_minutes(task.end_time)
                
            if task.field_values:
                # Extract locations, dynamic allocation, and detect transferee field
                for field_id, field_value in task.field_values.items():
                    field_type = template_field_types.get(field_id)
                    
                    if field_type == 'transferee':
                        transferee_field_id = field_id
                    elif (
                        ('start_location' in field_id.lower() or 'from_location' in field_id.lower())
                        and isinstance(field_value, int)
                        and field_value > 0
                    ):
                        from_loc = field_value
                    elif (
                        ('end_location' in field_id.lower() or 'to_location' in field_id.lower())
                        and isinstance(field_value, int)
                        and field_value > 0
                    ):
                        to_loc = field_value
                    elif 'dynamic_allocation' in field_id.lower() or 'dynamic_transfer' in field_id.lower():
                        dynamic_allocation_seen = True
                        dynamic_allocation_limit = parse_dynamic_allocation_value(
                            field_value,
                            task.id,
                            task.name,
                            field_id,
                            errors,
                        )
                
                # Also detect transferee field by type even if field_value is None/empty
                if not transferee_field_id:
                    for field_id in template_field_types:
                        if template_field_types[field_id] == 'transferee':
                            transferee_field_id = field_id
                            break
                
                # Extract capability requirements  -  track per-field
                for field_id, field_value in task.field_values.items():
                    field_type = template_field_types.get(field_id)
                    if field_type == 'capabilities_list' and isinstance(field_value, list):
                        field_caps = {}
                        for item in field_value:
                            if isinstance(item, dict):
                                if 'machine_name' in item:
                                    cap_name = item['machine_name']
                                    quantity = item.get('amount', item.get('quantity', 1))
                                    capacity_requirements[cap_name] = capacity_requirements.get(cap_name, 0) + quantity
                                    field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                                elif 'id' in item and 'quantity' in item:
                                    cap_id = item['id']
                                    quantity = item['quantity']
                                    cap_name = cap_id_to_machine_name.get(cap_id, f"cap_{cap_id}")
                                    capacity_requirements[cap_name] = capacity_requirements.get(cap_name, 0) + quantity
                                    field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                        if field_caps:
                            per_field_requirements[field_id] = field_caps
                    elif (
                        isinstance(field_value, list)
                        and (
                            field_type == 'persons_list'
                            or (
                                field_type is None
                                and any(
                                    isinstance(item, dict) and item.get("type") in {"person", "group"}
                                    for item in field_value
                                )
                            )
                        )
                    ):
                        valid_person_ids, group_warnings = resolve_person_field_for_task(
                            field_value,
                            task.id,
                            task.name,
                            start_time_minutes,
                            end_time_minutes,
                            'Transfer',
                        )
                        if valid_person_ids:
                            transfer_person_field_assignments[field_id] = valid_person_ids
                            locked_transfer_person_ids.extend(valid_person_ids)
                            debug_print(
                                f"  Transfer {task.id} - Direct passengers locked to: {valid_person_ids}"
                            )
                        for warning in group_warnings:
                            debug_print(f"  Transfer {task.id} - WARNING: {warning}")
                    elif isinstance(field_value, list) and field_type != 'persons_list':
                        # Fallback: detect capability list fields without template metadata
                        field_caps = {}
                        for item in field_value:
                            if isinstance(item, dict):
                                if 'machine_name' in item:
                                    cap_name = item['machine_name']
                                    quantity = item.get('amount', item.get('quantity', 1))
                                    capacity_requirements[cap_name] = capacity_requirements.get(cap_name, 0) + quantity
                                    field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                                elif 'id' in item and 'quantity' in item:
                                    cap_id = item['id']
                                    quantity = item['quantity']
                                    cap_name = cap_id_to_machine_name.get(cap_id, f"cap_{cap_id}")
                                    capacity_requirements[cap_name] = capacity_requirements.get(cap_name, 0) + quantity
                                    field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                        if field_caps:
                            per_field_requirements[field_id] = field_caps
            
            # Validate transfer has required fields
            if not from_loc or not to_loc:
                errors.append(f"Transfer task {task.id} ({task.name}) missing from/to locations")
                continue
            
            if start_time_minutes is None or end_time_minutes is None:
                errors.append(f"Transfer task {task.id} ({task.name}) missing start/end time")
                continue
            end_time_minutes = normalise_end_minutes(
                start_time_minutes,
                end_time_minutes,
            )
            
            # Calculate transfer capacity
            required_staff = sum(capacity_requirements.values()) if capacity_requirements else 0
            optional_slots = dynamic_allocation_limit if dynamic_allocation_limit is not None else 0
            locked_transfer_person_ids = list(dict.fromkeys(locked_transfer_person_ids))
            locked_passengers = len(locked_transfer_person_ids)
            total_capacity = locked_passengers + required_staff + optional_slots
            transfer_capacity = total_capacity if (total_capacity > 0 or dynamic_allocation_seen) else 999
            
            norm_transfers.append(OptimNormTransfer(
                id=task.id,
                from_location_id=from_loc,
                to_location_id=to_loc,
                depart_time=start_time_minutes,
                arrive_time=end_time_minutes,
                capacity=transfer_capacity,
                required_capabilities=capacity_requirements,
                optional_capacity_slots=optional_slots,
                field_requirements=per_field_requirements,
                transferee_field_id=transferee_field_id,
                locked_person_ids=locked_transfer_person_ids,
                person_field_assignments=transfer_person_field_assignments,
                counts_towards_work_time=counts_towards_work_time,
            ))
            
        else:
            # Check if this is a floating task
            if is_floating:
                # FLOATING TASK: Has time_range (window) + duration
                # Extract time_range and duration from field_values
                time_range_start = None
                time_range_end = None
                duration_minutes = None
                
                debug_print(f"\n  [FLOATING] Task {task.id} ({task.name}):")
                debug_print(f"    template_id={task.template_id}, field_values keys={list(task.field_values.keys()) if task.field_values else 'None'}")
                
                if task.field_values:
                    for key, value in task.field_values.items():
                        # Check for time_range field with field_time prefix or just time-like structure
                        if ('field_time' in key or 'time_range' in key.lower()) and isinstance(value, dict) and 'start' in value and 'end' in value:
                            time_range_start = parse_time_to_minutes(value['start'])
                            time_range_end = parse_time_to_minutes(value['end'])
                            debug_print(f"    Found time_range: key='{key}', start={value['start']} ({time_range_start}min), end={value['end']} ({time_range_end}min)")
                        # Check for duration field
                        if 'duration' in str(key).lower() and isinstance(value, (int, float)):
                            duration_minutes = int(value)
                            debug_print(f"    Found duration: key='{key}', value={duration_minutes}min")
                else:
                    debug_print(f"    WARNING: field_values is None or empty!")
                
                # Validate floating task has required fields
                if time_range_start is None or time_range_end is None:
                    errors.append(f"Floating task {task.id} ({task.name}) missing time_range field")
                    debug_print(f"    ERROR: Missing time_range  -  skipping this floating task")
                    continue
                
                if duration_minutes is None:
                    errors.append(f"Floating task {task.id} ({task.name}) missing duration field")
                    debug_print(f"    ERROR: Missing duration  -  skipping this floating task")
                    continue
                time_range_end = normalise_end_minutes(time_range_start, time_range_end)
                
                # Get fatigue rate from task type
                fatigue_per_minute = task_type_fatigue_map.get(task.task_type_id, 1.0)
                
                # Extract required capabilities and preassigned persons using field types
                required_caps = {}
                preassigned_person_ids = []
                person_field_values = []
                
                # Get field type map for this template
                template_field_types = template_fields_map.get(task.template_id, {})
                debug_print(f"    template_field_types lookup (template_id={task.template_id}): {template_field_types if template_field_types else 'EMPTY/NOT FOUND'}")
                
                if task.field_values:
                    for field_id, field_value in task.field_values.items():
                        # Get field type from template metadata
                        field_type = template_field_types.get(field_id)
                        debug_print(f"    field '{field_id}': type={field_type}, value_type={type(field_value).__name__}, value={repr(field_value)[:200]}")
                        
                        if field_type == 'persons_list' and isinstance(field_value, list):
                            person_field_values.append(field_value)
                            debug_print("      -> Will resolve persons_list per candidate time")
                        elif field_type == 'capabilities_list' and isinstance(field_value, list):
                            # Capabilities list - extract requirements
                            for item in field_value:
                                if isinstance(item, dict):
                                    if 'machine_name' in item:
                                        cap_name = item['machine_name']
                                        quantity = item.get('amount', item.get('quantity', 1))
                                        required_caps[cap_name] = required_caps.get(cap_name, 0) + quantity
                                        debug_print(f"      -> Extracted capability: {cap_name} x{quantity}")
                                    elif 'id' in item and 'quantity' in item:
                                        cap_id = item['id']
                                        quantity = item['quantity']
                                        cap_name = cap_id_to_machine_name.get(cap_id, f"cap_{cap_id}")
                                        required_caps[cap_name] = required_caps.get(cap_name, 0) + quantity
                                        debug_print(f"      -> Extracted capability (by id): {cap_name} x{quantity}")
                        elif field_type is None and isinstance(field_value, list) and len(field_value) > 0:
                            # Fallback: detect field type by data shape when template metadata is missing
                            if any(isinstance(item, dict) and item.get("type") in {"person", "group"} for item in field_value):
                                person_field_values.append(field_value)
                                debug_print("      -> FALLBACK: Will resolve person/group references per candidate time")
                            elif all(isinstance(pid, int) for pid in field_value):
                                # Looks like person IDs
                                valid_person_ids = [pid for pid in field_value if pid in person_id_set]
                                if valid_person_ids:
                                    preassigned_person_ids.extend(valid_person_ids)
                                    debug_print(f"      -> FALLBACK: Detected persons by shape: {valid_person_ids}")
                                else:
                                    debug_print(f"      -> WARNING: list of ints but no valid person IDs (raw={field_value})")
                            elif any(isinstance(item, dict) and 'machine_name' in item for item in field_value):
                                # Looks like capabilities
                                for item in field_value:
                                    if isinstance(item, dict) and 'machine_name' in item:
                                        cap_name = item['machine_name']
                                        quantity = item.get('amount', item.get('quantity', 1))
                                        required_caps[cap_name] = required_caps.get(cap_name, 0) + quantity
                                        debug_print(f"      -> FALLBACK: Detected capability by shape: {cap_name} x{quantity}")
                            else:
                                debug_print(f"      -> WARNING: list field with no template type and unknown shape")
                
                preassigned_person_ids = list(dict.fromkeys(preassigned_person_ids))
                debug_print(f"    RESULT: required_caps={required_caps}, preassigned_person_ids={preassigned_person_ids}")
                
                # Generate candidate time slots at hourly intervals within the time window
                candidates = []
                current_start = time_range_start
                while current_start + duration_minutes <= time_range_end:
                    candidate_preassigned_person_ids = list(preassigned_person_ids)
                    for person_field_value in person_field_values:
                        valid_person_ids, group_warnings = resolve_person_field_for_task(
                            person_field_value,
                            task.id,
                            task.name,
                            current_start,
                            current_start + duration_minutes,
                            'Floating Task',
                        )
                        if valid_person_ids:
                            candidate_preassigned_person_ids.extend(valid_person_ids)
                        for warning in group_warnings:
                            debug_print(f"      -> Candidate {current_start}-{current_start + duration_minutes} WARNING: {warning}")
                    candidate_preassigned_person_ids = list(dict.fromkeys(candidate_preassigned_person_ids))
                    candidates.append(
                        OptimNormTask(
                            id=task.id,
                            name=task.name or f"Task {task.id}",
                            location_id=task.location_id,
                            start_time=current_start,
                            end_time=current_start + duration_minutes,
                            required_capabilities=required_caps,
                            preassigned_person_ids=candidate_preassigned_person_ids,
                            fatigue_per_minute=fatigue_per_minute,
                            counts_towards_work_time=counts_towards_work_time,
                        )
                    )
                    current_start += 60  # Move forward by 1 hour
                
                debug_print(f"    Generated {len(candidates)} candidate time slots")
                if not candidates:
                    errors.append(f"Floating task {task.id} ({task.name}) generated 0 candidates (window {time_range_start}-{time_range_end}, duration {duration_minutes})")
                    debug_print(f"    ERROR: 0 candidates  -  window too small for duration!")
                    continue
                
                norm_floating_tasks.append(OptimNormFloatingTask(
                    id=task.id,
                    name=task.name or f"Floating Task {task.id}",
                    candidates=candidates
                ))
                
            else:
                # STATIC TASK: Has fixed start_time and end_time
                # Extract from field_values - look for field_time_ prefix
                start_time_minutes = None
                end_time_minutes = None
                
                if task.field_values:
                    for field_id, field_value in task.field_values.items():
                        # Look for field_time_ prefix (e.g., field_time_1766160056213)
                        if 'field_time' in field_id and isinstance(field_value, dict) and 'start' in field_value and 'end' in field_value:
                            start_time_str = field_value['start']
                            end_time_str = field_value['end']
                            start_time_minutes = parse_time_to_minutes(start_time_str)
                            end_time_minutes = parse_time_to_minutes(end_time_str)
                            break

                if start_time_minutes is None and task.start_time is not None:
                    start_time_minutes = time_to_minutes(task.start_time)
                if end_time_minutes is None and task.end_time is not None:
                    end_time_minutes = time_to_minutes(task.end_time)
                
                # Validate time range
                if start_time_minutes is None or end_time_minutes is None:
                    debug_print(f"DEBUG: Static task {task.id} ({task.name}) - start_time={start_time_minutes}, end_time={end_time_minutes}")
                    debug_print(f"  field_values: {task.field_values}")
                    errors.append(f"Static task {task.id} ({task.name}) missing start_time or end_time")
                    continue
                
                end_time_minutes = normalise_end_minutes(
                    start_time_minutes,
                    end_time_minutes,
                )
                
                # Get fatigue rate from task type
                fatigue_per_minute = task_type_fatigue_map.get(task.task_type_id, 1.0)
                
                # Extract required capabilities and preassigned persons using field types
                required_caps = {}
                preassigned_person_ids = []
                per_field_requirements = {}  # field_id -> {cap_name: count}
                
                # Get field type map for this template
                template_field_types = template_fields_map.get(task.template_id, {})
                
                if task.field_values:
                    for field_id, field_value in task.field_values.items():
                        # Get field type from template metadata
                        field_type = template_field_types.get(field_id)
                        
                        if field_type == 'persons_list' and isinstance(field_value, list):
                            # Persons list - resolve direct people and live group references
                            valid_person_ids, group_warnings = resolve_person_field_for_task(
                                field_value,
                                task.id,
                                task.name,
                                start_time_minutes,
                                end_time_minutes,
                                'Task',
                            )
                            if valid_person_ids:
                                preassigned_person_ids.extend(valid_person_ids)
                                debug_print(f"  Task {task.id} - Found preassigned persons: {valid_person_ids}")
                            for warning in group_warnings:
                                debug_print(f"  Task {task.id} - WARNING: {warning}")
                        
                        elif field_type == 'capabilities_list' and isinstance(field_value, list):
                            # Capabilities list - extract requirements and track per-field
                            field_caps = {}
                            for item in field_value:
                                if isinstance(item, dict):
                                    if 'machine_name' in item:
                                        cap_name = item['machine_name']
                                        quantity = item.get('amount', item.get('quantity', 1))
                                        required_caps[cap_name] = required_caps.get(cap_name, 0) + quantity
                                        field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                                    elif 'id' in item and 'quantity' in item:
                                        cap_id = item['id']
                                        quantity = item['quantity']
                                        cap_name = cap_id_to_machine_name.get(cap_id, f"cap_{cap_id}")
                                        required_caps[cap_name] = required_caps.get(cap_name, 0) + quantity
                                        field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                            if field_caps:
                                per_field_requirements[field_id] = field_caps
                
                preassigned_person_ids = list(dict.fromkeys(preassigned_person_ids))
                norm_tasks.append(OptimNormTask(
                    id=task.id,
                    name=task.name or f"Task {task.id}",
                    location_id=task.location_id,
                    start_time=start_time_minutes,
                    end_time=end_time_minutes,
                    required_capabilities=required_caps,
                    preassigned_person_ids=preassigned_person_ids,
                    fatigue_per_minute=fatigue_per_minute,
                    field_requirements=per_field_requirements,
                    counts_towards_work_time=counts_towards_work_time,
                ))
    
    # Print normalised results
    debug_print("\n" + "-"*80)
    debug_print("NORMALIZED OUTPUT")
    debug_print("-"*80)
    debug_print(f"Normalised counts:")
    debug_print(f"  - Static tasks: {len(norm_tasks)}")
    debug_print(f"  - Floating tasks: {len(norm_floating_tasks)}")
    debug_print(f"  - Transfers: {len(norm_transfers)}")
    debug_print(f"  - Persons: {len(norm_persons)}")
    debug_print(f"  - Errors: {len(errors)}")
    
    if errors:
        debug_print("\nNormalization errors:")
        for error in errors:
            debug_print(f"  - {error}")
    
    debug_print("\nNormalised persons:")
    for person in norm_persons[:5]:  # Show first 5
        debug_print(f"  Person {person.id} ({person.name}):")
        debug_print(f"    - Initial location: {person.initial_location_id}")
        debug_print(f"    - Capabilities: {person.capabilities}")
        debug_print(f"    - Max work minutes: {person.max_work_minutes_per_day}")
        debug_print(f"    - Unavailable intervals: {person.unavailable_intervals}")
    
    debug_print("\nNormalised static tasks:")
    for task in norm_tasks[:5]:  # Show first 5
        debug_print(f"  Task {task.id} ({task.name}):")
        debug_print(f"    - Location: {task.location_id}")
        debug_print(f"    - Time: {minutes_to_time_str(task.start_time)} - {minutes_to_time_str(task.end_time)}")
        debug_print(f"    - Fatigue per minute: {task.fatigue_per_minute}")
        debug_print(f"    - Required capabilities: {task.required_capabilities}")
        if task.preassigned_person_ids:
            debug_print(f"    - Preassigned to persons: {task.preassigned_person_ids}")

    
    if norm_floating_tasks:
        debug_print("\nNormalised floating tasks:")
        for task in norm_floating_tasks[:3]:
            debug_print(f"  Floating Task {task.id} ({task.name}):")
            debug_print(f"    - Number of candidates: {len(task.candidates)}")
            for i, candidate in enumerate(task.candidates[:2]):
                debug_print(f"      Candidate {i}: Location {candidate.location_id}, "
                      f"{minutes_to_time_str(candidate.start_time)}-{minutes_to_time_str(candidate.end_time)}")
    
    if norm_transfers:
        debug_print("\nNormalised transfers:")
        for transfer in norm_transfers[:3]:
            debug_print(f"  Transfer {transfer.id}:")
            debug_print(f"    - From location {transfer.from_location_id} to {transfer.to_location_id}")
            debug_print(f"    - Time: {minutes_to_time_str(transfer.depart_time)} - {minutes_to_time_str(transfer.arrive_time)}")
            debug_print(f"    - Capacity: {transfer.capacity}")
            debug_print(f"    - Required capabilities: {transfer.required_capabilities}")
            debug_print(f"    - Optional capacity slots: {transfer.optional_capacity_slots}")
    
    debug_print("="*80 + "\n")
    
    return NormalizedOptimizationInput(
        tasks=norm_tasks,
        persons=norm_persons,
        transfers=norm_transfers,
        floating_tasks=norm_floating_tasks,
        errors=errors
    )
