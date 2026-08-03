"""
MP-Backend Integration API
Manages connection to the Masterplan Optimiser web server:
  - Settings storage (server_url, publish_secret)
  - Ping (test connection)
  - Publish event data to server
  - Export server setup JSON for importing on the server side
"""
import hashlib
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional, List, Dict

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.app_settings import AppSettings
from app.models.event import Event
from app.models.person import Person
from app.models.privacy import DesktopDeletionOutbox, PersonUnavailability
from app.core.desktop_deletion import stage_deletion_report
from app.models.task import Task, TaskType
from app.models.task_template import TaskTemplate
from app.models.assignment import Assignment
from app.models.location import Location
from app.models.general_schedule import (
    AudienceCategory,
    AudienceTeam,
    GeneralSchedulePublishState,
    ScheduleView,
    SessionElement,
    SessionElementType,
)
from app.core.group_member_resolution import (
    resolve_group_assignment_for_task,
    resolve_group_member_person_ids,
)
from app.core.unavailability import normalize_unavailable_intervals
from app.core.data_minimisation import (
    PUBLISH_CONTRACT_VERSION,
    reviewed_publish_definition,
)
from app.core.local_operator import local_operator_subject
from app.core.secure_credentials import (
    SecureCredentialStoreUnavailable,
    credential_store_available,
    delete_secret,
    get_secret,
    mp_backend_secret_key,
    set_secret,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Keys used in the AppSettings key-value table
_KEY_SERVER_URL = "mp_backend_server_url"
_KEY_PUBLISH_SECRET = "mp_backend_publish_secret"

_SESSION_ELEMENT_COLOURS = {
    "#fca5a5",
    "#fecaca",
    "#fdba74",
    "#fde68a",
    "#86efac",
    "#6ee7b7",
    "#7dd3fc",
    "#a5b4fc",
    "#c4b5fd",
    "#d8b4fe",
    "#cbd5e1",
}
_DEFAULT_SESSION_ELEMENT_COLOUR = "#7dd3fc"


def _session_element_colour(value: Optional[str]) -> str:
    return value if value in _SESSION_ELEMENT_COLOURS else _DEFAULT_SESSION_ELEMENT_COLOUR


# ── Schemas ────────────────────────────────────────────────────────────────

class MpBackendSettings(BaseModel):
    server_url: str
    publish_secret: str


class MpBackendSettingsResponse(BaseModel):
    configured: bool
    server_url: Optional[str] = None
    secret_preview: Optional[str] = None
    credential_storage_available: bool = True
    secret_available: bool = False


class MpBackendPingResponse(BaseModel):
    status: str
    event_name: Optional[str] = None
    event_id: Optional[int] = None
    event_ref: Optional[str] = None
    supports_scoped_publish: bool = False
    supports_deletion_work_orders: bool = False


class MpBackendPublishResponse(BaseModel):
    status: str
    tasks_created: int = 0
    persons_created: int = 0
    edits_cleared: int = 0


class GeneralSchedulePublishResponse(BaseModel):
    status: str
    items_published: int = 0
    fingerprint: Optional[str] = None
    published_at: Optional[str] = None


class DeletionWorkOrderSyncResponse(BaseModel):
    """Summary of locally applied and server-confirmed deletion work orders."""

    applied: int = 0
    reports_sent: int = 0
    reports_pending: int = 0
    event_deleted: bool = False


class GeneralSchedulePublishRequest(BaseModel):
    """Optional working-day subset for Public Schedule publishing."""

    dates: Optional[List[str]] = None


class MpBackendPublishRequest(BaseModel):
    """Optional day subset for MP-Backend schedule publishing."""

    dates: Optional[List[str]] = None


class DataPolicyAcknowledgementRequest(BaseModel):
    """Exact policy identity explicitly reviewed by the local operator."""

    policy_version: int
    policy_sha256: str


class ExportSetupPerson(BaseModel):
    username: str
    display_name: str
    email: Optional[str] = None
    person_id: Optional[int] = None  # Desktop Person.id for auto-linking
    evidence_subject_id: str


class ExportSetupEvent(BaseModel):
    evidence_id: str
    name: str
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class ExportSetupResponse(BaseModel):
    event: ExportSetupEvent
    users: List[ExportSetupPerson]


# ── Helpers ────────────────────────────────────────────────────────────────

def _get_setting(db: Session, key: str) -> Optional[str]:
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    return row.value if row else None


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(AppSettings(key=key, value=value))


def _policy_ack_key(event_id: int) -> str:
    return f"mp_backend_policy_ack:{event_id}"


def _desktop_operator_subject(db: Session) -> str:
    """Return a local pseudonym without claiming an authenticated human identity."""
    return local_operator_subject(db)


async def _current_server_policy(server_url: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{server_url}/api/v1/governance/public")
        response.raise_for_status()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Cannot verify the Server permitted-data policy",
        ) from exc
    policy = response.json()
    if not policy.get("configured"):
        raise HTTPException(
            status_code=409,
            detail="The Server has not published its permitted-data policy",
        )
    version = policy.get("version")
    digest = policy.get("content_sha256")
    if not isinstance(version, int) or not isinstance(digest, str) or len(digest) != 64:
        raise HTTPException(status_code=502, detail="The Server policy identity is invalid")
    return policy


def _stored_policy_acknowledgement(db: Session, event_id: int) -> dict | None:
    raw = _get_setting(db, _policy_ack_key(event_id))
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


async def _require_current_policy_acknowledgement(
    db: Session,
    event_id: int,
    server_url: str,
) -> dict:
    policy = await _current_server_policy(server_url)
    acknowledgement = _stored_policy_acknowledgement(db, event_id)
    if not acknowledgement or (
        acknowledgement.get("policy_version") != policy["version"]
        or acknowledgement.get("policy_sha256") != policy["content_sha256"]
    ):
        raise HTTPException(
            status_code=428,
            detail={
                "code": "desktop_data_policy_acknowledgement_required",
                "policy_version": policy["version"],
                "policy_sha256": policy["content_sha256"],
                "message": "Review and acknowledge the current exact Server permitted-data policy before publishing.",
            },
        )
    return policy


def _mask(value: str, visible: int = 6) -> str:
    if len(value) <= visible:
        return "****"
    return value[:visible] + "****"


def _get_connection(db: Session, event_id: int) -> tuple[str, str]:
    """Return (server_url, publish_secret) from the event or raise 400 if not configured."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    server_url = event.mp_backend_url
    try:
        secret = _resolve_mp_backend_secret(db, event)
    except SecureCredentialStoreUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not server_url or not secret:
        raise HTTPException(status_code=400, detail="MP-Backend not configured for this event")
    return server_url.rstrip("/"), secret


def _resolve_mp_backend_secret(db: Session, event: Event) -> Optional[str]:
    """Read the current MP publish secret exclusively from secure storage."""
    del db
    return get_secret(mp_backend_secret_key(event.id))


def _normalise_publish_dates(dates: Optional[List[str]]) -> Optional[set[str]]:
    """Validate optional publish day ids and return a set of ISO date strings."""
    if dates is None:
        return None
    normalised: set[str] = set()
    for raw_date in dates:
        try:
            normalised.add(date.fromisoformat(raw_date).isoformat())
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid publish date: {raw_date}",
            )
    return normalised


async def _flush_deletion_outbox(db: Session) -> int:
    """Send durable reports and clear their encrypted bearer material on success."""

    sent = 0
    rows = db.query(DesktopDeletionOutbox).filter(
        DesktopDeletionOutbox.state == "pending",
    ).order_by(DesktopDeletionOutbox.id).all()
    async with httpx.AsyncClient(timeout=20) as client:
        for row in rows:
            row.attempts += 1
            try:
                response = await client.post(
                    f"{row.server_url}/api/v1/publish/deletion-work-orders/{row.work_order_id}/report",
                    headers={
                        "Authorization": f"Bearer {row.publish_secret}",
                        "X-Deletion-Claim": str(row.claim_capability),
                        "Content-Type": "application/json",
                    },
                    content=row.report_json,
                )
            except httpx.HTTPError:
                row.last_error_code = "network_error"
                continue
            if response.status_code == 200:
                row.state = "sent"
                row.sent_at = datetime.now(timezone.utc)
                row.publish_secret = None
                row.claim_capability = None
                row.last_error_code = None
                sent += 1
            else:
                row.last_error_code = f"http_{response.status_code}"
    db.commit()
    return sent


def _general_schedule_fingerprint(items: list[dict]) -> str:
    """Hash the public fields used by the frontend's publish confidence state."""
    fingerprint_items = []
    for item in items:
        view_ids = item.get("schedule_view_ids") or []
        view_names = item.get("schedule_view_names") or []
        fingerprint_items.append({
            "id": item["id"],
            "title": item["title"],
            "type_id": item.get("type_id"),
            "date": item["date"],
            "start_time": item["start_time"],
            "end_time": item["end_time"],
            "location_name": _normalise_fingerprint_text(item.get("location_name")),
            "location_address": _normalise_fingerprint_text(
                item.get("location_address")
            ),
            "audience_teams": [
                {
                    "id": team.get("id"),
                    "name": team.get("name"),
                    "short_name": team.get("short_name"),
                    "colour": team.get("colour"),
                }
                for team in (item.get("audience_teams") or [])
            ],
            "schedule_views": [
                {
                    "id": view_id,
                    "name": view_names[index] if index < len(view_names) else "",
                    "sort_order": _browser_json_number(
                        item.get("schedule_view_sort_orders", {}).get(str(view_id), 0)
                    ),
                }
                for index, view_id in enumerate(view_ids)
            ],
            "responsible": _normalise_fingerprint_text(
                item.get("responsible"),
                strip=True,
            ),
            "description": _normalise_fingerprint_text(item.get("description")),
            "colour": item.get("colour"),
            "copy_template_html": _normalise_fingerprint_text(
                item.get("copy_template_html")
            ),
            "sort_order": _browser_json_number(item.get("sort_order")),
        })
    fingerprint_items.sort(key=lambda item: item["id"])
    canonical = json.dumps(fingerprint_items, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _browser_json_number(value: object) -> object:
    """Normalise database floats to the representation used by JSON.stringify."""
    if value is None or value == 0:
        return 0
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _normalise_fingerprint_text(value: object, *, strip: bool = False) -> Optional[str]:
    """Match the browser's empty optional text handling for fingerprint fields."""
    if not isinstance(value, str):
        return None
    normalised = value.strip() if strip else value
    return normalised or None


def _schedule_day_offset_hour(event: Event) -> int:
    """Return the event's validated after-midnight working-day tail."""
    value = (event.meta_data or {}).get("schedule_day_range")
    if not isinstance(value, dict):
        return 0
    try:
        start_hour = int(value.get("startHour"))
        end_hour = int(value.get("endHour"))
    except (TypeError, ValueError):
        return 0
    if not (0 <= start_hour <= 23 and start_hour < end_hour <= 36):
        return 0
    return max(0, end_hour - 24)


def _schedule_day_range(event: Event) -> dict[str, int]:
    """Return the validated schedule display range published to MP-Backend."""
    value = (event.meta_data or {}).get("schedule_day_range")
    if isinstance(value, dict):
        try:
            start_hour = int(value.get("startHour"))
            end_hour = int(value.get("endHour"))
        except (TypeError, ValueError):
            pass
        else:
            if 0 <= start_hour <= 23 and start_hour < end_hour <= 36:
                return {"start_hour": start_hour, "end_hour": end_hour}
    return {"start_hour": 6, "end_hour": 24}


def _schedule_minutes(value: object) -> Optional[int]:
    """Parse an optimiser minute value or a clock string into linear minutes."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if raw.lstrip("-").isdigit():
        return int(raw)
    try:
        hours, minutes = raw.split(":", 1)
        parsed_hours = int(hours)
        parsed_minutes = int(minutes[:2])
    except (TypeError, ValueError):
        return None
    if parsed_minutes < 0 or parsed_minutes >= 60:
        return None
    return parsed_hours * 60 + parsed_minutes


def _task_working_date(
    actual_date: str,
    start_minutes: int,
    boundary_offset_hour: int,
) -> str:
    """Return the working-day identifier for a task's actual date and time."""
    parsed_date = date.fromisoformat(actual_date)
    if start_minutes >= 24 * 60:
        return parsed_date.isoformat()
    if boundary_offset_hour > 0 and start_minutes < boundary_offset_hour * 60:
        parsed_date -= timedelta(days=1)
    return parsed_date.isoformat()


def _linear_task_interval(
    actual_date: str,
    working_date: str,
    start_minutes: int,
    end_minutes: int,
) -> tuple[int, int]:
    """Return task times in minutes relative to its working-day date."""
    day_delta = (date.fromisoformat(actual_date) - date.fromisoformat(working_date)).days
    start = start_minutes if start_minutes >= 24 * 60 else start_minutes + day_delta * 24 * 60
    end = end_minutes if end_minutes >= 24 * 60 else end_minutes + day_delta * 24 * 60
    if end <= start:
        end += 24 * 60
    return start, end


def _local_iso_from_minutes(base_date: str, minutes: int) -> str:
    """Convert linear minutes from a local date into a local ISO datetime."""
    day_offset, clock_minutes = divmod(minutes, 24 * 60)
    actual_date = date.fromisoformat(base_date) + timedelta(days=day_offset)
    hours, minute = divmod(clock_minutes, 60)
    return f"{actual_date.isoformat()}T{hours:02d}:{minute:02d}:00"


def _general_schedule_working_day(
    actual_date: str,
    start_time: str,
    offset_hour: int,
) -> str:
    """Resolve the displayed working day for a Public Schedule item."""
    parsed_date = date.fromisoformat(actual_date)
    parsed_time = datetime.strptime(start_time, "%H:%M")
    if offset_hour > 0 and parsed_time.hour < offset_hour:
        parsed_date -= timedelta(days=1)
    return parsed_date.isoformat()


async def _ensure_scoped_publish_supported(server_url: str, secret: str) -> None:
    """Refuse date-scoped publish against older servers that would full-replace."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{server_url}/api/v1/publish/ping",
                headers={"Authorization": f"Bearer {secret}"},
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Cannot reach MP-Backend server") from None

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Server rejected the publish secret")
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Server capability check failed ({resp.status_code})",
        )

    try:
        data = resp.json()
    except ValueError:
        data = {}
    if data.get("supports_scoped_publish") is not True:
        raise HTTPException(
            status_code=409,
            detail=(
                "This MP-Backend server does not support selected-day publishing yet. "
                "Update the server or publish all days."
            ),
        )


# ── Settings CRUD ──────────────────────────────────────────────────────────

@router.get("/", response_model=MpBackendSettingsResponse)
async def get_mp_backend_settings(event_id: int, db: Session = Depends(get_db)):
    """Get current MP-Backend connection settings for the given event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    server_url = event.mp_backend_url
    try:
        secret = _resolve_mp_backend_secret(db, event)
    except SecureCredentialStoreUnavailable:
        secret = None
    configured = bool(server_url and secret)
    return MpBackendSettingsResponse(
        configured=configured,
        server_url=server_url or None,
        secret_preview=None,
        credential_storage_available=credential_store_available(),
        secret_available=bool(secret),
    )


@router.put("/", response_model=MpBackendSettingsResponse)
async def set_mp_backend_settings(
    payload: MpBackendSettings,
    event_id: int,
    db: Session = Depends(get_db),
):
    """Save or update MP-Backend connection settings for the given event."""
    url = payload.server_url.strip()
    secret = payload.publish_secret.strip()
    if not url or not secret:
        raise HTTPException(status_code=400, detail="Both server_url and publish_secret are required")

    # Enforce HTTPS (allow HTTP only for localhost development)
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme != "https":
        if not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
            raise HTTPException(status_code=400, detail="Server URL must use HTTPS (HTTP allowed only for localhost)")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        set_secret(mp_backend_secret_key(event.id), secret)
    except SecureCredentialStoreUnavailable as e:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(e))
    event.mp_backend_url = url
    db.commit()
    return MpBackendSettingsResponse(
        configured=True,
        server_url=url,
        secret_preview=None,
        credential_storage_available=credential_store_available(),
        secret_available=True,
    )


@router.delete("/")
async def delete_mp_backend_settings(event_id: int, db: Session = Depends(get_db)):
    """Remove MP-Backend connection settings for the given event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        delete_secret(mp_backend_secret_key(event.id))
    except SecureCredentialStoreUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    event.mp_backend_url = None
    db.commit()
    return {"status": "success", "message": "MP-Backend settings removed"}


# ── Ping ───────────────────────────────────────────────────────────────────

@router.post("/ping", response_model=MpBackendPingResponse)
async def ping_mp_backend(event_id: int, db: Session = Depends(get_db)):
    """Test connection to the MP-Backend server."""
    server_url, secret = _get_connection(db, event_id)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{server_url}/api/v1/publish/ping",
                headers={"Authorization": f"Bearer {secret}"},
            )
        if resp.status_code == 200:
            data = resp.json()
            event_ref = data.get("event_ref")
            try:
                event_ref = str(uuid.UUID(event_ref))
            except (TypeError, ValueError, AttributeError):
                return MpBackendPingResponse(status="invalid_event_identity")
            duplicate = db.query(Event).filter(
                Event.evidence_id == event_ref,
                Event.id != event_id,
            ).first()
            if duplicate is not None:
                return MpBackendPingResponse(status="event_identity_conflict")
            event = db.query(Event).filter(Event.id == event_id).one()
            if event.evidence_id != event_ref:
                has_outbox = db.query(DesktopDeletionOutbox).filter(
                    DesktopDeletionOutbox.event_ref == event.evidence_id,
                ).first() is not None
                if has_outbox:
                    return MpBackendPingResponse(status="event_identity_locked")
                event.evidence_id = event_ref
                db.commit()
            return MpBackendPingResponse(
                status="ok",
                event_name=data.get("event_name"),
                event_id=data.get("event_id"),
                event_ref=event_ref,
                supports_scoped_publish=data.get("supports_scoped_publish") is True,
                supports_deletion_work_orders=data.get("supports_deletion_work_orders") is True,
            )
        elif resp.status_code == 401:
            return MpBackendPingResponse(status="auth_failed")
        else:
            return MpBackendPingResponse(status=f"error_{resp.status_code}")
    except httpx.ConnectError:
        return MpBackendPingResponse(status="unreachable")
    except Exception as e:
        logger.warning(f"MP-Backend ping failed: {e}")
        return MpBackendPingResponse(status="error")


@router.post(
    "/deletion-work-orders/{event_id}/sync",
    response_model=DeletionWorkOrderSyncResponse,
)
async def sync_deletion_work_orders(
    event_id: int,
    db: Session = Depends(get_db),
):
    """Claim server work orders, erase locally, and retry durable reports."""

    reports_sent = await _flush_deletion_outbox(db)
    event = db.query(Event).filter(Event.id == event_id).first()
    if event is None:
        pending = db.query(DesktopDeletionOutbox).filter(
            DesktopDeletionOutbox.state == "pending",
        ).count()
        return DeletionWorkOrderSyncResponse(
            reports_sent=reports_sent,
            reports_pending=pending,
            event_deleted=True,
        )
    server_url, secret = _get_connection(db, event_id)
    headers = {"Authorization": f"Bearer {secret}"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{server_url}/api/v1/publish/deletion-work-orders",
                headers=headers,
            )
            if response.status_code == 401:
                raise HTTPException(status_code=401, detail="Server rejected the publish secret")
            response.raise_for_status()
            work_orders = response.json()
            if not isinstance(work_orders, list):
                raise HTTPException(status_code=502, detail="Server returned an invalid work-order list")
            applied = 0
            event_deleted = False
            for work_order in work_orders:
                if work_order.get("state") not in {"open", "claimed"}:
                    continue
                claim = await client.post(
                    f"{server_url}/api/v1/publish/deletion-work-orders/{work_order.get('work_order_id')}/claim",
                    headers=headers,
                )
                if claim.status_code == 409:
                    continue
                claim.raise_for_status()
                claimed = claim.json()
                if claimed.get("event_ref") != event.evidence_id:
                    raise HTTPException(
                        status_code=409,
                        detail="Server work order does not match this event identity",
                    )
                try:
                    stage_deletion_report(
                        db,
                        work_order=claimed,
                        claim_capability=claimed["claim_capability"],
                        server_url=server_url,
                        publish_secret=secret,
                    )
                    db.commit()
                except (KeyError, ValueError) as exc:
                    db.rollback()
                    raise HTTPException(status_code=409, detail=str(exc)) from exc
                applied += 1
                if claimed.get("operation") == "delete_event":
                    event_deleted = True
                    break
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Server work-order request failed ({exc.response.status_code})",
        ) from exc
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=502, detail="Cannot reach MP-Backend server") from exc
    reports_sent += await _flush_deletion_outbox(db)
    pending = db.query(DesktopDeletionOutbox).filter(
        DesktopDeletionOutbox.state == "pending",
    ).count()
    return DeletionWorkOrderSyncResponse(
        applied=applied,
        reports_sent=reports_sent,
        reports_pending=pending,
        event_deleted=event_deleted,
    )


@router.post(
    "/deletion-work-orders/retry-reports",
    response_model=DeletionWorkOrderSyncResponse,
)
async def retry_deletion_reports(db: Session = Depends(get_db)):
    """Retry durable reports even after their local event has been erased."""

    reports_sent = await _flush_deletion_outbox(db)
    reports_pending = db.query(DesktopDeletionOutbox).filter(
        DesktopDeletionOutbox.state == "pending",
    ).count()
    return DeletionWorkOrderSyncResponse(
        reports_sent=reports_sent,
        reports_pending=reports_pending,
    )


# ── Publish ────────────────────────────────────────────────────────────────

@router.get("/data-policy/{event_id}")
async def server_data_policy(event_id: int, db: Session = Depends(get_db)):
    """Return the current exact Server policy and local pseudonymous ack state."""

    server_url, _secret = _get_connection(db, event_id)
    policy = await _current_server_policy(server_url)
    acknowledgement = _stored_policy_acknowledgement(db, event_id)
    acknowledged = bool(
        acknowledgement
        and acknowledgement.get("policy_version") == policy["version"]
        and acknowledgement.get("policy_sha256") == policy["content_sha256"]
    )
    return {
        "configured": True,
        "policy_version": policy["version"],
        "policy_sha256": policy["content_sha256"],
        "controller_identity": policy.get("controller_legal_name"),
        "purpose": (policy.get("permitted_data") or {}).get("purpose"),
        "allowed": (policy.get("permitted_data") or {}).get("allowed", []),
        "unsupported": (policy.get("permitted_data") or {}).get("unsupported", []),
        "policy_url": f"{server_url}/api/v1/governance/public/versions/{policy['version']}/data-policy.html",
        "privacy_url": f"{server_url}/api/v1/governance/public/versions/{policy['version']}/privacy.html",
        "retention_days": (policy.get("retention") or {}).get("event_grace_days"),
        "enabled_optional_features": [
            item.get("code") for item in policy.get("feature_disclosures", [])
            if item.get("code") not in {"manual_activation", "dns_only_routing"}
        ],
        "incident_contact": policy.get("incident_contact_email"),
        "acknowledged": acknowledged,
        "operator_subject": acknowledgement.get("operator_subject") if acknowledged else None,
    }


@router.post("/data-policy/{event_id}/acknowledge")
async def acknowledge_server_data_policy(
    event_id: int,
    body: DataPolicyAcknowledgementRequest,
    db: Session = Depends(get_db),
):
    """Record an exact local acknowledgement without asserting human identity."""

    server_url, _secret = _get_connection(db, event_id)
    policy = await _current_server_policy(server_url)
    if (
        body.policy_version != policy["version"]
        or body.policy_sha256.lower() != policy["content_sha256"]
    ):
        raise HTTPException(
            status_code=409,
            detail="The Server policy changed. Review its current exact version.",
        )
    acknowledgement = {
        "policy_version": policy["version"],
        "policy_sha256": policy["content_sha256"],
        "operator_subject": _desktop_operator_subject(db),
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }
    _set_setting(db, _policy_ack_key(event_id), json.dumps(acknowledgement, sort_keys=True))
    db.commit()
    return {"acknowledged": True, **acknowledgement}

@router.post("/publish/{event_id}", response_model=MpBackendPublishResponse)
async def publish_to_mp_backend(
    event_id: int,
    payload: Optional[MpBackendPublishRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    """
    Publish the given event's schedule data to the MP-Backend server.
    Gathers tasks (with resolved person names and locations), persons (with emails),
    and current event metadata, then POSTs the exact contract to the server's
    /publish endpoint.
    If dates are supplied, only tasks on those event days are included.
    """
    server_url, secret = _get_connection(db, event_id)

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    schedule_day_range = _schedule_day_range(event)
    working_day_offset_hour = max(0, schedule_day_range["end_hour"] - 24)

    requested_dates = _normalise_publish_dates(payload.dates if payload else None)
    await _require_current_policy_acknowledgement(db, event_id, server_url)
    if requested_dates is not None:
        await _ensure_scoped_publish_supported(server_url, secret)

    # ── Gather data ────────────────────────────────────────────────
    persons = db.query(Person).filter(Person.event_id == event_id).all()
    persons_by_id: Dict[int, Person] = {p.id: p for p in persons}
    person_id_set = set(persons_by_id)
    typed_unavailability = {
        person.id: [
            {"starts_at": row.starts_at.isoformat(), "ends_at": row.ends_at.isoformat()}
            for row in db.query(PersonUnavailability).filter(
                PersonUnavailability.person_id == person.id,
            ).order_by(PersonUnavailability.starts_at, PersonUnavailability.id)
        ]
        for person in persons
    }

    unavailable_by_working_date: dict[str, dict[int, list[tuple[int, int]]]] = {}

    def _availability_for_working_date(working_date: str) -> dict[int, list[tuple[int, int]]]:
        """Return cached, normalised person availability for one working day."""
        if working_date in unavailable_by_working_date:
            return unavailable_by_working_date[working_date]
        availability: dict[int, list[tuple[int, int]]] = {}
        for person in persons:
            intervals, warnings = normalize_unavailable_intervals(
                typed_unavailability[person.id],
                selected_working_date=working_date,
                working_day_boundary_offset_hour=working_day_offset_hour,
            )
            availability[person.id] = intervals
            for warning in warnings:
                logger.warning("Person %s publish availability warning: %s", person.id, warning)
        unavailable_by_working_date[working_date] = availability
        return availability

    def _resolve_publish_person_ids(value) -> list[int]:
        """Resolve task person fields to concrete IDs for external publishing."""
        if isinstance(value, int):
            value = [value]
        if not isinstance(value, list):
            return []
        resolved_ids, warnings = resolve_group_member_person_ids(
            value,
            db,
            person_id_set,
            event_id,
        )
        for warning in warnings:
            logger.warning("Publish person field resolution warning: %s", warning)
        return resolved_ids

    locations = db.query(Location).filter(Location.event_id == event_id).all()
    locations_by_id: Dict[int, Location] = {loc.id: loc for loc in locations}

    tasks_query = db.query(Task).filter(Task.event_id == event_id)
    tasks = tasks_query.all()
    task_schedule: dict[int, tuple[str, int, int, str, str]] = {}
    for task in tasks:
        effective = task.final if task.final else (task.optimised if task.optimised else {})
        constraints = task.constraints or {}
        task_date = (task.additional or {}).get("date")
        raw_start = effective.get("start_time")
        if raw_start is None:
            raw_start = constraints.get("start_time", 0)
        raw_end = effective.get("end_time")
        if raw_end is None:
            raw_end = constraints.get("end_time", 0)
        start_minutes = _schedule_minutes(raw_start)
        end_minutes = _schedule_minutes(raw_end)
        if not task_date or start_minutes is None or end_minutes is None:
            continue
        try:
            working_date = _task_working_date(
                task_date,
                start_minutes,
                working_day_offset_hour,
            )
            linear_start, linear_end = _linear_task_interval(
                task_date,
                working_date,
                start_minutes,
                end_minutes,
            )
        except ValueError:
            continue
        task_schedule[task.id] = (
            working_date,
            linear_start,
            linear_end,
            _local_iso_from_minutes(working_date, linear_start),
            _local_iso_from_minutes(working_date, linear_end),
        )
    if requested_dates is not None:
        tasks = [
            task
            for task in tasks
            if task_schedule.get(task.id, (None,))[0] in requested_dates
        ]
    task_types = {tt.id: tt for tt in db.query(TaskType).all()}
    task_templates = {t.id: t for t in db.query(TaskTemplate).all()}

    assignments = db.query(Assignment).filter(Assignment.event_id == event_id).all()
    # Group assignments by task_id
    assignments_by_task: Dict[int, List[Assignment]] = {}
    for a in assignments:
        if a.task_id:
            assignments_by_task.setdefault(a.task_id, []).append(a)

    # ── Build payload ──────────────────────────────────────────────
    persons_payload = [
        {
            "id": p.id,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "email": p.email,
            "evidence_subject_id": p.evidence_subject_id,
        }
        for p in persons
    ]

    tasks_payload = []
    for task in tasks:
        # Resolve the effective schedule: final > optimised > constraints
        effective = task.final if task.final else (task.optimised if task.optimised else {})
        constraints = task.constraints or {}
        additional = task.additional or {}

        schedule_values = task_schedule.get(task.id)
        if schedule_values is None:
            logger.warning("Skipping task %s because its publish interval is invalid", task.id)
            continue
        working_date, task_start, task_end, start_dt, end_dt = schedule_values
        person_unavailability = _availability_for_working_date(working_date)

        # Resolve location
        loc_id = effective.get("location") or constraints.get("location")
        loc = locations_by_id.get(loc_id) if loc_id else None

        # Resolve task type
        tt = task_types.get(task.task_type_id)

        # Resolve attendees from assignments after structured fields are corrected.
        task_assignments = assignments_by_task.get(task.id, [])

        # Build field_assignments from template fields
        field_assignments = None
        field_values_resolved = None
        field_definitions_out = None
        runtime_represented_person_ids: set[int] = set()
        runtime_excluded_person_ids: set[int] = set()
        structured_person_field_ids: set[str] = set()
        tmpl = task_templates.get(task.task_template_id) if task.task_template_id else None
        if tmpl and tmpl.fields:
            field_assignments = {}
            field_values_resolved = {}
            field_definitions_out = []
            raw_field_values = (task.constraints or {}).get("field_values", {})

            for field in tmpl.fields:
                try:
                    published_definition = reviewed_publish_definition(field)
                except ValueError as exc:
                    raise HTTPException(status_code=409, detail=str(exc)) from exc
                if published_definition is None:
                    continue
                field_id = field.get("id", "")
                field_name = field.get("name", field_id)
                field_type = field.get("type", "")
                field_category = field.get("category", "")

                # Export field definition (id, name, type)
                field_definitions_out.append(published_definition)

                # Resolve field value depending on type
                if field_type == "persons_list":
                    structured_person_field_ids.add(field_id)
                    final_fa = (task.final or {}).get("field_assignments", {}).get(field_id)
                    optim_fa = (task.optimised or {}).get("field_assignments", {}).get(field_id)
                    raw_fa = raw_field_values.get(field_id)
                    source_value = (
                        raw_fa
                        if isinstance(raw_fa, list)
                        else final_fa or optim_fa or []
                    )
                    resolved_assignment = resolve_group_assignment_for_task(
                        source_value,
                        db,
                        person_id_set,
                        event_id=event_id,
                        person_unavailable_intervals=person_unavailability,
                        task_start=task_start,
                        task_end=task_end,
                    )
                    person_ids = resolved_assignment.person_ids
                    runtime_represented_person_ids.update(person_ids)
                    runtime_represented_person_ids.update(
                        excluded.person_id
                        for excluded in resolved_assignment.excluded_persons
                    )
                    runtime_excluded_person_ids.update(
                        excluded.person_id
                        for excluded in resolved_assignment.excluded_persons
                    )
                    for warning in resolved_assignment.warnings:
                        logger.warning(
                            "Task %s field %s group resolution warning: %s",
                            task.id,
                            field_id,
                            warning,
                        )
                    if person_ids:
                        field_persons = []
                        for pid in person_ids:
                            p = persons_by_id.get(pid)
                            if p:
                                field_persons.append({
                                    "name": f"{p.first_name} {p.last_name}",
                                    "person_id": p.id,
                                })
                        if field_persons:
                            field_assignments[field_id] = field_persons

                elif field_type == "capabilities_list":
                    caps = raw_field_values.get(field_id, [])
                    if caps:
                        field_values_resolved[field_id] = caps

                elif field_type == "location":
                    loc_val = raw_field_values.get(field_id)
                    loc_id = loc_val if isinstance(loc_val, int) else (loc_val.get("value") if isinstance(loc_val, dict) else None)
                    if loc_id:
                        resolved_loc = locations_by_id.get(loc_id)
                        if resolved_loc:
                            field_values_resolved[field_id] = {
                                "name": resolved_loc.name,
                                "address": getattr(resolved_loc, "address", None),
                            }
                        else:
                            field_values_resolved[field_id] = {"name": str(loc_id), "address": None}

                elif field_type == "duration":
                    # Duration may be in schedule output or field_values
                    dur = (
                        (task.final or {}).get(field_id)
                        or (task.optimised or {}).get(field_id)
                        or raw_field_values.get(field_id)
                    )
                    if dur is not None:
                        field_values_resolved[field_id] = dur

                elif field_type in ("start_end_time", "time_range"):
                    # Already represented by start/end; include raw for reference
                    val = raw_field_values.get(field_id)
                    if val is not None:
                        field_values_resolved[field_id] = val

                else:
                    # text, number, link, and any other type  -  pass through raw value
                    val = raw_field_values.get(field_id)
                    if val is not None and val != "" and val != []:
                        field_values_resolved[field_id] = val

            # --- Resolve person assignments from schedule.field_assignments ---
            # The optimiser may assign persons to fields of any type (e.g.
            # capabilities_list fields that represent roles like Front-Orga).
            # Resolve those person IDs and override the field type so the web
            # knows they contain persons.
            schedule_fa = (
                (task.final or {}).get("field_assignments")
                or (task.optimised or {}).get("field_assignments")
                or {}
            )
            if schedule_fa:
                # Build a quick lookup for field_definitions_out by id
                def_idx = {d["id"]: i for i, d in enumerate(field_definitions_out)}
                for fa_field_id, fa_person_ids in schedule_fa.items():
                    if fa_field_id in structured_person_field_ids:
                        continue  # already resolved via the availability-aware branch
                    fa_person_ids = _resolve_publish_person_ids(fa_person_ids)
                    if fa_field_id == "field_Assigned" and runtime_represented_person_ids:
                        fa_person_ids = [
                            person_id
                            for person_id in fa_person_ids
                            if person_id not in runtime_represented_person_ids
                        ]
                    if not fa_person_ids:
                        continue
                    field_persons = []
                    for pid in fa_person_ids:
                        p = persons_by_id.get(pid)
                        if p:
                            field_persons.append({
                                "name": f"{p.first_name} {p.last_name}",
                                "person_id": p.id,
                            })
                    if field_persons:
                        field_assignments[fa_field_id] = field_persons
                        # Override the type in field_definitions so the web
                        # renders them as person fields
                        if fa_field_id in def_idx:
                            field_definitions_out[def_idx[fa_field_id]]["type"] = "persons_list"
                        else:
                            field_assignments.pop(fa_field_id, None)

        effective_field_person_ids: set[int] = set()
        attendees_by_id: dict[int, dict[str, object]] = {}
        for field_people in (field_assignments or {}).values():
            for field_person in field_people:
                person_id = int(field_person["person_id"])
                effective_field_person_ids.add(person_id)
                attendees_by_id.setdefault(person_id, field_person)
        for assignment in task_assignments:
            person_id = assignment.person_id
            if (
                person_id in runtime_excluded_person_ids
                and person_id not in effective_field_person_ids
            ):
                continue
            person = persons_by_id.get(person_id)
            if person:
                attendees_by_id.setdefault(person_id, {
                    "name": f"{person.first_name} {person.last_name}",
                    "person_id": person.id,
                })
        attendees = list(attendees_by_id.values())

        tasks_payload.append({
            "id": task.id,
            "name": task.title,
            "description": task.description,
            "start": start_dt,
            "end": end_dt,
            "location_name": loc.name if loc else None,
            "location_address": getattr(loc, "address", None) if loc else None,
            "task_type_code": tt.name if tt else None,
            "task_type_name": tt.name if tt else None,
            "color": tt.color if tt else None,
            "attendees": attendees,
            "field_assignments": field_assignments if field_assignments else None,
            "field_values": field_values_resolved if field_values_resolved else None,
            "field_definitions": field_definitions_out if field_definitions_out else None,
            "sort_order": 0,
        })

    # Extract day aliases from event meta_data
    meta = event.meta_data or {}
    day_aliases = meta.get("day_aliases")  # Dict[str, str] e.g. {"2026-08-28": "Arrival Day"}

    if requested_dates is not None:
        availability_dates = sorted(requested_dates)
    else:
        availability_date_set = {
            values[0]
            for values in task_schedule.values()
        }
        if event.start_date and event.end_date:
            cursor = event.start_date
            while cursor <= event.end_date:
                availability_date_set.add(cursor.isoformat())
                cursor += timedelta(days=1)
        availability_dates = sorted(availability_date_set)

    unavailabilities_payload: list[dict[str, object]] = []
    for working_date in availability_dates:
        for person_id, intervals in _availability_for_working_date(working_date).items():
            for unavailable_start, unavailable_end in intervals:
                unavailabilities_payload.append({
                    "person_id": person_id,
                    "working_date": working_date,
                    "start": _local_iso_from_minutes(working_date, unavailable_start),
                    "end": _local_iso_from_minutes(working_date, unavailable_end),
                })

    payload = {
        "contract_version": PUBLISH_CONTRACT_VERSION,
        "event": {
            "name": event.name,
            "start_date": event.start_date.isoformat() if event.start_date else None,
            "end_date": event.end_date.isoformat() if event.end_date else None,
            "day_aliases": day_aliases,
            "schedule_day_range": schedule_day_range,
        },
        "tasks": tasks_payload,
        "persons": persons_payload,
        "unavailabilities": unavailabilities_payload,
        "publish_scope": "dates" if requested_dates is not None else "full",
    }
    if requested_dates is not None:
        payload["dates"] = sorted(requested_dates)

    # ── POST to server ─────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{server_url}/api/v1/publish/publish",
                headers={
                    "Authorization": f"Bearer {secret}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        logger.info(f"MP-Backend response: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            return MpBackendPublishResponse(
                status="ok",
                tasks_created=data.get("tasks_created", 0),
                persons_created=data.get("persons_created", 0),
                edits_cleared=data.get("edits_cleared", 0),
            )
        elif resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Server rejected the publish secret")
        elif resp.status_code == 422:
            detail = resp.text[:500] if resp.text else "Validation error"
            logger.warning(f"MP-Backend 422 validation error: {detail}")
            raise HTTPException(status_code=502, detail=f"Server validation error: {detail}")
        else:
            detail = resp.text[:500] if resp.text else f"HTTP {resp.status_code}"
            logger.warning(f"MP-Backend error {resp.status_code}: {detail}")
            raise HTTPException(status_code=502, detail=f"Server error ({resp.status_code}): {detail}")
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Cannot reach MP-Backend server")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("MP-Backend publish failed")
        raise HTTPException(status_code=500, detail=f"Publish failed: {e}")


@router.post("/publish-general-schedule/{event_id}", response_model=GeneralSchedulePublishResponse)
async def publish_general_schedule_to_mp_backend(
    event_id: int,
    request: Optional[GeneralSchedulePublishRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    """Publish all or selected working days of the Public Schedule."""
    server_url, secret = _get_connection(db, event_id)
    requested_dates = _normalise_publish_dates(request.dates) if request else None
    if request and request.dates is not None and not requested_dates:
        raise HTTPException(
            status_code=400,
            detail="Selected-day Public Schedule publishing requires a date.",
        )

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    working_day_offset_hour = _schedule_day_offset_hour(event)

    teams = {
        team.id: team
        for team in db.query(AudienceTeam).filter(AudienceTeam.event_id == event_id).all()
    }
    categories = {
        category.id: category
        for category in db.query(AudienceCategory).filter(AudienceCategory.event_id == event_id).all()
    }
    schedule_views = {
        view.id: view
        for view in db.query(ScheduleView).filter(ScheduleView.event_id == event_id).all()
    }
    session_types = {
        session_type.id: session_type
        for session_type in db.query(SessionElementType).filter(SessionElementType.event_id == event_id).all()
    }
    locations = {
        location.id: location
        for location in db.query(Location).filter(Location.event_id == event_id).all()
    }
    persons = {
        person.id: person
        for person in db.query(Person).filter(Person.event_id == event_id).all()
    }
    elements = (
        db.query(SessionElement)
        .filter(SessionElement.event_id == event_id, SessionElement.visibility == "public")
        .order_by(SessionElement.date, SessionElement.start_time, SessionElement.sort_order, SessionElement.title)
        .all()
    )

    public_items: list[dict] = []
    for element in elements:
        location = locations.get(element.location_id) if element.location_id else None
        location_name = (
            location.name.strip()
            if location and location.name and location.name.strip()
            else None
        )
        location_address = (
            location.address.strip()
            if location and location.address and location.address.strip()
            else None
        )
        responsible_person = (
            persons.get(element.responsible_person_id)
            if element.responsible_person_id
            else None
        )
        audience_teams = []
        schedule_view_ids = []
        schedule_view_names = []
        seen_view_ids = set()
        for view_id in element.schedule_view_ids or []:
            view = schedule_views.get(view_id)
            if view and view.id not in seen_view_ids:
                seen_view_ids.add(view.id)
                schedule_view_ids.append(view.id)
                schedule_view_names.append(view.name)
        if not schedule_view_ids:
            continue
        category_ids = []
        category_names = []
        seen_category_ids = set()
        for team_id in element.attendee_team_ids or []:
            team = teams.get(team_id)
            if not team:
                continue
            category = categories.get(team.category_id) if team.category_id else None
            if category and category.id not in seen_category_ids:
                seen_category_ids.add(category.id)
                category_ids.append(category.id)
                category_names.append(category.name)
            audience_teams.append({
                "id": team.id,
                "name": team.name,
                "short_name": team.short_name,
                "colour": team.colour,
                "category_id": category.id if category else None,
                "category_name": category.name if category else None,
            })
        session_type = session_types.get(element.session_element_type_id) if element.session_element_type_id else None
        public_items.append({
            "id": element.id,
            "type_id": session_type.id if session_type else None,
            "type_name": session_type.name if session_type else None,
            "title": element.title,
            "date": element.date,
            "start_time": element.start_time,
            "end_time": element.end_time,
            "location_name": location_name,
            "location_address": location_address,
            "audience_teams": audience_teams,
            "schedule_view_ids": schedule_view_ids,
            "schedule_view_names": schedule_view_names,
            "schedule_view_sort_orders": {
                str(view_id): schedule_views[view_id].sort_order or 0
                for view_id in schedule_view_ids
            },
            "category_ids": category_ids,
            "category_names": category_names,
            "responsible": (
                f"{responsible_person.first_name} {responsible_person.last_name}".strip()
                if responsible_person
                else (element.responsible_text or None)
            ),
            "description": element.description,
            "colour": _session_element_colour(session_type.colour if session_type else None),
            "copy_template_html": session_type.copy_template_html if session_type else None,
            "sort_order": element.sort_order or 0,
        })

    items_by_day: dict[str, list[dict]] = {}
    for item in public_items:
        working_day = _general_schedule_working_day(
            item["date"],
            item["start_time"],
            working_day_offset_hour,
        )
        items_by_day.setdefault(working_day, []).append(item)

    event_days: list[str] = []
    if event.start_date and event.end_date:
        cursor = event.start_date
        while cursor <= event.end_date:
            event_days.append(cursor.isoformat())
            cursor += timedelta(days=1)
    all_day_ids = sorted(set(event_days) | set(items_by_day))
    affected_day_ids = sorted(requested_dates) if requested_dates is not None else all_day_ids
    publish_items = (
        [
            item
            for item in public_items
            if _general_schedule_working_day(
                item["date"],
                item["start_time"],
                working_day_offset_hour,
            ) in requested_dates
        ]
        if requested_dates is not None
        else public_items
    )
    day_fingerprints = {
        day_id: _general_schedule_fingerprint(items_by_day.get(day_id, []))
        for day_id in all_day_ids
    }
    full_fingerprint = _general_schedule_fingerprint(public_items)
    fingerprint = _general_schedule_fingerprint(publish_items)
    published_at = datetime.now(timezone.utc).isoformat()
    meta = event.meta_data or {}
    payload = {
        "event": {
            "name": event.name,
            "start_date": event.start_date.isoformat() if event.start_date else None,
            "end_date": event.end_date.isoformat() if event.end_date else None,
            "day_aliases": meta.get("day_aliases"),
            "schedule_day_range": _schedule_day_range(event),
        },
        "categories": [
            {
                "id": view.id,
                "name": view.name,
                "sort_order": view.sort_order or 0,
            }
            for view in sorted(schedule_views.values(), key=lambda c: ((c.sort_order or 0), c.name))
        ],
        "schedule_views": [
            {
                "id": view.id,
                "name": view.name,
                "sort_order": view.sort_order or 0,
            }
            for view in sorted(schedule_views.values(), key=lambda c: ((c.sort_order or 0), c.name))
        ],
        "fingerprint": fingerprint,
        "published_at": published_at,
        "publish_scope": "dates" if requested_dates is not None else "full",
        "dates": affected_day_ids if requested_dates is not None else None,
        "items": publish_items,
    }

    state = (
        db.query(GeneralSchedulePublishState)
        .filter(GeneralSchedulePublishState.event_id == event_id)
        .first()
    )
    if state is None:
        state = GeneralSchedulePublishState(event_id=event_id, day_records={})
        db.add(state)

    def record_failure(message: str) -> None:
        """Persist failure metadata for only the days attempted by this request."""
        failed_at = datetime.now(timezone.utc).isoformat()
        records = dict(state.day_records or {})
        for day_id in affected_day_ids:
            previous = records.get(day_id, {})
            records[day_id] = {
                "fingerprint": previous.get("fingerprint"),
                "published_at": previous.get("published_at"),
                "publish_failed_at": failed_at,
                "failure_message": message,
                "item_count": int(previous.get("item_count") or 0),
            }
        state.day_records = records
        state.publish_failed_at = failed_at
        state.last_error = message
        db.commit()

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{server_url}/api/v1/publish/general-schedule",
                headers={
                    "Authorization": f"Bearer {secret}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.status_code == 200:
            data = resp.json()
            records = {} if requested_dates is None else dict(state.day_records or {})
            for day_id in affected_day_ids:
                records[day_id] = {
                    "fingerprint": day_fingerprints.get(
                        day_id,
                        _general_schedule_fingerprint([]),
                    ),
                    "published_at": published_at,
                    "publish_failed_at": None,
                    "failure_message": None,
                    "item_count": len(items_by_day.get(day_id, [])),
                }
            remaining_failures = [
                record
                for record in records.values()
                if isinstance(record, dict) and record.get("publish_failed_at")
            ]
            all_days_current = all(
                records.get(day_id, {}).get("fingerprint") == day_fingerprints[day_id]
                for day_id in all_day_ids
            )
            state.fingerprint = full_fingerprint if all_days_current else None
            state.published_at = published_at
            state.publish_failed_at = max(
                (record["publish_failed_at"] for record in remaining_failures),
                default=None,
            )
            state.item_count = sum(
                int(record.get("item_count") or 0)
                for record in records.values()
                if isinstance(record, dict)
            )
            state.last_error = (
                max(
                    remaining_failures,
                    key=lambda record: record["publish_failed_at"],
                ).get("failure_message")
                if remaining_failures
                else None
            )
            state.day_records = records
            db.commit()
            return GeneralSchedulePublishResponse(
                status="ok",
                items_published=data.get("items_published", len(publish_items)),
                fingerprint=fingerprint,
                published_at=published_at,
            )
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Server rejected the publish secret")
        detail = resp.text[:500] if resp.text else f"HTTP {resp.status_code}"
        raise HTTPException(status_code=502, detail=f"Server error ({resp.status_code}): {detail}")
    except HTTPException as exc:
        record_failure(str(exc.detail))
        raise
    except httpx.ConnectError:
        record_failure("Cannot reach MP-Backend server")
        raise HTTPException(status_code=502, detail="Cannot reach MP-Backend server") from None
    except Exception as exc:
        record_failure(f"Publish failed: {exc}")
        logger.exception("General Schedule publish failed")
        raise HTTPException(status_code=500, detail=f"Publish failed: {exc}") from exc


# ── Export Server Setup ────────────────────────────────────────────────────

@router.get("/export-setup/{event_id}", response_model=ExportSetupResponse)
async def export_server_setup(event_id: int, db: Session = Depends(get_db)):
    """
    Generate a JSON payload that can be imported on the MP-Backend server
    to bootstrap the event, users, and activation links.
    Persons become suggested user accounts (username = email or first.last).
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    persons = db.query(Person).filter(Person.event_id == event_id).all()

    users = []
    seen_usernames: set[str] = set()
    for p in persons:
        # Derive a username: prefer email, else first.last
        if p.email:
            username = p.email
        else:
            username = f"{p.first_name.lower()}.{p.last_name.lower()}".replace(" ", "")

        # Deduplicate
        base = username
        counter = 2
        while username in seen_usernames:
            username = f"{base}{counter}"
            counter += 1
        seen_usernames.add(username)

        users.append(ExportSetupPerson(
            username=username,
            display_name=f"{p.first_name} {p.last_name}",
            email=p.email,
            person_id=p.id,
            evidence_subject_id=p.evidence_subject_id,
        ))

    return ExportSetupResponse(
        event=ExportSetupEvent(
            evidence_id=event.evidence_id,
            name=event.name,
            location=event.location,
            start_date=event.start_date.isoformat() if event.start_date else None,
            end_date=event.end_date.isoformat() if event.end_date else None,
        ),
        users=users,
    )
