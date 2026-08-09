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

PUBLISHABLE_FIELD_TYPES = {
    "capabilities_list",
    "duration",
    "link",
    "location",
    "number",
    "persons_list",
    "start_end_time",
    "text",
    "time_range",
}


def reviewed_publish_definition(field: dict) -> dict | None:
    """Return a bounded wire definition or fail closed for unclassified fields."""

    if not field.get("classification_reviewed"):
        raise ValueError(
            f"Field {field.get('name') or field.get('id') or '<unknown>'} must have its purpose and Server sharing reviewed before publishing"
        )
    purpose = field.get("purpose")
    visibility = field.get("visibility")
    if purpose not in FieldPurpose.__args__:
        raise ValueError("A published field has an unsupported purpose")
    if visibility == "never_publish":
        return None
    if visibility not in {"participant", "organiser", "public"}:
        raise ValueError("A published field has an unsupported Server sharing setting")
    field_type = field.get("type")
    if field_type not in PUBLISHABLE_FIELD_TYPES:
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
        # Masterplan data is never public. Older organiser/public classifications
        # are narrowed to the authenticated participant contract at the boundary.
        "visibility": "participant",
    }
