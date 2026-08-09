"""Typed field-classification rules for the Desktop publish boundary."""

from __future__ import annotations

from typing import Literal


PUBLISH_CONTRACT_VERSION = "2026-07-30"

FieldPurpose = Literal[
    "assignment",
    "capability_requirement",
    "location",
    "operational_instruction",
    "reference",
    "timing",
]
FieldVisibility = Literal[
    "participant",
    "never_publish",
]

FIELD_PURPOSE_BY_TYPE: dict[str, FieldPurpose] = {
    "capabilities_list": "assignment",
    "duration": "timing",
    "link": "reference",
    "location": "location",
    "number": "operational_instruction",
    "persons_list": "assignment",
    "start_end_time": "timing",
    "text": "operational_instruction",
    "time_range": "timing",
}
PUBLISHABLE_FIELD_TYPES = frozenset(FIELD_PURPOSE_BY_TYPE)

# These fields are implementation details used by the optimiser. They are not
# participant-facing operational fields and have no bounded Server wire type.
INTERNAL_ONLY_FIELD_TYPES = frozenset({"dynamic_transfer_allocation", "transferee"})


def inferred_field_purpose(field_type: str) -> FieldPurpose | None:
    """Return the fixed operational purpose for a participant-facing field type."""

    return FIELD_PURPOSE_BY_TYPE.get(field_type)


def reviewed_publish_definition(field: dict) -> dict | None:
    """Return the automatic authenticated wire definition for a Masterplan field."""

    field_type = field.get("type")
    if field_type in INTERNAL_ONLY_FIELD_TYPES:
        return None
    purpose = inferred_field_purpose(field_type)
    if purpose is None:
        raise ValueError(
            f"Field {field.get('name') or field.get('id')} has no bounded Server wire type"
        )
    field_id = field.get("id")
    field_name = field.get("name")
    if not isinstance(field_id, str) or not field_id:
        raise ValueError("A published field is missing its identifier")
    if not isinstance(field_name, str) or not field_name:
        raise ValueError("A published field is missing its display name")
    return {
        "id": field_id,
        "name": field_name,
        "type": field_type,
        "purpose": purpose,
        # Masterplan is the authenticated schedule. Its operational fields are
        # never public and no per-field audience choice is exposed.
        "visibility": "participant",
    }
