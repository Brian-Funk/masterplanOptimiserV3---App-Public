"""Normalise task payload JSON before storage or finalisation."""

from __future__ import annotations

from typing import Any


def _coerce_integral_id(value: Any) -> int | None:
    """Return an integer ID when ``value`` safely represents one."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    if isinstance(value, dict):
        if value.get("type") == "person":
            return _coerce_integral_id(value.get("id"))
        return None
    return None


def _coerce_member_reference(value: Any) -> dict[str, int | str] | None:
    """Return a typed person/group reference when ``value`` is member-like."""
    if isinstance(value, dict):
        member_type = value.get("type")
        if member_type not in {"person", "group"}:
            return None
        member_id = _coerce_integral_id(value.get("id"))
        if member_id is None:
            return None
        return {"type": member_type, "id": member_id}
    return None


def _normalise_member_reference_list(value: list[Any]) -> list[dict[str, int | str]] | None:
    """Return unique typed person/group references when the list is member-like."""
    has_typed_reference = any(
        isinstance(item, dict) and item.get("type") in {"person", "group"}
        for item in value
    )
    if not has_typed_reference:
        return None

    result: list[dict[str, int | str]] = []
    seen: set[tuple[str, int]] = set()
    for item in value:
        reference = _coerce_member_reference(item)
        if reference is None:
            person_id = _coerce_integral_id(item)
            if person_id is None:
                return None
            reference = {"type": "person", "id": person_id}

        key = (str(reference["type"]), int(reference["id"]))
        if key in seen:
            continue
        seen.add(key)
        result.append(reference)

    return result


def _dedupe_integral_id_list(value: list[Any]) -> list[int] | None:
    """Return a unique ID list when every item is an ID-like value."""
    result: list[int] = []
    seen: set[int] = set()

    for item in value:
        item_id = _coerce_integral_id(item)
        if item_id is None:
            return None
        if item_id in seen:
            continue
        seen.add(item_id)
        result.append(item_id)

    return result


def normalise_task_json_id_lists(value: Any) -> Any:
    """Deduplicate task JSON lists while preserving live person/group references."""
    if isinstance(value, dict):
        return {
            key: normalise_task_json_id_lists(nested)
            for key, nested in value.items()
        }

    if isinstance(value, list):
        member_references = _normalise_member_reference_list(value)
        if member_references is not None:
            return member_references

        deduped = _dedupe_integral_id_list(value)
        if deduped is not None:
            return deduped
        return [normalise_task_json_id_lists(item) for item in value]

    return value


def normalise_concrete_person_id_list(value: Any) -> list[int]:
    """Return unique concrete person IDs for final schedule assignment rows."""
    if not isinstance(value, list):
        return []

    result: list[int] = []
    seen: set[int] = set()
    for item in value:
        person_id = _coerce_integral_id(item)
        if person_id is None or person_id in seen:
            continue
        seen.add(person_id)
        result.append(person_id)

    return result
