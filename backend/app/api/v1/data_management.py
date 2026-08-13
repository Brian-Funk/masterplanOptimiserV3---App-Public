"""
Data Management API - export, import, copy-from-event, delete-event, factory-reset.
"""
import json
import logging
import re
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.event_deletion import delete_event_scoped_data
from app.core.identifier_validation import validate_machine_name
from app.core.rich_template import validate_rich_template
from app.models import (
    Assignment,
    AssignmentSource,
    Capability,
    CapabilityType,
    CalendarExportFormat,
    AudienceCategory,
    AudienceTeam,
    Event,
    GeneralSchedulePublishState,
    Group,
    GroupMembership,
    GroupRole,
    GroupType,
    LeadershipLevel,
    Location,
    MasterplanLayout,
    OptimizationJob,
    Person,
    PersonCapability,
    PersonUnavailability,
    Task,
    TaskCapabilityRequirement,
    TaskInstance,
    TaskTemplate,
    TaskType,
    Theme,
    ScheduleView,
    SessionElement,
    SessionElementType,
)

logger = logging.getLogger(__name__)
router = APIRouter()

EXPORT_VERSION = 2

SHAREABLE_PROFILE = "shareable_setup"
SHAREABLE_EXCLUDED_CATEGORIES = [
    "events",
    "persons",
    "groups",
    "locations",
    "tasks",
    "assignments",
    "optimisation_results",
    "schedules",
    "publishing_state",
    "integration_settings",
    "credentials_and_tokens",
]
SHAREABLE_METADATA_KEYS = {"created_at", "updated_at"}
SHAREABLE_STRUCTURAL_KEYS = {"machine_name", "code"}
_EMAIL_PATTERN = re.compile(
    r"(?i)(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![A-Z0-9._%+-])"
)
_URL_PATTERN = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"]+")
_IGNORED_SENSITIVE_VALUES = {
    "active",
    "draft",
    "finalised",
    "optimised",
    "published",
    "public",
    "private",
    "person",
    "group",
    "event",
    "task",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_dict(row) -> dict:
    """Convert a SQLAlchemy model instance to a plain dict."""
    d = {}
    for col in row.__table__.columns:
        val = getattr(row, col.name)
        if isinstance(val, (datetime, date)):
            val = val.isoformat()
        d[col.name] = val
    return d


def _rows_to_list(rows) -> list:
    return [_row_to_dict(r) for r in rows]


def _event_to_export_dict(event: Event) -> dict:
    """Serialise an event without local publish integration secrets/links."""
    row = _row_to_dict(event)
    for key in ("mp_backend_url", "google_calendar_id"):
        row.pop(key, None)
    return row


def _serialize_global(db: Session) -> dict:
    """Serialise all global (non-event-scoped) data."""
    return {
        "themes": _rows_to_list(db.query(Theme).all()),
        "task_types": _rows_to_list(db.query(TaskType).all()),
        "capability_types": _rows_to_list(db.query(CapabilityType).all()),
        "capabilities": _rows_to_list(db.query(Capability).all()),
        "task_templates": _rows_to_list(db.query(TaskTemplate).all()),
        "group_types": _rows_to_list(db.query(GroupType).all()),
        "leadership_levels": _rows_to_list(db.query(LeadershipLevel).all()),
        "group_roles": _rows_to_list(db.query(GroupRole).all()),
        "assignment_sources": _rows_to_list(db.query(AssignmentSource).all()),
        "calendar_export_formats": _rows_to_list(db.query(CalendarExportFormat).all()),
    }


def _add_sensitive_value(values: set[str], value: Any) -> None:
    """Collect bounded event-scoped strings that must not enter a shared setup."""
    if isinstance(value, dict):
        for nested in value.values():
            _add_sensitive_value(values, nested)
        return
    if isinstance(value, (list, tuple, set)):
        for nested in value:
            _add_sensitive_value(values, nested)
        return
    if not isinstance(value, str):
        return

    candidate = value.strip()
    if len(candidate) < 3 or candidate.casefold() in _IGNORED_SENSITIVE_VALUES:
        return
    if re.fullmatch(r"[\d\s:.,+\-/TZ]+", candidate):
        return
    values.add(candidate)


def _shareable_sensitive_values(db: Session) -> list[str]:
    """Build the deny corpus from data deliberately excluded from shared setups."""
    values: set[str] = set()
    for event in db.query(Event).all():
        for value in (
            event.name,
            event.location,
            event.evidence_id,
            event.google_calendar_id,
            event.mp_backend_url,
            event.meta_data,
        ):
            _add_sensitive_value(values, value)

        exported = _serialize_event(db, event)
        for person in exported.get("persons", []):
            first = str(person.get("first_name") or "").strip()
            last = str(person.get("last_name") or "").strip()
            for value in (
                first,
                last,
                f"{first} {last}".strip(),
                person.get("email"),
                person.get("google_email"),
                person.get("evidence_subject_id"),
            ):
                _add_sensitive_value(values, value)

        sensitive_collections = {
            "locations": ("name", "address", "details"),
            "groups": ("name", "meta_data"),
            "tasks": ("title", "description", "constraints", "additional"),
            "task_instances": ("name", "field_values", "constraints", "additional"),
            "audience_categories": None,
            "schedule_views": None,
            "session_element_types": None,
            "audience_teams": None,
            "session_elements": None,
        }
        for collection, keys in sensitive_collections.items():
            for row in exported.get(collection, []):
                if keys is None:
                    for key, value in row.items():
                        if key not in SHAREABLE_METADATA_KEYS and not key.endswith("_id"):
                            _add_sensitive_value(values, value)
                else:
                    for key in keys:
                        _add_sensitive_value(values, row.get(key))

    return sorted(values, key=lambda item: (-len(item), item.casefold()))


def _sensitive_pattern(value: str) -> re.Pattern[str]:
    escaped = re.escape(value)
    if value[0].isalnum() and value[-1].isalnum():
        escaped = rf"(?<![A-Za-z0-9]){escaped}(?![A-Za-z0-9])"
    return re.compile(escaped, re.IGNORECASE)


def _contains_sensitive_text(value: str, sensitive_values: list[str]) -> bool:
    if _EMAIL_PATTERN.search(value) or _URL_PATTERN.search(value):
        return True
    return any(_sensitive_pattern(item).search(value) for item in sensitive_values)


def _redact_shareable_text(value: str, sensitive_values: list[str]) -> tuple[str, int]:
    """Remove exact known identifiers without trying to infer deployment facts."""
    redactions = 0
    value, count = _EMAIL_PATTERN.subn("[removed email]", value)
    redactions += count
    value, count = _URL_PATTERN.subn("[removed link]", value)
    redactions += count
    for sensitive in sensitive_values:
        value, count = _sensitive_pattern(sensitive).subn("[removed]", value)
        redactions += count
    return value, redactions


def _sanitize_shareable_value(
    value: Any,
    sensitive_values: list[str],
    *,
    path: str,
    key: Optional[str] = None,
    blockers: list[str],
    report: dict[str, int],
) -> Any:
    """Strip metadata and redact display strings while preserving references."""
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for child_key, child_value in value.items():
            if child_key in SHAREABLE_METADATA_KEYS:
                continue
            child_path = f"{path}.{child_key}" if path else child_key
            sanitized[child_key] = _sanitize_shareable_value(
                child_value,
                sensitive_values,
                path=child_path,
                key=child_key,
                blockers=blockers,
                report=report,
            )
        return sanitized
    if isinstance(value, list):
        return [
            _sanitize_shareable_value(
                item,
                sensitive_values,
                path=f"{path}[{index}]",
                key=key,
                blockers=blockers,
                report=report,
            )
            for index, item in enumerate(value)
        ]
    if not isinstance(value, str):
        return value

    if key in SHAREABLE_STRUCTURAL_KEYS:
        if _contains_sensitive_text(value, sensitive_values):
            blockers.append(path)
        return value

    sanitized, count = _redact_shareable_text(value, sensitive_values)
    report["redactions"] += count
    return sanitized


def _serialize_shareable_setup(db: Session) -> dict:
    """Create the privacy-safe, import-compatible global configuration payload."""
    sensitive_values = _shareable_sensitive_values(db)
    blockers: list[str] = []
    report = {"redactions": 0}
    global_data = _sanitize_shareable_value(
        deepcopy(_serialize_global(db)),
        sensitive_values,
        path="global_data",
        blockers=blockers,
        report=report,
    )
    if blockers:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SHAREABLE_SETUP_STRUCTURAL_IDENTIFIER",
                "message": (
                    "A reusable machine identifier contains event or participant data. "
                    "Rename the listed configuration record before sharing this setup."
                ),
                "paths": sorted(set(blockers)),
            },
        )

    return {
        "version": EXPORT_VERSION,
        "type": "app_settings",
        "profile": SHAREABLE_PROFILE,
        "global_data": global_data,
        "shareable_setup_report": {
            "included_counts": {
                key: len(rows) if isinstance(rows, list) else 0
                for key, rows in global_data.items()
            },
            "excluded_categories": SHAREABLE_EXCLUDED_CATEGORIES,
            "redactions": report["redactions"],
            "generated_at": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        },
    }


def _serialize_event(db: Session, event: Event) -> dict:
    """Serialise one event and all its scoped data."""
    eid = event.id
    locations = db.query(Location).filter(Location.event_id == eid).all()
    persons = db.query(Person).filter(Person.event_id == eid).all()
    person_ids = [p.id for p in persons]
    tasks = db.query(Task).filter(Task.event_id == eid).all()
    task_ids = [t.id for t in tasks]
    groups = db.query(Group).filter(Group.event_id == eid).all()
    group_ids = [g.id for g in groups]

    person_capabilities = (
        db.query(PersonCapability)
        .filter(PersonCapability.person_id.in_(person_ids))
        .all()
        if person_ids else []
    )
    person_unavailabilities = (
        db.query(PersonUnavailability)
        .filter(PersonUnavailability.person_id.in_(person_ids))
        .all()
        if person_ids else []
    )
    task_cap_reqs = (
        db.query(TaskCapabilityRequirement)
        .filter(TaskCapabilityRequirement.task_id.in_(task_ids))
        .all()
        if task_ids else []
    )
    assignments = db.query(Assignment).filter(Assignment.event_id == eid).all()
    group_memberships = (
        db.query(GroupMembership)
        .filter(GroupMembership.group_id.in_(group_ids))
        .all()
        if group_ids else []
    )
    task_instances = db.query(TaskInstance).filter(TaskInstance.event_id == eid).all()
    masterplan_layouts = db.query(MasterplanLayout).filter(MasterplanLayout.event_id == eid).all()
    optimization_jobs = db.query(OptimizationJob).filter(OptimizationJob.event_id == eid).all()
    audience_categories = db.query(AudienceCategory).filter(AudienceCategory.event_id == eid).all()
    schedule_views = db.query(ScheduleView).filter(ScheduleView.event_id == eid).all()
    session_element_types = db.query(SessionElementType).filter(SessionElementType.event_id == eid).all()
    audience_teams = db.query(AudienceTeam).filter(AudienceTeam.event_id == eid).all()
    session_elements = db.query(SessionElement).filter(SessionElement.event_id == eid).all()

    return {
        "event": _event_to_export_dict(event),
        "locations": _rows_to_list(locations),
        "persons": _rows_to_list(persons),
        "person_capabilities": _rows_to_list(person_capabilities),
        "person_unavailabilities": _rows_to_list(person_unavailabilities),
        "tasks": _rows_to_list(tasks),
        "task_capability_requirements": _rows_to_list(task_cap_reqs),
        "assignments": _rows_to_list(assignments),
        "groups": _rows_to_list(groups),
        "group_memberships": _rows_to_list(group_memberships),
        "task_instances": _rows_to_list(task_instances),
        "masterplan_layouts": _rows_to_list(masterplan_layouts),
        "optimization_jobs": _rows_to_list(optimization_jobs),
        "audience_categories": _rows_to_list(audience_categories),
        "schedule_views": _rows_to_list(schedule_views),
        "session_element_types": _rows_to_list(session_element_types),
        "audience_teams": _rows_to_list(audience_teams),
        "session_elements": _rows_to_list(session_elements),
    }


# ---------------------------------------------------------------------------
# EXPORT
# ---------------------------------------------------------------------------

class ExportRequest(BaseModel):
    """Data export request selecting full, global-only, or event-only scope."""

    scope: str = "full"  # "full" | "global" | "event" | "shareable"
    event_ids: Optional[List[int]] = None


@router.post("/export")
async def export_data(req: ExportRequest, db: Session = Depends(get_db)):
    """Export data as JSON.

    scope=full  → global settings + all events  (type="full_backup")
    scope=global → global settings only          (type="app_settings")
    scope=event  → global settings + 1+ events   (type="project")
    """
    if req.scope == "shareable":
        return _serialize_shareable_setup(db)

    result: Dict[str, Any] = {"version": EXPORT_VERSION}

    # Global data is ALWAYS included  -  events are never exported without it
    result["global_data"] = _serialize_global(db)

    if req.scope == "global":
        result["type"] = "app_settings"
    elif req.scope == "event":
        if not req.event_ids:
            raise HTTPException(400, "event_ids required when scope=event")
        result["type"] = "project"
        events = db.query(Event).filter(Event.id.in_(req.event_ids)).all()
        result["events"] = [_serialize_event(db, e) for e in events]
    else:  # full
        result["type"] = "full_backup"
        result["events"] = [_serialize_event(db, e) for e in db.query(Event).all()]

    return result


# ---------------------------------------------------------------------------
# IMPORT  - the big one
# ---------------------------------------------------------------------------

class ImportRequest(BaseModel):
    """Portable backup/import payload produced by the export endpoint."""

    data: Dict[str, Any]


class ImportValidationIssue(BaseModel):
    """Structured import validation message shown before import."""

    id: str
    severity: str
    title: str
    message: str
    path: Optional[str] = None


class ImportPreviewSummary(BaseModel):
    """Human-readable import contents summary."""

    projectName: Optional[str] = None
    eventName: Optional[str] = None
    dateRange: Optional[str] = None
    sourceVersion: Optional[str] = None
    exportedAt: Optional[str] = None
    peopleCount: int = 0
    locationCount: int = 0
    groupCount: int = 0
    taskCount: int = 0
    templateCount: int = 0
    taskTypeCount: int = 0
    assignmentCount: int = 0
    hasOptimisedSchedule: bool = False
    hasFinalSchedule: bool = False
    hasPublishMetadata: bool = False
    hasAppSettings: bool = False
    importType: str = "unknown"


class ImportValidationResult(BaseModel):
    """Validation result used by the import preview UI."""

    isValid: bool
    errors: List[ImportValidationIssue]
    warnings: List[ImportValidationIssue]
    info: List[ImportValidationIssue]
    summary: ImportPreviewSummary


def _issue(
    severity: str,
    title: str,
    message: str,
    path: Optional[str] = None,
    issue_id: Optional[str] = None,
) -> ImportValidationIssue:
    """Build a stable import validation issue."""
    safe_title = title.lower().replace(" ", "_").replace("/", "_")
    return ImportValidationIssue(
        id=issue_id or f"{severity}_{safe_title}",
        severity=severity,
        title=title,
        message=message,
        path=path,
    )


def _format_import_date_range(start_date: Optional[str], end_date: Optional[str]) -> Optional[str]:
    """Format ISO import dates as Swiss-style dates for the preview summary."""
    try:
        if start_date and end_date:
            start = date.fromisoformat(start_date)
            end = date.fromisoformat(end_date)
            return f"{start:%d.%m.%Y} - {end:%d.%m.%Y}"
        if start_date:
            return f"{date.fromisoformat(start_date):%d.%m.%Y}"
        if end_date:
            return f"{date.fromisoformat(end_date):%d.%m.%Y}"
    except (TypeError, ValueError):
        return None
    return None


def _rows(payload: dict, key: str) -> list:
    """Return a list field from an import payload, treating malformed values as empty."""
    value = payload.get(key, [])
    return value if isinstance(value, list) else []


def _id_set(rows: list) -> set:
    """Collect non-null integer IDs from imported rows."""
    return {row.get("id") for row in rows if isinstance(row, dict) and row.get("id") is not None}


def _check_duplicate_ids(rows: list, label: str, path_prefix: str, errors: list[ImportValidationIssue]) -> None:
    """Add a blocking issue when one table contains duplicate old IDs."""
    seen = set()
    duplicates = set()
    for row in rows:
        if not isinstance(row, dict) or row.get("id") is None:
            continue
        row_id = row["id"]
        if row_id in seen:
            duplicates.add(row_id)
        seen.add(row_id)
    if duplicates:
        errors.append(_issue(
            "error",
            f"Duplicate {label} IDs",
            f"The import contains duplicate {label} IDs: {sorted(duplicates)}.",
            path_prefix,
            f"duplicate_{label}_ids",
        ))


def _check_rich_template(
    row: Any,
    key: str,
    path: str,
    errors: list[ImportValidationIssue],
) -> None:
    """Add a blocking import issue for unsafe rich-template markup."""

    if not isinstance(row, dict) or row.get(key) in (None, ""):
        return
    try:
        validate_rich_template(row[key])
    except ValueError as exc:
        errors.append(_issue(
            "error",
            "Unsafe rich-text template",
            f"This template contains unsupported or unsafe markup: {exc}.",
            path,
            issue_id=f"unsafe_rich_template_{path}",
        ))


def _check_imported_rich_templates(
    global_data: dict,
    events: list,
    errors: list[ImportValidationIssue],
) -> None:
    for index, row in enumerate(global_data.get("calendar_export_formats", [])):
        _check_rich_template(
            row,
            "description_template",
            f"global_data.calendar_export_formats[{index}].description_template",
            errors,
        )
    for event_index, event_data in enumerate(events):
        if not isinstance(event_data, dict):
            continue
        for type_index, row in enumerate(event_data.get("session_element_types", [])):
            _check_rich_template(
                row,
                "copy_template_html",
                f"events[{event_index}].session_element_types[{type_index}].copy_template_html",
                errors,
            )


def _has_value(row: dict, key: str) -> bool:
    """Return whether an imported row contains a non-empty value."""
    value = row.get(key)
    return value is not None and value != ""


def _task_has_location_value(row: dict) -> bool:
    """Return whether an imported task row appears to include location data."""
    if any(_has_value(row, key) for key in ("location_id", "start_location_id", "end_location_id")):
        return True
    for blob_key in ("field_values", "optimised", "final"):
        value = row.get(blob_key)
        if isinstance(value, dict):
            if any(key in value and value[key] not in (None, "") for key in ("location", "location_id", "start_location_id", "end_location_id")):
                return True
    return False


def validate_import_payload(payload: Any) -> ImportValidationResult:
    """Validate an import payload and build a preview without mutating data."""
    errors: list[ImportValidationIssue] = []
    warnings: list[ImportValidationIssue] = []
    info: list[ImportValidationIssue] = []
    summary = ImportPreviewSummary()

    if not isinstance(payload, dict):
        errors.append(_issue(
            "error",
            "Unsupported import format",
            "The import file must contain a JSON object exported by this app.",
        ))
        return ImportValidationResult(isValid=False, errors=errors, warnings=[], info=[], summary=summary)

    import_type = payload.get("type", "unknown")
    summary.importType = str(import_type or "unknown")
    if import_type not in ("full_backup", "project", "app_settings", "unknown"):
        errors.append(_issue(
            "error",
            "Unsupported import format",
            f"Import type '{import_type}' is not supported by this app.",
            "type",
        ))
    elif import_type == "unknown":
        errors.append(_issue(
            "error",
            "Missing import type",
            "Only a current export with an explicit import type can be imported.",
            "type",
        ))

    version = payload.get("version")
    if version is None:
        errors.append(_issue(
            "error",
            "Missing file version",
            "Only a current version 2 export can be imported. Convert the one retained database with the standalone conversion tool.",
            "version",
        ))
    elif not isinstance(version, int):
        errors.append(_issue(
            "error",
            "Invalid file version",
            "The export version must be a number.",
            "version",
        ))
    elif version > EXPORT_VERSION:
        errors.append(_issue(
            "error",
            "File version too new",
            f"This file was exported with version {version}, but this app supports version {EXPORT_VERSION}.",
            "version",
        ))
    elif version < EXPORT_VERSION:
        errors.append(_issue(
            "error",
            "Older file version is unsupported",
            "This app has no built-in legacy import. Convert the one retained database with the standalone conversion tool.",
            "version",
        ))
    if version is not None:
        summary.sourceVersion = str(version)
        info.append(_issue("info", "File version", f"Export version {version}.", "version"))

    exported_at = payload.get("exported_at") or payload.get("exportedAt")
    if exported_at:
        summary.exportedAt = str(exported_at)
        info.append(_issue("info", "Export timestamp", f"Exported at {exported_at}.", "exported_at"))

    global_data = payload.get("global_data")
    if not isinstance(global_data, dict):
        errors.append(_issue(
            "error",
            "Missing application settings",
            "The file is missing the required global_data section.",
            "global_data",
        ))
        global_data = {}
    else:
        summary.hasAppSettings = True

    global_id_sets = {
        "task_types": _id_set(_rows(global_data, "task_types")),
        "task_templates": _id_set(_rows(global_data, "task_templates")),
        "capabilities": _id_set(_rows(global_data, "capabilities")),
        "group_types": _id_set(_rows(global_data, "group_types")),
        "group_roles": _id_set(_rows(global_data, "group_roles")),
        "assignment_sources": _id_set(_rows(global_data, "assignment_sources")),
    }
    summary.templateCount = len(_rows(global_data, "task_templates"))
    summary.taskTypeCount = len(_rows(global_data, "task_types"))

    for key in (
        "task_types",
        "capability_types",
        "capabilities",
        "task_templates",
        "group_types",
        "leadership_levels",
        "group_roles",
        "assignment_sources",
        "calendar_export_formats",
    ):
        _check_duplicate_ids(_rows(global_data, key), key, f"global_data.{key}", errors)

    events = payload.get("events", [])
    if events is None:
        events = []
    if not isinstance(events, list):
        errors.append(_issue(
            "error",
            "Invalid projects section",
            "The events section must be a list.",
            "events",
        ))
        events = []

    _check_imported_rich_templates(global_data, events, errors)

    first_event_name: Optional[str] = None
    first_start: Optional[str] = None
    first_end: Optional[str] = None
    total_assignments = 0
    schedule_without_metadata = False
    publish_metadata_found = False

    for event_index, event_data in enumerate(events):
        event_path = f"events[{event_index}]"
        if not isinstance(event_data, dict):
            errors.append(_issue(
                "error",
                "Invalid project entry",
                "Each project entry must be an object.",
                event_path,
            ))
            continue

        event_row = event_data.get("event")
        if not isinstance(event_row, dict):
            errors.append(_issue(
                "error",
                "Missing project identity",
                "Each imported project must contain an event object.",
                f"{event_path}.event",
            ))
            continue

        event_name = str(event_row.get("name") or "").strip()
        if not event_name:
            errors.append(_issue(
                "error",
                "Missing project name",
                "Each imported project must have a name.",
                f"{event_path}.event.name",
            ))
        elif first_event_name is None:
            first_event_name = event_name
            summary.projectName = event_name
            summary.eventName = event_name

        start_date = event_row.get("start_date")
        end_date = event_row.get("end_date")
        if first_start is None and isinstance(start_date, str):
            first_start = start_date
        if first_end is None and isinstance(end_date, str):
            first_end = end_date
        for field_name, raw_value in (("start_date", start_date), ("end_date", end_date)):
            if raw_value:
                try:
                    date.fromisoformat(str(raw_value))
                except ValueError:
                    errors.append(_issue(
                        "error",
                        "Invalid project date",
                        f"{field_name} must be an ISO date such as 2026-08-01.",
                        f"{event_path}.event.{field_name}",
                    ))
        if start_date and end_date:
            try:
                if date.fromisoformat(str(end_date)) < date.fromisoformat(str(start_date)):
                    errors.append(_issue(
                        "error",
                        "Invalid date range",
                        "The project end date must not be before the start date.",
                        f"{event_path}.event.end_date",
                    ))
            except ValueError:
                pass

        if any(event_row.get(key) for key in ("google_calendar_id", "mp_backend_url")):
            publish_metadata_found = True

        locations = _rows(event_data, "locations")
        persons = _rows(event_data, "persons")
        tasks = _rows(event_data, "tasks")
        task_instances = _rows(event_data, "task_instances")
        groups = _rows(event_data, "groups")
        assignments = _rows(event_data, "assignments")
        group_memberships = _rows(event_data, "group_memberships")
        task_capability_requirements = _rows(event_data, "task_capability_requirements")
        person_capabilities = _rows(event_data, "person_capabilities")
        masterplan_layouts = _rows(event_data, "masterplan_layouts")
        optimization_jobs = _rows(event_data, "optimization_jobs")
        audience_teams = _rows(event_data, "audience_teams")
        schedule_views = _rows(event_data, "schedule_views")
        session_elements = _rows(event_data, "session_elements")

        summary.locationCount += len(locations)
        summary.peopleCount += len(persons)
        summary.groupCount += len(groups)
        summary.taskCount += len(tasks) + len(task_instances)
        total_assignments += len(assignments)

        for key, rows in (
            ("locations", locations),
            ("persons", persons),
            ("tasks", tasks),
            ("task_instances", task_instances),
            ("groups", groups),
            ("assignments", assignments),
            ("group_memberships", group_memberships),
            ("task_capability_requirements", task_capability_requirements),
            ("person_capabilities", person_capabilities),
            ("masterplan_layouts", masterplan_layouts),
            ("optimization_jobs", optimization_jobs),
            ("audience_teams", audience_teams),
            ("schedule_views", schedule_views),
            ("session_elements", session_elements),
        ):
            _check_duplicate_ids(rows, key, f"{event_path}.{key}", errors)

        location_ids = _id_set(locations)
        person_ids = _id_set(persons)
        task_ids = _id_set(tasks)
        task_instance_ids = _id_set(task_instances)
        all_task_ids = task_ids | task_instance_ids
        group_ids = _id_set(groups)
        audience_team_ids = _id_set(audience_teams)
        schedule_view_ids = _id_set(schedule_views)
        assigned_task_ids = {row.get("task_id") for row in assignments if isinstance(row, dict) and row.get("task_id") is not None}
        grouped_person_ids = {row.get("person_id") for row in group_memberships if isinstance(row, dict)}

        if not persons:
            warnings.append(_issue(
                "warning",
                "No people included",
                f"{event_name or 'This project'} has no people in the import.",
                f"{event_path}.persons",
            ))
        if not tasks and not task_instances:
            warnings.append(_issue(
                "warning",
                "No tasks included",
                f"{event_name or 'This project'} has no tasks in the import.",
                f"{event_path}.tasks",
            ))

        for idx, loc in enumerate(locations):
            if isinstance(loc, dict) and not str(loc.get("name") or "").strip():
                warnings.append(_issue(
                    "warning",
                    "Location missing name",
                    "A location is missing its display name. A default name may be used.",
                    f"{event_path}.locations[{idx}].name",
                ))

        for idx, person in enumerate(persons):
            if not isinstance(person, dict):
                continue
            if "phone" in person:
                errors.append(_issue(
                    "error",
                    "Retired person phone field",
                    "Phone fields are no longer supported. Remove 'phone' and use the optional 'email' field instead.",
                    f"{event_path}.persons[{idx}].phone",
                ))
            home_location_id = person.get("home_location_id")
            if home_location_id is not None and home_location_id not in location_ids:
                errors.append(_issue(
                    "error",
                    "Person references missing location",
                    "A person's home location does not exist in the imported project.",
                    f"{event_path}.persons[{idx}].home_location_id",
                ))
            if group_memberships and person.get("id") not in grouped_person_ids:
                warnings.append(_issue(
                    "warning",
                    "Person without group",
                    "A person is not part of any imported group.",
                    f"{event_path}.persons[{idx}]",
                ))

        for idx, task in enumerate(tasks):
            if not isinstance(task, dict):
                continue
            template_id = task.get("task_template_id")
            task_type_id = task.get("task_type_id")
            if template_id is not None and template_id not in global_id_sets["task_templates"]:
                errors.append(_issue(
                    "error",
                    "Task references missing template",
                    "A task references a task template that is not included in the import.",
                    f"{event_path}.tasks[{idx}].task_template_id",
                ))
            if task_type_id is not None and task_type_id not in global_id_sets["task_types"]:
                errors.append(_issue(
                    "error",
                    "Task references missing task type",
                    "A task references a task type that is not included in the import.",
                    f"{event_path}.tasks[{idx}].task_type_id",
                ))
            if task.get("id") not in assigned_task_ids:
                warnings.append(_issue(
                    "warning",
                    "Task without assigned people",
                    "A task has no imported person assignments.",
                    f"{event_path}.tasks[{idx}]",
                ))
            if not _task_has_location_value(task):
                warnings.append(_issue(
                    "warning",
                    "Task without location",
                    "A task has no imported location information.",
                    f"{event_path}.tasks[{idx}]",
                ))
            if task.get("optimised"):
                summary.hasOptimisedSchedule = True
            if task.get("final"):
                summary.hasFinalSchedule = True

        for idx, task in enumerate(task_instances):
            if not isinstance(task, dict):
                continue
            template_id = task.get("template_id")
            task_type_id = task.get("task_type_id")
            if template_id is not None and template_id not in global_id_sets["task_templates"]:
                errors.append(_issue(
                    "error",
                    "Task instance references missing template",
                    "A task instance references a task template that is not included in the import.",
                    f"{event_path}.task_instances[{idx}].template_id",
                ))
            if task_type_id is not None and task_type_id not in global_id_sets["task_types"]:
                errors.append(_issue(
                    "error",
                    "Task instance references missing task type",
                    "A task instance references a task type that is not included in the import.",
                    f"{event_path}.task_instances[{idx}].task_type_id",
                ))
            if not _task_has_location_value(task):
                warnings.append(_issue(
                    "warning",
                    "Task without location",
                    "A task has no imported location information.",
                    f"{event_path}.task_instances[{idx}]",
                ))
            if task.get("optimised"):
                summary.hasOptimisedSchedule = True
            if task.get("final"):
                summary.hasFinalSchedule = True

        for idx, assignment in enumerate(assignments):
            if not isinstance(assignment, dict):
                continue
            if assignment.get("person_id") not in person_ids:
                errors.append(_issue(
                    "error",
                    "Assignment references missing person",
                    "An assignment references a person that is not included in the import.",
                    f"{event_path}.assignments[{idx}].person_id",
                ))
            task_id = assignment.get("task_id")
            if task_id is not None and task_id not in all_task_ids:
                errors.append(_issue(
                    "error",
                    "Assignment references missing task",
                    "An assignment references a task that is not included in the import.",
                    f"{event_path}.assignments[{idx}].task_id",
                ))
            source_id = assignment.get("assignment_source_id")
            if source_id is not None and source_id not in global_id_sets["assignment_sources"]:
                errors.append(_issue(
                    "error",
                    "Assignment references missing source",
                    "An assignment references an assignment source that is not included in the import.",
                    f"{event_path}.assignments[{idx}].assignment_source_id",
                ))

        for idx, membership in enumerate(group_memberships):
            if not isinstance(membership, dict):
                continue
            if membership.get("group_id") not in group_ids:
                errors.append(_issue(
                    "error",
                    "Group membership references missing group",
                    "A group membership references a group that is not included in the import.",
                    f"{event_path}.group_memberships[{idx}].group_id",
                ))
            if membership.get("person_id") not in person_ids:
                errors.append(_issue(
                    "error",
                    "Group membership references missing person",
                    "A group membership references a person that is not included in the import.",
                    f"{event_path}.group_memberships[{idx}].person_id",
                ))
            if membership.get("group_role_id") not in global_id_sets["group_roles"]:
                errors.append(_issue(
                    "error",
                    "Group membership references missing role",
                    "A group membership references a group role that is not included in the import.",
                    f"{event_path}.group_memberships[{idx}].group_role_id",
                ))

        for idx, requirement in enumerate(task_capability_requirements):
            if not isinstance(requirement, dict):
                continue
            if requirement.get("task_id") not in task_ids:
                errors.append(_issue(
                    "error",
                    "Capability requirement references missing task",
                    "A task capability requirement references a missing task.",
                    f"{event_path}.task_capability_requirements[{idx}].task_id",
                ))
            if requirement.get("capability_id") not in global_id_sets["capabilities"]:
                errors.append(_issue(
                    "error",
                    "Capability requirement references missing capability",
                    "A task capability requirement references a missing capability.",
                    f"{event_path}.task_capability_requirements[{idx}].capability_id",
                ))

        for idx, capability in enumerate(person_capabilities):
            if not isinstance(capability, dict):
                continue
            if capability.get("person_id") not in person_ids:
                errors.append(_issue(
                    "error",
                    "Person capability references missing person",
                    "A person capability references a missing person.",
                    f"{event_path}.person_capabilities[{idx}].person_id",
                ))
            if capability.get("capability_id") not in global_id_sets["capabilities"]:
                errors.append(_issue(
                    "error",
                    "Person capability references missing capability",
                    "A person capability references a missing capability.",
                    f"{event_path}.person_capabilities[{idx}].capability_id",
                ))

        for idx, layout in enumerate(masterplan_layouts):
            if isinstance(layout, dict) and layout.get("task_id") is not None and layout.get("task_id") not in all_task_ids:
                errors.append(_issue(
                    "error",
                    "Layout references missing task",
                    "A schedule layout entry references a task that is not included in the import.",
                    f"{event_path}.masterplan_layouts[{idx}].task_id",
                ))

        for idx, element in enumerate(session_elements):
            if not isinstance(element, dict):
                continue
            if not str(element.get("title") or "").strip():
                errors.append(_issue(
                    "error",
                    "Session Element missing title",
                    "A Session Element is missing its title.",
                    f"{event_path}.session_elements[{idx}].title",
                ))
            location_id = element.get("location_id")
            if location_id is not None and location_id not in location_ids:
                warnings.append(_issue(
                    "warning",
                    "Session Element references missing location",
                    "A Session Element references a location that is not included; the location will be cleared.",
                    f"{event_path}.session_elements[{idx}].location_id",
                ))
            responsible_person_id = element.get("responsible_person_id")
            if responsible_person_id is not None and responsible_person_id not in person_ids:
                warnings.append(_issue(
                    "warning",
                    "Session Element references missing responsible person",
                    "A Session Element references a responsible person that is not included; the person reference will be cleared.",
                    f"{event_path}.session_elements[{idx}].responsible_person_id",
                ))
            team_ids = element.get("attendee_team_ids") or []
            if not isinstance(team_ids, list):
                errors.append(_issue(
                    "error",
                    "Session Element has invalid audience teams",
                    "A Session Element audience team list must be an array.",
                    f"{event_path}.session_elements[{idx}].attendee_team_ids",
                ))
            elif team_ids:
                missing_team_ids = [team_id for team_id in team_ids if team_id not in audience_team_ids]
                if missing_team_ids:
                    warnings.append(_issue(
                        "warning",
                        "Session Element references missing team",
                        "A Session Element references an Audience Team that is not included; the missing team will be ignored.",
                        f"{event_path}.session_elements[{idx}].attendee_team_ids",
                    ))
            view_ids = element.get("schedule_view_ids") or []
            if not isinstance(view_ids, list):
                errors.append(_issue(
                    "error",
                    "Session Element has invalid schedule views",
                    "A Session Element schedule view list must be an array.",
                    f"{event_path}.session_elements[{idx}].schedule_view_ids",
                ))
            elif view_ids:
                missing_view_ids = [view_id for view_id in view_ids if view_id not in schedule_view_ids]
                if missing_view_ids:
                    warnings.append(_issue(
                        "warning",
                        "Session Element references missing schedule view",
                        "A Session Element references a schedule view that is not included; the missing view will be ignored.",
                        f"{event_path}.session_elements[{idx}].schedule_view_ids",
                    ))

        if (summary.hasOptimisedSchedule or summary.hasFinalSchedule) and not optimization_jobs:
            schedule_without_metadata = True

    summary.assignmentCount = total_assignments
    summary.dateRange = _format_import_date_range(first_start, first_end)
    summary.hasPublishMetadata = publish_metadata_found

    if schedule_without_metadata:
        warnings.append(_issue(
            "warning",
            "Schedule without optimisation metadata",
            "Imported schedule data exists, but no optimisation job metadata is included.",
            "events",
        ))

    if publish_metadata_found:
        warnings.append(_issue(
            "warning",
            "Reconnect integrations after import",
            "Publish metadata was found, but credentials and secrets are not imported from project JSON.",
            "events",
        ))

    if not events and import_type != "app_settings":
        warnings.append(_issue(
            "warning",
            "No projects included",
            "This file does not contain any projects. It may only update global configuration.",
            "events",
        ))

    return ImportValidationResult(
        isValid=not errors,
        errors=errors,
        warnings=warnings,
        info=info,
        summary=summary,
    )


def _reject_accountability_identity_conflicts(db: Session, payload: dict) -> None:
    """Reject duplicate imported accountability identities before any writes."""
    event_refs: list[str] = []
    subject_refs: list[str] = []
    events = payload.get("events")
    if not isinstance(events, list):
        return
    for event_data in events:
        if not isinstance(event_data, dict):
            continue
        event_row = event_data.get("event")
        if isinstance(event_row, dict) and event_row.get("evidence_id"):
            event_refs.append(str(event_row["evidence_id"]))
        person_rows = event_data.get("persons")
        if not isinstance(person_rows, list):
            continue
        for person_row in person_rows:
            if isinstance(person_row, dict) and person_row.get("evidence_subject_id"):
                subject_refs.append(str(person_row["evidence_subject_id"]))

    duplicate_event_refs = len(event_refs) - len(set(event_refs))
    duplicate_subject_refs = len(subject_refs) - len(set(subject_refs))
    if duplicate_event_refs or duplicate_subject_refs:
        raise HTTPException(
            400,
            {
                "message": "Import contains duplicate accountability identities.",
                "event_identity_conflicts": duplicate_event_refs,
                "person_identity_conflicts": duplicate_subject_refs,
            },
        )

    existing_event_refs = 0
    existing_subject_refs = 0
    if event_refs:
        existing_event_refs = db.query(Event).filter(
            Event.evidence_id.in_(set(event_refs))
        ).count()
    if subject_refs:
        existing_subject_refs = db.query(Person).filter(
            Person.evidence_subject_id.in_(set(subject_refs))
        ).count()
    if existing_event_refs or existing_subject_refs:
        raise HTTPException(
            409,
            {
                "message": (
                    "This backup contains accountability identities that already exist "
                    "in the local database. Remove the existing project before restoring "
                    "it, or import the backup into an empty database."
                ),
                "event_identity_conflicts": existing_event_refs,
                "person_identity_conflicts": existing_subject_refs,
            },
        )


@router.post("/import/preview", response_model=ImportValidationResult)
async def preview_import_data(req: ImportRequest):
    """Validate an import payload and return a safe preview summary."""
    return validate_import_payload(req.data)


def _import_rows(db: Session, model, rows: list, id_map: dict,
                 remap: dict | None = None, unique_key: str | None = None):
    """
    Insert rows into *model*, skipping the old id and remapping FKs.
    Populates id_map  {old_id -> new_id}.
    remap = { "column_name": other_id_map } for FK remapping.
    unique_key = column name to match existing rows (skip insert on conflict).
    """
    for row in rows:
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)

        # Remap FK columns
        if remap:
            for col, fk_map in remap.items():
                if col in row and row[col] is not None:
                    row[col] = fk_map.get(row[col], row[col])

        # Check for existing record by unique key
        if unique_key and unique_key in row and row[unique_key] is not None:
            existing = db.query(model).filter(
                getattr(model, unique_key) == row[unique_key]
            ).first()
            if existing:
                if old_id is not None:
                    id_map[old_id] = existing.id
                continue

        obj = model(**row)
        db.add(obj)
        db.flush()  # get the new id
        if old_id is not None:
            id_map[old_id] = obj.id


def _import_global(db: Session, global_data: dict) -> dict:
    """Import global data, returns dict of id maps per table."""
    maps: Dict[str, dict] = {}

    # Order matters - dependencies first
    # (key, model, unique_key_column)
    for key, model, ukey in [
        ("themes", Theme, None),
        ("task_types", TaskType, "name"),
        ("capability_types", CapabilityType, "name"),
        ("assignment_sources", AssignmentSource, "code"),
        ("group_types", GroupType, "code"),
        ("leadership_levels", LeadershipLevel, "code"),
    ]:
        rows = global_data.get(key, [])
        m: dict = {}
        _import_rows(db, model, rows, m, unique_key=ukey)
        maps[key] = m

    # Capabilities - remap capability_type_id
    cap_map: dict = {}
    for row in global_data.get("capabilities", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        if row.get("capability_type_id") is not None:
            row["capability_type_id"] = maps["capability_types"].get(
                row["capability_type_id"], row["capability_type_id"]
            )
        if row.get("machine_name"):
            try:
                row["machine_name"] = validate_machine_name(row["machine_name"])
            except ValueError as exc:
                raise HTTPException(400, f"Invalid capability machine_name: {exc}") from exc
        # Check for existing capability by machine_name
        if row.get("machine_name"):
            existing = db.query(Capability).filter(
                Capability.machine_name == row["machine_name"]
            ).first()
            if existing:
                if old_id is not None:
                    cap_map[old_id] = existing.id
                continue
        obj = Capability(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            cap_map[old_id] = obj.id
    maps["capabilities"] = cap_map

    # Task templates - remap task_type_id
    tt_map: dict = {}
    template_rows = []
    for row in global_data.get("task_templates", []):
        if row.get("machine_name"):
            try:
                row["machine_name"] = validate_machine_name(row["machine_name"])
            except ValueError as exc:
                raise HTTPException(400, f"Invalid task template machine_name: {exc}") from exc
        template_rows.append(row)
    _import_rows(db, TaskTemplate, template_rows, tt_map,
                 remap={"task_type_id": maps["task_types"]}, unique_key="machine_name")
    maps["task_templates"] = tt_map

    # Group roles - remap group_type_id, leadership_level_id
    gr_map: dict = {}
    _import_rows(db, GroupRole, global_data.get("group_roles", []), gr_map,
                 remap={
                     "group_type_id": maps["group_types"],
                     "leadership_level_id": maps["leadership_levels"],
                 })
    maps["group_roles"] = gr_map

    # Calendar export formats - remap task_type_id
    cef_map: dict = {}
    _import_rows(db, CalendarExportFormat, global_data.get("calendar_export_formats", []), cef_map,
                 remap={"task_type_id": maps["task_types"]}, unique_key="task_type_id")
    maps["calendar_export_formats"] = cef_map

    # Google calendar connections are NEVER imported (must be set up fresh via OAuth)

    return maps


def _import_event(db: Session, event_data: dict, global_maps: dict) -> "Event":
    """Import a single event and all its scoped data, using global_maps for cross-ref FKs.
    Returns the newly created Event."""
    ev_row = event_data["event"]
    old_event_id = ev_row.pop("id", None)
    ev_row.pop("created_at", None)
    ev_row.pop("updated_at", None)
    # Remap enabled_capability_ids
    if ev_row.get("enabled_capability_ids") and global_maps.get("capabilities"):
        cap_map = global_maps["capabilities"]
        ev_row["enabled_capability_ids"] = [
            cap_map.get(cid, cid) for cid in ev_row["enabled_capability_ids"]
        ]
    # Never import google_calendar_id - connections must be set up fresh
    ev_row.pop("google_calendar_id", None)
    # Never import MP-Backend settings - must be configured per-event
    ev_row.pop("mp_backend_url", None)
    # Parse date strings back to Python date objects
    for date_field in ("start_date", "end_date"):
        if ev_row.get(date_field) and isinstance(ev_row[date_field], str):
            ev_row[date_field] = date.fromisoformat(ev_row[date_field])
    event = Event(**ev_row)
    db.add(event)
    db.flush()
    new_event_id = event.id

    # Locations
    loc_map: dict = {}
    for row in event_data.get("locations", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        obj = Location(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            loc_map[old_id] = obj.id

    # Persons (home_location_id uses loc_map)
    person_map: dict = {}
    for row in event_data.get("persons", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("home_location_id") is not None:
            row["home_location_id"] = loc_map.get(row["home_location_id"], row["home_location_id"])
        obj = Person(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            person_map[old_id] = obj.id

    # PersonCapabilities
    cap_map = global_maps.get("capabilities", {})
    for row in event_data.get("person_capabilities", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        if row.get("person_id") is not None:
            row["person_id"] = person_map.get(row["person_id"], row["person_id"])
        if row.get("capability_id") is not None:
            row["capability_id"] = cap_map.get(row["capability_id"], row["capability_id"])
        db.add(PersonCapability(**row))

    # Typed, reason-free unavailability intervals
    for row in event_data.get("person_unavailabilities", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("person_id") is not None:
            row["person_id"] = person_map.get(row["person_id"], row["person_id"])
        for key in ("starts_at", "ends_at"):
            if isinstance(row.get(key), str):
                row[key] = datetime.fromisoformat(row[key])
        db.add(PersonUnavailability(**row))

    # Tasks
    task_map: dict = {}
    tt_map = global_maps.get("task_templates", {})
    ttype_map = global_maps.get("task_types", {})
    for row in event_data.get("tasks", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("task_template_id") is not None:
            row["task_template_id"] = tt_map.get(row["task_template_id"], row["task_template_id"])
        if row.get("task_type_id") is not None:
            row["task_type_id"] = ttype_map.get(row["task_type_id"], row["task_type_id"])
        obj = Task(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            task_map[old_id] = obj.id

    # TaskCapabilityRequirements
    for row in event_data.get("task_capability_requirements", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        if row.get("task_id") is not None:
            row["task_id"] = task_map.get(row["task_id"], row["task_id"])
        if row.get("capability_id") is not None:
            row["capability_id"] = cap_map.get(row["capability_id"], row["capability_id"])
        db.add(TaskCapabilityRequirement(**row))

    # Assignments
    as_map = global_maps.get("assignment_sources", {})
    for row in event_data.get("assignments", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("person_id") is not None:
            row["person_id"] = person_map.get(row["person_id"], row["person_id"])
        if row.get("task_id") is not None:
            row["task_id"] = task_map.get(row["task_id"], row["task_id"])
        if row.get("assignment_source_id") is not None:
            row["assignment_source_id"] = as_map.get(row["assignment_source_id"], row["assignment_source_id"])
        db.add(Assignment(**row))

    # Groups
    gt_map = global_maps.get("group_types", {})
    group_map: dict = {}
    created_groups = []
    for row in event_data.get("groups", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("group_type_id") is not None:
            row["group_type_id"] = gt_map.get(row["group_type_id"], row["group_type_id"])
        obj = Group(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            group_map[old_id] = obj.id
        created_groups.append(obj)

    def _remap_group_members(members: Optional[list]) -> list:
        """Remap imported person and group member references to new IDs."""
        if not isinstance(members, list):
            return []

        remapped = []
        seen = set()
        for item in members:
            member_type = "person"
            raw_id = item
            if isinstance(item, dict):
                member_type = item.get("type") or "person"
                raw_id = item.get("id")

            if member_type not in {"person", "group"} or not isinstance(raw_id, int):
                continue

            next_id = (
                group_map.get(raw_id, raw_id)
                if member_type == "group"
                else person_map.get(raw_id, raw_id)
            )
            key = (member_type, next_id)
            if key in seen:
                continue
            seen.add(key)
            remapped.append({"type": member_type, "id": next_id})
        return remapped

    for obj in created_groups:
        meta_data = dict(obj.meta_data or {})
        meta_data["members"] = _remap_group_members(meta_data.get("members", []))
        obj.meta_data = meta_data

    # AudienceCategories
    audience_category_map: dict[int, int] = {}
    for row in event_data.get("audience_categories", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        obj = AudienceCategory(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            audience_category_map[old_id] = obj.id

    # ScheduleViews
    schedule_view_map: dict[int, int] = {}
    for row in event_data.get("schedule_views", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        obj = ScheduleView(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            schedule_view_map[old_id] = obj.id

    # SessionElementTypes
    session_element_type_map: dict[int, int] = {}
    for row in event_data.get("session_element_types", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        obj = SessionElementType(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            session_element_type_map[old_id] = obj.id

    # AudienceTeams
    audience_team_map: dict[int, int] = {}
    for row in event_data.get("audience_teams", []):
        old_id = row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("category_id") is not None:
            row["category_id"] = audience_category_map.get(row["category_id"], None)
        obj = AudienceTeam(**row)
        db.add(obj)
        db.flush()
        if old_id is not None:
            audience_team_map[old_id] = obj.id

    # GroupMemberships
    gr_map = global_maps.get("group_roles", {})
    for row in event_data.get("group_memberships", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        if row.get("group_id") is not None:
            row["group_id"] = group_map.get(row["group_id"], row["group_id"])
        if row.get("person_id") is not None:
            row["person_id"] = person_map.get(row["person_id"], row["person_id"])
        if row.get("group_role_id") is not None:
            row["group_role_id"] = gr_map.get(row["group_role_id"], row["group_role_id"])
        db.add(GroupMembership(**row))

    # Pre-build template field-type lookup for field_values remapping
    _tpl_field_types: Dict[int, Dict[str, str]] = {}
    for tpl in db.query(TaskTemplate).all():
        _tpl_field_types[tpl.id] = {
            f["id"]: f.get("type", "") for f in (tpl.fields or [])
        }

    def _remap_fv(fv: Optional[dict], template_id: Optional[int]) -> Optional[dict]:
        """Remap entity IDs inside a field_values dict using import ID maps."""
        if not fv or not isinstance(fv, dict) or not template_id:
            return fv
        ft_map = _tpl_field_types.get(template_id, {})
        for fid, ftype in ft_map.items():
            if fid not in fv:
                continue
            val = fv[fid]
            if ftype == "persons_list" and isinstance(val, list):
                fv[fid] = _remap_group_members(val)
            elif ftype in ("location", "start_location", "end_location") and isinstance(val, int):
                fv[fid] = loc_map.get(val, val)
            elif ftype == "capabilities_list" and isinstance(val, list):
                fv[fid] = [
                    {**item, "id": cap_map.get(item["id"], item["id"])}
                    if isinstance(item, dict) and "id" in item else item
                    for item in val
                ]
        return fv

    # TaskInstances
    for row in event_data.get("task_instances", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("template_id") is not None:
            row["template_id"] = tt_map.get(row["template_id"], row["template_id"])
        if row.get("task_type_id") is not None:
            row["task_type_id"] = ttype_map.get(row["task_type_id"], row["task_type_id"])
        # Remap entity IDs inside field_values, optimised, and final
        new_tid = row.get("template_id")
        for col in ("field_values", "optimised", "final"):
            if row.get(col):
                row[col] = _remap_fv(row[col], new_tid)
        db.add(TaskInstance(**row))

    # SessionElements
    for row in event_data.get("session_elements", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("session_element_type_id") is not None:
            row["session_element_type_id"] = session_element_type_map.get(row["session_element_type_id"], None)
        if row.get("location_id") is not None:
            row["location_id"] = loc_map.get(row["location_id"], None)
        if row.get("responsible_person_id") is not None:
            row["responsible_person_id"] = person_map.get(row["responsible_person_id"], None)
        remapped_team_ids: list[int] = []
        seen_team_ids: set[int] = set()
        for old_team_id in row.get("attendee_team_ids") or []:
            new_team_id = audience_team_map.get(old_team_id)
            if new_team_id is not None and new_team_id not in seen_team_ids:
                seen_team_ids.add(new_team_id)
                remapped_team_ids.append(new_team_id)
        row["attendee_team_ids"] = remapped_team_ids
        remapped_view_ids: list[int] = []
        seen_view_ids: set[int] = set()
        for old_view_id in row.get("schedule_view_ids") or []:
            new_view_id = schedule_view_map.get(old_view_id)
            if new_view_id is not None and new_view_id not in seen_view_ids:
                seen_view_ids.add(new_view_id)
                remapped_view_ids.append(new_view_id)
        row["schedule_view_ids"] = remapped_view_ids
        db.add(SessionElement(**row))

    # MasterplanLayouts
    for row in event_data.get("masterplan_layouts", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row["event_id"] = new_event_id
        if row.get("task_id") is not None:
            row["task_id"] = task_map.get(row["task_id"], row["task_id"])
        db.add(MasterplanLayout(**row))

    # OptimizationJobs
    for row in event_data.get("optimization_jobs", []):
        row.pop("id", None)
        row.pop("created_at", None)
        row.pop("updated_at", None)
        row.pop("started_at", None)
        row.pop("completed_at", None)
        row["event_id"] = new_event_id
        db.add(OptimizationJob(**row))

    db.flush()
    return event


@router.post("/import")
async def import_data(req: ImportRequest, db: Session = Depends(get_db)):
    """Import data from a previously exported JSON payload.

    The file always contains global_data (always imported first).
    Events are imported after global data, with FK remapping.
    """
    payload = req.data
    validation = validate_import_payload(payload)
    if validation.errors:
        raise HTTPException(
            400,
            {
                "message": "Import validation failed",
                "errors": [issue.model_dump() for issue in validation.errors],
            },
        )
    _reject_accountability_identity_conflicts(db, payload)

    try:
        imported_event_ids: list[int] = []

        # Always import global data first
        global_maps = _import_global(db, payload["global_data"])

        # Then import events if present
        if "events" in payload:
            for event_data in payload["events"]:
                new_event = _import_event(db, event_data, global_maps)
                if new_event is not None:
                    imported_event_ids.append(new_event.id)

        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.error(f"Import failed: {exc}", exc_info=True)
        raise HTTPException(500, f"Import failed: {exc}")

    # Build descriptive message
    file_type = payload.get("type", "unknown")
    parts = ["application settings"]
    if imported_event_ids:
        n = len(imported_event_ids)
        parts.append(f"{n} project{'s' if n != 1 else ''}")
    msg = "Imported " + " and ".join(parts) + "."

    return {
        "status": "ok",
        "message": msg,
        "imported_event_ids": imported_event_ids,
    }


# ---------------------------------------------------------------------------
# COPY FROM EVENT
# ---------------------------------------------------------------------------

class CopyFromEventRequest(BaseModel):
    """Request to copy selected setup data from one event into another."""

    source_event_id: int
    target_event_id: int
    include: List[str]  # "persons", "locations", "groups", "task_structure", "enabled_capabilities"


class CopiedTaskDateRepairRequest(BaseModel):
    """Identify a source and target event for copied task-date repair."""

    source_event_id: int
    target_event_id: int


class ApplyCopiedTaskDateRepairRequest(CopiedTaskDateRepairRequest):
    """Apply the selected copied task-date repairs after revalidation."""

    task_instance_ids: List[int]


class CopiedTaskDateRepairCandidate(BaseModel):
    """One copied task skeleton and its proposed target-event date."""

    task_instance_id: int
    name: str
    current_date: str
    proposed_date: Optional[str] = None
    proposed_day_index: Optional[int] = None
    repairable: bool
    reason: Optional[str] = None


class CopiedTaskDateRepairPreview(BaseModel):
    """Preview of safe copied task-date repairs for one event pair."""

    source_event_id: int
    target_event_id: int
    candidates: List[CopiedTaskDateRepairCandidate]
    repairable_count: int


class TaskDateMappingError(ValueError):
    """Raised when a source task cannot be represented in the target event."""


def _parse_task_date(value: object, label: str) -> date:
    """Parse an ISO task date and raise a user-readable mapping error."""
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise TaskDateMappingError(f"{label} has an invalid task date.") from exc


def _event_day_boundary_hour(event: Event) -> int:
    """Return the event's after-midnight working-day boundary hour."""
    meta_data = event.meta_data if isinstance(event.meta_data, dict) else {}
    day_range = meta_data.get("schedule_day_range")
    if not isinstance(day_range, dict):
        return 0
    try:
        end_hour = int(day_range.get("endHour", 24))
    except (TypeError, ValueError):
        return 0
    return max(0, min(12, end_hour - 24))


def _clock_minutes(value: object) -> Optional[int]:
    """Convert a valid HH:MM value to minutes after midnight."""
    if not isinstance(value, str):
        return None
    try:
        hours, minutes = (int(part) for part in value.split(":"))
    except (TypeError, ValueError):
        return None
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None
    return hours * 60 + minutes


def _task_start_clock(
    instance: TaskInstance,
    template: Optional[TaskTemplate],
) -> Optional[str]:
    """Read the first concrete start clock from a task instance's template fields."""
    values = instance.field_values if isinstance(instance.field_values, dict) else {}
    fields = template.fields if template and isinstance(template.fields, list) else []
    for field in fields:
        if not isinstance(field, dict):
            continue
        value = values.get(field.get("id"))
        if field.get("type") in {"start_end_time", "time_range"}:
            if (
                isinstance(value, dict)
                and _clock_minutes(value.get("start")) is not None
            ):
                return value["start"]
        elif field.get("type") == "time" and _clock_minutes(value) is not None:
            return value
    return None


def _map_task_date(
    instance: TaskInstance,
    source: Event,
    target: Event,
    template: Optional[TaskTemplate],
) -> tuple[str, int]:
    """Map a task to the same relative working day in the target event."""
    if (
        not source.start_date
        or not source.end_date
        or not target.start_date
        or not target.end_date
    ):
        raise TaskDateMappingError("Both source and target projects need valid date ranges.")

    actual_date = _parse_task_date(instance.date, instance.name or "Task")
    working_date = actual_date
    start_minutes = _clock_minutes(_task_start_clock(instance, template))
    boundary_hour = _event_day_boundary_hour(source)
    if (
        boundary_hour > 0
        and start_minutes is not None
        and start_minutes < boundary_hour * 60
    ):
        working_date -= timedelta(days=1)

    day_index = (working_date - source.start_date).days
    source_day_count = (source.end_date - source.start_date).days + 1
    target_day_count = (target.end_date - target.start_date).days + 1
    if day_index < 0 or day_index >= source_day_count:
        raise TaskDateMappingError(
            f'"{instance.name or "Untitled"}" is outside the source project date range.'
        )
    if day_index >= target_day_count:
        raise TaskDateMappingError(
            f'"{instance.name or "Untitled"}" needs relative day {day_index + 1}, '
            "but the target project has only "
            f"{target_day_count} day{'s' if target_day_count != 1 else ''}."
        )

    actual_date_offset = (actual_date - working_date).days
    target_working_date = target.start_date + timedelta(days=day_index)
    proposed_date = target_working_date + timedelta(days=actual_date_offset)
    return proposed_date.isoformat(), day_index


def _task_structure_signature(instance: TaskInstance) -> str:
    """Return a stable signature for fields retained by task-structure copying."""
    payload = {
        "name": instance.name,
        "template_id": instance.template_id,
        "task_type_id": instance.task_type_id,
        "is_floating": bool(instance.is_floating),
        "is_transfer": bool(instance.is_transfer),
        "field_values": instance.field_values,
        "constraints": instance.constraints,
        "additional": instance.additional,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _load_copy_events(
    db: Session,
    source_event_id: int,
    target_event_id: int,
) -> tuple[Event, Event]:
    """Load and validate the source and target events used by copy operations."""
    source = db.query(Event).filter(Event.id == source_event_id).first()
    target = db.query(Event).filter(Event.id == target_event_id).first()
    if not source:
        raise HTTPException(404, "Source event not found")
    if not target:
        raise HTTPException(404, "Target event not found")
    if source.id == target.id:
        raise HTTPException(400, "Source and target must be different events")
    return source, target


def _template_map(db: Session, instances: List[TaskInstance]) -> dict[int, TaskTemplate]:
    """Load templates referenced by a collection of task instances."""
    template_ids = {
        item.template_id for item in instances if item.template_id is not None
    }
    if not template_ids:
        return {}
    templates = db.query(TaskTemplate).filter(TaskTemplate.id.in_(template_ids)).all()
    return {template.id: template for template in templates}


def _build_copied_task_date_repair_preview(
    db: Session,
    source: Event,
    target: Event,
) -> CopiedTaskDateRepairPreview:
    """Find safe repair candidates by matching copied skeletons to source tasks."""
    source_instances = (
        db.query(TaskInstance).filter(TaskInstance.event_id == source.id).all()
    )
    target_instances = (
        db.query(TaskInstance).filter(TaskInstance.event_id == target.id).all()
    )
    templates = _template_map(db, source_instances)
    source_by_key = {
        (_task_structure_signature(instance), str(instance.date)): instance
        for instance in source_instances
    }
    candidates: List[CopiedTaskDateRepairCandidate] = []

    for target_instance in target_instances:
        if target_instance.optimised or target_instance.final:
            continue
        source_instance = source_by_key.get(
            (_task_structure_signature(target_instance), str(target_instance.date))
        )
        if not source_instance:
            continue
        try:
            proposed_date, day_index = _map_task_date(
                source_instance,
                source,
                target,
                templates.get(source_instance.template_id),
            )
            if (
                proposed_date == str(target_instance.date)
                and target_instance.day_index == day_index
            ):
                continue
            candidate = CopiedTaskDateRepairCandidate(
                task_instance_id=target_instance.id,
                name=target_instance.name,
                current_date=str(target_instance.date),
                proposed_date=proposed_date,
                proposed_day_index=day_index,
                repairable=True,
            )
        except TaskDateMappingError as exc:
            candidate = CopiedTaskDateRepairCandidate(
                task_instance_id=target_instance.id,
                name=target_instance.name,
                current_date=str(target_instance.date),
                repairable=False,
                reason=str(exc),
            )
        candidates.append(candidate)

    return CopiedTaskDateRepairPreview(
        source_event_id=source.id,
        target_event_id=target.id,
        candidates=candidates,
        repairable_count=sum(1 for candidate in candidates if candidate.repairable),
    )


@router.post("/copy-from-event")
async def copy_from_event(req: CopyFromEventRequest, db: Session = Depends(get_db)):
    """Clone selected data from one event into another (internal DB copy)."""
    source, target = _load_copy_events(db, req.source_event_id, req.target_event_id)

    summary: Dict[str, int] = {}
    mapped_task_instances: List[tuple[TaskInstance, str, int]] = []

    if "task_structure" in req.include:
        source_task_instances = (
            db.query(TaskInstance).filter(TaskInstance.event_id == source.id).all()
        )
        templates = _template_map(db, source_task_instances)
        try:
            for instance in source_task_instances:
                mapped_date, mapped_day_index = _map_task_date(
                    instance,
                    source,
                    target,
                    templates.get(instance.template_id),
                )
                mapped_task_instances.append(
                    (instance, mapped_date, mapped_day_index)
                )
        except TaskDateMappingError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        loc_map: dict = {}
        person_map: dict = {}

        # Locations
        if "locations" in req.include:
            src_locations = db.query(Location).filter(Location.event_id == source.id).all()
            for loc in src_locations:
                new_loc = Location(
                    event_id=target.id, name=loc.name, address=loc.address, details=loc.details
                )
                db.add(new_loc)
                db.flush()
                loc_map[loc.id] = new_loc.id
            summary["locations"] = len(src_locations)

        # Persons (+ capabilities)
        if "persons" in req.include:
            src_persons = db.query(Person).filter(Person.event_id == source.id).all()
            for p in src_persons:
                home_loc = loc_map.get(p.home_location_id) if p.home_location_id else None
                new_p = Person(
                    event_id=target.id,
                    first_name=p.first_name, last_name=p.last_name,
                    email=p.email, google_email=p.google_email,
                    max_hours_per_day=p.max_hours_per_day,
                    home_location_id=home_loc,
                )
                db.add(new_p)
                db.flush()
                person_map[p.id] = new_p.id

                # Copy person capabilities
                src_caps = db.query(PersonCapability).filter(PersonCapability.person_id == p.id).all()
                for pc in src_caps:
                    db.add(PersonCapability(
                        person_id=new_p.id,
                        capability_id=pc.capability_id,
                        level=pc.level, notes=pc.notes,
                    ))
                for interval in db.query(PersonUnavailability).filter(
                    PersonUnavailability.event_id == source.id,
                    PersonUnavailability.person_id == p.id,
                ).all():
                    db.add(PersonUnavailability(
                        event_id=target.id,
                        person_id=new_p.id,
                        starts_at=interval.starts_at,
                        ends_at=interval.ends_at,
                    ))
            summary["persons"] = len(src_persons)

        # Groups (+ memberships)
        if "groups" in req.include:
            src_groups = db.query(Group).filter(Group.event_id == source.id).all()
            group_map: dict = {}
            for g in src_groups:
                new_g = Group(
                    event_id=target.id, group_type_id=g.group_type_id,
                    name=g.name, meta_data=g.meta_data,
                )
                db.add(new_g)
                db.flush()
                group_map[g.id] = new_g.id

            # Memberships - only if persons were also copied (need person_map)
            if person_map:
                for g in src_groups:
                    mems = db.query(GroupMembership).filter(GroupMembership.group_id == g.id).all()
                    for m in mems:
                        new_pid = person_map.get(m.person_id)
                        if new_pid:
                            db.add(GroupMembership(
                                group_id=group_map[g.id],
                                person_id=new_pid,
                                group_role_id=m.group_role_id,
                                membership_data=m.membership_data,
                            ))
            summary["groups"] = len(src_groups)

        # Task structure (task_instances - skeleton only, no optimised/final/assignments)
        if "task_structure" in req.include:
            for ti, mapped_date, mapped_day_index in mapped_task_instances:
                db.add(TaskInstance(
                    event_id=target.id,
                    name=ti.name,
                    template_id=ti.template_id,
                    task_type_id=ti.task_type_id,
                    date=mapped_date,
                    day_index=mapped_day_index,
                    is_floating=ti.is_floating,
                    is_transfer=ti.is_transfer,
                    field_values=ti.field_values,
                    constraints=ti.constraints,
                    additional=ti.additional,
                    # omit optimised and final
                ))
            summary["task_instances"] = len(mapped_task_instances)

        # Enabled capabilities
        if "enabled_capabilities" in req.include:
            target.enabled_capability_ids = source.enabled_capability_ids
            summary["enabled_capabilities_copied"] = 1

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Copy-from-event failed: {exc}", exc_info=True)
        raise HTTPException(500, f"Copy failed: {exc}")

    return {"status": "ok", "summary": summary}


@router.post(
    "/copy-from-event/repair-preview",
    response_model=CopiedTaskDateRepairPreview,
)
async def preview_copied_task_date_repair(
    req: CopiedTaskDateRepairRequest,
    db: Session = Depends(get_db),
):
    """Preview safe date repairs for task skeletons copied between events."""
    source, target = _load_copy_events(
        db,
        req.source_event_id,
        req.target_event_id,
    )
    return _build_copied_task_date_repair_preview(db, source, target)


@router.post("/copy-from-event/repair")
async def apply_copied_task_date_repair(
    req: ApplyCopiedTaskDateRepairRequest,
    db: Session = Depends(get_db),
):
    """Apply selected copied task-date repairs after revalidating the preview."""
    source, target = _load_copy_events(
        db,
        req.source_event_id,
        req.target_event_id,
    )
    preview = _build_copied_task_date_repair_preview(db, source, target)
    candidates = {
        candidate.task_instance_id: candidate
        for candidate in preview.candidates
        if candidate.repairable
    }
    requested_ids = list(dict.fromkeys(req.task_instance_ids))
    missing_ids = [
        task_id for task_id in requested_ids if task_id not in candidates
    ]
    if missing_ids:
        raise HTTPException(
            status_code=409,
            detail=(
                "The repair preview is stale. Review the copied task dates "
                "again before applying changes."
            ),
        )

    instances = (
        db.query(TaskInstance)
        .filter(TaskInstance.event_id == target.id, TaskInstance.id.in_(requested_ids))
        .all()
        if requested_ids
        else []
    )
    instances_by_id = {instance.id: instance for instance in instances}
    for task_id in requested_ids:
        candidate = candidates[task_id]
        instance = instances_by_id.get(task_id)
        if not instance or str(instance.date) != candidate.current_date:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail=(
                    "The repair preview is stale. Review the copied task dates "
                    "again before applying changes."
                ),
            )
        instance.date = candidate.proposed_date
        instance.day_index = candidate.proposed_day_index

    db.commit()
    return {
        "status": "ok",
        "repaired_count": len(requested_ids),
        "task_instance_ids": requested_ids,
    }


# ---------------------------------------------------------------------------
# DELETE EVENT
# ---------------------------------------------------------------------------

@router.delete("/event/{event_id}")
async def delete_event(event_id: int, db: Session = Depends(get_db)):
    """Delete a single event and all its scoped data."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(404, "Event not found")

    event_name = event.name
    try:
        delete_event_scoped_data(db, event_id)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Error deleting event {event_id}: {exc}")
        raise HTTPException(500, f"Failed to delete event: {exc}")

    db.expire_all()
    return {"status": "ok", "message": f"Event '{event_name}' deleted"}


# ---------------------------------------------------------------------------
# FACTORY RESET
# ---------------------------------------------------------------------------

class FactoryResetRequest(BaseModel):
    """Confirmation payload required before wiping all local app data."""

    confirmation: str


@router.post("/factory-reset")
async def factory_reset(req: FactoryResetRequest, db: Session = Depends(get_db)):
    """Wipe ALL data and recreate default theme. Requires confirmation='RESET'."""
    if req.confirmation != "RESET":
        raise HTTPException(400, "You must send confirmation='RESET' to proceed")

    try:
        # Delete in FK-safe order (leaves first)
        tables_ordered = [
            "assignments",
            "optimization_jobs",
            "event_publish_states",
            "general_schedule_publish_states",
            "task_descriptions",
            "masterplan_layouts",
            "task_capability_requirements",
            "session_elements",
            "session_element_types",
            "schedule_views",
            "audience_teams",
            "audience_categories",
            "tasks",
            "person_unavailability",
            "person_capabilities",
            "group_memberships",
            "groups",
            "persons",
            "locations",
            "attachments",
            "task_instances",
            "events",
            # Global tables
            "calendar_export_formats",
            "group_roles",
            "group_types",
            "leadership_levels",
            "assignment_sources",
            "task_templates",
            "capabilities",
            "capability_types",
            "task_types",
            "google_calendar_connections",
            "themes",
            "app_settings",
        ]
        for table in tables_ordered:
            try:
                db.execute(text(f"DELETE FROM {table}"))
            except Exception:
                pass  # table may not exist yet

        # Recreate default theme
        default_theme = Theme(name="Default Theme", is_active=True)
        db.add(default_theme)

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Factory reset failed: {exc}", exc_info=True)
        raise HTTPException(500, f"Factory reset failed: {exc}")

    db.expire_all()
    return {"status": "ok", "message": "Factory reset complete. Default theme restored."}
