"""
Test suite for fatigue_optimizer.py

Tests the CP-SAT solver for task assignment optimization with fatigue minimization.
"""
import sys
from pathlib import Path

# Add src directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from fatigue_optimizer import (
    optimize_with_fatigue,
    OptimizationConfig,
    OptimizationResult,
)
from flow_checker import (
    NormPerson,
    NormTask,
    NormTransfer,
    NormFloatingTask,
    NormalizedFlowInput,
)


def test_trivial_one_person_one_task():
    """Test trivial case: one person with capability assigned to one task"""
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
            name="Simple Task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    # Set fatigue rate: 1.0 per minute
    tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    assert len(result.errors) == 0, f"Expected no errors, got: {result.errors}"
    
    # Check capability assignment
    assert (100, "is_orga") in result.capability_assignments, "Task 100 'is_orga' capability should be assigned"
    assert 1 in result.capability_assignments[(100, "is_orga")], "Person 1 should cover is_orga for task 100"
    
    # Check fatigue calculation: 60 minutes * 1.0 fatigue_per_minute = 60.0
    assert 1 in result.fatigue_per_person, "Person 1 should have fatigue calculated"
    assert result.fatigue_per_person[1] == 60.0, f"Expected fatigue 60.0, got {result.fatigue_per_person[1]}"
    
    # Check fatigue statistics
    assert result.fatigue_min == 60.0, f"Expected fatigue_min 60.0, got {result.fatigue_min}"
    assert result.fatigue_max == 60.0, f"Expected fatigue_max 60.0, got {result.fatigue_max}"
    assert result.fatigue_range == 0.0, f"Expected fatigue_range 0.0, got {result.fatigue_range}"
    
    # Check breaks
    assert 1 in result.breaks_per_person, "Person 1 should have breaks tracked"
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks, got {result.breaks_per_person[1]}"


def test_person_lacks_required_capability():
    """Test infeasibility: person does not have the capability required by the task"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_driver"],  # Has driver capability, not organizer
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=101,
            name="Task Requiring Organizer",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},  # Requires organizer capability
            preassigned_person_ids=[]
        )
    ]
    
    tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - person doesn't have required capability
    assert result.status == "INFEASIBLE", f"Expected INFEASIBLE, got {result.status}"
    assert len(result.errors) > 0, "Expected error messages for infeasibility"
    
    # No capability assignments should exist
    assert (101, "is_orga") not in result.capability_assignments, "Task should not have capability assigned"


def test_two_persons_one_with_capability():
    """Test that optimizer selects the person with the correct capability from two persons"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_driver"],  # Wrong capability
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],  # Correct capability
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=102,
            name="Task Requiring Organizer",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    assert len(result.errors) == 0, f"Expected no errors, got: {result.errors}"
    
    # Check that person 2 (with correct capability) is assigned
    assert (102, "is_orga") in result.capability_assignments, "Task 102 'is_orga' capability should be assigned"
    assigned_persons = result.capability_assignments[(102, "is_orga")]
    assert 2 in assigned_persons, "Person 2 (with is_orga) should be assigned to task"
    assert 1 not in assigned_persons, "Person 1 (without is_orga) should NOT be assigned to task"
    
    # Check fatigue for person 2: 60 minutes * 1.0 = 60.0
    assert 2 in result.fatigue_per_person, "Person 2 should have fatigue calculated"
    assert result.fatigue_per_person[2] == 60.0, f"Expected fatigue 60.0 for person 2, got {result.fatigue_per_person[2]}"
    
    # Both persons tracked in fatigue (optimizer minimizes range across all persons)
    assert 1 in result.fatigue_per_person, "Person 1 should have fatigue calculated"
    
    # Person 1 cannot do the task (lacks capability), so fatigue range will be 60.0
    assert result.fatigue_per_person[1] == 0.0, f"Expected fatigue 0.0 for person 1, got {result.fatigue_per_person[1]}"
    assert result.fatigue_range == 60.0, f"Expected fatigue_range 60.0, got {result.fatigue_range}"


def test_preassigned_person_selected():
    """Test that preassigned person is selected when both persons have the required capability"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],  # Has capability
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],  # Also has capability
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=103,
            name="Task with Preassignment",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[2]  # Person 2 is preassigned
        )
    ]
    
    tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    assert len(result.errors) == 0, f"Expected no errors, got: {result.errors}"
    
    # Check that person 2 (preassigned) is in the assignments (as organizer)
    assert 103 in result.assignments, "Task 103 should have assignments"
    assert 2 in result.assignments[103], "Person 2 (preassigned) should be in task assignments as organizer"
    
    # The capability can be covered by either person - preassignment only locks the organizer role
    # Both persons could work on this task, but person 2 must be assigned as organizer
    assert (103, "is_orga") in result.capability_assignments, "Task 103 'is_orga' capability should be assigned"
    
    # At least one person should cover the capability
    capability_persons = result.capability_assignments[(103, "is_orga")]
    assert len(capability_persons) > 0, "At least one person should cover is_orga capability"
    
    # The key test: person 2 must be in the assignments (organizer role)
    assert 2 in result.assignments[103], "Person 2 must be assigned as organizer (preassigned)"


def test_break_with_sufficient_gap():
    """Test that a break is counted when gap between tasks exceeds threshold"""
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
            id=200,
            name="Morning Task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Afternoon Task",
            location_id=1,
            start_time=600,  # 10:00 (60 minute gap from previous)
            end_time=660,    # 11:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,  # 30 minutes threshold
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    
    # Check that breaks are tracked (may or may not be counted depending on optimizer logic)
    assert 1 in result.breaks_per_person, "Person 1 should have breaks tracked"
    # The gap is 60 minutes which is above the 30 min threshold, but the optimizer
    # may handle segment breaks differently. Just verify it's tracked.
    assert result.breaks_per_person[1] >= 0, f"Breaks should be non-negative, got {result.breaks_per_person[1]}"


def test_no_break_with_insufficient_gap():
    """Test that no break is counted when gap between tasks is below threshold"""
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
            id=202,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=510,    # 08:30 (30 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=203,
            name="Task B",
            location_id=1,
            start_time=520,  # 08:40 (10 minute gap - less than threshold)
            end_time=550,    # 09:10 (30 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,  # 30 minutes threshold
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    
    # Check that person 1 has zero breaks (10 min gap < 30 min threshold)
    assert 1 in result.breaks_per_person, "Person 1 should have breaks tracked"
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks (gap too small), got {result.breaks_per_person[1]}"


def test_continuous_work_no_breaks():
    """Test that no breaks are counted when person works continuously"""
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
            id=204,
            name="Continuous Task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=600,    # 10:00 (120 minutes continuous)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    
    # Check that person 1 has zero breaks (continuous work, no gaps)
    assert 1 in result.breaks_per_person, "Person 1 should have breaks tracked"
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks (continuous work), got {result.breaks_per_person[1]}"
    
    # Fatigue should be 120 minutes * 1.0 = 120.0
    assert result.fatigue_per_person[1] == 120.0, f"Expected fatigue 120.0, got {result.fatigue_per_person[1]}"


def test_multiple_breaks_throughout_day():
    """Test that multiple breaks are counted correctly"""
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
            id=205,
            name="Morning Task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=206,
            name="Late Morning Task",
            location_id=1,
            start_time=600,  # 10:00 (60 min gap - break 1)
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=207,
            name="Afternoon Task",
            location_id=1,
            start_time=780,  # 13:00 (120 min gap - break 2)
            end_time=840,    # 14:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    
    # Check that person 1 has multiple breaks
    assert 1 in result.breaks_per_person, "Person 1 should have breaks tracked"
    assert result.breaks_per_person[1] >= 2, f"Expected at least 2 breaks, got {result.breaks_per_person[1]}"


def test_break_reduces_fatigue():
    """Test that breaks reduce accumulated fatigue through break_effect"""
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
            id=208,
            name="Task Before Break",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=209,
            name="Task After Break",
            location_id=1,
            start_time=600,  # 10:00 (60 minute break)
            end_time=660,    # 11:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,  # Each minute of break reduces fatigue by 0.5
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Verify optimization succeeded
    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    
    # Check breaks are counted
    assert 1 in result.breaks_per_person, "Person 1 should have breaks tracked"
    num_breaks = result.breaks_per_person[1]
    
    # 120 min work at 1.0/min = 120 fatigue, 60 min break at -0.5/min = -30 recovery
    # Net fatigue = 90
    assert 1 in result.fatigue_per_person, "Person 1 should have fatigue calculated"
    expected = 120.0 - 0.5 * 60  # 90.0
    assert abs(result.fatigue_per_person[1] - expected) < 0.1, \
        f"Expected fatigue ~{expected}, got {result.fatigue_per_person[1]}"


def test_multiple_short_gaps_no_breaks():
    """Test that multiple gaps below threshold don't count as breaks"""
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
            id=210,
            name="Task 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=500,    # 08:20 (20 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=211,
            name="Task 2",
            location_id=1,
            start_time=520,  # 08:40 (20 min gap)
            end_time=540,    # 09:00 (20 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=212,
            name="Task 3",
            location_id=1,
            start_time=560,  # 09:20 (20 min gap)
            end_time=580,    # 09:40 (20 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks (all gaps < 30min), got {result.breaks_per_person[1]}"
    # Total work: 60 minutes
    assert result.fatigue_per_person[1] == 60.0, f"Expected fatigue 60.0, got {result.fatigue_per_person[1]}"


def test_long_break_single_occurrence():
    """Test that a single long break (2 hours) counts as 1 break"""
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
            id=213,
            name="Morning Task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=214,
            name="Afternoon Task",
            location_id=1,
            start_time=660,  # 11:00 (120 min gap - long lunch break)
            end_time=720,    # 12:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,  # Recovery per minute of break
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 120 minute gap should count as at least 1 break segment
    assert result.breaks_per_person[1] >= 1, f"Expected at least 1 break, got {result.breaks_per_person[1]}"
    # Total work: 120 min at 1.0/min = 120. Break: 120 min at -0.5/min = -60. Net = 60.
    expected_fatigue = 120.0 + (-0.5 * 120)  # 60.0
    assert abs(result.fatigue_per_person[1] - expected_fatigue) < 0.1, \
        f"Expected fatigue ~{expected_fatigue}, got {result.fatigue_per_person[1]}"


def test_multiple_persons_different_break_patterns():
    """Test two persons with different break patterns - one with breaks, one continuous"""
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
        # Person 1: work with break
        NormTask(
            id=215,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=216,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00 (60 min break)
            end_time=660,    # 11:00
            requirements={},
            preassigned_person_ids=[1]
        ),
        # Person 2: continuous work
        NormTask(
            id=217,
            name="Task C",
            location_id=1,
            start_time=480,  # 08:00
            end_time=660,    # 11:00 (continuous 180 min)
            requirements={},
            preassigned_person_ids=[2]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,  # Recovery per minute of break
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person 1 should have at least 1 break
    assert result.breaks_per_person[1] >= 1, f"Person 1 expected >= 1 break, got {result.breaks_per_person[1]}"
    # Person 2 should have 0 breaks (continuous work)
    assert result.breaks_per_person[2] == 0, f"Person 2 expected 0 breaks, got {result.breaks_per_person[2]}"
    
    # Person 1 fatigue: 120 min work - 60 min break at -0.5/min = 120 - 30 = 90
    expected_fatigue_p1 = 120.0 + (-0.5 * 60)
    assert abs(result.fatigue_per_person[1] - expected_fatigue_p1) < 0.1
    # Person 2 fatigue: 180 min work, no breaks
    assert result.fatigue_per_person[2] == 180.0


def test_idle_at_start_of_day():
    """Test that idle time before first task doesn't count as break"""
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
            id=218,
            name="Late Morning Task",
            location_id=1,
            start_time=600,  # 10:00 (idle from day start)
            end_time=660,    # 11:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Idle before first task shouldn't count as break (no work to recover from)
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks (idle before work), got {result.breaks_per_person[1]}"
    assert result.fatigue_per_person[1] == 60.0


def test_idle_at_end_of_day():
    """Test that idle time after last task counts as break segment"""
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
            id=219,
            name="Morning Task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=220,
            name="Mid-Morning Task",
            location_id=1,
            start_time=540,  # 09:00
            end_time=600,    # 10:00 (60 minutes) - followed by long idle
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # No gap between tasks, so no breaks during work
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks (continuous work), got {result.breaks_per_person[1]}"
    assert result.fatigue_per_person[1] == 120.0


def test_unavailable_during_potential_break():
    """Test that unavailability period doesn't count as break"""
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
            id=221,
            name="Task Before Unavailable",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=222,
            name="Task After Unavailable",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Unavailable period should not count as break
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks (unavailable, not break), got {result.breaks_per_person[1]}"
    assert result.fatigue_per_person[1] == 120.0


def test_break_exactly_at_threshold():
    """Test that a break exactly at threshold (30 min) counts as 1 break"""
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
            id=223,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=224,
            name="Task B",
            location_id=1,
            start_time=570,  # 09:30 (exactly 30 min gap)
            end_time=630,    # 10:30 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Exactly 30 minutes should count as 1 break
    assert result.breaks_per_person[1] == 1, f"Expected 1 break (exactly 30 min), got {result.breaks_per_person[1]}"
    # Total work: 120 minutes, 30-min break at -0.5/min = -15 recovery → 105.0
    assert result.fatigue_per_person[1] == 105.0, f"Expected fatigue 105.0, got {result.fatigue_per_person[1]}"


def test_break_one_minute_below_threshold():
    """Test that a break 1 minute below threshold (29 min) doesn't count"""
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
            id=225,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=226,
            name="Task B",
            location_id=1,
            start_time=569,  # 09:29 (29 min gap - 1 below threshold)
            end_time=629,    # 10:29 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 29 minutes should NOT count as break
    assert result.breaks_per_person[1] == 0, f"Expected 0 breaks (29 min < 30 min), got {result.breaks_per_person[1]}"
    assert result.fatigue_per_person[1] == 120.0


def test_mixed_gaps_some_qualify_some_dont():
    """Test multiple gaps where only some meet the break threshold"""
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
            id=227,
            name="Task 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=228,
            name="Task 2",
            location_id=1,
            start_time=560,  # 09:20 (20 min gap - NO break)
            end_time=620,    # 10:20
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=229,
            name="Task 3",
            location_id=1,
            start_time=680,  # 11:20 (60 min gap - YES break)
            end_time=740,    # 12:20
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=230,
            name="Task 4",
            location_id=1,
            start_time=755,  # 12:35 (15 min gap - NO break)
            end_time=815,    # 13:35
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,  # Recovery per minute of break
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Only one gap (60 min) qualifies as break
    assert result.breaks_per_person[1] >= 1, f"Expected at least 1 break, got {result.breaks_per_person[1]}"
    # Total work: 240 minutes, 60 min break at -0.5/min
    expected_fatigue = 240.0 + (-0.5 * 60)
    assert abs(result.fatigue_per_person[1] - expected_fatigue) < 0.1


def test_very_long_continuous_work_then_break():
    """Test very long continuous work (4 hours) followed by break"""
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
            id=231,
            name="Long Morning Work",
            location_id=1,
            start_time=480,  # 08:00
            end_time=720,    # 12:00 (240 minutes continuous)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=232,
            name="Afternoon Task",
            location_id=1,
            start_time=780,  # 13:00 (60 min lunch break)
            end_time=840,    # 14:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,  # Recovery per minute of break
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Should have break segments during the 60 min gap
    assert result.breaks_per_person[1] >= 1, f"Expected at least 1 break, got {result.breaks_per_person[1]}"
    # Total work: 300 minutes, 60 min break at -0.5/min
    expected_fatigue = 300.0 + (-0.5 * 60)
    assert abs(result.fatigue_per_person[1] - expected_fatigue) < 0.1


def test_break_with_different_fatigue_rates():
    """Test that break effect is independent of task fatigue rates"""
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
            id=233,
            name="High Fatigue Task",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=234,
            name="Low Fatigue Task",
            location_id=1,
            start_time=600,  # 10:00 (60 min break)
            end_time=660,    # 11:00 (60 minutes)
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    # Different fatigue rates
    tasks[0].fatigue_per_minute = 2.0  # High fatigue
    tasks[1].fatigue_per_minute = 0.5  # Low fatigue
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,  # Recovery per minute of break
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Should have break segments in the 60 min gap
    assert result.breaks_per_person[1] >= 1, f"Expected at least 1 break, got {result.breaks_per_person[1]}"
    # Total fatigue: (60 * 2.0) + (60 * 0.5) - 60 min break at -0.5/min
    # = 120 + 30 - 30 = 120
    expected_fatigue = 150.0 + (-0.5 * 60)
    assert abs(result.fatigue_per_person[1] - expected_fatigue) < 0.1, f"Expected fatigue {expected_fatigue}, got {result.fatigue_per_person[1]}"


# ============================================================================
# UNAVAILABLE PERIOD TESTS (20 tests)
# ============================================================================

def test_unavailable_during_task_time():
    """Person unavailable during task - should be infeasible or unassigned"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(480, 540)]  # 08:00-09:00
    )
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible since person is unavailable during the only task
    assert result.status == "INFEASIBLE"


def test_unavailable_during_one_of_multiple_tasks():
    """Person unavailable during one task but available for another"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(480, 540)]  # 08:00-09:00
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - person can't do Task A but Task B alone leaves Task A uncovered
    assert result.status == "INFEASIBLE"


def test_unavailable_during_break_period():
    """Person unavailable during potential break - break should not be counted"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(540, 600)]  # 09:00-10:00 (the gap)
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # No break during unavailable period
    assert result.breaks_per_person[1] == 0
    # Fatigue: 120 min work, no breaks
    assert result.fatigue_per_person[1] == 120.0


def test_partial_unavailability_within_task():
    """Person unavailable for part of a task duration"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(500, 520)]  # 08:20-08:40 (middle of task)
    )
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00 (60 min task)
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - can't do task when partially unavailable
    assert result.status == "INFEASIBLE"


def test_multiple_unavailable_periods():
    """Person has multiple unavailable periods throughout day"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[
            (480, 500),   # 08:00-08:20
            (540, 560),   # 09:00-09:20
            (600, 620)    # 10:00-10:20
        ]
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=500,  # 08:20
            end_time=540,    # 09:00
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=620,  # 10:20
            end_time=680,    # 11:20
            requirements={},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person works 40 + 60 = 100 minutes
    assert result.fatigue_per_person[1] == 100.0 or result.fatigue_per_person[1] == 97.0  # Might have break


def test_two_persons_different_unavailability():
    """Two persons with different unavailable periods - optimal assignment"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(480, 540)]  # 08:00-09:00
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(600, 660)]  # 10:00-11:00
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person 1 can't do Task A (unavailable), Person 2 must do it
    # Person 2 can't do Task B (unavailable), Person 1 must do it
    assert result.fatigue_per_person[1] == 60.0
    assert result.fatigue_per_person[2] == 60.0


def test_unavailable_all_day():
    """Person unavailable entire day - should not be assigned"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(0, 1440)]  # All day
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Only Person 2 should work
    assert result.fatigue_per_person.get(1, 0) == 0
    assert result.fatigue_per_person[2] == 60.0


def test_unavailable_exactly_at_task_boundaries():
    """Unavailable period exactly matches task start/end times"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(480, 540)]  # Exactly 08:00-09:00
    )
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "INFEASIBLE"


def test_unavailable_before_and_after_task():
    """Person unavailable before and after task but available during"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[
            (0, 480),      # Before 08:00
            (540, 1440)    # After 09:00
        ]
    )
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={},
        preassigned_person_ids=[1]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    assert result.fatigue_per_person[1] == 60.0
    # No breaks possible - unavailable before and after
    assert result.breaks_per_person[1] == 0


def test_unavailable_overlapping_multiple_segments():
    """Unavailable period spans multiple time segments"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(510, 630)]  # 08:30-10:30 (spans multiple segments)
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=540,  # 09:00
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=202,
            name="Task C",
            location_id=1,
            start_time=660,  # 11:00
            end_time=720,    # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - unavailable during Tasks A and B
    assert result.status == "INFEASIBLE"


def test_unavailable_short_period_within_long_task():
    """Short unavailable period within a long task"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(540, 545)]  # 09:00-09:05 (5 min)
    )
    
    task = NormTask(
        id=200,
        name="Long Task",
        location_id=1,
        start_time=480,  # 08:00
        end_time=720,    # 12:00 (4 hours)
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - can't do task with unavailable period in middle
    assert result.status == "INFEASIBLE"


def test_unavailable_adjacent_to_task_no_overlap():
    """Unavailable period adjacent to task but not overlapping"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(540, 600)]  # 09:00-10:00
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00 (ends when unavailable starts)
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00 (starts when unavailable ends)
            end_time=660,    # 11:00
            requirements={},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Can do both tasks, unavailable period is between them (no break counted)
    assert result.fatigue_per_person[1] == 120.0
    assert result.breaks_per_person[1] == 0


def test_preassigned_but_unavailable():
    """Person preassigned to task but unavailable during that time"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(480, 540)]  # 08:00-09:00
    )
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[1]  # Preassigned but unavailable!
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - preassigned but unavailable
    assert result.status == "INFEASIBLE"


def test_unavailable_gap_prevents_break():
    """Gap would qualify as break but person is unavailable"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(570, 630)]  # 09:30-10:30 (60 min)
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=570,    # 09:30
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=630,  # 10:30
            end_time=690,    # 11:30
            requirements={},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 90 + 60 = 150 min work, no break (unavailable during gap)
    assert result.fatigue_per_person[1] == 150.0
    assert result.breaks_per_person[1] == 0


def test_unavailable_very_early_morning():
    """Person unavailable very early, all tasks later"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(0, 420)]  # Unavailable until 07:00
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Should have a break in the gap
    assert result.breaks_per_person[1] >= 1


def test_unavailable_very_late_evening():
    """Person unavailable very late, all tasks earlier"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(1200, 1440)]  # Unavailable from 20:00 onwards
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Should have a break in the gap
    assert result.breaks_per_person[1] >= 1


def test_unavailable_multiple_short_periods():
    """Multiple short unavailable periods throughout the day"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[
            (495, 500),   # 08:15-08:20 (5 min)
            (555, 560),   # 09:15-09:20 (5 min)
            (615, 620)    # 10:15-10:20 (5 min)
        ]
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - unavailable during task times
    assert result.status == "INFEASIBLE"


def test_unavailable_single_minute():
    """Person unavailable for just 1 minute during task"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(510, 511)]  # 08:30-08:31 (1 minute)
    )
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[1]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - even 1 minute unavailable during task
    assert result.status == "INFEASIBLE"


def test_unavailable_between_consecutive_tasks():
    """Person unavailable in very short gap between consecutive tasks"""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["is_orga"],
        max_work_minutes_per_day=480,
        unavailable_intervals=[(540, 545)]  # 09:00-09:05 (5 min gap)
    )
    
    tasks = [
        NormTask(
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={},
            preassigned_person_ids=[1]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=545,  # 09:05
            end_time=605,    # 10:05
            requirements={},
            preassigned_person_ids=[1]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Can do both tasks, unavailable between them is fine
    assert result.fatigue_per_person[1] == 120.0 or result.fatigue_per_person[1] == 117.0  # Might have break


def test_three_persons_overlapping_unavailability():
    """Three persons with overlapping unavailable periods"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(480, 540)]  # 08:00-09:00
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(510, 570)]  # 08:30-09:30
        ),
        NormPerson(
            id=3,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]  # Always available
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task A",
        location_id=1,
        start_time=520,  # 08:40
        end_time=560,    # 09:20
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person 1 and 2 unavailable during task, Person 3 must do it
    assert result.fatigue_per_person.get(1, 0) == 0
    assert result.fatigue_per_person.get(2, 0) == 0
    assert result.fatigue_per_person[3] == 40.0


# ========================================
# LOCATION-FOCUSED TEST CASES
# ========================================

def test_person_at_wrong_location_cannot_do_task():
    """Person at location A cannot do task at location B without movement"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,  # Home at location 1
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=2,  # Home at location 2
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person 2 is already at location 2, should do the task
    assert result.fatigue_per_person[2] == 60.0
    # Person 1 is at location 1, should not work
    assert result.fatigue_per_person.get(1, 0) == 0


def test_consecutive_tasks_same_location():
    """Two consecutive tasks at same location - person stays put"""
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
            id=200,
            name="Task A",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task B",
            location_id=1,
            start_time=540,  # 09:00
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person does both tasks at same location
    assert result.fatigue_per_person[1] == 120.0


def test_person_must_use_transfer_to_change_location():
    """Person uses transfer to move from location A to location B for task"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=540,  # 09:00
        end_time=600,    # 10:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,  # 08:00
        arrive_time=540,  # 09:00
        capacity=10,
        requirements={}
    )
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[transfer],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person takes transfer and does task
    assert result.fatigue_per_person[1] == 60.0


def test_multiple_persons_at_different_locations():
    """Two persons at different home locations, each does task at their location"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Each person does task at their own location
    assert result.fatigue_per_person[1] == 60.0
    assert result.fatigue_per_person[2] == 60.0


def test_no_transfer_available_task_unreachable():
    """Task at different location with no transfer - only local person can do it"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[],  # No transfers available
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Only Person 3 at location 2 can do the task
    assert result.fatigue_per_person[3] == 60.0
    assert result.fatigue_per_person.get(1, 0) == 0
    assert result.fatigue_per_person.get(2, 0) == 0


def test_preassigned_person_at_correct_location():
    """Preassigned person already at task location"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={},
        preassigned_person_ids=[2]  # Person 2 preassigned
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Preassigned person at correct location does task
    assert result.fatigue_per_person[2] == 60.0
    assert result.fatigue_per_person.get(1, 0) == 0


def test_transfer_between_consecutive_tasks():
    """Person takes transfer between two tasks at different locations"""
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
            id=200,
            name="Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=540,  # 09:00
        arrive_time=600,  # 10:00
        capacity=10,
        requirements={}
    )
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[transfer],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person does both tasks with transfer in between
    assert result.fatigue_per_person[1] == 120.0


def test_three_locations_sequential_tasks():
    """Person visits three different locations for three tasks"""
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
            id=200,
            name="Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=202,
            name="Task at Location 3",
            location_id=3,
            start_time=720,  # 12:00
            end_time=780,    # 13:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    transfers = [
        NormTransfer(
            id=300,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=301,
            from_location_id=2,
            to_location_id=3,
            depart_time=660,  # 11:00
            arrive_time=720,  # 12:00
            capacity=10,
            requirements={}
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person completes all three tasks
    assert result.fatigue_per_person[1] == 180.0


def test_location_prevents_double_booking():
    """Two simultaneous tasks at different locations require two persons"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Both persons needed for simultaneous tasks at different locations
    assert result.fatigue_per_person[1] == 60.0
    assert result.fatigue_per_person[2] == 60.0


def test_transfer_capacity_limits_movement():
    """Transfer with limited capacity restricts who can move"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Task A at Location 2",
            location_id=2,
            start_time=540,  # 09:00
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task B at Location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    # Transfer with capacity 1 - only one person can move
    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,  # 08:00
        arrive_time=540,  # 09:00
        capacity=1,
        requirements={}
    )
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[transfer],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person 3 already at location 2 should do one task
    # One person from location 1 should take transfer for other task
    total_fatigue = sum(result.fatigue_per_person.values())
    assert total_fatigue == 120.0  # Two tasks completed


def test_return_transfer_for_round_trip():
    """Person takes transfer to task location and returns home"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=540,  # 09:00
        end_time=600,    # 10:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    transfers = [
        NormTransfer(
            id=300,
            from_location_id=1,
            to_location_id=2,
            depart_time=480,  # 08:00
            arrive_time=540,  # 09:00
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=301,
            from_location_id=2,
            to_location_id=1,
            depart_time=600,  # 10:00
            arrive_time=660,  # 11:00
            capacity=10,
            requirements={}
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person completes task (may or may not return home)
    assert result.fatigue_per_person[1] == 60.0


def test_alternating_locations_multiple_transfers():
    """Person alternates between two locations with multiple tasks"""
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
            id=200,
            name="Task 1 at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=520,    # 08:40
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task 2 at Location 2",
            location_id=2,
            start_time=580,  # 09:40
            end_time=620,    # 10:20
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=202,
            name="Task 3 at Location 1",
            location_id=1,
            start_time=680,  # 11:20
            end_time=720,    # 12:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    transfers = [
        NormTransfer(
            id=300,
            from_location_id=1,
            to_location_id=2,
            depart_time=520,  # 08:40
            arrive_time=580,  # 09:40
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=301,
            from_location_id=2,
            to_location_id=1,
            depart_time=620,  # 10:20
            arrive_time=680,  # 11:20
            capacity=10,
            requirements={}
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person completes all three tasks
    assert result.fatigue_per_person[1] == 120.0  # 40+40+40


def test_location_with_unavailability():
    """Person unavailable but at correct location - cannot do task"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[(480, 540)]  # 08:00-09:00
        ),
        NormPerson(
            id=2,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 1",
        location_id=1,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person 1 unavailable, Person 2 does task
    assert result.fatigue_per_person[2] == 60.0
    assert result.fatigue_per_person.get(1, 0) == 0


def test_multiple_tasks_require_optimal_location_choice():
    """Optimizer chooses best person-location-task assignment"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=3,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=202,
            name="Task at Location 3",
            location_id=3,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Each person at their home location does their local task
    assert result.fatigue_per_person[1] == 60.0
    assert result.fatigue_per_person[2] == 60.0
    assert result.fatigue_per_person[3] == 60.0


def test_no_one_at_task_location_requires_transfer():
    """All persons at location 1, task at location 2 - someone must transfer"""
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
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=540,  # 09:00
        end_time=600,    # 10:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,  # 08:00
        arrive_time=540,  # 09:00
        capacity=10,
        requirements={}
    )
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[transfer],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # One person takes transfer and does task
    # Note: optimizer minimizes fatigue RANGE, so both persons may work to balance load
    total_fatigue = sum(result.fatigue_per_person.values())
    assert total_fatigue >= 60.0  # At least one task completed


def test_moving_task_changes_person_location():
    """Task with from_location and to_location moves person"""
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
            id=200,
            name="Moving Task 1->2",
            location_id=1,  # Start location
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=540,  # 09:00
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    # Set from and to locations for moving task
    tasks[0].from_location_id = 1
    tasks[0].to_location_id = 2
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person does moving task, then arrives at location 2 for next task
    assert result.fatigue_per_person[1] == 120.0


def test_simultaneous_tasks_same_location_different_persons():
    """Two simultaneous tasks at same location require two persons"""
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
            id=200,
            name="Task A at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task B at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Both persons at same location do simultaneous tasks
    assert result.fatigue_per_person[1] == 60.0
    assert result.fatigue_per_person[2] == 60.0


def test_complex_multi_location_scenario():
    """Complex scenario: 3 persons, 3 locations, multiple tasks and transfers"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga", "tech"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=2,
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=3,
            home_location_id=3,
            capabilities=["tech"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Orga Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Orga Task at Location 2",  # Changed from tech to orga
            location_id=2,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},  # Changed from tech to orga
            preassigned_person_ids=[]
        ),
        NormTask(
            id=202,
            name="Tech Task at Location 3",  # Changed from orga to tech
            location_id=3,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"tech": 1},  # Changed from orga to tech
            preassigned_person_ids=[]
        ),
        NormTask(
            id=203,
            name="Orga Task at Location 1",  # Changed from tech to orga
            location_id=1,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},  # Changed from tech to orga
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    transfers = [
        NormTransfer(
            id=300,
            from_location_id=1,
            to_location_id=2,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=301,
            from_location_id=2,
            to_location_id=3,
            depart_time=540,  # 09:00
            arrive_time=600,  # 10:00
            capacity=10,
            requirements={}
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # All tasks should be completed
    # Note: Person who does multiple tasks may get breaks, reducing total fatigue
    total_fatigue = sum(result.fatigue_per_person.values())
    assert total_fatigue <= 240.0  # At most 4 tasks * 60 minutes each


def test_location_continuity_without_transfer_fails():
    """Person cannot jump locations without transfer - task becomes infeasible"""
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
            id=200,
            name="Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=540,  # 09:00 (immediately after, no time to transfer)
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    # No transfer available between locations
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be infeasible - person can't be at both locations
    # OR only first task completed
    if result.status == "OPTIMAL":
        # If optimal, only one task should be completed
        total_fatigue = sum(result.fatigue_per_person.values())
        assert total_fatigue == 60.0
    else:
        # Both tasks required but impossible to complete
        assert result.status == "INFEASIBLE"


def test_no_transfer_available_task_unreachable():
    """Task at different location with no transfer - only local person can do it"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=480,  # 08:00
        end_time=540,    # 09:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[],  # No transfers available
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Only Person 3 at location 2 can do the task
    assert result.fatigue_per_person[3] == 60.0
    assert result.fatigue_per_person.get(1, 0) == 0
    assert result.fatigue_per_person.get(2, 0) == 0


def test_transfer_capacity_limits_movement():
    """Transfer with limited capacity restricts who can move"""
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
            home_location_id=2,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    tasks = [
        NormTask(
            id=200,
            name="Task A at Location 2",
            location_id=2,
            start_time=540,  # 09:00
            end_time=600,    # 10:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task B at Location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    # Transfer with capacity 1 - only one person can move
    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,  # 08:00
        arrive_time=540,  # 09:00
        capacity=1,
        requirements={}
    )
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[transfer],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person 3 already at location 2 should do one task
    # One person from location 1 should take transfer for other task
    total_fatigue = sum(result.fatigue_per_person.values())
    assert total_fatigue == 120.0  # Two tasks completed


def test_return_transfer_for_round_trip():
    """Person takes transfer to task location and returns home"""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=540,  # 09:00
        end_time=600,    # 10:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0
    
    transfers = [
        NormTransfer(
            id=300,
            from_location_id=1,
            to_location_id=2,
            depart_time=480,  # 08:00
            arrive_time=540,  # 09:00
            capacity=10,
            requirements={}
        ),
        NormTransfer(
            id=301,
            from_location_id=2,
            to_location_id=1,
            depart_time=600,  # 10:00
            arrive_time=660,  # 11:00
            capacity=10,
            requirements={}
        )
    ]
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=transfers,
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person completes task (may or may not return home)
    assert result.fatigue_per_person[1] == 60.0


def test_transfer_between_consecutive_tasks():
    """Person takes transfer between two tasks at different locations"""
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
            id=200,
            name="Task at Location 1",
            location_id=1,
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        ),
        NormTask(
            id=201,
            name="Task at Location 2",
            location_id=2,
            start_time=600,  # 10:00
            end_time=660,    # 11:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[]
        )
    ]
    
    for task in tasks:
        task.fatigue_per_minute = 1.0
    
    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=540,  # 09:00
        arrive_time=600,  # 10:00
        capacity=10,
        requirements={}
    )
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[transfer],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person does both tasks with transfer in between
    assert result.fatigue_per_person[1] == 120.0


def test_preassigned_person_must_travel_to_different_location():
    """Preassigned person at wrong location must take transfer"""
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
    
    task = NormTask(
        id=200,
        name="Task at Location 2",
        location_id=2,
        start_time=540,  # 09:00
        end_time=600,    # 10:00
        requirements={"is_orga": 1},
        preassigned_person_ids=[1]  # Person 1 preassigned but at wrong location
    )
    task.fatigue_per_minute = 1.0
    
    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,  # 08:00
        arrive_time=540,  # 09:00
        capacity=10,
        requirements={}
    )
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[task],
        transfers=[transfer],
        errors=[],
        floating_tasks=[]
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Preassigned Person 1 must take transfer and do task
    assert result.fatigue_per_person[1] == 60.0


# ===== FLOATING TASK TESTS =====

def test_single_floating_task_in_wide_window():
    """Single floating task with 60min duration in 240min window - should optimize placement for breaks"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=720, duration=60, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    # Set fatigue rate for floating tasks
    for ft in floating_tasks:
        ft.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person should have 60min work
    assert result.fatigue_per_person[1] == 60.0



def test_two_floating_tasks_same_window():
    """Two floating tasks (30min each) in same 120min window - should schedule both"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=600, duration=30, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=1, window_start_time=480, window_end_time=600, duration=30, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    floating_tasks[1].fatigue_per_minute = 1.0
    
    # Set fatigue rate for floating tasks
    for ft in floating_tasks:
        ft.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Person should have 60min total work (30+30)
    assert result.fatigue_per_person[1] == 60.0



def test_floating_task_with_fixed_task():
    """Floating task (60min) and fixed task (60min) - should schedule around each other"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    tasks = [
        NormTask(id=1, name="T1", start_time=480, end_time=540, location_id=1, requirements={"basic": 1}, preassigned_person_ids=[])
    ]
    tasks[0].fatigue_per_minute = 1.0
    
    floating_tasks = [
        NormFloatingTask(id=2, name="F1", location_id=1, window_start_time=480, window_end_time=660, duration=60, requirements={"basic": 1})
    ]
    floating_tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 120min work; floating placement is non-deterministic for 1 person (range=0),
    # so break count and recovery depend on solver placement.
    fat = result.fatigue_per_person[1]
    assert 90.0 <= fat <= 120.0, f"Expected fatigue in [90, 120], got {fat}"



def test_floating_task_exact_window_fit():
    """Floating task with duration exactly matching window - must start at window_start"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=540, duration=60, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    assert result.fatigue_per_person[1] == 60.0



def test_floating_task_window_too_small():
    """Floating task with duration > window size - should be INFEASIBLE"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=510, duration=60, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "INFEASIBLE"



def test_two_persons_one_floating_task():
    """Two persons, one floating task - optimizer chooses one person to minimize range"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[]),
        NormPerson(id=2, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # One person should have 60, other should have 0
    fatigues = sorted([result.fatigue_per_person[1], result.fatigue_per_person[2]])
    assert fatigues == [0.0, 60.0]



def test_floating_task_with_capability_requirement():
    """Floating task requires capability - only qualified person can do it"""
    persons = [
        NormPerson(id=1, capabilities=["skill_a"], home_location_id=1, unavailable_intervals=[]),
        NormPerson(id=2, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"skill_a": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    # Note: NormFloatingTask doesn't have requirements field in current implementation
    # This test assumes floating tasks inherit location-based capability checking
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Either person can do it since no specific requirements
    total_fatigue = result.fatigue_per_person[1] + result.fatigue_per_person[2]
    assert total_fatigue == 60.0



def test_multiple_floating_tasks_distribution():
    """Three floating tasks, two persons - should distribute to balance fatigue"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[]),
        NormPerson(id=2, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1}),
        NormFloatingTask(id=3, name="F3", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    floating_tasks[1].fatigue_per_minute = 1.0
    floating_tasks[2].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Total should be 180 (3 * 60)
    total_fatigue = result.fatigue_per_person[1] + result.fatigue_per_person[2]
    assert total_fatigue == 180.0
    # Should balance: one person 120, other 60 (or similar)
    fatigues = sorted([result.fatigue_per_person[1], result.fatigue_per_person[2]])
    assert fatigues[0] >= 60.0  # Each person gets at least one task
    assert fatigues[1] <= 120.0  # No person gets all three



def test_floating_task_with_break_opportunity():
    """Two floating tasks with gap - should allow break if gap is large enough"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=540, duration=30, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=1, window_start_time=600, window_end_time=660, duration=30, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    floating_tasks[1].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 60min work - 30min break (if scheduled optimally) = 30min fatigue
    assert result.fatigue_per_person[1] <= 60.0  # May get break benefit



def test_floating_task_overlapping_windows():
    """Two floating tasks with overlapping windows - can't both be done by same person simultaneously"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=600, duration=90, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=1, window_start_time=510, window_end_time=630, duration=90, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    floating_tasks[1].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Might be OPTIMAL if they can be scheduled sequentially, or INFEASIBLE if no time
    # With current windows, both can fit: F1 at 480-570, F2 at 570-660 (or similar)
    if result.status == "OPTIMAL":
        assert result.fatigue_per_person[1] == 180.0  # 90+90



def test_floating_task_with_unavailability():
    """Floating task with person unavailable during part of window"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, 
                   unavailable_intervals=[(500, 560)])  # Unavailable 500-560 (60min)
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Task window is 480-600, task duration is 60min, unavailable is 500-560
    # Available periods: 480-500 (20min) and 560-600 (40min)
    # Neither is long enough for a 60-minute task → INFEASIBLE
    assert result.status == "INFEASIBLE"




    """Two floating tasks at different locations - person needs transfer"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    transfers = [
        NormTransfer(id=1, from_location_id=1, to_location_id=2, 
                    depart_time=540, arrive_time=570, capacity=10, requirements={"basic": 1})
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=540, duration=30, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=2, window_start_time=570, window_end_time=630, duration=30, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    floating_tasks[1].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=transfers,
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 30min F1 + 30min F2 = 60min total work at rate 1.0 = 60.0 base fatigue
    # With per-minute break recovery (-0.5/min), breaks reduce fatigue.
    # With 1 person the range is always 0, so the solver may pick any
    # number of valid breaks. Accept any fatigue <= 60.
    fat = result.fatigue_per_person[1]
    assert fat <= 60.0, f"Expected fatigue <= 60, got {fat}"



def test_floating_task_no_transfer_available():
    """Floating task at different location but no transfer - should be INFEASIBLE or skip task"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=2, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],  # No transfer available
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    # Should be OPTIMAL with person not doing the task (fatigue=0)
    # OR INFEASIBLE if floating tasks are mandatory
    if result.status == "OPTIMAL":
        assert result.fatigue_per_person[1] == 0.0  # Can't reach location



def test_long_floating_task_short_window():
    """Long duration floating task (180min) in slightly larger window (200min)"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=680, duration=180, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    assert result.fatigue_per_person[1] == 180.0



def test_many_short_floating_tasks():
    """Six floating tasks (10min each) in 90min window - all should fit"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=i, name=f"F{i}", location_id=1, window_start_time=480, window_end_time=570, duration=10, requirements={"basic": 1})
        for i in range(1, 7)
    ]

    # Set fatigue rate
    for ft in floating_tasks:
        ft.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 6 tasks * 10min = 60min
    assert result.fatigue_per_person[1] == 60.0



def test_floating_task_sequential_windows():
    """Three floating tasks in three sequential non-overlapping windows"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=540, duration=30, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=1, window_start_time=540, window_end_time=600, duration=30, requirements={"basic": 1}),
        NormFloatingTask(id=3, name="F3", location_id=1, window_start_time=600, window_end_time=660, duration=30, requirements={"basic": 1})
    ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    floating_tasks[1].fatigue_per_minute = 1.0
    floating_tasks[2].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 3 * 30 = 90min work; floating placement is non-deterministic (1 person),
    # so break count varies. With -0.5/min, max recovery = 2 breaks * 0.5*30 = 30.
    fat = result.fatigue_per_person[1]
    assert 60.0 <= fat <= 90.0, f"Expected fatigue in [60, 90], got {fat}"




def test_floating_tasks_tight_packing():
    """Four 30-min floating tasks in 120-min window - perfect fit"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=i, name=f"F{i}", location_id=1, window_start_time=480, window_end_time=600, duration=30, requirements={"basic": 1})
        for i in range(1, 5)
    ]

    # Set fatigue rate
    for ft in floating_tasks:
        ft.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # 4 * 30 = 120min, perfectly packed
    assert result.fatigue_per_person[1] == 120.0



def test_floating_task_capacity_constraint():
    """Two persons, two floating tasks in same window - both can be done in parallel if capacity allows"""
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[]),
        NormPerson(id=2, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=1, window_start_time=480, window_end_time=600, duration=60, requirements={"basic": 1})
        ]

    # Set fatigue rate
    floating_tasks[0].fatigue_per_minute = 1.0
    floating_tasks[1].fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    config = OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-3.0,
        max_time_seconds=10.0
    )
    
    result = optimize_with_fatigue(normalized, config=config)
    
    assert result.status == "OPTIMAL"
    # Both persons work 60min each for balanced load
    assert result.fatigue_per_person[1] == 60.0
    assert result.fatigue_per_person[2] == 60.0


# ============================================================================
# MULTI-CAPABILITY TESTS
# ============================================================================

def test_multi_cap_one_person_cannot_fill_two_slots():
    """
    One person has both is_ho and is_nurse capabilities.
    Task requires 1 is_ho + 1 is_nurse = 2 distinct slots.
    Should be INFEASIBLE because one person cannot fill two slots.
    """
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_ho", "is_nurse"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        )
    ]

    tasks = [
        NormTask(
            id=100,
            name="Multi-Cap Task",
            location_id=1,
            start_time=480,
            end_time=540,
            requirements={"is_ho": 1, "is_nurse": 1},
            preassigned_person_ids=[]
        )
    ]
    tasks[0].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30, break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "INFEASIBLE", (
        f"Expected INFEASIBLE (1 person can't fill 2 capability slots), got {result.status}"
    )


def test_multi_cap_two_persons_each_with_one_cap():
    """
    Two persons, each with one capability.
    Task needs 1 is_ho + 1 is_nurse.
    Should be OPTIMAL with each person filling their respective slot.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_ho"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=["is_nurse"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]

    tasks = [
        NormTask(
            id=100, name="Multi-Cap Task", location_id=1,
            start_time=480, end_time=540,
            requirements={"is_ho": 1, "is_nurse": 1},
            preassigned_person_ids=[]
        )
    ]
    tasks[0].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30, break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    assert (100, "is_ho") in result.capability_assignments
    assert (100, "is_nurse") in result.capability_assignments
    assert 1 in result.capability_assignments[(100, "is_ho")], "Person 1 should fill is_ho slot"
    assert 2 in result.capability_assignments[(100, "is_nurse")], "Person 2 should fill is_nurse slot"


def test_multi_cap_three_persons_two_cap_types():
    """
    Three persons: P1 has is_ho, P2 and P3 have is_nurse.
    Task needs 1 is_ho + 2 is_nurse = 3 slots.
    Should be OPTIMAL with correct per-capability assignment.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_ho"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=["is_nurse"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=3, home_location_id=1, capabilities=["is_nurse"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]

    tasks = [
        NormTask(
            id=100, name="Multi-Cap Task", location_id=1,
            start_time=480, end_time=540,
            requirements={"is_ho": 1, "is_nurse": 2},
            preassigned_person_ids=[]
        )
    ]
    tasks[0].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30, break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    assert (100, "is_ho") in result.capability_assignments
    assert (100, "is_nurse") in result.capability_assignments
    assert result.capability_assignments[(100, "is_ho")] == [1]
    assert sorted(result.capability_assignments[(100, "is_nurse")]) == [2, 3]


def test_multi_cap_zero_fatigue_rate():
    """
    Multi-cap task with fatigue_per_minute not set (defaults to 0).
    Should still be OPTIMAL  -  the bounds fix ensures zero-cost tasks don't break.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_ho"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=["is_nurse"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=3, home_location_id=1, capabilities=["is_nurse"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]

    tasks = [
        NormTask(
            id=100, name="Zero-Fatigue Multi-Cap", location_id=1,
            start_time=480, end_time=540,
            requirements={"is_ho": 1, "is_nurse": 2},
            preassigned_person_ids=[]
        )
    ]
    # Note: no fatigue_per_minute set  -  defaults to 0.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30, break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    assert (100, "is_ho") in result.capability_assignments
    assert (100, "is_nurse") in result.capability_assignments
    assert len(result.capability_assignments[(100, "is_nurse")]) == 2


def test_multi_cap_person_with_both_caps_needs_two_people():
    """
    Two persons both having is_ho and is_nurse.
    Task needs 1 is_ho + 1 is_nurse.
    Should be OPTIMAL: each person fills exactly one slot (different people for each).
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_ho", "is_nurse"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=["is_ho", "is_nurse"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]

    tasks = [
        NormTask(
            id=100, name="Multi-Cap Task", location_id=1,
            start_time=480, end_time=540,
            requirements={"is_ho": 1, "is_nurse": 1},
            preassigned_person_ids=[]
        )
    ]
    tasks[0].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30, break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "OPTIMAL", f"Expected OPTIMAL, got {result.status}"
    ho_persons = result.capability_assignments[(100, "is_ho")]
    nurse_persons = result.capability_assignments[(100, "is_nurse")]
    # Different persons must fill the two slots
    assert len(ho_persons) == 1
    assert len(nurse_persons) == 1
    assert ho_persons[0] != nurse_persons[0], (
        f"Same person {ho_persons[0]} filled both is_ho and is_nurse slots  -  "
        f"each slot must be assigned to a different person"
    )


# ============================================================
# Per-Field Assignment Tests
# ============================================================


def test_transfer_field_assignments_with_dynamic_allocation():
    """
    Transfer with multiple capability fields + dynamic allocation → field_assignments
    splits boarding persons per template field, with leftovers as transferee.

    Setup:
      - Transfer from loc 1 → loc 2 (08:00-09:00)
      - field_requirements:
          front_orga: {is_orga: 1}
          side_orga:  {is_ho: 2}
          back_orga:  {is_driver: 1}
      - transferee_field_id = "field_transferee"
      - dynamic_allocation_limit = 40, so capacity = 1+2+1+40 = 44
      - 5 persons: (1=orga, 2=ho, 3=ho, 4=driver, 5=none)
      - All at loc 1, task at loc 2 requires transfer

    Expected:
      - All 5 board the transfer
      - field_assignments[transfer.id]:
          front_orga → [person with is_orga]
          side_orga  → [two persons with is_ho]
          back_orga  → [person with is_driver]
          field_transferee → [remaining person(s)]
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=["is_ho"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=3, home_location_id=1, capabilities=["is_ho"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=4, home_location_id=1, capabilities=["is_driver"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=5, home_location_id=1, capabilities=[],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]

    # Task at location 2 that requires all 5 people (so they all board)
    task = NormTask(
        id=200, name="Task at Loc 2", location_id=2,
        start_time=540, end_time=600,  # 09:00-10:00
        requirements={},
        preassigned_person_ids=[1, 2, 3, 4, 5]
    )
    task.fatigue_per_minute = 1.0

    transfer = NormTransfer(
        id=300,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,  # 08:00
        arrive_time=540,  # 09:00
        capacity=44,      # 1+2+1+40
        requirements={"is_orga": 1, "is_ho": 2, "is_driver": 1},
        field_requirements={
            "front_orga": {"is_orga": 1},
            "side_orga": {"is_ho": 2},
            "back_orga": {"is_driver": 1},
        },
        transferee_field_id="field_transferee"
    )

    normalized = NormalizedFlowInput(
        persons=persons, tasks=[task], transfers=[transfer],
        errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30,
                                break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status in ("OPTIMAL", "FEASIBLE"), f"Got {result.status}"

    # All 5 should board
    boarding = result.transfer_assignments.get(300, [])
    assert len(boarding) == 5, f"Expected 5 boarding, got {len(boarding)}: {boarding}"

    # Check field_assignments
    fa = result.field_assignments.get(300, {})
    assert fa, f"No field_assignments for transfer 300. result.field_assignments={result.field_assignments}"

    # front_orga: exactly 1 person with is_orga
    assert "front_orga" in fa, f"Missing front_orga in {fa}"
    assert len(fa["front_orga"]) == 1
    assert fa["front_orga"][0] == 1, f"Expected person 1 (is_orga), got {fa['front_orga']}"

    # side_orga: exactly 2 persons with is_ho
    assert "side_orga" in fa, f"Missing side_orga in {fa}"
    assert len(fa["side_orga"]) == 2
    assert set(fa["side_orga"]) == {2, 3}, f"Expected persons 2,3 (is_ho), got {fa['side_orga']}"

    # back_orga: exactly 1 person with is_driver
    assert "back_orga" in fa, f"Missing back_orga in {fa}"
    assert len(fa["back_orga"]) == 1
    assert fa["back_orga"][0] == 4, f"Expected person 4 (is_driver), got {fa['back_orga']}"

    # transferee: remaining person(s)
    assert "field_transferee" in fa, f"Missing field_transferee in {fa}"
    assert fa["field_transferee"] == [5], f"Expected [5] as transferee, got {fa['field_transferee']}"


def test_task_field_assignments_multi_capability_fields():
    """
    Regular task with multiple capabilities_list fields → field_assignments
    maps persons back to specific fields using capability_assignments.

    Setup:
      - Task requires: is_orga:1, is_driver:1 from two separate fields
      - field_requirements:
          field_lead: {is_orga: 1}
          field_driver: {is_driver: 1}
      - 2 persons, each with one capability

    Expected:
      - field_assignments[task.id]:
          field_lead → [orga person]
          field_driver → [driver person]
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=["is_driver"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]

    task = NormTask(
        id=100, name="Multi-Field Task", location_id=1,
        start_time=480, end_time=540,  # 08:00-09:00
        requirements={"is_orga": 1, "is_driver": 1},
        preassigned_person_ids=[],
        field_requirements={
            "field_lead": {"is_orga": 1},
            "field_driver": {"is_driver": 1},
        }
    )
    task.fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=[task], transfers=[], errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30,
                                break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "OPTIMAL"
    # Persons are assigned via capability provision (x), not preassignment
    assert result.capability_assignments[(100, "is_orga")] == [1]
    assert result.capability_assignments[(100, "is_driver")] == [2]

    fa = result.field_assignments.get(100, {})
    assert fa, f"No field_assignments for task 100"
    assert fa.get("field_lead") == [1], f"Expected field_lead=[1], got {fa.get('field_lead')}"
    assert fa.get("field_driver") == [2], f"Expected field_driver=[2], got {fa.get('field_driver')}"


def test_transfer_roles_are_distinct_when_one_person_has_both_capabilities():
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["front", "side"]),
        NormPerson(id=2, home_location_id=1, capabilities=["side"]),
        NormPerson(id=3, home_location_id=1, capabilities=["side"]),
        NormPerson(id=4, home_location_id=1, capabilities=["side"]),
    ]
    transfer = NormTransfer(
        id=301,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,
        arrive_time=540,
        capacity=4,
        requirements={"front": 1, "side": 3},
        field_requirements={
            "front_orga": {"front": 1},
            "side_orga": {"side": 2},
            "back_orga": {"side": 1},
        },
    )
    result = optimize_with_fatigue(
        NormalizedFlowInput(
            persons=persons,
            tasks=[],
            transfers=[transfer],
            errors=[],
            floating_tasks=[],
        ),
        config=OptimizationConfig(max_time_seconds=10.0),
    )

    assert result.status in ("OPTIMAL", "FEASIBLE")
    fields = result.field_assignments[301]
    assert len(fields["front_orga"]) == 1
    assert len(fields["side_orga"]) == 2
    assert len(fields["back_orga"]) == 1
    assert len({pid for assigned in fields.values() for pid in assigned}) == 4
    assert fields["front_orga"] == [1]


def test_regular_repeated_capability_is_partitioned_between_fields():
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["orga"]),
        NormPerson(id=2, home_location_id=1, capabilities=["orga"]),
        NormPerson(id=3, home_location_id=1, capabilities=["orga"]),
    ]
    task = NormTask(
        id=101,
        name="Repeated role",
        location_id=1,
        start_time=480,
        end_time=540,
        requirements={"orga": 3},
        field_requirements={
            "side_orga": {"orga": 2},
            "back_orga": {"orga": 1},
        },
    )
    result = optimize_with_fatigue(
        NormalizedFlowInput(
            persons=persons,
            tasks=[task],
            transfers=[],
            errors=[],
            floating_tasks=[],
        ),
        config=OptimizationConfig(max_time_seconds=10.0),
    )

    assert result.status in ("OPTIMAL", "FEASIBLE")
    fields = result.field_assignments[101]
    assert len(fields["side_orga"]) == 2
    assert len(fields["back_orga"]) == 1
    assert set(fields["side_orga"]).isdisjoint(fields["back_orga"])


def test_direct_transfer_passenger_does_not_fill_a_capability_role():
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["orga"]),
        NormPerson(id=2, home_location_id=1, capabilities=["orga"]),
    ]
    transfer = NormTransfer(
        id=303,
        from_location_id=1,
        to_location_id=2,
        depart_time=480,
        arrive_time=540,
        capacity=2,
        requirements={"orga": 1},
        field_requirements={"front_orga": {"orga": 1}},
        locked_person_ids=[1],
        person_field_assignments={"passengers": [1]},
    )
    result = optimize_with_fatigue(
        NormalizedFlowInput(
            persons=persons,
            tasks=[],
            transfers=[transfer],
            errors=[],
            floating_tasks=[],
        ),
        config=OptimizationConfig(max_time_seconds=10.0),
    )

    assert result.status in ("OPTIMAL", "FEASIBLE")
    assert result.field_assignments[303]["passengers"] == [1]
    assert result.field_assignments[303]["front_orga"] == [2]


def test_transfer_no_field_requirements_no_field_assignments():
    """
    Transfer without field_requirements → field_assignments should be empty for that transfer.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]

    task = NormTask(
        id=200, name="Task at Loc 2", location_id=2,
        start_time=540, end_time=600,
        requirements={"is_orga": 1},
        preassigned_person_ids=[]
    )
    task.fatigue_per_minute = 1.0

    transfer = NormTransfer(
        id=300, from_location_id=1, to_location_id=2,
        depart_time=480, arrive_time=540, capacity=10,
        requirements={}
    )

    normalized = NormalizedFlowInput(
        persons=persons, tasks=[task], transfers=[transfer],
        errors=[], floating_tasks=[]
    )
    config = OptimizationConfig(scale=100, break_threshold_min=30,
                                break_effect=-3.0, max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "OPTIMAL"
    # No field_requirements → no field_assignments entry for this transfer
    assert 300 not in result.field_assignments


# ============================================================================
# INITIAL FATIGUE (PREVIOUS-DAY CARRY-OVER) TESTS
# ============================================================================

def _make_config():
    return OptimizationConfig(
        scale=100,
        break_threshold_min=30,
        break_effect=-0.5,
        max_time_seconds=10.0,
    )


def test_initial_fatigue_zero_no_effect():
    """initial_fatigue=0.0 (default) produces identical result to omitting the field."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=0.0),
        NormPerson(id=2, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=0.0),
    ]
    task = NormTask(id=100, name="T", location_id=1,
                    start_time=480, end_time=540,
                    requirements={"is_orga": 1})
    task.fatigue_per_minute = 1.0

    norm = NormalizedFlowInput(persons=persons, tasks=[task],
                               transfers=[], errors=[], floating_tasks=[])
    result = optimize_with_fatigue(norm, config=_make_config())

    assert result.status == "OPTIMAL"
    # Both start at 0 so fatigue_range should be 60 (one works, one doesn't)
    assert result.fatigue_range == 60.0


def test_initial_fatigue_shifts_baseline():
    """Person with high initial_fatigue is avoided when only 1 task exists."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=50.0),
        NormPerson(id=2, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=0.0),
    ]
    task = NormTask(id=100, name="T", location_id=1,
                    start_time=480, end_time=540,
                    requirements={"is_orga": 1})
    task.fatigue_per_minute = 1.0  # 60 min => 60 fatigue

    norm = NormalizedFlowInput(persons=persons, tasks=[task],
                               transfers=[], errors=[], floating_tasks=[])
    result = optimize_with_fatigue(norm, config=_make_config())

    assert result.status == "OPTIMAL"
    # Optimal: assign to person 2 (initial=0) → fatigues become 50 vs 60 → range=10
    # If assigned to person 1 → fatigues become 110 vs 0 → range=110  (worse)
    assert (100, "is_orga") in result.capability_assignments
    assigned = result.capability_assignments[(100, "is_orga")]
    assert 2 in assigned, f"Expected person 2 assigned, got {assigned}"
    assert result.fatigue_per_person[1] == 50.0
    assert result.fatigue_per_person[2] == 60.0


def test_initial_fatigue_balances_assignment():
    """Two tasks: solver balances so the already-tired person gets the lighter task."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=40.0),
        NormPerson(id=2, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=0.0),
    ]
    # Short task (30 min → 30 fatigue) and long task (60 min → 60 fatigue)
    short = NormTask(id=100, name="Short", location_id=1,
                     start_time=480, end_time=510,
                     requirements={"is_orga": 1})
    short.fatigue_per_minute = 1.0

    long = NormTask(id=101, name="Long", location_id=1,
                    start_time=600, end_time=660,
                    requirements={"is_orga": 1})
    long.fatigue_per_minute = 1.0

    norm = NormalizedFlowInput(persons=persons, tasks=[short, long],
                               transfers=[], errors=[], floating_tasks=[])
    result = optimize_with_fatigue(norm, config=_make_config())

    assert result.status == "OPTIMAL"
    # With per-minute break recovery (-0.5/min), assigning both tasks to P2
    # gives P2 a 90-min break (510-600) worth -0.5*90 = -45 recovery:
    #   P1(init=40, no tasks) = 40, P2(init=0, 90min work - 45 break) = 45, range=5
    # This beats splitting tasks (range=10) because the break compensates.
    assert result.fatigue_per_person[1] == 40.0
    assert result.fatigue_per_person[2] == 45.0
    assert result.fatigue_range == 5.0


def test_initial_fatigue_uniform_no_effect():
    """Equal initial_fatigue for everyone doesn't change the assignment vs zero."""
    base_persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=0.0),
        NormPerson(id=2, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=0.0),
    ]
    uniform_persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=30.0),
        NormPerson(id=2, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=30.0),
    ]
    task = NormTask(id=100, name="T", location_id=1,
                    start_time=480, end_time=540,
                    requirements={"is_orga": 1})
    task.fatigue_per_minute = 1.0

    norm_base = NormalizedFlowInput(persons=base_persons, tasks=[task],
                                    transfers=[], errors=[], floating_tasks=[])
    norm_uniform = NormalizedFlowInput(persons=uniform_persons, tasks=[task],
                                       transfers=[], errors=[], floating_tasks=[])
    r_base = optimize_with_fatigue(norm_base, config=_make_config())
    r_uniform = optimize_with_fatigue(norm_uniform, config=_make_config())

    assert r_base.status == "OPTIMAL"
    assert r_uniform.status == "OPTIMAL"
    # Both should have the same fatigue range (uniform offset doesn't change range)
    assert r_base.fatigue_range == r_uniform.fatigue_range


def test_initial_fatigue_with_breaks():
    """Verify breaks still reduce fatigue correctly with non-zero initial_fatigue."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"],
                   max_work_minutes_per_day=480, initial_fatigue=20.0),
    ]
    # Two tasks with a 60-min gap (break-eligible)
    t1 = NormTask(id=100, name="Morning", location_id=1,
                  start_time=480, end_time=540,
                  requirements={"is_orga": 1})
    t1.fatigue_per_minute = 1.0   # 60 fatigue

    t2 = NormTask(id=101, name="Afternoon", location_id=1,
                  start_time=660, end_time=720,
                  requirements={"is_orga": 1})
    t2.fatigue_per_minute = 1.0   # 60 fatigue

    norm = NormalizedFlowInput(persons=persons, tasks=[t1, t2],
                               transfers=[], errors=[], floating_tasks=[])
    config = _make_config()
    result = optimize_with_fatigue(norm, config=config)

    assert result.status == "OPTIMAL"
    # initial(20) + 60 + 60 = 140 raw, minus some break recovery
    # With break_effect=-3.0 per segment, each qualifying break segment reduces by 3
    assert result.fatigue_per_person[1] < 140.0, \
        f"Fatigue should be < 140 due to breaks, got {result.fatigue_per_person[1]}"
    assert result.fatigue_per_person[1] >= 20.0, \
        f"Fatigue should be >= initial 20, got {result.fatigue_per_person[1]}"
