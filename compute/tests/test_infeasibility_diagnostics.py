"""Regression tests for concrete schedule infeasibility diagnostics."""

from types import SimpleNamespace
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from infeasibility_diagnostics import (
    diagnostics_payload,
    legacy_message_issue,
    preflight_issues,
    task_requirement_issue,
)
from fatigue_optimizer import OptimizationConfig, optimize_with_fatigue
from flow_checker import NormPerson, NormTask, NormalizedFlowInput, check_flow


def _input(*, persons, tasks, transfers=None, floating_tasks=None):
    return SimpleNamespace(
        persons=persons,
        tasks=tasks,
        transfers=transfers or [],
        floating_tasks=floating_tasks or [],
        capability_names={"nurse": "Nurse"},
    )


def _person(person_id, *, capabilities=None, unavailable=None, name=None):
    return SimpleNamespace(
        id=person_id,
        name=name or f"Person {person_id}",
        capabilities=capabilities or [],
        unavailable_intervals=unavailable or [],
    )


def _task(task_id, *, requirements=None, assigned=None):
    return SimpleNamespace(
        id=task_id,
        name=f"Task {task_id}",
        start_time=600,
        end_time=660,
        requirements=requirements or {},
        preassigned_person_ids=assigned or [],
        location_id=1,
    )


def test_capability_shortage_names_task_requirement_and_counts():
    issues = preflight_issues(
        _input(
            persons=[_person(1, capabilities=["nurse"])],
            tasks=[_task(10, requirements={"nurse": 2})],
        )
    )

    shortage = next(issue for issue in issues if issue.code == "CAPABILITY_SHORTAGE")
    assert shortage.task_ids == (10,)
    assert "needs 2 Nurse" in shortage.message
    assert ("Eligible", "1") in shortage.facts
    assert shortage.suggestions


def test_locked_unavailable_person_is_concrete():
    issues = preflight_issues(
        _input(
            persons=[
                _person(7, unavailable=[(590, 670)], name="Alex Example")
            ],
            tasks=[_task(11, assigned=[7])],
        )
    )

    issue = next(issue for issue in issues if issue.code == "LOCKED_PERSON_UNAVAILABLE")
    assert issue.task_ids == (11,)
    assert issue.person_ids == (7,)
    assert "Alex Example" in issue.message
    assert "10:00 to 11:00" in issue.message


def test_payload_is_versioned_and_never_loses_issue_details():
    issues = preflight_issues(_input(persons=[], tasks=[_task(12)]))
    payload = diagnostics_payload("invalid_input", issues)

    assert payload["schema_version"] == 1
    assert payload["status"] == "invalid_input"
    assert payload["issues"][0]["code"] == "NO_PEOPLE"
    assert payload["issues"][0]["message"]
    assert payload["issues"][0]["suggestions"]


def test_capability_machine_names_are_not_exposed_in_feedback():
    task = _task(13, requirements={"is_ext_orga": 2})
    normalized = _input(
        persons=[_person(1, capabilities=["is_ext_orga"])],
        tasks=[task],
    )
    normalized.capability_names = {"is_ext_orga": "Extended Orga"}

    shortage = preflight_issues(normalized)[0]
    legacy = legacy_message_issue(
        "Task 'Task 13' (ID: 13) needs 2 'is_ext_orga'", normalized
    )
    solver_issue = task_requirement_issue(task, normalized)

    assert "Extended Orga" in shortage.message
    assert "Extended Orga" in legacy.message
    assert "is_ext_orga" not in legacy.message
    assert ("Required capabilities", "Extended Orga") in solver_issue.facts
    assert solver_issue.capability_ids == ("is_ext_orga",)


def _overlapping_demand():
    person = NormPerson(
        id=1,
        name="Alex Example",
        home_location_id=1,
        capabilities=["nurse"],
    )
    tasks = [
        NormTask(
            id=21,
            name="First aid desk",
            location_id=1,
            start_time=600,
            end_time=660,
            requirements={"nurse": 1},
        ),
        NormTask(
            id=22,
            name="Medical briefing",
            location_id=1,
            start_time=600,
            end_time=660,
            requirements={"nurse": 1},
        ),
    ]
    return NormalizedFlowInput(
        persons=[person],
        tasks=tasks,
        transfers=[],
        errors=[],
        capability_names={"nurse": "Nurse"},
    )


def test_optimizer_infeasibility_names_tasks_from_solver_core():
    result = optimize_with_fatigue(
        _overlapping_demand(),
        OptimizationConfig(max_time_seconds=2),
    )

    assert result.status == "INFEASIBLE"
    assert result.diagnostics["status"] == "infeasible"
    diagnosed_ids = {
        task_id
        for issue in result.diagnostics["issues"]
        for task_id in issue["task_ids"]
    }
    assert diagnosed_ids
    assert diagnosed_ids.issubset({21, 22})
    assert all(issue["message"] for issue in result.diagnostics["issues"])


def test_flow_check_returns_same_structured_contract_for_joint_demand():
    errors, diagnostics = check_flow(
        _overlapping_demand(),
        max_time_seconds=2,
        include_diagnostics=True,
    )

    assert errors
    assert diagnostics["schema_version"] == 1
    assert diagnostics["status"] == "infeasible"
    diagnosed_ids = {
        task_id
        for issue in diagnostics["issues"]
        for task_id in issue["task_ids"]
    }
    assert diagnosed_ids.intersection({21, 22})
