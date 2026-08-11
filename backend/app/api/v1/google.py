"""
Google Calendar API Endpoints
Handles OAuth2 connection, calendar selection, and publishing to Google Calendar.
"""
import logging
from typing import Optional, List, Dict, Any
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.db.database import get_db
from app.models.google_calendar import GoogleCalendarConnection
from app.models.event import Event
from app.models.task import Task, TaskType
from app.models.task_template import TaskTemplate
from app.models.person import Person
from app.models.location import Location
from app.models.calendar_export_format import CalendarExportFormat
from app.core.google_calendar_service import (
    create_auth_url,
    exchange_code_for_token,
    list_calendars,
    list_calendar_members,
    publish_day_to_calendar,
    get_event_colors,
)
from app.core.google_credentials import (
    delete_connection_token_secrets,
    get_connection_token_data,
    persist_refreshed_connection_tokens,
    sanitize_token_metadata,
    store_connection_token_secrets,
)
from app.core.secure_credentials import SecureCredentialStoreUnavailable

logger = logging.getLogger(__name__)
router = APIRouter()


def _credential_http_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=str(exc) or "Secure credential storage is unavailable.",
    )


def _persist_google_token_update(db: Session, connection: GoogleCalendarConnection):
    def _persist(token_data: dict) -> None:
        persist_refreshed_connection_tokens(db, connection, token_data)

    return _persist


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConnectResponse(BaseModel):
    """OAuth authorisation URL and state returned when starting Google connect."""

    auth_url: str
    state: str


class OAuthCallbackRequest(BaseModel):
    """Authorisation code and state returned from Google's OAuth redirect."""

    code: str
    state: str


class ConnectionResponse(BaseModel):
    """Stored Google Calendar account connection exposed to the frontend."""

    id: int
    account_email: str
    calendar_id: Optional[str] = None
    calendar_name: Optional[str] = None


class CalendarInfo(BaseModel):
    """Calendar metadata returned by the Google Calendar API."""

    id: str
    summary: str
    description: str = ""
    primary: bool = False
    accessRole: str = ""


class CalendarMember(BaseModel):
    """Access-control entry for a Google Calendar member."""

    email: str
    role: str


class SetCalendarRequest(BaseModel):
    """Calendar selection payload for a stored Google connection."""

    calendar_id: str
    calendar_name: Optional[str] = None


class PublishRequest(BaseModel):
    """Google Calendar publish request for one event and optional date subset."""

    event_id: int
    dates: Optional[List[str]] = None        # Specific dates to publish (YYYY-MM-DD); if null, publish all days


class PublishDayResult(BaseModel):
    """Per-day Google Calendar publish result."""

    date: str
    deleted: int
    created: int
    errors: List[str] = Field(default_factory=list)


class PublishResponse(BaseModel):
    """Aggregate Google Calendar publish response."""

    status: str
    results: List[PublishDayResult]
    events_created: int


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

@router.get("/connections", response_model=List[ConnectionResponse])
async def get_connections(db: Session = Depends(get_db)):
    """Get all Google Calendar connections."""
    connections = db.query(GoogleCalendarConnection).all()

    # Try to re-resolve any "unknown" account emails using stored tokens
    for conn in connections:
        if conn.account_email == "unknown" and conn.token_data:
            try:
                from google.oauth2.credentials import Credentials
                from googleapiclient.discovery import build
                token_data = get_connection_token_data(db, conn)
                creds = Credentials(
                    token=token_data.get("access_token"),
                    refresh_token=token_data.get("refresh_token"),
                    token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
                    client_id=token_data.get("client_id"),
                    client_secret=token_data.get("client_secret"),
                )
                service = build("calendar", "v3", credentials=creds)
                primary = service.calendarList().get(calendarId="primary").execute()
                resolved = primary.get("id")
                if resolved and resolved != "unknown":
                    conn.account_email = resolved
                    db.commit()
                    db.refresh(conn)
                    logger.info(f"Re-resolved account email for connection {conn.id}: {resolved}")
            except SecureCredentialStoreUnavailable as e:
                logger.debug(f"Could not load secure Google tokens for connection {conn.id}: {e}")
            except Exception as e:
                logger.debug(f"Could not re-resolve email for connection {conn.id}: {e}")

    return connections


@router.post("/connect", response_model=ConnectResponse)
async def start_connect():
    """Start OAuth2 flow  -  returns the Google authorisation URL."""
    try:
        logger.info("POST /connect called  -  creating auth URL")
        auth_url, state = create_auth_url()
        logger.info("Auth URL created")
        return ConnectResponse(auth_url=auth_url, state=state)
    except Exception as e:
        logger.exception("Failed to create auth URL")
        raise HTTPException(status_code=500, detail=f"Failed to create auth URL: {e}")


@router.get("/oauth2callback")
async def oauth2_callback_redirect(code: str = Query(...), state: str = Query(...)):
    """
    GET handler for the Google OAuth2 redirect.
    Serves a small HTML page that posts the authorisation code back to the
    opener (Electron / browser) window via postMessage, then closes itself.
    """
    import json
    from fastapi.responses import HTMLResponse
    logger.info("GET /oauth2callback - received OAuth redirect")
    code_json = json.dumps(code)
    state_json = json.dumps(state)
    html = f"""<!DOCTYPE html>
<html><head><title>Connecting...</title></head>
<body>
<p>Authenticating with Google&hellip; this window will close automatically.</p>
<script>
  var msg = {{
    type: "google-calendar-callback",
    code: {code_json},
    state: {state_json}
  }};
  if (window.opener) {{
    window.opener.postMessage(msg, "*");
    setTimeout(function() {{ window.close(); }}, 1500);
  }} else {{
    // Electron may not set window.opener  -  try BroadcastChannel as fallback
    try {{
      var bc = new BroadcastChannel("google-oauth");
      bc.postMessage(msg);
      bc.close();
      setTimeout(function() {{ window.close(); }}, 1500);
    }} catch(e) {{
      document.body.innerHTML = "<p>Connection successful. Please close this window and return to the app.</p>";
    }}
  }}
</script>
</body></html>"""
    return HTMLResponse(content=html)


@router.post("/oauth2callback", response_model=ConnectionResponse)
async def oauth2_callback(
    request: OAuthCallbackRequest,
    db: Session = Depends(get_db),
):
    """Exchange authorisation code for tokens and store the connection."""
    logger.info("POST /oauth2callback called")
    try:
        token_data = exchange_code_for_token(request.code, request.state)
        logger.info("Token exchange succeeded")
    except ValueError as e:
        logger.warning(f"Token exchange rejected: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Token exchange failed")
        raise HTTPException(status_code=400, detail=f"Failed to exchange code: {e}")

    # Get account email via Calendar API (primary calendar id == user email)
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        token=token_data["access_token"],
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
    )
    account_email = "unknown"
    try:
        service = build("calendar", "v3", credentials=creds)
        primary = service.calendarList().get(calendarId="primary").execute()
        account_email = primary.get("id", "unknown")
        logger.info(f"Got account email from Calendar API: {account_email}")
    except Exception as e:
        logger.warning(f"Failed to get account email from Calendar API: {e}")

    # Fallback: try Google OAuth2 userinfo endpoint
    if account_email == "unknown":
        try:
            import requests as http_requests
            resp = http_requests.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
                timeout=10,
            )
            if resp.ok:
                userinfo = resp.json()
                account_email = userinfo.get("email", "unknown")
                logger.info(f"Got account email from userinfo: {account_email}")
        except Exception as e2:
            logger.warning(f"Failed to get account email from userinfo: {e2}")

    # Check if connection already exists for this email
    existing = db.query(GoogleCalendarConnection).filter(
        GoogleCalendarConnection.account_email == account_email
    ).first()

    if existing:
        try:
            store_connection_token_secrets(existing, token_data)
            db.commit()
            db.refresh(existing)
            return existing
        except SecureCredentialStoreUnavailable as e:
            db.rollback()
            raise _credential_http_error(e)
    else:
        connection = GoogleCalendarConnection(
            account_email=account_email,
            token_data=sanitize_token_metadata(token_data, None),
        )
        try:
            db.add(connection)
            db.flush()
            store_connection_token_secrets(connection, token_data)
            db.commit()
            db.refresh(connection)
            return connection
        except SecureCredentialStoreUnavailable as e:
            db.rollback()
            raise _credential_http_error(e)


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(connection_id: int, db: Session = Depends(get_db)):
    """Remove a Google Calendar connection."""
    connection = db.query(GoogleCalendarConnection).filter(
        GoogleCalendarConnection.id == connection_id
    ).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        delete_connection_token_secrets(connection.id)
    except SecureCredentialStoreUnavailable as e:
        raise _credential_http_error(e)
    db.delete(connection)
    db.commit()


# ---------------------------------------------------------------------------
# Calendar listing & selection
# ---------------------------------------------------------------------------

@router.get("/calendars", response_model=List[CalendarInfo])
async def get_calendars(
    connection_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """List all calendars for a Google account connection."""
    connection = db.query(GoogleCalendarConnection).filter(
        GoogleCalendarConnection.id == connection_id
    ).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        token_data = get_connection_token_data(db, connection)
        cals = list_calendars(
            token_data,
            on_token_update=_persist_google_token_update(db, connection),
        )
        return cals
    except SecureCredentialStoreUnavailable as e:
        raise _credential_http_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list calendars: {e}")


@router.get("/calendar-members", response_model=List[CalendarMember])
async def get_calendar_members(
    connection_id: int = Query(...),
    calendar_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """List people who have access to a specific calendar."""
    connection = db.query(GoogleCalendarConnection).filter(
        GoogleCalendarConnection.id == connection_id
    ).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        token_data = get_connection_token_data(db, connection)
        members = list_calendar_members(
            token_data,
            calendar_id,
            on_token_update=_persist_google_token_update(db, connection),
        )
        return members
    except SecureCredentialStoreUnavailable as e:
        raise _credential_http_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list calendar members: {e}")


@router.put("/connections/{connection_id}/calendar")
async def set_calendar(
    connection_id: int,
    request: SetCalendarRequest,
    db: Session = Depends(get_db),
):
    """Set the selected calendar for a connection."""
    connection = db.query(GoogleCalendarConnection).filter(
        GoogleCalendarConnection.id == connection_id
    ).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    connection.calendar_id = request.calendar_id
    connection.calendar_name = request.calendar_name
    db.commit()
    db.refresh(connection)
    return {"status": "ok", "calendar_id": connection.calendar_id}


@router.get("/colors")
async def get_calendar_colors(db: Session = Depends(get_db)):
    """Fetch available event colours from Google Calendar API."""
    connection = db.query(GoogleCalendarConnection).first()
    if not connection:
        return []
    try:
        token_data = get_connection_token_data(db, connection)
        colors = get_event_colors(
            token_data,
            on_token_update=_persist_google_token_update(db, connection),
        )
        return colors
    except SecureCredentialStoreUnavailable as e:
        raise _credential_http_error(e)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch colours: {e}")


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------

@router.post("/publish", response_model=PublishResponse)
async def publish_to_calendar(
    request: PublishRequest,
    db: Session = Depends(get_db),
):
    """
    Publish tasks to Google Calendar.
    If dates are specified, publish only those days.
    Otherwise, publish all days of the event.
    Deletes existing events for each day before writing.
    """
    event = db.query(Event).filter(Event.id == request.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    logger.info(f"Publish request: event_id={request.event_id}, dates={request.dates}")
    logger.info(
        "Event selected for Google publish: id=%s, name=%s, has_calendar=%s",
        event.id,
        event.name,
        bool(event.google_calendar_id),
    )

    if not event.google_calendar_id:
        raise HTTPException(status_code=400, detail="Event has no Google Calendar associated")

    # Find the connection for this calendar
    connection = db.query(GoogleCalendarConnection).filter(
        GoogleCalendarConnection.calendar_id == event.google_calendar_id
    ).first()
    if not connection:
        raise HTTPException(
            status_code=400,
            detail="No Google Calendar connection found for this event's calendar"
        )

    # Get all tasks for this event
    tasks = db.query(Task).filter(Task.event_id == event.id).all()

    # Build lookup dicts
    persons = db.query(Person).filter(Person.event_id == event.id).all()
    persons_by_id = {
        p.id: {
            "id": p.id,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "email": p.email,
            "google_email": p.google_email,
        }
        for p in persons
    }

    locations = db.query(Location).filter(Location.event_id == event.id).all()
    locations_by_id = {
        loc.id: {
            "id": loc.id,
            "name": loc.name,
            "address": loc.address,
        }
        for loc in locations
    }

    # Load export formats and task types for templating
    all_formats = db.query(CalendarExportFormat).all()
    export_formats_by_type = {
        f.task_type_id: {
            "title_template": f.title_template,
            "description_template": f.description_template,
            "color_id": f.color_id,
        }
        for f in all_formats
    }
    all_task_types = db.query(TaskType).all()
    task_types_by_id = {
        tt.id: {"id": tt.id, "name": tt.name, "color": tt.color}
        for tt in all_task_types
    }

    # Load task templates for field variable mapping
    all_templates = db.query(TaskTemplate).all()
    templates_by_id = {
        t.id: {"id": t.id, "fields": t.fields}
        for t in all_templates
    }

    # Determine which dates to publish
    if request.dates:
        target_dates = [date.fromisoformat(d) for d in request.dates]
    else:
        # All days of the event
        if not event.start_date or not event.end_date:
            raise HTTPException(status_code=400, detail="Event must have start and end dates")
        target_dates = []
        current = event.start_date
        while current <= event.end_date:
            target_dates.append(current)
            current += __import__("datetime").timedelta(days=1)

    # Group tasks by date
    tasks_by_date: Dict[str, list] = {}
    for task in tasks:
        additional = task.additional or {}
        task_date = additional.get("date")
        if task_date:
            tasks_by_date.setdefault(task_date, []).append(task)

    logger.info(f"Total tasks: {len(tasks)}, target_dates: {[d.isoformat() for d in target_dates]}")
    logger.info(f"Tasks grouped by date: { {k: len(v) for k, v in tasks_by_date.items()} }")

    # Publish each day
    results = []
    for target in target_dates:
        day_tasks = tasks_by_date.get(target.isoformat(), [])
        logger.info(f"Publishing {len(day_tasks)} tasks for {target.isoformat()}")
        task_dicts = [
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "task_type_id": t.task_type_id,
                "task_template_id": t.task_template_id,
                "constraints": t.constraints,
                "optimised": t.optimised,
                "final": t.final,
                "additional": t.additional,
                "is_floating": t.is_floating,
                "is_transfer": t.is_transfer,
            }
            for t in day_tasks
        ]

        try:
            token_data = get_connection_token_data(db, connection)
        except SecureCredentialStoreUnavailable as e:
            raise _credential_http_error(e)

        result = publish_day_to_calendar(
            token_data=token_data,
            calendar_id=event.google_calendar_id,
            target_date=target,
            tasks=task_dicts,
            persons_by_id=persons_by_id,
            locations_by_id=locations_by_id,
            export_formats=export_formats_by_type,
            task_types_by_id=task_types_by_id,
            templates_by_id=templates_by_id,
            on_token_update=_persist_google_token_update(db, connection),
        )
        results.append(PublishDayResult(**result))

    # Update event status to published
    event.status = "published"
    db.commit()

    events_created = sum(result.created for result in results)
    return PublishResponse(status="success", results=results, events_created=events_created)
