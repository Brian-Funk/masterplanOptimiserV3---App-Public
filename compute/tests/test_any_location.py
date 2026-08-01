"""
Test suite for any-location tasks (location_id = None).

Tests that both flow_checker and fatigue_optimizer correctly handle tasks
where the location is not predetermined  -  the solver picks the best location.
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
)
from fatigue_optimizer import (
    optimize_with_fatigue,
    OptimizationConfig,
)


# ═══════════════════════════════════════════════════════════════════════════════
# FLOW CHECKER TESTS
# ═══════════════════════════════════════════════════════════════════════════════


def test_flow_any_location_single_person():
    """An any-location task should be feasible  -  solver places it at person's home."""
    persons = [
        NormPerson(
            id=1,
            home_location_id=1,
            capabilities=["is_orga"],
            max_work_minutes_per_day=480,
            unavailable_intervals=[],
        )
    ]

    tasks = [
        NormTask(
            id=100,
            name="Floating meeting (any loc)",
            location_id=None,  # <-- any location
            start_time=480,  # 08:00
            end_time=540,    # 09:00
            requirements={"is_orga": 1},
            preassigned_person_ids=[],
        )
    ]

    normalized = NormalizedFlowInput(
        persons=persons,
        tasks=tasks,
        transfers=[],
        errors=[],
        floating_tasks=[],
    )

    result = check_flow(normalized)
    assert len(result) == 0, f"Expected feasible, got: {result}"


def test_flow_any_location_two_persons_same_location():
    """Two persons at same location, one any-location task requiring both."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
        NormPerson(id=2, home_location_id=1, capabilities=["is_ho"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Team meeting (any loc)",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1, "is_ho": 1},
        )
    ]

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    result = check_flow(normalized)
    assert len(result) == 0, f"Expected feasible, got: {result}"


def test_flow_any_location_persons_different_locations_no_transfer():
    """
    Two persons at different locations, one any-location task requiring both.
    Without a transfer, only one location is reachable by both → INFEASIBLE
    because person 1 is at loc 1, person 2 is at loc 2, and neither can move.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
        NormPerson(id=2, home_location_id=2, capabilities=["is_ho"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Team meeting (any loc)",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1, "is_ho": 1},
        )
    ]

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    result = check_flow(normalized)
    # Should be infeasible  -  the two persons are at different locations and
    # the any-location constraint still forces everyone on the task to be co-located.
    assert len(result) > 0, "Expected infeasible  -  persons at different locations, no transfer"


def test_flow_any_location_with_transfer():
    """
    Two persons at different locations, transfer brings person 2 to location 1
    before the any-location task starts.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
        NormPerson(id=2, home_location_id=2, capabilities=["is_ho"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Team meeting (any loc)",
            location_id=None,
            start_time=540,   # 09:00
            end_time=600,     # 10:00
            requirements={"is_orga": 1, "is_ho": 1},
        )
    ]

    transfers = [
        NormTransfer(
            id=200,
            from_location_id=2,
            to_location_id=1,
            depart_time=480,   # 08:00
            arrive_time=540,   # 09:00
            capacity=10,
            requirements={},
        )
    ]

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=transfers, errors=[], floating_tasks=[]
    )

    result = check_flow(normalized)
    assert len(result) == 0, f"Expected feasible (transfer enables co-location), got: {result}"


def test_flow_mixed_fixed_and_any_location():
    """
    One fixed-location task at loc 1 and one any-location task, both at the same time.
    Person 1 must do the fixed task at loc 1, person 2 does the any-location task.
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
        NormPerson(id=2, home_location_id=2, capabilities=["is_ho"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Fixed task at loc 1",
            location_id=1,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1},
        ),
        NormTask(
            id=101,
            name="Flexible meeting",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={"is_ho": 1},
        ),
    ]

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    result = check_flow(normalized)
    assert len(result) == 0, f"Expected feasible, got: {result}"


def test_flow_any_location_preassigned():
    """Preassigned person on an any-location task should be placed at their location."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Meeting (preassigned, any loc)",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={},
            preassigned_person_ids=[1],
        )
    ]

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    result = check_flow(normalized)
    assert len(result) == 0, f"Expected feasible, got: {result}"


def test_flow_any_location_floating_task():
    """A floating any-location task should be feasible."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
    ]

    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Flexible floating meeting",
            location_id=None,
            window_start_time=480,
            window_end_time=720,
            duration=60,
            requirements={"is_orga": 1},
        )
    ]

    normalized = NormalizedFlowInput(
        persons=persons, tasks=[], transfers=[], errors=[], floating_tasks=floating_tasks
    )

    result = check_flow(normalized)
    assert len(result) == 0, f"Expected feasible, got: {result}"


# ═══════════════════════════════════════════════════════════════════════════════
# FATIGUE OPTIMIZER TESTS
# ═══════════════════════════════════════════════════════════════════════════════


def test_optim_any_location_single_person():
    """Optimizer should handle an any-location task and report correct fatigue."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Flexible task",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1},
        )
    ]
    tasks[0].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    config = OptimizationConfig(max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status in ("OPTIMAL", "FEASIBLE"), f"Expected OPTIMAL/FEASIBLE, got {result.status}"
    assert len(result.errors) == 0, f"Errors: {result.errors}"
    assert 1 in result.fatigue_per_person
    assert result.fatigue_per_person[1] == 60.0, f"Expected 60.0 fatigue, got {result.fatigue_per_person[1]}"


def test_optim_any_location_chosen_location_in_details():
    """Optimizer should resolve the chosen location and put it in task_details."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Flexible task",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1},
        )
    ]
    tasks[0].fatigue_per_minute = 0.5

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    config = OptimizationConfig(max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status in ("OPTIMAL", "FEASIBLE")
    assert 100 in result.task_details, f"Task 100 not in task_details: {result.task_details}"
    # The resolved location should be 1 (the only location available)
    assert result.task_details[100]["location_id"] == 1, \
        f"Expected resolved location_id=1, got {result.task_details[100]['location_id']}"


def test_optim_any_location_minimises_movement():
    """
    Two persons at different locations. One fixed task at loc 1, one any-location task.
    The optimizer should place the any-location task at loc 2 to minimise fatigue
    (avoiding unnecessary transfer for person 2).
    """
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
        NormPerson(id=2, home_location_id=2, capabilities=["is_ho"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Fixed task at loc 1",
            location_id=1,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1},
        ),
        NormTask(
            id=101,
            name="Any-loc task",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={"is_ho": 1},
        ),
    ]
    tasks[0].fatigue_per_minute = 1.0
    tasks[1].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    config = OptimizationConfig(max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status in ("OPTIMAL", "FEASIBLE"), f"Got {result.status}: {result.errors}"
    # Person 2 should handle task 101 at loc 2 (their home)  -  no movement needed
    assert 101 in result.task_details
    assert result.task_details[101]["location_id"] == 2, \
        f"Expected any-loc task placed at loc 2, got {result.task_details[101]['location_id']}"


def test_optim_any_location_floating():
    """Floating + any-location task should be optimised correctly."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_orga"]),
    ]

    floating_tasks = [
        NormFloatingTask(
            id=200,
            name="Flexible floating meeting",
            location_id=None,
            window_start_time=480,
            window_end_time=720,
            duration=60,
            requirements={"is_orga": 1},
        )
    ]
    floating_tasks[0].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=[], transfers=[], errors=[], floating_tasks=floating_tasks
    )

    config = OptimizationConfig(max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status in ("OPTIMAL", "FEASIBLE"), f"Got {result.status}: {result.errors}"
    assert result.fatigue_per_person[1] == 60.0, \
        f"Expected 60.0 fatigue, got {result.fatigue_per_person[1]}"


def test_optim_any_location_infeasible_no_capability():
    """Any-location task requiring capability no one has → INFEASIBLE."""
    persons = [
        NormPerson(id=1, home_location_id=1, capabilities=["is_driver"]),
    ]

    tasks = [
        NormTask(
            id=100,
            name="Need orga (any loc)",
            location_id=None,
            start_time=480,
            end_time=540,
            requirements={"is_orga": 1},
        )
    ]
    tasks[0].fatigue_per_minute = 1.0

    normalized = NormalizedFlowInput(
        persons=persons, tasks=tasks, transfers=[], errors=[], floating_tasks=[]
    )

    config = OptimizationConfig(max_time_seconds=10.0)
    result = optimize_with_fatigue(normalized, config=config)

    assert result.status == "INFEASIBLE", f"Expected INFEASIBLE, got {result.status}"
