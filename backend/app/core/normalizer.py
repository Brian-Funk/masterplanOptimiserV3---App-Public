"""
Data Normaliser - Converts raw API data into standardised format for flow checking and optimisation.

This module provides normalization functions that transform API data (tasks, persons, locations, capabilities)
into a clean, standardised format that can be used by both the flow checker and optimiser.
"""

from typing import List, Dict, Optional, Any, Tuple
from dataclasses import dataclass, field
from pydantic import BaseModel, Field

from app.core.debug_logging import debug_print
from app.core.group_member_resolution import resolve_group_assignment_for_task
from app.core.unavailability import normalize_unavailable_intervals


# ============================================================================
# Normalised Data Classes
# ============================================================================

@dataclass
class NormPerson:
    id: int
    home_location_id: Optional[int]
    capabilities: List[str]  # canonical capability ids (machine_names like "is_ho")
    
    # Maximum working minutes per day (None = no limit)
    max_work_minutes_per_day: Optional[int] = None
    
    # List of unavailable intervals (start_time, end_time) in minutes since midnight
    # Example: [(0, 480), (1320, 1440)] means unavailable 00:00-08:00 and 22:00-24:00
    unavailable_intervals: List[Tuple[int, int]] = field(default_factory=list)


@dataclass
class NormTask:
    id: int
    name: str
    location_id: Optional[int]  # None means "any location"  -  solver picks
    start_time: int  # minutes since midnight (e.g., 420 = 07:00)
    end_time: int    # minutes since midnight (e.g., 480 = 08:00)
    requirements: Dict[str, int]  # capability_id -> count
    preassigned_person_ids: List[int] = field(default_factory=list)  # List of fixed assigned persons
    counts_towards_work_time: bool = True
    
    # Optional: for tasks that move people between locations (like transfers)
    from_location_id: Optional[int] = None  # Starting location (defaults to location_id)
    to_location_id: Optional[int] = None    # Ending location (defaults to location_id)
    
    # Per-field requirement tracking: field_id -> {cap_name: count}
    field_requirements: Dict[str, Dict[str, int]] = field(default_factory=dict)


@dataclass
class NormTransfer:
    id: int
    from_location_id: int
    to_location_id: int
    depart_time: int  # minutes since midnight
    arrive_time: int  # minutes since midnight
    capacity: int
    requirements: Dict[str, int]  # capability_id -> count (same as tasks)
    optional_capacity_slots: int = 0  # How many additional people can board beyond requirements
    field_requirements: Dict[str, Dict[str, int]] = field(default_factory=dict)  # field_id -> {cap_name: count}
    transferee_field_id: Optional[str] = None  # field_id for the transferee field
    locked_person_ids: List[int] = field(default_factory=list)  # Direct transfer passengers from persons_list fields
    person_field_assignments: Dict[str, List[int]] = field(default_factory=dict)  # field_id -> direct passenger ids
    counts_towards_work_time: bool = True


@dataclass
class NormFloatingTask:
    id: int
    name: str
    location_id: Optional[int]  # None means "any location"  -  solver picks
    window_start_time: int  # minutes since midnight
    window_end_time: int    # minutes since midnight
    duration: int           # minimum duration in minutes
    requirements: Dict[str, int]  # capability_id -> count
    preassigned_person_ids: List[int] = field(default_factory=list)  # List of fixed assigned persons
    counts_towards_work_time: bool = True


@dataclass
class NormalizedFlowInput:
    persons: List[NormPerson]
    tasks: List[NormTask]        # "normal" tasks that consume capability
    transfers: List[NormTransfer]
    floating_tasks: List[NormFloatingTask]  # tasks that can float within a time window
    errors: List[str]            # warnings/errors from parsing


# ============================================================================
# Pydantic Models for API Input
# ============================================================================

class Task(BaseModel):
    id: int  # Integer only (frontend converts float to int)
    template_id: Optional[int] = None
    name: Optional[str] = None
    task_type_id: Optional[int] = None
    event_id: Optional[int] = None
    location_id: Optional[int] = None  # None means "any location"  -  solver picks
    date: Optional[str] = None
    is_floating: bool = False  # True = floating task (time_range+duration), False = static task (start_end_time)
    is_transfer: bool = False  # True = transfer task (from/to locations), False = normal task (single location)
    counts_towards_work_time: bool = True
    field_values: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class Person(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    home_location_id: Optional[int] = None
    max_hours_per_day: Optional[float] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    capabilities: Optional[List[str]] = None
    unavailabilities: List[Dict[str, str]] = Field(default_factory=list)


class Location(BaseModel):
    id: int
    event_id: Optional[int] = None
    name: str
    address: Optional[str] = None
    link: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class Capability(BaseModel):
    id: int
    machine_name: str
    name: str


# ============================================================================
# Normalization Functions
# ============================================================================

def parse_time_to_minutes(time_str: str) -> int:
    """Convert HH:MM time string to minutes since midnight."""
    try:
        hours, minutes = map(int, time_str.split(':'))
        return hours * 60 + minutes
    except:
        return 0


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


def normalize_flow_input(
    tasks: List[Task],
    persons: List[Person],
    locations: List[Location],
    capabilities: List[Capability],
    db = None,
    working_day_date: Optional[str] = None,
    working_day_boundary_offset_hour: int = 0,
) -> NormalizedFlowInput:
    """
    Convert raw API data into normalised flow checking format.
    
    Args:
        tasks: Raw task data from API
        persons: Raw person data from API
        locations: Raw location data from API
        capabilities: List of all capabilities with id and machine_name
        db: Optional database session for loading templates
    
    Returns:
        NormalizedFlowInput with all data converted to standard format
    """
    errors = []
    
    # Build capability ID to machine_name mapping from capabilities list
    capability_map = {cap.id: cap.machine_name for cap in capabilities}
    
    # Build person ID set for validation
    person_id_set = {p.id for p in persons}
    event_id = next((task.event_id for task in tasks if task.event_id is not None), None)
    
    # Load template fields map if database session is available
    template_fields_map = {}
    template_flags_map = {}
    if db:
        try:
            from app.models.task_template import TaskTemplate
            templates = db.query(TaskTemplate).all()
            for template in templates:
                template_flags_map[template.id] = {
                    "is_transfer": bool(template.is_transfer),
                    "is_floating": bool(template.is_floating),
                }
                if template.fields:
                    template_fields_map[template.id] = {
                        field.get('id'): field.get('type')
                        for field in template.fields
                        if field.get('id') and field.get('type')
                    }
        except Exception as e:
            debug_print(f"Warning: Could not load task templates: {e}")
    
    debug_print(f"\nCapability ID to machine_name mapping: {capability_map}")
    
    # Normalise persons
    norm_persons = []
    person_unavailability_map: Dict[int, List[Tuple[int, int]]] = {}
    for person in persons:
        capabilities_list = person.capabilities or []
        
        debug_print(f"DEBUG Person {person.id} ({person.first_name} {person.last_name}): capabilities={capabilities_list}")
        
        # Extract max work hours (convert hours to minutes)
        max_work_minutes = None
        if hasattr(person, 'max_hours_per_day') and person.max_hours_per_day is not None:
            max_work_minutes = person.max_hours_per_day * 60
        
        unavailable_intervals, unavailable_warnings = normalize_unavailable_intervals(
            person.unavailabilities,
            selected_working_date=working_day_date,
            working_day_boundary_offset_hour=working_day_boundary_offset_hour,
        )
        for warning in unavailable_warnings:
            errors.append(f"Person {person.id}: {warning}")
        person_unavailability_map[person.id] = unavailable_intervals
        
        norm_person = NormPerson(
            id=person.id,
            home_location_id=person.home_location_id,
            capabilities=capabilities_list,
            max_work_minutes_per_day=max_work_minutes,
            unavailable_intervals=unavailable_intervals,
        )
        # Attach display metadata after construction so a development server
        # holding the previous NormPerson class can hot-reload safely.
        norm_person.name = (
            f"{person.first_name or ''} {person.last_name or ''}".strip()
            or f"Person {person.id}"
        )
        norm_persons.append(norm_person)
    
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
    # Separate tasks into normal tasks, floating tasks, and transfers
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
            # Extract transfer-specific fields from field_values
            from_loc = None
            to_loc = None
            start_time = None
            end_time = None
            capacity_requirements = {}
            dynamic_allocation_limit = None
            dynamic_allocation_seen = False
            per_field_requirements = {}  # field_id -> {cap_name: count}
            transferee_field_id = None
            locked_transfer_person_ids = []
            transfer_person_field_assignments = {}
            
            if task.field_values:
                debug_print(f"DEBUG Transfer {task.id} field_values: {task.field_values}")
                
                # Get field type map for this template (if available)
                template_field_types = template_fields_map.get(task.template_id, {})
                
                # Find time field (look for start_end_time or time_range)
                for field_id, field_value in task.field_values.items():
                    if isinstance(field_value, dict) and 'start' in field_value and 'end' in field_value:
                        start_time = field_value['start']
                        end_time = field_value['end']
                        break
                
                # Extract location fields, dynamic allocation, and detect transferee field
                for field_id, field_value in task.field_values.items():
                    field_type = template_field_types.get(field_id, '')
                    
                    if field_type == 'transferee':
                        transferee_field_id = field_id
                    elif 'start_location' in field_id.lower() and isinstance(field_value, int) and field_value > 0:
                        from_loc = field_value
                        debug_print(f"  Found start_location: {from_loc}")
                    elif 'end_location' in field_id.lower() and isinstance(field_value, int) and field_value > 0:
                        to_loc = field_value
                        debug_print(f"  Found end_location: {to_loc}")
                    elif 'dynamic_allocation' in field_id.lower() or 'dynamic_transfer' in field_id.lower():
                        dynamic_allocation_seen = True
                        dynamic_allocation_limit = parse_dynamic_allocation_value(
                            field_value,
                            task.id,
                            task.name,
                            field_id,
                            errors,
                        )
                        debug_print(f"  Found dynamic_allocation_limit: {dynamic_allocation_limit}")
                
                # Also detect transferee field by type from template metadata
                if not transferee_field_id and template_field_types:
                    for fid, ftype in template_field_types.items():
                        if ftype == 'transferee':
                            transferee_field_id = fid
                            break
                
                # Extract capability requirements from capabilities_list fields  -  track per field
                for field_id, field_value in task.field_values.items():
                    if isinstance(field_value, list):
                        debug_print(f"  DEBUG: Processing list field {field_id}: {field_value}")
                        field_caps = {}
                        for item in field_value:
                            if isinstance(item, dict):
                                # Check for capability object with machine_name
                                if 'machine_name' in item:
                                    cap_name = item['machine_name']
                                    quantity = item.get('amount', item.get('quantity', 1))
                                    capacity_requirements[cap_name] = capacity_requirements.get(cap_name, 0) + quantity
                                    field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                                    debug_print(f"    -> Added capability requirement: {cap_name} = {quantity}")
                                # Check for capability reference with just id and quantity
                                elif 'id' in item and 'quantity' in item:
                                    cap_id = item['id']
                                    quantity = item['quantity']
                                    # Look up machine_name from our mapping
                                    cap_name = capability_map.get(cap_id, f"cap_{cap_id}")
                                    capacity_requirements[cap_name] = capacity_requirements.get(cap_name, 0) + quantity
                                    field_caps[cap_name] = field_caps.get(cap_name, 0) + quantity
                                    debug_print(f"    -> Added capability requirement (from id {cap_id}): {cap_name} = {quantity}")
                        if field_caps:
                            per_field_requirements[field_id] = field_caps

                    field_type = template_field_types.get(field_id)
                    if (
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
                            parse_time_to_minutes(start_time) if start_time else None,
                            parse_time_to_minutes(end_time) if end_time else None,
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
            
            # Validate transfer has required fields
            if not from_loc or not to_loc:
                errors.append(f"Transfer task {task.id} ({task.name}) missing from/to locations")
                continue
            
            if not start_time or not end_time:
                errors.append(f"Transfer task {task.id} ({task.name}) missing start/end time")
                continue
            
            # Validate dynamic allocation limit is set (should be a locked field)
            if dynamic_allocation_limit is None:
                debug_print(f"  WARNING: Transfer {task.id} ({task.name}) missing dynamic_allocation_limit, defaulting to 0")
                dynamic_allocation_limit = 0
            
            depart_minutes = parse_time_to_minutes(start_time)
            arrive_minutes = parse_time_to_minutes(end_time)
            arrive_minutes = normalise_end_minutes(depart_minutes, arrive_minutes)
            
            # Determine transfer capacity:
            # Total capacity = required capability staff + dynamic allocation slots
            # - capability requirements (X): people who MUST be on transfer (e.g., 1 organizer)
            # - dynamic_allocation_limit (Y): additional slots for anyone else who needs the transfer
            # Example: organizer=1, dynamic_limit=2 â†’ total capacity = 3 (1 required + 2 optional)
            required_staff = sum(capacity_requirements.values()) if capacity_requirements else 0
            optional_slots = dynamic_allocation_limit if dynamic_allocation_limit is not None else 0
            locked_transfer_person_ids = list(dict.fromkeys(locked_transfer_person_ids))
            locked_passengers = len(locked_transfer_person_ids)
            total_capacity = locked_passengers + required_staff + optional_slots
            transfer_capacity = total_capacity if (total_capacity > 0 or dynamic_allocation_seen) else 999
            
            debug_print(
                f"DEBUG Transfer {task.id}: locked_passengers={locked_passengers}, "
                f"required_staff={required_staff}, optional_slots={optional_slots}, "
                f"total_capacity={transfer_capacity}"
            )
            debug_print(f"  capacity_requirements={capacity_requirements}")
            debug_print(f"  dynamic_allocation_limit={dynamic_allocation_limit}")
            if locked_transfer_person_ids:
                debug_print(f"  Direct assignments locked to: {locked_transfer_person_ids}")
            
            norm_transfers.append(NormTransfer(
                id=task.id,
                from_location_id=from_loc,
                to_location_id=to_loc,
                depart_time=depart_minutes,
                arrive_time=arrive_minutes,
                capacity=transfer_capacity,
                requirements=capacity_requirements,
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
                time_range_start = None
                time_range_end = None
                duration_minutes = None
                requirements = {}
                preassigned_person_ids = []  # Changed to list
                
                if task.field_values:
                    # Find time_range field
                    for field_id, field_value in task.field_values.items():
                        if isinstance(field_value, dict) and 'start' in field_value and 'end' in field_value:
                            time_range_start = field_value['start']
                            time_range_end = field_value['end']
                            break
                    
                    # Find duration field
                    for field_id, field_value in task.field_values.items():
                        if 'duration' in str(field_id).lower() and isinstance(field_value, (int, float)):
                            duration_minutes = int(field_value)
                            break
                    
                    # Extract capability requirements and assigned persons
                    for field_id, field_value in task.field_values.items():
                        if isinstance(field_value, list):
                            # Check field type from template
                            field_type = template_fields_map.get(task.template_id, {}).get(field_id)
                            
                            if field_type == 'persons_list':
                                # Persons list - resolve direct people and live group references
                                valid_person_ids, group_warnings = resolve_person_field_for_task(
                                    field_value,
                                    task.id,
                                    task.name,
                                    None,
                                    None,
                                    'Floating Task',
                                )
                                if valid_person_ids:
                                    preassigned_person_ids = valid_person_ids
                                    debug_print(f"  Floating Task {task.id} - Found preassigned persons: {preassigned_person_ids}")
                                for warning in group_warnings:
                                    debug_print(f"  Floating Task {task.id} - WARNING: {warning}")
                            
                            elif field_type == 'capabilities_list':
                                # Capabilities list - extract requirements
                                for item in field_value:
                                    if isinstance(item, dict):
                                        if 'machine_name' in item:
                                            cap_name = item['machine_name']
                                            quantity = item.get('amount', item.get('quantity', 1))
                                            requirements[cap_name] = requirements.get(cap_name, 0) + quantity
                                        elif 'id' in item and 'quantity' in item:
                                            cap_id = item['id']
                                            quantity = item['quantity']
                                            cap_name = capability_map.get(cap_id, f"cap_{cap_id}")
                                            requirements[cap_name] = requirements.get(cap_name, 0) + quantity
                
                # Validate floating task has required fields
                if not time_range_start or not time_range_end:
                    errors.append(f"Floating task {task.id} ({task.name}) missing time_range field")
                    continue
                
                if duration_minutes is None or duration_minutes <= 0:
                    errors.append(f"Floating task {task.id} ({task.name}) missing or invalid duration field")
                    continue
                
                window_start_minutes = parse_time_to_minutes(time_range_start)
                window_end_minutes = parse_time_to_minutes(time_range_end)
                window_end_minutes = normalise_end_minutes(
                    window_start_minutes,
                    window_end_minutes,
                )
                
                preassigned_person_ids = list(dict.fromkeys(preassigned_person_ids))
                norm_floating_tasks.append(NormFloatingTask(
                    id=task.id,
                    name=task.name or "Unnamed Floating Task",
                    location_id=task.location_id,
                    window_start_time=window_start_minutes,
                    window_end_time=window_end_minutes,
                    duration=duration_minutes,
                    requirements=requirements,
                    preassigned_person_ids=preassigned_person_ids,
                    counts_towards_work_time=counts_towards_work_time,
                ))
                
            else:
                # STATIC TASK (meeting, meal, chore, etc.)
                start_time = None
                end_time = None
                requirements = {}
                preassigned_person_ids = []  # Changed to list
                from_location = None
                to_location = None
                
                if task.field_values:
                    # Find time field (start_end_time)
                    for field_id, field_value in task.field_values.items():
                        if isinstance(field_value, dict) and 'start' in field_value and 'end' in field_value:
                            start_time = field_value['start']
                            end_time = field_value['end']
                            break
                    
                    # Extract location fields using field ID patterns
                    # Locked fields have IDs like: field_location_*, field_start_location_*, field_end_location_*
                    for field_id, field_value in task.field_values.items():
                        if isinstance(field_value, int) and field_value > 0:
                            # Check for start_location pattern
                            if 'start_location' in field_id.lower():
                                from_location = field_value
                            # Check for end_location pattern
                            elif 'end_location' in field_id.lower():
                                to_location = field_value
                            # Check for generic location pattern (only if we haven't found start/end)
                            elif 'location' in field_id.lower() and from_location is None:
                                # This is a single location field (non-transfer task)
                                pass  # Don't set from_location for non-transfer tasks
                    
                    # Log if we found transfer locations
                    if from_location and to_location and from_location != to_location:
                        debug_print(f"  Task {task.id} ({task.name}) - Found start/end locations: from={from_location}, to={to_location}")
                    
                    # Extract capability requirements and assigned persons
                    for field_id, field_value in task.field_values.items():
                        if isinstance(field_value, list):
                            # Check field type from template
                            field_type = template_fields_map.get(task.template_id, {}).get(field_id)
                            
                            if field_type == 'persons_list':
                                # Persons list - resolve direct people and live group references
                                valid_person_ids, group_warnings = resolve_person_field_for_task(
                                    field_value,
                                    task.id,
                                    task.name,
                                    parse_time_to_minutes(start_time) if start_time else None,
                                    parse_time_to_minutes(end_time) if end_time else None,
                                    'Task',
                                )
                                if valid_person_ids:
                                    preassigned_person_ids = valid_person_ids
                                    debug_print(f"  Task {task.id} - Found preassigned persons: {preassigned_person_ids}")
                                for warning in group_warnings:
                                    debug_print(f"  Task {task.id} - WARNING: {warning}")
                            
                            elif field_type == 'capabilities_list':
                                # Capabilities list - extract requirements
                                for item in field_value:
                                    if isinstance(item, dict):
                                        debug_print(f"  Task {task.id} - Processing requirement item: {item}")
                                        # Check for capability object with machine_name
                                        if 'machine_name' in item:
                                            cap_name = item['machine_name']
                                            quantity = item.get('amount', item.get('quantity', 1))
                                            requirements[cap_name] = requirements.get(cap_name, 0) + quantity
                                            debug_print(f"    -> Added requirement: {cap_name} = {quantity}")
                                        # Check for capability reference with just id and quantity
                                        elif 'id' in item and 'quantity' in item:
                                            cap_id = item['id']
                                            quantity = item['quantity']
                                            # Look up machine_name from our mapping
                                            cap_name = capability_map.get(cap_id, f"cap_{cap_id}")
                                            debug_print(f"    -> Looked up cap_id {cap_id}: got '{cap_name}' (in map: {cap_id in capability_map})")
                                            requirements[cap_name] = requirements.get(cap_name, 0) + quantity
                
                if not start_time or not end_time:
                    errors.append(f"Task {task.id} ({task.name}) missing start/end time")
                    continue
                
                start_minutes = parse_time_to_minutes(start_time)
                end_minutes = parse_time_to_minutes(end_time)
                end_minutes = normalise_end_minutes(start_minutes, end_minutes)
                
                # Determine movement: if task has from/to locations different from task.location_id
                # Use task.location_id as fallback if from_location not specified
                final_from_location = from_location if from_location else None
                final_to_location = to_location if to_location else None
                
                preassigned_person_ids = list(dict.fromkeys(preassigned_person_ids))
                norm_tasks.append(NormTask(
                    id=task.id,
                    name=task.name or "Unnamed",
                    location_id=task.location_id,
                    start_time=start_minutes,
                    end_time=end_minutes,
                    requirements=requirements,
                    preassigned_person_ids=preassigned_person_ids,
                    from_location_id=final_from_location,
                    to_location_id=final_to_location,
                    counts_towards_work_time=counts_towards_work_time,
                ))
    
    return NormalizedFlowInput(
        persons=norm_persons,
        tasks=norm_tasks,
        transfers=norm_transfers,
        floating_tasks=norm_floating_tasks,
        errors=errors
    )
