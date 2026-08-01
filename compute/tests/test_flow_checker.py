"""
Test suite for flow_checker.py

Tests the CP-SAT solver for task assignment feasibility checking.
"""
import sys
from pathlib import Path

# Add src directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from flow_checker import (
    NormPerson,
    NormTask,
    NormTransfer,
    NormFloatingTask,
    NormalizedFlowInput,
    check_flow,
    generate_time_segments,
)


def test_simple_task_at_home():
    # should pass since task is at home_location
    """Test a simple feasible task with one person at home location"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at home",
            location_id=1,  # Same as home
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # check_flow returns a list of error messages
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_task_at_different_location_no_transfer():
    # should fail since the task is not on home_location
    """Test task at different location without transfer - should be infeasible"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at remote location",
            location_id=2,  # Different from home (location 1)
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],  # No transfer available
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible - person is at location 1, task is at location 2, no transfer
    assert len(result) > 0, "Expected infeasible (errors present)"


def test_task_at_different_location_with_transfer():
    # should pass since there's a transfer to get to the task location
    """Test task at different location with capability transfer - should be feasible"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=420,  # 07:00
            arrive_time=480,  # 08:00
            capacity=1,
            requirements={"is_orga": 1} 
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at remote location",
            location_id=2,  # Different from home (location 1)
            start_time=480,  # 08:00 - right after transfer arrival
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible - person can take transfer from location 1 to 2
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_task_at_different_location_with_transfer_dynamic():
    # should pass since there's a transfer to get to the task location
    """Test task at different location with dynamic transfer - should be feasible"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=420,  # 07:00
            arrive_time=480,  # 08:00
            capacity=10,
            requirements={}  # No requirements - anyone can board
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at remote location",
            location_id=2,  # Different from home (location 1)
            start_time=480,  # 08:00 - right after transfer arrival
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible - person can take transfer from location 1 to 2
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_transfer_with_return_journey():
    """Test transfer to location 2, tasks at both locations, one person returns"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        # Transfer to location 2: requires 1 is_orga + has 2 dynamic slots = total 3 people
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=420,  # 07:00
            arrive_time=480,  # 08:00
            capacity=3,  # Total capacity: 1 required + 2 dynamic
            requirements={"is_orga": 1}  # At least 1 person with is_orga
        ),
        # Return transfer from location 2 to location 1
        NormTransfer(
            id=201,
            from_location_id=2,
            to_location_id=1,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,  # Plenty of space for return
            requirements={}
        )
    ]
    
    tasks = [
        # Task at location 2 - requires 1 is_orga
        NormTask(
            id=100,
            name="Task at location 2",
            location_id=2,
            start_time=480,  # 08:00
            end_time=540,   # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        # Task at location 1 - requires 1 is_orga (after someone returns)
        NormTask(
            id=101,
            name="Task at location 1",
            location_id=1,
            start_time=600,  # 10:00 (after return transfer arrives)
            end_time=660,   # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible:
    # - 3 people can take transfer to location 2
    # - 1 person does task at location 2
    # - 1 person takes return transfer to location 1
    # - That person does task at location 1
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_person_with_multiple_capabilities():
    """Test person with multiple capabilities can fulfill different task requirements"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga", "is_ho"],  # Has both capabilities
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task requiring is_orga",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task requiring is_ho",
            location_id=1,
            start_time=540,  # 09:00
            end_time=600,    # 10:00
            requirements={"is_ho": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible - same person can do both tasks (different capabilities)
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_task_requiring_multiple_capabilities_different_people():
    """Test task requiring multiple capabilities - needs different people for each"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_ho"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task requiring both capabilities",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1, "is_ho": 1},  # Needs 2 different people
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible - person 1 provides is_orga, person 2 provides is_ho
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_multiple_people_with_overlapping_capabilities():
    """Test multiple people with overlapping capabilities for sequential tasks"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga", "can_drive"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga", "can_use_card"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        # First task requiring 2 capabilities (needs 2 different people)
        NormTask(
            id=100,
            name="Driving task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1, "can_drive": 1},
            preassigned_person_ids=[]
        ),
        # Second task at different time, also requiring 2 capabilities
        NormTask(
            id=101,
            name="Card payment task",
            location_id=1,
            start_time=540,  # 09:00 (after first task)
            end_time=600,    # 10:00
            requirements={"is_orga": 1, "can_use_card": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible with sequential tasks:
    # Task 100 needs 2 different people for 2 capabilities
    # Task 101 needs 2 different people for 2 capabilities
    # Since tasks are sequential, the same 2 people can handle both tasks
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_task_requiring_multiple_capabilities_from_different_people():
    """Test when task needs 2 people with different capabilities - should be feasible"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["can_drive"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task requiring both capabilities",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1, "can_drive": 1},  # Needs 2 different people
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible - person 1 has is_orga, person 2 has can_drive
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"
def test_task_at_different_location_with_transfer_dynamic():
    # should pass since there's a transfer to get to the task location
    """Test task at different location with dynamic transfer - should be feasible"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=420,  # 07:00
            arrive_time=480,  # 08:00
            capacity=10,
            requirements={}  # No requirements - anyone can board
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at remote location",
            location_id=2,  # Different from home (location 1)
            start_time=480,  # 08:00 - right after transfer arrival
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible - person can take transfer from location 1 to 2
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_transfer_with_decision():
    """Test transfer to location 2, possible to send all but one needs to stay back"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        # Return transfer from location 2 to location 1
        NormTransfer(
            id=201,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,  # Plenty of space for return
            requirements={"is_orga": 1}
        )
    ]
    
    tasks = [
        # Task at location 2 - requires 1 is_orga
        NormTask(
            id=100,
            name="Task at location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,   # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task at location 1",
            location_id=1,
            start_time=600,  # 10:00 
            end_time=660,   # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible:
    # - 3 people can take transfer to location 2
    # - 1 person does task at location 2
    # - 1 person takes return transfer to location 1
    # - That person does task at location 1
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


# ============================================================================
# A. TIME & SEGMENT EDGE CASES
# ============================================================================

def test_tasks_at_segment_boundaries():
    """Test 1: Tasks that start/end exactly at segment boundaries"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task A ending at segment boundary",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00 (exactly on boundary)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task B starting at segment boundary",
            location_id=1,
            start_time=660,  # 11:00 (exactly on boundary)
            end_time=720,    # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: tasks touch but don't overlap
    # Same person can do both tasks sequentially
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_tasks_touching_by_one_minute():
    """Test 2: Two tasks touching by 1 minute - segment edge extremely narrow"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task A",
            location_id=1,
            start_time=600,  # 10:00
            end_time=629,    # 10:29
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task B",
            location_id=1,
            start_time=629,  # 10:29 (touches by 1 minute)
            end_time=658,    # 10:58
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: tasks touch but don't overlap (boundary is inclusive-exclusive)
    assert len(result) == 0, f"Expected feasible (no errors), got: {result}"


def test_task_wholly_inside_another():
    """Test 3: Task B wholly inside Task A - double-booking detection"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task A - outer task",
            location_id=1,
            start_time=600,  # 10:00
            end_time=840,    # 14:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]  # Pre-assign to person 1
        ),
        NormTask(
            id=101,
            name="Task B - inner task",
            location_id=1,
            start_time=660,  # 11:00
            end_time=720,    # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible: only one person, already assigned to outer task
    # Inner task cannot be assigned to same person (double-booking)
    assert len(result) > 0, f"Expected infeasible (overlap detection), got no errors"


def test_very_short_floating_task():
    """Test 4: Very short floating task (duration shorter than any segment)"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Very short floating task",
            duration=10,  # Only 10 minutes
            location_id=1,
            window_start_time=600,  # 10:00
            window_end_time=660,    # 11:00 (60 minute window)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: short task should fit within the window
    assert len(result) == 0, f"Expected feasible (short task fits), got: {result}"


def test_very_long_floating_task_no_fit():
    """Test 5: Very long floating task that doesn't fit any segment"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    # Add several fixed tasks to fragment the day into small segments
    tasks = [
        NormTask(
            id=100,
            name="Task blocking 08:00-09:00",
            location_id=1,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=101,
            name="Task blocking 10:00-11:00",
            location_id=1,
            start_time=600,
            end_time=660,
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=102,
            name="Task blocking 12:00-13:00",
            location_id=1,
            start_time=720,
            end_time=780,
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Very long floating task",
            duration=180,  # 3 hours - won't fit in any gap
            location_id=1,
            window_start_time=480,   # 08:00
            window_end_time=780,       # 13:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible: no continuous 3-hour segment available
    assert len(result) > 0, f"Expected infeasible (no segment fits), got no errors"


# ============================================================================
# B. AVAILABILITY + LOCATION PROPAGATION
# ============================================================================

def test_person_unavailable_middle_segment():
    """Test 6: Person unavailable for a middle segment"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(540, 600)]  # Unavailable 09:00-10:00
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task before unavailable period",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task after unavailable period",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: person can work before and after unavailable period
    # Can be at location 1 at 08:00-09:00, unavailable 09:00-10:00,
    # then "teleport" to location 2 at 10:00-11:00
    assert len(result) == 0, f"Expected feasible (unavailable gap allows location change), got: {result}"


def test_availability_prohibits_transfer():
    """Test 7: Person locked at location due to earlier task, then unavailable during only transfer"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(480, 540)]  # Unavailable 08:00-09:00
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=510,  # 08:30 (during unavailable period)
            arrive_time=540,  # 09:00
            capacity=10,
            requirements={"is_orga": 1}
        )
    ]
    
    tasks = [
        # Task before unavailability locks person at location 1
        NormTask(
            id=99,
            name="Early task at location 1",
            location_id=1,
            start_time=420,  # 07:00
            end_time=480,    # 08:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        ),
        # Task after unavailability at location 2
        NormTask(
            id=100,
            name="Task at location 2",
            location_id=2,
            start_time=540,  # 09:00
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible:
    # Person does task at location 1 (07:00-08:00), locking them there
    # Person unavailable 08:00-09:00 (cannot take transfer during this time)
    # Only transfer to location 2 departs at 08:30 (during unavailability)
    # Person cannot reach location 2 for the task at 09:00
    assert len(result) > 0, f"Expected infeasible (locked at location, unavailable during only transfer), got no errors"


def test_assigned_person_unavailable_during_task():
    """Test 8: Assigned person unavailable in task time"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(570, 720)]  # Unavailable 09:30-12:00
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task during unavailable period",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: person 1 cannot do it (unavailable)
    # but person 2 can do the task
    assert len(result) == 0, f"Expected feasible (person 2 available), got: {result}"


def test_person_unavailable_entire_day():
    """Test 9: Person unavailable the entire day"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(0, 1440)]  # Unavailable all day (00:00-24:00)
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["can_drive"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task requiring is_orga",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible: person 1 has required capability but unavailable
    # person 2 is available but lacks capability
    assert len(result) > 0, f"Expected infeasible (only capable person unavailable), got no errors"


def test_person_available_just_in_time():
    """Test 10: Person becomes available just in time for task"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(480, 710)]  # Unavailable 08:00-11:50
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task starting at 12:00",
            location_id=2,  # Different location
            start_time=720,  # 12:00
            end_time=780,    # 13:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: person is unavailable 08:00-11:50 (can travel to location 2)
    # Then becomes available at 11:50 and can do task at location 2 at 12:00
    assert len(result) == 0, f"Expected feasible (just-in-time availability), got: {result}"


# ============================================================================
# C. TRANSFER + LOCATION CONSTRAINTS
# ============================================================================

def test_transfer_arrives_exactly_when_task_starts():
    """Test 11: Transfer arrival = segment start = task start"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00 (exactly when task starts)
            capacity=10,
            requirements={}
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at location 2",
            location_id=2,
            start_time=600,  # 10:00 (same as transfer arrival)
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: person can take transfer and immediately work
    assert len(result) == 0, f"Expected feasible (transfer arrives on time), got: {result}"


def test_transfer_capacity_zero():
    """Test 12: Transfer capacity = 0"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=0,  # No one can use this transfer
            requirements={}
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible: transfer has zero capacity, person cannot reach location 2
    assert len(result) > 0, f"Expected infeasible (zero capacity transfer), got no errors"


def test_transfer_requires_capability_no_one_has():
    """Test 13: Transfer requires a capability no one has"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["can_drive"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,
            requirements={"can_fly_helicopter": 1}  # No one has this capability
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at location 2 requiring is_orga",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible: transfer requires capability no one has
    # Person with is_orga cannot reach location 2
    assert len(result) > 0, f"Expected infeasible (transfer capability missing), got no errors"


def test_two_transfers_overlap_in_time():
    """Test 14: Two transfers overlap in time - double-booking detection"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=201,
            from_location_id=1,
            to_location_id=3,
            depart_time=550,  # 09:10 (overlaps with first transfer)
            arrive_time=610,  # 10:10
            capacity=10,
            requirements={}
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task at location 3",
            location_id=3,
            start_time=610,  # 10:10
            end_time=670,    # 11:10
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible: only one person, cannot take both overlapping transfers
    # (Would need to be in two places at once during overlap period)
    assert len(result) > 0, f"Expected infeasible (overlapping transfers), got no errors"


def test_circular_transfer_chains():
    """Test 15: Circular transfer chains A->B, B->C, C->A"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=480,  # 08:00
            arrive_time=540,  # 09:00
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=201,
            from_location_id=2,
            to_location_id=3,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=202,
            from_location_id=3,
            to_location_id=1,
            depart_time=600,  # 10:00
            arrive_time=660,  # 11:00
            capacity=10,
            requirements={}
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task back at location 1",
            location_id=1,
            start_time=660,  # 11:00
            end_time=720,    # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: person can follow circular path 1->2->3->1
    # No infinite loop, just constrained by time segments
    assert len(result) == 0, f"Expected feasible (circular path works), got: {result}"


# ============================================================================
# D. FLOATING TASKS
# ============================================================================

def test_floating_task_with_only_one_valid_segment():
    """Test 16: Floating task with only one valid segment"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    # Block most of the day with fixed tasks for person 1
    tasks = [
        NormTask(
            id=100,
            name="Morning task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=101,
            name="Afternoon task",
            location_id=1,
            start_time=660,  # 11:00
            end_time=780,    # 13:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Floating task with one slot",
            duration=60,  # 1 hour
            location_id=1,
            window_start_time=480,  # 08:00
            window_end_time=780,      # 13:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: only one valid slot (10:00-11:00)
    # Floating task should land there and behave like a fixed task
    assert len(result) == 0, f"Expected feasible (fits in only slot), got: {result}"


def test_floating_task_many_slots_across_locations():
    """Test 17: Floating task with many possible slots across locations"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,
            requirements={}
        )
    ]
    
    # Fixed task at location 1
    tasks = [
        NormTask(
            id=100,
            name="Fixed task at location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Floating task at location 2",
            duration=60,  # 1 hour
            location_id=2,
            window_start_time=480,  # 08:00
            window_end_time=720,      # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be feasible:
    # - Person does fixed task at location 1 (08:00-09:00)
    # - Takes transfer to location 2 (09:00-10:00)
    # - Does floating task at location 2 (10:00-11:00 or later)
    assert len(result) == 0, f"Expected feasible (floating task after transfer), got: {result}"


def test_multiple_floating_tasks_competing_for_segment():
    """Test 18: Multiple floating tasks competing for same segment"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Floating task 1",
            duration=60,  # 1 hour
            location_id=1,
            window_start_time=600,  # 10:00
            window_end_time=720,      # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormFloatingTask(
            id=201,
            name="Floating task 2",
            duration=60,  # 1 hour
            location_id=1,
            window_start_time=600,  # 10:00
            window_end_time=720,      # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormFloatingTask(
            id=202,
            name="Floating task 3",
            duration=60,  # 1 hour
            location_id=1,
            window_start_time=600,  # 10:00
            window_end_time=720,      # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: 3 tasks, 2 people, 2-hour window
    # Person 1: 10:00-11:00 and 11:00-12:00 (2 tasks)
    # Person 2: 10:00-11:00 (1 task)
    # OR other valid combinations
    assert len(result) == 0, f"Expected feasible (distribute across segments), got: {result}"


def test_floating_task_unreachable_capabilities():
    """Test 19: Floating task at location 2, person locked at location 1, no transfer available"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    # Add a task at location 1 to lock the person there
    tasks = [
        NormTask(
            id=99,
            name="Task at location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Floating task at unreachable location",
            duration=60,  # 1 hour
            location_id=2,  # Cannot reach this location
            window_start_time=600,  # 10:00
            window_end_time=720,      # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],  # No transfers available
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible:
    # Person is locked at location 1 by the task at 08:00-09:00
    # No unavailability window to allow teleportation
    # No transfer available to reach location 2
    # Floating task at location 2 cannot be completed
    assert len(result) > 0, f"Expected infeasible (location unreachable without transfer), got no errors"


# ============================================================================
# E. FATIGUE + WORKING HOURS
# ============================================================================

def test_person_max_work_minutes_very_small():
    """Test 20: Person max_work_minutes_per_day is very small"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=60,  # Only 60 minutes
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,  # Normal day
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task 1 - 60 minutes",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task 2 - 60 minutes",
            location_id=1,
            start_time=540,  # 09:00
            end_time=600,    # 10:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible:
    # - Person 1 can only do one 60-min task (at limit)
    # - Person 2 does the other task
    assert len(result) == 0, f"Expected feasible (distribute based on limits), got: {result}"


def test_person_max_work_minutes_exceeded():
    """Test 21: Person would exceed max_work_minutes"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=60,  # Only 60 minutes
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task 1 - 60 minutes",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]  # Force assign
        ),
        NormTask(
            id=101,
            name="Task 2 - 60 minutes",
            location_id=1,
            start_time=540,  # 09:00
            end_time=600,    # 10:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible:
    # - Person 1 is preassigned to Task 1 (60 min)
    # - Task 2 would exceed their 60-min limit
    # - No other person available
    assert len(result) > 0, f"Expected infeasible (exceeds max work minutes), got no errors"


def test_all_persons_identical_capabilities():
    """Test 23: All persons have identical capabilities and availabilities"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga", "can_drive"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga", "can_drive"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga", "can_drive"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=600,    # 10:00 (120 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task 2",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 min)
            requirements={"can_drive": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=102,
            name="Task 3",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: solver should distribute tasks
    # Ideally evenly to minimize fatigue range (though not explicitly tested here)
    # Person 1: 120 min, Person 2: 60 min, Person 3: 60 min
    assert len(result) == 0, f"Expected feasible (distribute work), got: {result}"


def test_person_max_work_minutes_none():
    """Test 24: Person with max_work_minutes undefined (None - no limit)"""
    # Note: Check if None is supported. If max_work_minutes is always an int, skip this test.
    # For now, testing with a very high value to simulate "no limit"
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=999999,  # Effectively no limit
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=101,
            name="Task 2",
            location_id=1,
            start_time=540,  # 09:00
            end_time=600,    # 10:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=102,
            name="Task 3",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=103,
            name="Task 4",
            location_id=1,
            start_time=660,  # 11:00
            end_time=720,    # 12:00 (60 min)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible: person has no meaningful work limit
    # Can do all 4 tasks (240 minutes total)
    assert len(result) == 0, f"Expected feasible (no work limit), got: {result}"


# ============================================================================
# F. BONUS REAL WORLD FAILURE MODES
# ============================================================================

def test_two_persons_only_one_can_reach_location():
    """Test 25: Two persons can serve a capability, but only one can reach the location"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=2,  # Already at location 2
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    # No transfer from location 1 to location 2
    
    tasks = [
        NormTask(
            id=100,
            name="Task requiring 2 is_orga at location 2",
            location_id=2,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 2},  # Needs 2 people
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],  # No transfers available
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible:
    # - Task requires 2 people with is_orga
    # - Only person 2 can reach location 2
    # - Person 1 cannot reach location 2 (no transfer)
    assert len(result) > 0, f"Expected infeasible (only one person can reach location), got no errors"


def test_floating_task_overlaps_with_mandatory_transfer():
    """Test 26: Floating task overlaps with mandatory transfer"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=510,  # 08:30
            arrive_time=570,  # 09:30
            capacity=10,
            requirements={}
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at location 2 - requires transfer",
            location_id=2,
            start_time=570,  # 09:30 (right after transfer arrival)
            end_time=630,    # 10:30
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]  # Must be person 1
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Floating task during transfer time",
            duration=60,  # 1 hour
            location_id=1,
            window_start_time=480,  # 08:00
            window_end_time=600,      # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible:
    # - Person 1 (only person with is_orga) must take transfer (08:30-09:30) to reach task at 09:30
    # - Floating task also needs person 1 for 60 minutes between 08:00-10:00
    # - If floating task is 08:00-09:00, person can't take transfer at 08:30
    # - If floating task is after transfer (09:30-10:30), conflicts with fixed task ending at 10:30
    assert len(result) > 0, f"Expected infeasible (floating task conflicts with transfer), got no errors"


def test_multiple_floating_tasks_require_same_capability_worker():
    """Test 27: Multiple floating tasks all require same rare capability worker - infeasible"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["rare_skill"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],  # Different capability
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Floating task 1 - needs rare_skill",
            duration=120,  # 2 hours
            location_id=1,
            window_start_time=480,  # 08:00
            window_end_time=720,      # 12:00 (4-hour window)
            requirements={"rare_skill": 1},
            preassigned_person_ids=[]
        ),
        NormFloatingTask(
            id=201,
            name="Floating task 2 - needs rare_skill",
            duration=120,  # 2 hours
            location_id=1,
            window_start_time=480,  # 08:00
            window_end_time=720,      # 12:00 (4-hour window)
            requirements={"rare_skill": 1},
            preassigned_person_ids=[]
        ),
        NormFloatingTask(
            id=202,
            name="Floating task 3 - needs rare_skill",
            duration=120,  # 2 hours
            location_id=1,
            window_start_time=480,  # 08:00
            window_end_time=720,      # 12:00 (4-hour window)
            requirements={"rare_skill": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be infeasible:
    # - 3 tasks × 2 hours = 6 hours total demand for rare_skill
    # - Window is only 4 hours (08:00-12:00)
    # - Only 1 person with rare_skill
    # - Under current floating task implementation, time points are only 480 and 720
    #   creating one segment [480, 720), so all floating tasks would overlap
    # - Cannot fit 6 hours of work into 4-hour window with one person
    assert len(result) > 0, f"Expected infeasible (6 hours work in 4-hour window impossible), got no errors"


def test_transfer_ends_inside_availability_gap():
    """Test 28: Transfer ends inside an availability gap"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[
                (480, 600),  # Unavailable 08:00-10:00
                (660, 780)   # Unavailable 11:00-13:00
            ]
        )
    ]
    
    transfers = [
        NormTransfer(
            id=200,
            from_location_id=1,
            to_location_id=2,
            depart_time=450,  # 07:30
            arrive_time=540,  # 09:00 (arrives during unavailable period)
            capacity=10,
            requirements={}
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task at location 2",
            location_id=2,
            start_time=600,  # 10:00 (when available again)
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be feasible:
    # - Person is unavailable 08:00-10:00 (can travel to any location during this period)
    # - Transfer departs at 07:30 and arrives at 09:00 (during unavailable period)
    # - Person becomes available at 10:00 and can be at location 2
    # - Person can do task at location 2 from 10:00-11:00
    assert len(result) == 0, f"Expected feasible (can travel during unavailable period), got: {result}"


def test_multiple_preassigned_persons_conflict():
    """Test that multiple preassigned persons on one task conflicts with another task needing same capability"""
    # Person A and B both have cap_A
    # Task A requires both Person A and Person B (preassigned)
    # Task B (same time) requires cap_A (1 person)
    # Should be INFEASIBLE because both people with cap_A are locked to Task A
    
    persons = [
        NormPerson(
            id=1,  # Person A
            home_location_id=1,
            capabilities=["cap_A"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,  # Person B
            home_location_id=1,
            capabilities=["cap_A"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Task A - Both persons preassigned",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={},  # No capability requirements, just preassigned persons
            preassigned_person_ids=[1, 2]  # Both Person A and Person B are preassigned
        ),
        NormTask(
            id=101,
            name="Task B - Needs cap_A",
            location_id=1,
            start_time=480,  # 08:00 (same time as Task A)
            end_time=540,    # 09:00
            requirements={"cap_A": 1},  # Needs 1 person with cap_A
            preassigned_person_ids=[]
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be INFEASIBLE:
    # - Task A has both Person A and Person B preassigned (locked)
    # - Task B needs 1 person with cap_A
    # - Both persons with cap_A are already assigned to Task A
    # - No one is available to cover Task B
    assert len(result) > 0, f"Expected infeasible (all cap_A persons locked to Task A), got: {result}"
    # Check that the error mentions Task B not being covered
    assert any("Task 101" in error or "Task B" in error for error in result), \
        f"Expected error about Task B not being covered, got: {result}"


# ============================================================================
# Test cases for tasks with BOTH preassigned person AND capability requirements
# ============================================================================

def test_preassigned_plus_capability_static_task_feasible():
    """
    Test Case 1: Static task with preassigned person + capability requirement - FEASIBLE
    
    Scenario: A static task has:
    - 1 preassigned person (Person 1)
    - Requires 2 additional people with 'is_orga' capability
    - Total needed: 1 preassigned + 2 from capabilities = 3 people
    - Available: 4 people total (1 preassigned + 3 others with is_orga)
    """
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=4,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Workshop - needs organizer + 2 helpers",
            location_id=1,
            start_time=480,  # 08:00
            end_time=600,    # 10:00
            requirements={"is_orga": 2},  # Need 2 additional people with is_orga
            preassigned_person_ids=[1]  # Person 1 is preassigned (also has is_orga)
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be FEASIBLE: Person 1 is preassigned, and 2 more from {2, 3, 4} can cover requirements
    assert len(result) == 0, f"Expected feasible, got: {result}"


def test_preassigned_plus_capability_static_task_infeasible():
    """
    Test Case 2: Static task with preassigned person + capability requirement - INFEASIBLE
    
    Scenario: A static task needs:
    - 1 preassigned person
    - Requires 3 additional people with 'is_orga'
    - Total needed: 1 preassigned + 3 from capabilities = 4 people
    - Available: Only 3 people total - NOT ENOUGH!
    """
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=100,
            name="Large Workshop - needs organizer + 3 helpers",
            location_id=1,
            start_time=480,  # 08:00
            end_time=600,    # 10:00
            requirements={"is_orga": 3},  # Need 3 additional people
            preassigned_person_ids=[1]  # Person 1 is preassigned
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    result = check_flow(normalized)
    
    # Should be INFEASIBLE: Need 4 people total (1 preassigned + 3 more), but only 3 exist
    assert len(result) > 0, f"Expected infeasible (not enough people), got: {result}"


def test_preassigned_plus_capability_floating_task_feasible():
    """
    Test Case 3: Floating task with preassigned person + capability requirement - FEASIBLE
    
    Scenario: A floating task has:
    - 1 preassigned person
    - Requires 1 additional person with 'is_driver' capability
    - Window: 08:00-12:00, duration: 60 minutes
    - Should find a valid time slot where both persons are available
    """
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_driver"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=100,
            name="Transport Run - needs organizer + driver",
            location_id=1,
            window_start_time=480,   # 08:00
            window_end_time=720,     # 12:00
            duration=60,             # 1 hour
            requirements={"is_driver": 1},  # Need 1 driver in addition to preassigned
            preassigned_person_ids=[1]  # Person 1 (organizer) is preassigned
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be FEASIBLE: Person 1 is preassigned, Person 2 (driver) can cover the driver requirement
    assert len(result) == 0, f"Expected feasible, got: {result}"


def test_preassigned_plus_capability_floating_task_with_conflict():
    """
    Test Case 4: Floating task with preassigned person + capability, conflicting with static task - INFEASIBLE
    
    Scenario:
    - Floating task needs: 1 preassigned person + 2 people with 'is_orga'
    - Static task at same time needs: 2 people with 'is_orga'
    - Only 3 people with 'is_orga' exist total
    - Floating window is SAME as static task time (no way to avoid conflict)
    - Total needed if overlapping: 1 preassigned + 2 from floating + 2 from static = 5 people
    - But preassigned person has is_orga, so: 3 unique people needed from floating + 2 from static = 5, but only 3 exist
    """
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Static Workshop - needs 2 organizers",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 2},
            preassigned_person_ids=[]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=100,
            name="Floating Meeting - needs preassigned + 2 organizers",
            location_id=1,
            window_start_time=480,   # 08:00 (SAME as static task start)
            window_end_time=540,     # 09:00 (SAME as static task end - no room to avoid)
            duration=60,
            requirements={"is_orga": 2},  # Need 2 organizers in addition to preassigned
            preassigned_person_ids=[1]  # Person 1 is preassigned
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be INFEASIBLE:
    # - Static task needs 2 people from {1, 2, 3}
    # - Floating task needs Person 1 (preassigned) + 2 more from {1, 2, 3}
    # - Total: Person 1 (preassigned to floating) + 2 for floating capability + 2 for static = 5 person-slots
    # - But Person 1 counts for floating preassigned AND could count for one of the "2 organizers"
    # - Still need: 1 preassigned (Person 1) + 2 more for floating (Persons 2,3) + 2 for static (need 2 more but none left!)
    # - Not enough people!
    assert len(result) > 0, f"Expected infeasible (resource conflict), got: {result}"


def test_preassigned_plus_capability_floating_task_can_avoid_conflict():
    """
    Test Case 5: Floating task with preassigned + capability can schedule around static task - FEASIBLE
    
    Scenario:
    - Static task at 08:00-09:00 needs: 2 people with 'is_orga'
    - Floating task (window 08:00-12:00, 60min) needs: 1 preassigned + 1 'is_orga'
    - 4 people with 'is_orga' available
    - Floating task should schedule at 09:00-10:00 (after static task) to avoid conflict
    """
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=4,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Static Workshop - 08:00-09:00",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 2},  # Uses 2 people
            preassigned_person_ids=[]
        )
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=100,
            name="Floating Meeting - can schedule later",
            location_id=1,
            window_start_time=480,   # 08:00
            window_end_time=720,     # 12:00
            duration=60,
            requirements={"is_orga": 1},  # Need 1 organizer
            preassigned_person_ids=[1]  # Person 1 is preassigned
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = check_flow(normalized)
    
    # Should be FEASIBLE:
    # - Static task uses 2 people (e.g., Person 2 and 3) during 08:00-09:00
    # - Floating task can schedule at 09:00-10:00 with Person 1 (preassigned) + Person 4
    # - Or at 10:00-11:00, etc.
    # - With 4 people total, there's enough capacity to avoid conflicts
    assert len(result) == 0, f"Expected feasible (floating task can avoid conflict), got: {result}"
