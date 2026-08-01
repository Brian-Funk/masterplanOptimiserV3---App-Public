"""Validation helpers for internal technical identifiers."""

import re


_MACHINE_NAME_RE = re.compile(r"^[a-z0-9_]+$")


def validate_machine_name(value: str) -> str:
    """Validate a stable ASCII machine name and return the trimmed value."""
    cleaned = value.strip() if isinstance(value, str) else ""
    if not cleaned:
        raise ValueError("Machine name is required")
    if not _MACHINE_NAME_RE.fullmatch(cleaned):
        raise ValueError(
            "Machine name must only contain lowercase ASCII letters, numbers, and underscores"
        )
    return cleaned
