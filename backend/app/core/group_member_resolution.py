"""Resolve live group references in task person fields."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.group import Group


Interval = tuple[int, int]


@dataclass
class ExcludedGroupPerson:
    person_id: int
    group_id: int
    group_name: str
    reason: str = "unavailable"
    unavailable_from: Optional[int] = None
    unavailable_to: Optional[int] = None


@dataclass
class ResolvedGroupAssignment:
    """Structured runtime group/person resolution for one persons_list value."""

    person_ids: list[int] = field(default_factory=list)
    direct_person_ids: list[int] = field(default_factory=list)
    group_person_ids: list[int] = field(default_factory=list)
    excluded_persons: list[ExcludedGroupPerson] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _coerce_integral_id(value: Any) -> Optional[int]:
    """Return an integer ID when a value safely represents one."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _normalise_member_references(value: Any) -> list[dict[str, int | str]]:
    """Normalise legacy person IDs and typed person/group references."""
    if not isinstance(value, list):
        return []

    references: list[dict[str, int | str]] = []
    seen: set[tuple[str, int]] = set()
    for item in value:
        member_type = "person"
        raw_id = item

        if isinstance(item, dict):
            member_type = item.get("type") or "person"
            raw_id = item.get("id")

        if member_type not in {"person", "group"}:
            continue

        member_id = _coerce_integral_id(raw_id)
        if member_id is None:
            continue

        key = (member_type, member_id)
        if key in seen:
            continue

        seen.add(key)
        references.append({"type": member_type, "id": member_id})

    return references


def _load_group(
    db: Session,
    group_id: int,
    event_id: Optional[int],
) -> Optional[Group]:
    query = db.query(Group).filter(Group.id == group_id)
    if event_id is not None:
        query = query.filter(Group.event_id == event_id)
    return query.first()


def resolve_group_member_person_ids(
    value: Any,
    db: Optional[Session],
    valid_person_ids: set[int],
    event_id: Optional[int] = None,
) -> tuple[list[int], list[str]]:
    """Resolve person/group references to concrete, deduplicated person IDs."""
    resolved: list[int] = []
    warnings: list[str] = []
    seen_person_ids: set[int] = set()

    def append_person(person_id: int) -> None:
        if person_id not in valid_person_ids or person_id in seen_person_ids:
            return
        seen_person_ids.add(person_id)
        resolved.append(person_id)

    def resolve_references(
        references: list[dict[str, int | str]],
        visiting_group_ids: set[int],
    ) -> None:
        for reference in references:
            member_type = str(reference["type"])
            member_id = int(reference["id"])

            if member_type == "person":
                append_person(member_id)
                continue

            if db is None:
                warnings.append(
                    f"Group {member_id} could not be resolved without database access."
                )
                continue

            if member_id in visiting_group_ids:
                warnings.append("Circular group reference ignored during resolution.")
                continue

            group = _load_group(db, member_id, event_id)
            if group is None:
                warnings.append(f"Group {member_id} no longer exists.")
                continue

            visiting_group_ids.add(member_id)
            resolve_references(
                _normalise_member_references(
                    group.meta_data.get("members", []) if group.meta_data else []
                ),
                visiting_group_ids,
            )
            visiting_group_ids.remove(member_id)

    resolve_references(_normalise_member_references(value), set())
    return resolved, warnings


def _first_overlap(
    intervals: list[Interval],
    task_start: Optional[int],
    task_end: Optional[int],
) -> Optional[Interval]:
    if task_start is None or task_end is None:
        return None
    if task_end <= task_start:
        task_end += 24 * 60

    for unavailable_start, unavailable_end in intervals:
        if unavailable_end <= unavailable_start:
            unavailable_end += 24 * 60
        if unavailable_start < task_end and unavailable_end > task_start:
            return (unavailable_start, unavailable_end)
    return None


def resolve_group_assignment_for_task(
    value: Any,
    db: Optional[Session],
    valid_person_ids: set[int],
    *,
    event_id: Optional[int] = None,
    person_unavailable_intervals: Optional[dict[int, list[Interval]]] = None,
    task_start: Optional[int] = None,
    task_end: Optional[int] = None,
) -> ResolvedGroupAssignment:
    """Resolve a task persons_list value with runtime group availability.

    Direct person references stay explicit hard assignments. Person references
    reached through a group are included only when they do not overlap the task
    interval. Missing task time keeps group members included and emits a warning
    rather than guessing availability.
    """

    result = ResolvedGroupAssignment()
    seen_person_ids: set[int] = set()
    seen_direct_person_ids: set[int] = set()
    seen_group_person_ids: set[int] = set()
    seen_exclusions: set[tuple[int, int]] = set()
    availability_known = task_start is not None and task_end is not None
    unavailable_by_person = person_unavailable_intervals or {}

    def append_effective(person_id: int, *, from_group: bool) -> None:
        if person_id not in valid_person_ids:
            return
        if person_id not in seen_person_ids:
            seen_person_ids.add(person_id)
            result.person_ids.append(person_id)
        if from_group and person_id not in seen_group_person_ids:
            seen_group_person_ids.add(person_id)
            result.group_person_ids.append(person_id)
        if not from_group and person_id not in seen_direct_person_ids:
            seen_direct_person_ids.add(person_id)
            result.direct_person_ids.append(person_id)

    def add_exclusion(person_id: int, group: Group, overlap: Interval) -> None:
        key = (int(group.id), person_id)
        if key in seen_exclusions:
            return
        seen_exclusions.add(key)
        result.excluded_persons.append(
            ExcludedGroupPerson(
                person_id=person_id,
                group_id=int(group.id),
                group_name=group.name or f"Group {group.id}",
                unavailable_from=overlap[0],
                unavailable_to=overlap[1],
            )
        )

    def resolve_group_members(
        group: Group,
        visiting_group_ids: set[int],
    ) -> tuple[list[int], list[int]]:
        """Return all valid group people and available valid group people."""
        all_group_people: list[int] = []
        available_group_people: list[int] = []
        seen_all: set[int] = set()
        seen_available: set[int] = set()

        for member in _normalise_member_references(
            group.meta_data.get("members", []) if group.meta_data else []
        ):
            member_type = str(member["type"])
            member_id = int(member["id"])

            if member_type == "person":
                if member_id not in valid_person_ids:
                    continue
                if member_id not in seen_all:
                    seen_all.add(member_id)
                    all_group_people.append(member_id)

                if not availability_known:
                    if member_id not in seen_available:
                        seen_available.add(member_id)
                        available_group_people.append(member_id)
                    continue

                overlap = _first_overlap(
                    unavailable_by_person.get(member_id, []),
                    task_start,
                    task_end,
                )
                if overlap is not None:
                    add_exclusion(member_id, group, overlap)
                    continue

                if member_id not in seen_available:
                    seen_available.add(member_id)
                    available_group_people.append(member_id)
                continue

            if db is None:
                result.warnings.append(
                    f"Group {member_id} could not be resolved without database access."
                )
                continue

            if member_id in visiting_group_ids:
                result.warnings.append("Circular group reference ignored during resolution.")
                continue

            nested_group = _load_group(db, member_id, event_id)
            if nested_group is None:
                result.warnings.append(f"Group {member_id} no longer exists.")
                continue

            visiting_group_ids.add(member_id)
            nested_all, nested_available = resolve_group_members(
                nested_group,
                visiting_group_ids,
            )
            visiting_group_ids.remove(member_id)

            for person_id in nested_all:
                if person_id not in seen_all:
                    seen_all.add(person_id)
                    all_group_people.append(person_id)
            for person_id in nested_available:
                if person_id not in seen_available:
                    seen_available.add(person_id)
                    available_group_people.append(person_id)

        return all_group_people, available_group_people

    for reference in _normalise_member_references(value):
        member_type = str(reference["type"])
        member_id = int(reference["id"])

        if member_type == "person":
            append_effective(member_id, from_group=False)
            continue

        if db is None:
            result.warnings.append(
                f"Group {member_id} could not be resolved without database access."
            )
            continue

        group = _load_group(db, member_id, event_id)
        if group is None:
            result.warnings.append(f"Group {member_id} no longer exists.")
            continue

        if not availability_known:
            result.warnings.append(
                f"Availability for group {group.name or group.id} could not be checked because task time is unknown."
            )

        all_people, available_people = resolve_group_members(group, {member_id})
        if availability_known and all_people and not available_people:
            result.warnings.append(
                f"All members of {group.name or f'Group {group.id}'} are unavailable during this task."
            )
        for person_id in available_people:
            append_effective(person_id, from_group=True)

    result.warnings = list(dict.fromkeys(result.warnings))
    return result
