"""Structured, solver-backed explanations for infeasible schedules.

The optimiser and flow checker use :class:`AssumptionRegistry` to attach
human-readable provenance to hard CP-SAT requirements.  Deterministic
preflight checks catch locally impossible inputs before a solve, while the
registry converts an infeasible assumption core into stable API issues.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any, Dict, List, Optional, Sequence


@dataclass(frozen=True)
class DiagnosticIssue:
    """One concrete reason why a schedule requirement cannot be satisfied."""

    code: str
    category: str
    message: str
    task_ids: tuple[int, ...] = ()
    person_ids: tuple[int, ...] = ()
    transfer_ids: tuple[int, ...] = ()
    location_ids: tuple[int, ...] = ()
    capability_ids: tuple[str, ...] = ()
    time_window: Optional[tuple[int, int]] = None
    facts: tuple[tuple[str, str], ...] = ()
    suggestions: tuple[str, ...] = ()
    severity: str = "error"

    def as_dict(self) -> Dict[str, Any]:
        """Serialise this issue for compute and backend API responses."""

        result: Dict[str, Any] = {
            "code": self.code,
            "category": self.category,
            "severity": self.severity,
            "message": self.message,
            "task_ids": list(self.task_ids),
            "person_ids": list(self.person_ids),
            "transfer_ids": list(self.transfer_ids),
            "location_ids": list(self.location_ids),
            "capability_ids": list(self.capability_ids),
            "facts": [
                {"label": label, "value": value} for label, value in self.facts
            ],
            "suggestions": list(self.suggestions),
        }
        if self.time_window is not None:
            result["time_window"] = {
                "start": self.time_window[0],
                "end": self.time_window[1],
            }
        return result


@dataclass
class AssumptionRegistry:
    """Map CP-SAT assumption literals to semantic scheduling requirements."""

    model: Any
    _literals: Dict[str, Any] = field(default_factory=dict)
    _issues_by_index: Dict[int, DiagnosticIssue] = field(default_factory=dict)

    def literal(self, key: str, issue: DiagnosticIssue):
        """Return a reusable assumption literal registered for ``issue``."""

        existing = self._literals.get(key)
        if existing is not None:
            return existing
        safe_key = "".join(ch if ch.isalnum() else "_" for ch in key)
        literal = self.model.NewBoolVar(f"require_{safe_key}")
        self.model.AddAssumption(literal)
        self._literals[key] = literal
        self._issues_by_index[int(literal.Index())] = issue
        return literal

    def enforce(self, constraint: Any, key: str, issue: DiagnosticIssue) -> Any:
        """Enforce a supported constraint under a labelled assumption."""

        constraint.OnlyEnforceIf(self.literal(key, issue))
        return constraint

    def issues_for_infeasibility(self, solver: Any) -> List[DiagnosticIssue]:
        """Return de-duplicated issues from the solver's sufficient core."""

        core = solver.SufficientAssumptionsForInfeasibility()
        issues: List[DiagnosticIssue] = []
        seen: set[tuple[Any, ...]] = set()
        for raw_index in core:
            issue = self._issues_by_index.get(int(raw_index))
            if issue is None:
                continue
            identity = (
                issue.code,
                issue.message,
                issue.task_ids,
                issue.person_ids,
                issue.transfer_ids,
            )
            if identity in seen:
                continue
            seen.add(identity)
            issues.append(issue)
        return issues


def clock(minutes: int) -> str:
    """Format linear working-day minutes as a compact clock value."""

    suffix = " (+1)" if minutes >= 24 * 60 else ""
    local = minutes % (24 * 60)
    return f"{local // 60:02d}:{local % 60:02d}{suffix}"


def diagnostics_payload(
    status: str,
    issues: Sequence[DiagnosticIssue],
    *,
    checked_scope: str = "full",
) -> Dict[str, Any]:
    """Build the versioned diagnostic payload shared by both solver paths."""

    unique: List[DiagnosticIssue] = []
    seen: set[tuple[Any, ...]] = set()
    for issue in issues:
        identity = (issue.code, issue.message, issue.task_ids, issue.person_ids)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(issue)

    if status == "infeasible":
        summary = (
            f"No feasible schedule was found. Review {len(unique)} concrete "
            f"requirement{'s' if len(unique) != 1 else ''}."
        )
    elif status == "invalid_input":
        summary = (
            f"The schedule input has {len(unique)} problem"
            f"{'s' if len(unique) != 1 else ''} that must be corrected."
        )
    elif status == "undetermined":
        summary = "The solver stopped before it could prove whether a schedule exists."
    else:
        summary = "The checked schedule requirements are feasible."

    return {
        "schema_version": 1,
        "status": status,
        "checked_scope": checked_scope,
        "summary": summary,
        "issues": [issue.as_dict() for issue in unique],
    }


def _person_name(person: Any) -> str:
    value = str(getattr(person, "name", "") or "").strip()
    return value or f"Person {person.id}"


def _capability_name(normalized_input: Any, capability_id: str) -> str:
    names = getattr(normalized_input, "capability_names", {}) or {}
    configured = str(names.get(capability_id) or "").strip()
    if configured:
        return configured

    tokens = str(capability_id).removeprefix("is_").split("_")
    aliases = {
        "ext": "Extended",
        "orga": "Orga",
        "ho": "HO",
        "hr": "HR",
        "it": "IT",
    }
    return " ".join(aliases.get(token, token.capitalize()) for token in tokens)


def humanise_capabilities(message: str, normalized_input: Any) -> str:
    """Replace capability machine names in user-facing text with labels."""

    names = getattr(normalized_input, "capability_names", {}) or {}
    capability_ids = {
        str(capability_id)
        for task in getattr(normalized_input, "tasks", []) or []
        for capability_id in (getattr(task, "requirements", {}) or {})
    }
    capability_ids.update(str(value) for value in names)
    result = message
    for capability_id in sorted(capability_ids, key=len, reverse=True):
        label = _capability_name(normalized_input, capability_id)
        result = result.replace(f"'{capability_id}'", label)
        result = result.replace(f'"{capability_id}"', label)
        result = re.sub(
            rf"(?<![A-Za-z0-9_]){re.escape(capability_id)}(?![A-Za-z0-9_])",
            label,
            result,
        )
    return result


def _available_for_interval(person: Any, start: int, end: int) -> bool:
    return not any(
        unavailable_start < end and start < unavailable_end
        for unavailable_start, unavailable_end in getattr(
            person, "unavailable_intervals", []
        )
    )


def preflight_issues(normalized_input: Any) -> List[DiagnosticIssue]:
    """Return sound, locally provable infeasibility issues before CP-SAT runs."""

    persons = list(getattr(normalized_input, "persons", []) or [])
    tasks = list(getattr(normalized_input, "tasks", []) or [])
    transfers = list(getattr(normalized_input, "transfers", []) or [])
    floating_tasks = list(getattr(normalized_input, "floating_tasks", []) or [])
    person_by_id = {person.id: person for person in persons}
    issues: List[DiagnosticIssue] = []

    if not persons and (tasks or transfers or floating_tasks):
        issues.append(
            DiagnosticIssue(
                code="NO_PEOPLE",
                category="coverage",
                message="The selected day contains work but no people are available to staff it.",
                facts=(("People", "0"), ("Scheduled items", str(len(tasks) + len(transfers) + len(floating_tasks)))),
                suggestions=("Add people to the event or remove the scheduled work.",),
            )
        )
        return issues

    for task in tasks:
        start = int(task.start_time)
        end = int(task.end_time)
        task_ids = (int(task.id),) if isinstance(task.id, int) else ()
        time_label = f"{clock(start)} to {clock(end)}"
        requirements = {
            capability_id: int(count)
            for capability_id, count in (task.requirements or {}).items()
            if int(count) > 0
        }
        direct_ids = list(task.preassigned_person_ids or [])

        if end <= start:
            issues.append(
                DiagnosticIssue(
                    code="INVALID_TASK_TIME",
                    category="input",
                    message=f"Task '{task.name}' has an end time that is not after its start time.",
                    task_ids=task_ids,
                    time_window=(start, end),
                    facts=(("Time", time_label),),
                    suggestions=("Correct the task start and end times.",),
                )
            )
            continue

        if not requirements and not direct_ids:
            issues.append(
                DiagnosticIssue(
                    code="UNSTAFFED_TASK",
                    category="coverage",
                    message=f"Task '{task.name}' has neither a capability requirement nor a directly assigned person.",
                    task_ids=task_ids,
                    time_window=(start, end),
                    facts=(("Time", time_label),),
                    suggestions=("Add a capability requirement or assign at least one person.",),
                )
            )

        for person_id in direct_ids:
            person = person_by_id.get(person_id)
            if person is None:
                issues.append(
                    DiagnosticIssue(
                        code="ASSIGNED_PERSON_MISSING",
                        category="assignment",
                        message=f"Task '{task.name}' is locked to Person {person_id}, who is not present in this event.",
                        task_ids=task_ids,
                        person_ids=(int(person_id),),
                        time_window=(start, end),
                        facts=(("Time", time_label),),
                        suggestions=("Remove the stale assignment or restore the person to the event.",),
                    )
                )
            elif not _available_for_interval(person, start, end):
                name = _person_name(person)
                issues.append(
                    DiagnosticIssue(
                        code="LOCKED_PERSON_UNAVAILABLE",
                        category="availability",
                        message=f"{name} is locked to '{task.name}' from {time_label} but is unavailable during that time.",
                        task_ids=task_ids,
                        person_ids=(int(person_id),),
                        time_window=(start, end),
                        facts=(("Task", task.name), ("Time", time_label), ("Person", name)),
                        suggestions=("Change the assignment, task time, or the person's unavailability.",),
                    )
                )

        for capability_id, required in requirements.items():
            eligible = [
                person
                for person in persons
                if capability_id in person.capabilities
            ]
            available = [
                person
                for person in eligible
                if _available_for_interval(person, start, end)
            ]
            capability_name = _capability_name(normalized_input, capability_id)
            if len(eligible) < required:
                issues.append(
                    DiagnosticIssue(
                        code="CAPABILITY_SHORTAGE",
                        category="capability",
                        message=f"Task '{task.name}' needs {required} {capability_name} from {time_label}, but only {len(eligible)} eligible {'person exists' if len(eligible) == 1 else 'people exist'}.",
                        task_ids=task_ids,
                        capability_ids=(str(capability_id),),
                        time_window=(start, end),
                        facts=(("Required", str(required)), ("Eligible", str(len(eligible))), ("Time", time_label)),
                        suggestions=("Add qualified people or reduce the capability requirement.",),
                    )
                )
            elif len(available) < required:
                unavailable_names = ", ".join(
                    _person_name(person) for person in eligible if person not in available
                )
                issues.append(
                    DiagnosticIssue(
                        code="CAPABILITY_UNAVAILABLE",
                        category="availability",
                        message=f"Task '{task.name}' needs {required} available {capability_name} from {time_label}, but only {len(available)} are available.",
                        task_ids=task_ids,
                        person_ids=tuple(int(person.id) for person in eligible if person not in available),
                        capability_ids=(str(capability_id),),
                        time_window=(start, end),
                        facts=(("Required", str(required)), ("Available", str(len(available))), ("Unavailable", unavailable_names or "None")),
                        suggestions=("Change the task time, availability, or qualified staffing requirement.",),
                    )
                )

    # Direct assignments to overlapping tasks are an exact, person-specific conflict.
    for person in persons:
        locked = [task for task in tasks if person.id in (task.preassigned_person_ids or [])]
        for index, first in enumerate(locked):
            for second in locked[index + 1 :]:
                start = max(int(first.start_time), int(second.start_time))
                end = min(int(first.end_time), int(second.end_time))
                if start >= end:
                    continue
                name = _person_name(person)
                task_ids = tuple(
                    int(task.id) for task in (first, second) if isinstance(task.id, int)
                )
                issues.append(
                    DiagnosticIssue(
                        code="LOCKED_PERSON_OVERLAP",
                        category="assignment",
                        message=f"{name} is locked to '{first.name}' and '{second.name}' at the same time from {clock(start)} to {clock(end)}.",
                        task_ids=task_ids,
                        person_ids=(int(person.id),),
                        time_window=(start, end),
                        facts=(("Person", name), ("Overlapping tasks", f"{first.name}; {second.name}"), ("Overlap", f"{clock(start)} to {clock(end)}")),
                        suggestions=("Move one task or remove one of the direct assignments.",),
                    )
                )

    for transfer in transfers:
        locked_ids = list(getattr(transfer, "locked_person_ids", []) or [])
        capacity = int(getattr(transfer, "capacity", 999) or 0)
        if capacity < 999 and len(locked_ids) > capacity:
            issues.append(
                DiagnosticIssue(
                    code="TRANSFER_CAPACITY",
                    category="transfer",
                    message=f"Transfer {transfer.id} has capacity for {capacity} people, but {len(locked_ids)} passengers are locked to it.",
                    person_ids=tuple(int(value) for value in locked_ids),
                    transfer_ids=(int(transfer.id),),
                    time_window=(int(transfer.depart_time), int(transfer.arrive_time)),
                    facts=(("Capacity", str(capacity)), ("Locked passengers", str(len(locked_ids)))),
                    suggestions=("Increase the transfer capacity or remove locked passengers.",),
                )
            )

    for floating in floating_tasks:
        window = int(floating.window_end_time) - int(floating.window_start_time)
        if int(floating.duration) > window:
            issues.append(
                DiagnosticIssue(
                    code="FLOATING_WINDOW_TOO_SMALL",
                    category="time",
                    message=f"Floating task '{floating.name}' needs {floating.duration} minutes inside a {window}-minute window from {clock(floating.window_start_time)} to {clock(floating.window_end_time)}.",
                    task_ids=(int(floating.id),),
                    time_window=(int(floating.window_start_time), int(floating.window_end_time)),
                    facts=(("Duration", f"{floating.duration} minutes"), ("Window", f"{window} minutes")),
                    suggestions=("Increase the time window or reduce the task duration.",),
                )
            )

    return issues


def core_fallback_issue(normalized_input: Any) -> DiagnosticIssue:
    """Describe the exact checked requirement set if no core item was mapped."""

    tasks = list(getattr(normalized_input, "tasks", []) or [])
    names = ", ".join(f"'{task.name}'" for task in tasks[:5]) or "the selected work"
    if len(tasks) > 5:
        names += f", and {len(tasks) - 5} more"
    return DiagnosticIssue(
        code="JOINT_CONSTRAINT_CONFLICT",
        category="coverage",
        message=f"The staffing, timing, availability, and location requirements for {names} cannot all be satisfied together.",
        task_ids=tuple(int(task.id) for task in tasks if isinstance(task.id, int)),
        facts=(("Tasks checked", str(len(tasks))), ("People checked", str(len(getattr(normalized_input, 'persons', []) or [])))),
        suggestions=("Review the listed tasks together, especially direct assignments, overlapping capability demand, availability, and travel between locations.",),
    )


def task_requirement_issue(task: Any, normalized_input: Any) -> DiagnosticIssue:
    """Describe a task coverage requirement used as a solver assumption."""

    start = int(task.start_time)
    end = int(task.end_time)
    task_ids = (int(task.id),) if isinstance(task.id, int) else ()
    location_id = getattr(task, "location_id", None)
    location_ids = (int(location_id),) if location_id is not None else ()
    capability_ids = tuple(
        str(capability_id)
        for capability_id, count in (task.requirements or {}).items()
        if int(count) > 0
    )
    capability_labels = tuple(
        _capability_name(normalized_input, capability_id)
        for capability_id in capability_ids
    )
    return DiagnosticIssue(
        code="TASK_CANNOT_BE_COVERED",
        category="coverage",
        message=(
            f"Task '{task.name}' cannot be fully staffed from {clock(start)} to "
            f"{clock(end)} while its assignments, availability, location, and "
            "overlapping work requirements remain unchanged."
        ),
        task_ids=task_ids,
        location_ids=location_ids,
        capability_ids=capability_ids,
        time_window=(start, end),
        facts=(
            ("Task", str(task.name)),
            ("Time", f"{clock(start)} to {clock(end)}"),
            (
                "Required capabilities",
                ", ".join(capability_labels) or "Direct assignment only",
            ),
        ),
        suggestions=(
            "Review this task together with overlapping tasks, direct assignments, person availability, and travel between locations.",
        ),
    )


def legacy_message_issue(message: str, normalized_input: Any) -> DiagnosticIssue:
    """Convert a legacy flow-check message into a structured compatibility issue."""

    message = humanise_capabilities(message, normalized_input)
    task_ids: List[int] = []
    for task in getattr(normalized_input, "tasks", []) or []:
        task_id = getattr(task, "id", None)
        if isinstance(task_id, int) and (
            f"ID: {task_id}" in message or f"Task {task_id}" in message
        ):
            task_ids.append(task_id)
    category = "coverage"
    lower = message.lower()
    if "unavailable" in lower:
        category = "availability"
    elif "reach" in lower or "location" in lower:
        category = "location"
    elif "preassigned" in lower or "assigned" in lower:
        category = "assignment"
    elif "capability" in lower or "needs" in lower:
        category = "capability"
    elif "transfer" in lower:
        category = "transfer"
    return DiagnosticIssue(
        code="FLOW_REQUIREMENT_CONFLICT",
        category=category,
        message=message,
        task_ids=tuple(task_ids),
        suggestions=("Review the named requirement and the affected task or time window.",),
    )
