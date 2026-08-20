"""Regression tests for task types excluded from working-time accounting."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from fatigue_optimizer import OptimizationConfig, optimize_with_fatigue
from flow_checker import (
    NormPerson,
    NormTask,
    NormTransfer,
    NormalizedFlowInput,
    check_flow,
)


def _input(*tasks: NormTask, unavailable=()) -> NormalizedFlowInput:
    return NormalizedFlowInput(
        persons=[
            NormPerson(
                id=1,
                home_location_id=1,
                capabilities=[],
                max_work_minutes_per_day=120,
                unavailable_intervals=list(unavailable),
            )
        ],
        tasks=list(tasks),
        transfers=[],
        floating_tasks=[],
        errors=[],
    )


def _task(
    task_id: int,
    start: int,
    end: int,
    *,
    counted: bool,
    fatigue: float = 1.0,
) -> NormTask:
    task = NormTask(
        id=task_id,
        name=f"Task {task_id}",
        location_id=1,
        start_time=start,
        end_time=end,
        requirements={},
        preassigned_person_ids=[1],
        counts_towards_work_time=counted,
    )
    task.fatigue_per_minute = fatigue
    return task


def test_excluded_task_reserves_person_without_consuming_work_limit():
    """A rest task may be long, but a person cannot overlap it or ignore availability."""
    rest = _task(1, 0, 300, counted=False)
    work = _task(2, 300, 420, counted=True)

    assert check_flow(_input(rest, work)) == []
    assert check_flow(_input(_task(1, 0, 300, counted=True), work))
    assert check_flow(_input(rest, _task(3, 240, 360, counted=True)))
    assert check_flow(_input(rest, unavailable=((120, 180),)))


def test_fatigue_optimiser_keeps_fatigue_separate_from_work_time():
    """Excluded duration still contributes its configured fatigue or recovery score."""
    rest = _task(1, 0, 300, counted=False, fatigue=0.5)
    work = _task(2, 300, 420, counted=True, fatigue=1.0)

    result = optimize_with_fatigue(
        _input(rest, work),
        config=OptimizationConfig(max_time_seconds=10.0),
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert result.fatigue_per_person[1] == 270.0


def test_excluded_transfer_does_not_consume_work_limit():
    """A non-work transfer still moves and reserves its direct staff member."""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=[],
        max_work_minutes_per_day=120,
    )
    transfer = NormTransfer(
        id=10,
        from_location_id=1,
        to_location_id=2,
        depart_time=0,
        arrive_time=300,
        capacity=1,
        requirements={},
        locked_person_ids=[1],
        counts_towards_work_time=False,
    )
    work = _task(2, 300, 420, counted=True)
    work.location_id = 2

    normalised = NormalizedFlowInput(
        persons=[person],
        tasks=[work],
        transfers=[transfer],
        floating_tasks=[],
        errors=[],
    )
    assert check_flow(normalised) == []

    transfer.counts_towards_work_time = True
    assert check_flow(normalised)


def _transferee_input(*, include_overlapping_task: bool = False) -> NormalizedFlowInput:
    passenger = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=[],
        max_work_minutes_per_day=120,
    )
    transfer = NormTransfer(
        id=10,
        from_location_id=1,
        to_location_id=2,
        depart_time=0,
        arrive_time=300,
        capacity=1,
        requirements={},
        optional_capacity_slots=1,
        transferee_field_id="field_transferee",
        counts_towards_work_time=True,
    )
    destination_work = _task(2, 300, 420, counted=True)
    destination_work.location_id = 2
    tasks = [destination_work]
    if include_overlapping_task:
        overlapping = _task(3, 120, 180, counted=True)
        overlapping.location_id = 1
        tasks.append(overlapping)
    return NormalizedFlowInput(
        persons=[passenger],
        tasks=tasks,
        transfers=[transfer],
        floating_tasks=[],
        errors=[],
    )


def test_transferee_moves_without_consuming_work_limit_in_both_solvers():
    """Passenger travel is busy time, but the passenger retains the full work allowance."""
    normalised = _transferee_input()

    assert check_flow(normalised) == []
    result = optimize_with_fatigue(
        normalised,
        config=OptimizationConfig(max_time_seconds=10.0),
    )
    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert result.transfer_assignments[10] == [1]
    assert result.field_assignments[10]["field_transferee"] == [1]


def test_transferee_remains_unavailable_during_travel():
    """Exempting passenger travel from the cap must not permit double-booking."""
    assert check_flow(_transferee_input(include_overlapping_task=True))


def test_capability_holder_travelling_as_passenger_is_not_treated_as_staff():
    passenger = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["driver"],
        max_work_minutes_per_day=120,
    )
    staff = NormPerson(
        id=2,
        home_location_id=1,
        capabilities=["driver"],
        max_work_minutes_per_day=300,
    )
    transfer = NormTransfer(
        id=10,
        from_location_id=1,
        to_location_id=2,
        depart_time=0,
        arrive_time=180,
        capacity=2,
        requirements={"driver": 1},
        optional_capacity_slots=1,
        field_requirements={"field_driver": {"driver": 1}},
        transferee_field_id="field_transferee",
    )
    destination_work = _task(2, 180, 300, counted=True)
    destination_work.location_id = 2
    normalised = NormalizedFlowInput(
        persons=[passenger, staff],
        tasks=[destination_work],
        transfers=[transfer],
        floating_tasks=[],
        errors=[],
    )

    assert check_flow(normalised) == []
    result = optimize_with_fatigue(
        normalised,
        config=OptimizationConfig(max_time_seconds=10.0),
    )
    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert result.field_assignments[10]["field_driver"] == [2]
    assert result.field_assignments[10]["field_transferee"] == [1]


def test_structured_transfer_staff_still_consumes_work_limit():
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["driver"],
        max_work_minutes_per_day=120,
    )
    transfer = NormTransfer(
        id=10,
        from_location_id=1,
        to_location_id=2,
        depart_time=0,
        arrive_time=180,
        capacity=1,
        requirements={"driver": 1},
        field_requirements={"field_driver": {"driver": 1}},
        transferee_field_id="field_transferee",
    )
    normalised = NormalizedFlowInput(
        persons=[person],
        tasks=[],
        transfers=[transfer],
        floating_tasks=[],
        errors=[],
    )

    assert check_flow(normalised)
    result = optimize_with_fatigue(
        normalised,
        config=OptimizationConfig(max_time_seconds=10.0),
    )
    assert result.status == "INFEASIBLE"


def test_legacy_transfer_staff_still_consumes_work_limit():
    """Aggregate historical requirements receive an explicit working role."""
    person = NormPerson(
        id=1,
        home_location_id=1,
        capabilities=["driver"],
        max_work_minutes_per_day=120,
    )
    transfer = NormTransfer(
        id=10,
        from_location_id=1,
        to_location_id=2,
        depart_time=0,
        arrive_time=180,
        capacity=1,
        requirements={"driver": 1},
    )
    normalised = NormalizedFlowInput(
        persons=[person],
        tasks=[],
        transfers=[transfer],
        floating_tasks=[],
        errors=[],
    )

    assert check_flow(normalised)
    result = optimize_with_fatigue(
        normalised,
        config=OptimizationConfig(max_time_seconds=10.0),
    )
    assert result.status == "INFEASIBLE"
