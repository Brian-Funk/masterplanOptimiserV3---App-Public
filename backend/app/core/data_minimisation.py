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
    "organiser",
    "participant",
    "public",
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
            f"Field {field.get('name') or field.get('id') or '<unknown>'} must have its purpose and visibility reviewed before Server publishing"
        )
    purpose = field.get("purpose")
    visibility = field.get("visibility")
    if purpose not in FieldPurpose.__args__:
        raise ValueError("A published field has an unsupported purpose")
    if visibility not in FieldVisibility.__args__:
        raise ValueError("A published field has an unsupported visibility")
    if visibility == "never_publish":
        return None
    if visibility == "public" and not field.get("public_visibility_confirmed"):
        raise ValueError(
            f"Field {field.get('name') or field.get('id')} requires explicit public-visibility confirmation"
        )
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
        "visibility": visibility,
    }
