"""
Test suite for reproducing bugs found in fatigue_optimizer.py

This file contains test cases that replicate real-world scenarios that
were reported as infeasible but should be feasible.
"""
import sys
from pathlib import Path

# Add src directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from flow_checker import (
    NormPerson,
    NormTask,
    NormFloatingTask,
    NormalizedFlowInput,
)

from fatigue_optimizer import (
    optimize_with_fatigue,
    OptimizationConfig,
)


def test_real_world_scenario_three_floating_tasks():
    """
    Test case replicating the real-world scenario with:
    - 10 persons (IDs: 17-26)
    - 3 static tasks with preassigned persons
    - 3 floating tasks (Leadership Meeting, Buddy Group 1, Buddy Group 2)
    
    This was reported as INFEASIBLE but should have multiple valid solutions.
    """
    # Define all 10 persons with their capabilities
    persons = [
        NormPerson(
            id=17,
            home_location_id=4,
            capabilities=['in_prcomm', 'can_drive', 'in_ppg', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=18,
            home_location_id=4,
            capabilities=['is_ho', 'can_drive', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=19,
            home_location_id=4,
            capabilities=['is_ho', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=20,
            home_location_id=4,
            capabilities=['in_live', 'is_scavenger', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=21,
            home_location_id=4,
            capabilities=['f_b', 'inkind', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=22,
            home_location_id=4,
            capabilities=['f_b', 'inkind', 'can_drive', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=23,
            home_location_id=4,
            capabilities=['is_orga', 'f_b', 'inkind'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=24,
            home_location_id=4,
            capabilities=['is_orga', 'in_pubfund', 'support', 'cmoj_night', 'is_scavenger'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=25,
            home_location_id=4,
            capabilities=['in_live', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
        NormPerson(
            id=26,
            home_location_id=4,
            capabilities=['f_b', 'inkind', 'is_orga'],
            max_work_minutes_per_day=480,
            unavailable_intervals=[]
        ),
    ]
    
    # Define the 3 static tasks
    tasks = [
        # Task 1: Officials Check-In Preparation (07:45-08:00, 15 min)
        NormTask(
            id=1770042463955,
            name="Officials Check-In Preparation",
            location_id=4,
            start_time=465,  # 07:45 = 7*60 + 45 = 465
            end_time=480,    # 08:00 = 8*60 = 480
            requirements={},
            preassigned_person_ids=[17, 20, 21, 22, 23, 24, 25, 26]
        ),
        # Task 2: Prepare InKind Bags (08:00-09:00, 60 min)
        NormTask(
            id=1770042526421,
            name="Prepare InKind Bags",
            location_id=4,
            start_time=480,  # 08:00 = 480
            end_time=540,    # 09:00 = 9*60 = 540
            requirements={},
            preassigned_person_ids=[17, 20, 21, 22, 23, 24, 25, 26, 18, 19]
        ),
        # Task 3: Officials Check-In (09:00-10:00, 60 min)
        NormTask(
            id=1770042802147,
            name="Officials Check-In",
            location_id=4,
            start_time=540,  # 09:00 = 540
            end_time=600,    # 10:00 = 10*60 = 600
            requirements={'is_ho': 1, 'is_orga': 8},
            preassigned_person_ids=[]
        ),
    ]
    
    # Define the 3 floating tasks
    floating_tasks = [
        # Leadership Meeting (10:00-19:00, 60 min)
        NormFloatingTask(
            id=1770042197058,
            name="Leadership Meeting",
            location_id=4,
            duration=60,
            window_start_time=600,   # 10:00 = 600
            window_end_time=1140,    # 19:00 = 19*60 = 1140
            requirements={},
            preassigned_person_ids=[18, 19]
        ),
        # Buddy Group 1 (10:00-19:00, 45 min)
        NormFloatingTask(
            id=1770042369210,
            name="Buddy Group 1",
            location_id=4,
            duration=45,
            window_start_time=600,   # 10:00 = 600
            window_end_time=1140,    # 19:00 = 1140
            requirements={},
            preassigned_person_ids=[17, 18, 20, 22, 25]
        ),
        # Buddy Group 2 (10:00-19:00, 45 min)
        NormFloatingTask(
            id=1770042408344,
            name="Buddy Group 2",
            location_id=4,
            duration=45,
            window_start_time=600,   # 10:00 = 600
            window_end_time=1140,    # 19:00 = 1140
            requirements={},
            preassigned_person_ids=[19, 21, 23, 26, 24]
        ),
    ]
    
    # Set fatigue rate for all tasks
    for task in tasks:
        task.fatigue_per_minute = 1.0
    for ft in floating_tasks:
        ft.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = optimize_with_fatigue(normalized)
    
    # Should be feasible: Multiple valid schedules exist
    # Example solution:
    # - Leadership Meeting: 10:00-11:00 (persons 18, 19)
    # - Buddy Group 1: 11:00-11:45 (persons 17, 18, 20, 22, 25)
    # - Buddy Group 2: 12:00-12:45 (persons 19, 21, 23, 26, 24)
    assert result.status in ["OPTIMAL", "FEASIBLE"], f"Expected feasible solution, got: {result.status}"
    assert len(result.errors) == 0, f"Expected no errors, got: {result.errors}"


def test_simplified_three_floating_tasks():
    """
    Simplified version of the above test with fewer persons and clearer constraints.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=['is_orga'], 
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=['is_orga'], 
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=3, home_location_id=1, capabilities=['is_orga'], 
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]
    
    # No static tasks, just 3 floating tasks with overlapping preassignments
    floating_tasks = [
        NormFloatingTask(
            id=100,
            name="Meeting A",
            location_id=1,
            duration=60,
            window_start_time=600,   # 10:00
            window_end_time=900,     # 15:00 (5 hour window)
            requirements={},
            preassigned_person_ids=[1, 2]  # Persons 1 and 2
        ),
        NormFloatingTask(
            id=101,
            name="Meeting B",
            location_id=1,
            duration=60,
            window_start_time=600,   # 10:00
            window_end_time=900,     # 15:00
            requirements={},
            preassigned_person_ids=[2, 3]  # Persons 2 and 3 (shares person 2)
        ),
        NormFloatingTask(
            id=102,
            name="Meeting C",
            location_id=1,
            duration=60,
            window_start_time=600,   # 10:00
            window_end_time=900,     # 15:00
            requirements={},
            preassigned_person_ids=[1, 3]  # Persons 1 and 3 (shares persons)
        ),
    ]
    
    # Set fatigue rate for all floating tasks
    for ft in floating_tasks:
        ft.fatigue_per_minute = 1.0
    
    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=[],
        transfers=[],
        errors=[],
        floating_tasks=floating_tasks
    )
    
    result = optimize_with_fatigue(normalized)
    
    # Should be feasible:
    # Meeting A: 10:00-11:00 (persons 1, 2)
    # Meeting B: 11:00-12:00 (persons 2, 3)
    # Meeting C: 12:00-13:00 (persons 1, 3)
    assert result.status in ["OPTIMAL", "FEASIBLE"], f"Expected feasible solution, got: {result.status}"
    assert len(result.errors) == 0, f"Expected no errors, got: {result.errors}"


def test_two_floating_tasks_shared_person():
    """
    Even simpler: just 2 floating tasks sharing one person.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=['is_orga'], 
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
        NormPerson(id=2, home_location_id=1, capabilities=['is_orga'], 
                   max_work_minutes_per_day=480, unavailable_intervals=[]),
    ]
    
    floating_tasks = [
        NormFloatingTask(
            id=100,
            name="Task A",
            location_id=1,
            duration=60,
            window_start_time=600,   # 10:00
            window_end_time=780,     # 13:00 (3 hour window)
            requirements={},
            preassigned_person_ids=[1, 2]
        ),
        NormFloatingTask(
            id=101,
            name="Task B",
            location_id=1,
            duration=60,
            window_start_time=600,   # 10:00
            window_end_time=780,     # 13:00
            requirements={},
            preassigned_person_ids=[1, 2]  # Same persons
        ),
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
    
    result = optimize_with_fatigue(normalized)
    
    # Should be feasible:
    # Task A: 10:00-11:00 (persons 1, 2)
    # Task B: 11:00-12:00 (persons 1, 2)
    assert result.status in ["OPTIMAL", "FEASIBLE"], f"Expected feasible solution, got: {result.status}"
    assert len(result.errors) == 0, f"Expected no errors, got: {result.errors}"


def test_two_persons_one_floating_task_assignment_bug():
    """
    Bug: When two persons both have required capability for a floating task requiring 1 person,
    optimizer was incorrectly assigning BOTH persons instead of choosing one.
    
    Expected: One person does task (60min fatigue), other idle (0min)
    Bug behavior: Both persons had 60min fatigue
    """
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[]),
        NormPerson(id=2, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480, 
                        window_end_time=600, duration=60, requirements={"basic": 1})
    ]
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
    # One person should have 60min, other should have 0min
    fatigues = sorted([result.fatigue_per_person[1], result.fatigue_per_person[2]])
    assert fatigues == [0.0, 60.0], f"Expected [0.0, 60.0], got {fatigues}"


def test_floating_task_capability_requirement_bug():
    """
    Bug: Floating task requiring skill_a was assigning person without skill_a,
    resulting in both persons having fatigue (total 120min instead of 60min).
    
    Expected: Only Person 1 (has skill_a) does task, Person 2 idle
    Bug behavior: Both persons working
    """
    persons = [
        NormPerson(id=1, capabilities=["skill_a"], home_location_id=1, unavailable_intervals=[]),
        NormPerson(id=2, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480,
                        window_end_time=600, duration=60, requirements={"skill_a": 1})
    ]
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
    # Only person 1 can do it (has skill_a), person 2 should be idle
    assert result.fatigue_per_person[1] == 60.0, f"Person 1 should have 60.0, got {result.fatigue_per_person[1]}"
    assert result.fatigue_per_person[2] == 0.0, f"Person 2 should have 0.0, got {result.fatigue_per_person[2]}"
    total_fatigue = result.fatigue_per_person[1] + result.fatigue_per_person[2]
    assert total_fatigue == 60.0, f"Total should be 60.0, got {total_fatigue}"


def test_multiple_floating_tasks_distribution_bug():
    """
    Bug: Three floating tasks (each requiring 1 person) were all done by multiple persons,
    resulting in total fatigue of 240min instead of 180min (3 * 60).
    
    Expected: Tasks distributed among persons (e.g., P1=120min, P2=60min, total=180min)
    Bug behavior: Each task done by multiple persons (total=240min)
    """
    persons = [
        NormPerson(id=1, capabilities=["basic"], home_location_id=1, unavailable_intervals=[]),
        NormPerson(id=2, capabilities=["basic"], home_location_id=1, unavailable_intervals=[])
    ]
    
    floating_tasks = [
        NormFloatingTask(id=1, name="F1", location_id=1, window_start_time=480,
                        window_end_time=600, duration=60, requirements={"basic": 1}),
        NormFloatingTask(id=2, name="F2", location_id=1, window_start_time=480,
                        window_end_time=600, duration=60, requirements={"basic": 1}),
        NormFloatingTask(id=3, name="F3", location_id=1, window_start_time=480,
                        window_end_time=600, duration=60, requirements={"basic": 1})
    ]
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
    # Total should be 180min (3 tasks * 60min each)
    total_fatigue = result.fatigue_per_person[1] + result.fatigue_per_person[2]
    assert total_fatigue == 180.0, f"Total should be 180.0, got {total_fatigue}"
    # Should be distributed (one person gets 2 tasks, other gets 1)
    fatigues = sorted([result.fatigue_per_person[1], result.fatigue_per_person[2]])
    assert fatigues[0] >= 60.0, f"Each person should get at least one task, got {fatigues}"
    assert fatigues[1] <= 120.0, f"No person should get all three tasks, got {fatigues}"
