"""
Google Calendar Service
Handles OAuth2 authentication, calendar listing, and publishing tasks to Google Calendar.
"""
import logging
import time
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.config import settings
from app.core.google_credentials import get_google_client_id, get_google_client_secret

logger = logging.getLogger(__name__)

# In-memory store for PKCE code_verifiers, keyed by OAuth state.
# Entries are consumed (popped) after token exchange.
_OAUTH_STATE_TTL_SECONDS = 10 * 60
_pending_verifiers: dict[str, tuple[Optional[str], float]] = {}

# OAuth2 scopes needed
SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
]

# Client config for installed/desktop app flow
CLIENT_CONFIG = {
    "installed": {
        "client_id": "",       # Set via GOOGLE_CLIENT_ID env var
        "client_secret": "",   # Set via GOOGLE_CLIENT_SECRET env var
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["http://localhost:8000/api/v1/google/oauth2callback"],
    }
}


def _get_client_config() -> dict:
    """Build client config from DB metadata and secure credential storage."""
    config = dict(CLIENT_CONFIG)
    config["installed"] = dict(config["installed"])

    client_id = settings.GOOGLE_CLIENT_ID
    client_secret = settings.GOOGLE_CLIENT_SECRET
    try:
        from app.db.database import SessionLocal
        db = SessionLocal()
        try:
            client_id = get_google_client_id(db)
            client_secret = get_google_client_secret(db)
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Could not read OAuth credentials, using env vars: {e}")

    config["installed"]["client_id"] = client_id
    config["installed"]["client_secret"] = client_secret
    return config


def create_auth_url() -> tuple[str, str]:
    """
    Create an OAuth2 authorisation URL.
    Returns (auth_url, state) tuple.
    """
    flow = Flow.from_client_config(
        _get_client_config(),
        scopes=SCOPES,
        redirect_uri=CLIENT_CONFIG["installed"]["redirect_uris"][0],
    )
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    # Store the PKCE code_verifier so exchange_code_for_token can use it
    code_verifier = flow.code_verifier
    _cleanup_pending_verifiers()
    _pending_verifiers[state] = (code_verifier, time.time() + _OAUTH_STATE_TTL_SECONDS)
    if not code_verifier:
        logger.warning("Flow did not generate a code_verifier (PKCE disabled?)")
    return auth_url, state


def _cleanup_pending_verifiers() -> None:
    now = time.time()
    expired = [state for state, (_, expires_at) in _pending_verifiers.items() if expires_at <= now]
    for state in expired:
        _pending_verifiers.pop(state, None)


def _consume_code_verifier(state: str) -> Optional[str]:
    if not state:
        raise ValueError("Missing OAuth state")
    _cleanup_pending_verifiers()
    entry = _pending_verifiers.pop(state, None)
    if not entry:
        raise ValueError("Unknown or expired OAuth state")
    code_verifier, expires_at = entry
    if expires_at <= time.time():
        raise ValueError("Expired OAuth state")
    return code_verifier


def exchange_code_for_token(code: str, state: str = "") -> dict:
    """
    Exchange an authorisation code for tokens.
    Returns token data dict (access_token, refresh_token, etc.).
    """
    config = _get_client_config()
    redirect_uri = CLIENT_CONFIG["installed"]["redirect_uris"][0]
    logger.info("exchange_code_for_token: redirect_uri=%s, client_id set=%s, client_secret set=%s",
                redirect_uri, bool(config['installed']['client_id']), bool(config['installed']['client_secret']))
    flow = Flow.from_client_config(
        config,
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )
    # Restore the PKCE code_verifier from the auth step
    code_verifier = _consume_code_verifier(state)
    if code_verifier:
        flow.code_verifier = code_verifier
        logger.info("Restored code_verifier for this exchange")
    else:
        logger.warning("No code_verifier found for state  -  PKCE may fail")
    try:
        flow.fetch_token(code=code)
    except Exception as e:
        logger.error(f"flow.fetch_token FAILED: {type(e).__name__}: {e}")
        raise
    creds = flow.credentials
    logger.info(f"Token exchange success  -  has refresh_token: {bool(creds.refresh_token)}")
    return {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes) if creds.scopes else SCOPES,
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }


def _get_credentials(token_data: dict) -> Credentials:
    """Build Credentials object from stored token data."""
    return Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=token_data.get("client_id", settings.GOOGLE_CLIENT_ID),
        client_secret=token_data.get("client_secret", settings.GOOGLE_CLIENT_SECRET),
        scopes=token_data.get("scopes", SCOPES),
    )


def _get_calendar_service(token_data: dict):
    """Build a Google Calendar API service and return it with credentials."""
    creds = _get_credentials(token_data)
    return build("calendar", "v3", credentials=creds), creds


def _token_data_from_credentials(token_data: dict, creds: Credentials) -> dict:
    """Return token metadata updated from a possibly refreshed Credentials object."""
    updated = dict(token_data)
    if creds.token:
        updated["access_token"] = creds.token
    if creds.refresh_token:
        updated["refresh_token"] = creds.refresh_token
    if creds.expiry:
        updated["expiry"] = creds.expiry.isoformat()
    return updated


def list_calendars(token_data: dict, on_token_update=None) -> List[Dict[str, Any]]:
    """List all calendars accessible to the authenticated user."""
    service, creds = _get_calendar_service(token_data)
    result = service.calendarList().list().execute()
    if on_token_update:
        on_token_update(_token_data_from_credentials(token_data, creds))
    calendars = []
    for cal in result.get("items", []):
        calendars.append({
            "id": cal["id"],
            "summary": cal.get("summary", ""),
            "description": cal.get("description", ""),
            "primary": cal.get("primary", False),
            "accessRole": cal.get("accessRole", ""),
        })
    return calendars


def list_calendar_members(
    token_data: dict,
    calendar_id: str,
    on_token_update=None,
) -> List[Dict[str, str]]:
    """List people who have access to a calendar (ACL entries with email)."""
    service, creds = _get_calendar_service(token_data)
    result = service.acl().list(calendarId=calendar_id).execute()
    if on_token_update:
        on_token_update(_token_data_from_credentials(token_data, creds))
    members = []
    for rule in result.get("items", []):
        scope = rule.get("scope", {})
        if scope.get("type") == "user":
            members.append({
                "email": scope.get("value", ""),
                "role": rule.get("role", ""),
            })
    return members


def get_event_colors(token_data: dict, on_token_update=None) -> List[Dict[str, Any]]:
    """Fetch available event colours from Google Calendar API."""
    service, creds = _get_calendar_service(token_data)
    result = service.colors().get().execute()
    if on_token_update:
        on_token_update(_token_data_from_credentials(token_data, creds))
    colors = []
    event_colors = result.get("event", {})
    for color_id, color_data in sorted(event_colors.items(), key=lambda x: int(x[0])):
        colors.append({
            "id": color_id,
            "background": color_data.get("background", ""),
            "foreground": color_data.get("foreground", ""),
        })
    return colors


def publish_day_to_calendar(
    token_data: dict,
    calendar_id: str,
    target_date: date,
    tasks: List[Dict[str, Any]],
    persons_by_id: Dict[int, Dict[str, Any]],
    locations_by_id: Dict[int, Dict[str, Any]],
    export_formats: Optional[Dict[int, Dict[str, Any]]] = None,
    task_types_by_id: Optional[Dict[int, Dict[str, Any]]] = None,
    templates_by_id: Optional[Dict[int, Dict[str, Any]]] = None,
    on_token_update=None,
) -> Dict[str, Any]:
    """
    Publish tasks for a single day to Google Calendar.
    1. Delete all events for target_date in this calendar
    2. Create new events from tasks

    Returns summary of created/deleted events.
    """
    service, creds = _get_calendar_service(token_data)

    logger.info("publish_day_to_calendar: date=%s, tasks=%s", target_date, len(tasks))

    # Get calendar timezone so events are created in the correct local time
    cal_timezone = "UTC"
    try:
        calendar_info = service.calendars().get(calendarId=calendar_id).execute()
        cal_timezone = calendar_info.get("timeZone", "UTC")
        logger.info(f"Calendar timezone: {cal_timezone}")
    except HttpError as e:
        logger.warning(f"Failed to get calendar timezone, defaulting to UTC: {e}")

    # Define time boundaries for the day using the calendar's timezone
    # so the query window matches the timezone events were created in.
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(cal_timezone)
        day_start = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=tz)
        day_end = datetime.combine(target_date + timedelta(days=1), datetime.min.time()).replace(tzinfo=tz)
        time_min = day_start.isoformat()
        time_max = day_end.isoformat()
    except Exception:
        # Fallback to UTC if timezone parsing fails
        time_min = datetime.combine(target_date, datetime.min.time()).isoformat() + "Z"
        time_max = datetime.combine(target_date + timedelta(days=1), datetime.min.time()).isoformat() + "Z"

    logger.info(f"Deleting events between {time_min} and {time_max}")

    # Step 1: Delete ALL existing events for this day (paginate to catch everything)
    deleted_count = 0
    try:
        page_token = None
        while True:
            events_result = service.events().list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                maxResults=2500,
                pageToken=page_token,
            ).execute()

            for event in events_result.get("items", []):
                try:
                    service.events().delete(
                        calendarId=calendar_id,
                        eventId=event["id"],
                    ).execute()
                    deleted_count += 1
                except HttpError as e:
                    logger.warning(f"Failed to delete event {event['id']}: {e}")

            page_token = events_result.get("nextPageToken")
            if not page_token:
                break
    except HttpError as e:
        logger.error(f"Failed to list events for deletion: {e}")

    # Step 2: Create new events from tasks
    created_count = 0
    errors = []

    for task in tasks:
        try:
            # Build field_id → variable name mapping for this task's template
            field_id_to_var = None
            tmpl_id = task.get("task_template_id")
            if templates_by_id and tmpl_id and tmpl_id in templates_by_id:
                tmpl = templates_by_id[tmpl_id]
                field_id_to_var = {}
                for f in (tmpl.get("fields") or []):
                    fid = f.get("id", "")
                    fname = f.get("name", fid)
                    if fid:
                        field_id_to_var[fid] = f"field.{_sanitize_field_name(fname)}"

            gcal_event = _task_to_gcal_event(
                task, target_date, persons_by_id, locations_by_id,
                export_formats=export_formats or {},
                task_types_by_id=task_types_by_id or {},
                field_id_to_var=field_id_to_var,
                cal_timezone=cal_timezone,
            )
            if gcal_event:
                created_event = service.events().insert(
                    calendarId=calendar_id,
                    body=gcal_event,
                    supportsAttachments=False,
                ).execute()
                created_count += 1
                logger.info(f"  Created GCal event: id={created_event.get('id')}, summary={gcal_event.get('summary')!r}")
            else:
                logger.debug(f"  Task '{task.get('title')}' (id={task.get('id')}): _task_to_gcal_event returned None, skipping")
        except HttpError as e:
            errors.append(f"Failed to create event for task '{task.get('title', '?')}': {e}")
            logger.error(f"Failed to create calendar event (HttpError): {e}")
        except Exception as e:
            errors.append(f"Failed to create event for task '{task.get('title', '?')}': {e}")
            logger.error(f"Failed to create calendar event (unexpected): {e}", exc_info=True)

    logger.info(f"publish_day_to_calendar result: date={target_date}, deleted={deleted_count}, created={created_count}, errors={len(errors)}")
    if errors:
        for err in errors:
            logger.error(f"  Publish error: {err}")

    if on_token_update:
        on_token_update(_token_data_from_credentials(token_data, creds))

    return {
        "date": target_date.isoformat(),
        "deleted": deleted_count,
        "created": created_count,
        "errors": errors,
    }


def _interpolate_template(template: str, variables: Dict[str, str]) -> str:
    """Replace {variable_name} placeholders with actual values."""
    import re
    def replacer(match):
        key = match.group(1)
        return variables.get(key, match.group(0))
    return re.sub(r'\{([^}]+)\}', replacer, template)


def _sanitize_field_name(name: str) -> str:
    """Convert a human field name to a safe variable key."""
    import re as _re
    s = name.lower().strip()
    s = _re.sub(r'[^a-z0-9]+', '_', s)
    s = s.strip('_')
    return s or "field"


def _format_field_value(val: Any) -> str:
    """Format a template field value to a human-readable string."""
    if isinstance(val, dict):
        if 'start' in val and 'end' in val:
            return f"{val['start']} - {val['end']}"
        return str(val)
    if isinstance(val, list):
        return ", ".join(str(item) for item in val)
    return str(val) if val is not None else ""


# Google Calendar colour IDs mapped to their approximate hex values
_GCAL_COLORS = {
    "1": "#7986CB",   # Lavender
    "2": "#33B679",   # Sage
    "3": "#8E24AA",   # Grape
    "4": "#E67C73",   # Flamingo
    "5": "#F6BF26",   # Banana
    "6": "#F4511E",   # Tangerine
    "7": "#039BE5",   # Peacock
    "8": "#616161",   # Graphite
    "9": "#3F51B5",   # Blueberry
    "10": "#0B8043",  # Basil
    "11": "#D50000",  # Tomato
}


def _hex_to_closest_gcal_color_id(hex_color: str) -> Optional[str]:
    """Find the closest Google Calendar colour ID (1-11) for a hex colour."""
    hex_color = hex_color.strip().lstrip("#")
    if len(hex_color) < 6:
        return None
    try:
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
    except ValueError:
        return None

    best_id = None
    best_dist = float("inf")
    for cid, chex in _GCAL_COLORS.items():
        cr = int(chex[1:3], 16)
        cg = int(chex[3:5], 16)
        cb = int(chex[5:7], 16)
        dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
        if dist < best_dist:
            best_dist = dist
            best_id = cid
    return best_id


def _build_template_variables(
    task: Dict[str, Any],
    target_date: date,
    persons_by_id: Dict[int, Dict[str, Any]],
    locations_by_id: Dict[int, Dict[str, Any]],
    task_types_by_id: Dict[int, Dict[str, Any]],
    field_id_to_var: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build the variable dict for template interpolation."""
    final = task.get("final") or task.get("optimised") or {}
    additional = task.get("additional") or {}
    constraints = task.get("constraints") or {}

    # Location info
    location_id = final.get("location_id") or final.get("location")
    location_name = ""
    location_address = ""
    if location_id:
        loc = locations_by_id.get(int(location_id), {})
        location_name = loc.get("name", "")
        location_address = loc.get("address", "")

    # For transfers, use destination location
    if task.get("is_transfer"):
        dest_id = final.get("destination_location_id") or final.get("end_location")
        if dest_id:
            dest = locations_by_id.get(int(dest_id), {})
            location_name = dest.get("name", location_name)
            location_address = dest.get("address", location_address)

    # Persons
    assigned_persons = final.get("assigned_persons", [])
    person_names = []
    for pid in assigned_persons:
        try:
            person = persons_by_id.get(int(pid))
            if person:
                person_names.append(f"{person.get('first_name', '')} {person.get('last_name', '')}".strip())
        except (TypeError, ValueError):
            pass


    # Task type name
    task_type_id = task.get("task_type_id")
    task_type_name = ""
    if task_type_id and task_type_id in task_types_by_id:
        task_type_name = task_types_by_id[task_type_id].get("name", "")

    variables = {
        "title": task.get("title", ""),
        "task_type": task_type_name,
        "description": task.get("description", "") or "",
        "location": location_name,
        "location_address": location_address,
        "start_time": _minutes_to_time_str(final.get("start_time")) or "",
        "end_time": _minutes_to_time_str(final.get("end_time")) or "",
        "date": target_date.isoformat(),
        "persons": ", ".join(person_names) if person_names else "",
    }

    # Add template-defined fields from constraints.field_values
    field_values = constraints.get("field_values", {})
    if field_id_to_var and field_values:
        for fid, var_name in field_id_to_var.items():
            val = field_values.get(fid)
            if val is not None:
                variables[var_name] = _format_field_value(val)

    # Add per-person phone variables (person.<sanitized_name>.phone)
    for pid, person in persons_by_id.items():
        first = person.get("first_name", "")
        last = person.get("last_name", "")
        sanitized = _sanitize_field_name(f"{first} {last}")
        phone = person.get("phone") or ""
        variables[f"person.{sanitized}.phone"] = phone

    return variables


def _minutes_to_time_str(val: Any) -> Optional[str]:
    """Convert a time value to HH:MM string.
    Accepts: int (minutes from midnight, e.g. 420 → '07:00'),
             or string already in HH:MM format.
    Returns None if the value cannot be parsed.
    """
    if val is None:
        return None
    if isinstance(val, (int, float)):
        minutes = int(val)
        h, m = divmod(minutes, 60)
        return f"{h:02d}:{m:02d}"
    s = str(val).strip()
    if ":" in s:
        return s
    # Try parsing as integer string
    try:
        minutes = int(s)
        h, m = divmod(minutes, 60)
        return f"{h:02d}:{m:02d}"
    except ValueError:
        return s


def _task_to_gcal_event(
    task: Dict[str, Any],
    target_date: date,
    persons_by_id: Dict[int, Dict[str, Any]],
    locations_by_id: Dict[int, Dict[str, Any]],
    export_formats: Dict[int, Dict[str, Any]] = {},
    task_types_by_id: Dict[int, Dict[str, Any]] = {},
    field_id_to_var: Optional[Dict[str, str]] = None,
    cal_timezone: str = "UTC",
) -> Optional[Dict[str, Any]]:
    """Convert a task dict to a Google Calendar event body."""
    final = task.get("final") or task.get("optimised") or {}
    if not final:
        logger.debug(f"Task '{task.get('title')}' (id={task.get('id')}): no final/optimised data, skipping")
        return None

    # Parse times  -  may be int (minutes from midnight) or "HH:MM" string
    start_time_str = _minutes_to_time_str(final.get("start_time"))
    end_time_str = _minutes_to_time_str(final.get("end_time"))
    if not start_time_str or not end_time_str:
        logger.debug(
            f"Task '{task.get('title')}' (id={task.get('id')}): missing start/end time "
            f"(raw: start={final.get('start_time')!r}, end={final.get('end_time')!r}), skipping"
        )
        return None

    logger.info(
        f"Building GCal event for task '{task.get('title')}' (id={task.get('id')}): "
        f"{start_time_str}-{end_time_str} on {target_date}"
    )

    # Build datetime strings
    start_dt = f"{target_date.isoformat()}T{start_time_str}:00"
    end_dt = f"{target_date.isoformat()}T{end_time_str}:00"

    # Build template variables
    template_vars = _build_template_variables(
        task, target_date, persons_by_id, locations_by_id, task_types_by_id,
        field_id_to_var=field_id_to_var,
    )

    # Location
    location_str = template_vars.get("location_address") or template_vars.get("location", "")

    # For transfers, use destination
    if task.get("is_transfer"):
        dest_id = final.get("destination_location_id") or final.get("end_location")
        if dest_id:
            dest = locations_by_id.get(int(dest_id), {})
            location_str = dest.get("address") or dest.get("name", location_str)

    # Attendees (persons with google_email)
    attendees = []
    assigned_persons = final.get("assigned_persons", [])
    for pid in assigned_persons:
        try:
            person = persons_by_id.get(int(pid))
            if person and person.get("google_email"):
                attendees.append({"email": person["google_email"]})
        except (TypeError, ValueError):
            pass

    # Check for export format template
    task_type_id = task.get("task_type_id")
    fmt = export_formats.get(task_type_id) if task_type_id else None

    if fmt:
        # Use templated title and description
        summary = _interpolate_template(fmt.get("title_template", "{title}"), template_vars)
        # Strip HTML tags from summary (GCal title is plain text)
        import re as _re
        summary = _re.sub(r'<[^>]+>', '', summary)
        description = _interpolate_template(fmt.get("description_template", ""), template_vars)
        # Convert newlines to <br> when description contains HTML tags
        if '<' in description:
            description = description.replace('\n', '<br>')
    else:
        # Fallback: original behaviour
        summary = task.get("title", "Untitled Task")
        additional = task.get("additional") or {}
        description_parts = []
        if task.get("description"):
            description_parts.append(task["description"])
        notes = additional.get("notes") or additional.get("description")
        if notes:
            description_parts.append(notes)

        description = "\n".join(description_parts) if description_parts else ""

    event_body: Dict[str, Any] = {
        "summary": summary or "Untitled Task",
        "start": {"dateTime": start_dt, "timeZone": cal_timezone},
        "end": {"dateTime": end_dt, "timeZone": cal_timezone},
        "description": description,
    }

    if location_str:
        event_body["location"] = location_str

    if attendees:
        event_body["attendees"] = attendees

    # Apply colour: prefer export format, fall back to closest match from task type hex colour
    if fmt and fmt.get("color_id"):
        event_body["colorId"] = fmt["color_id"]
    else:
        task_type_id = task.get("task_type_id")
        task_type = task_types_by_id.get(task_type_id) if task_type_id else None
        if task_type and task_type.get("color"):
            closest = _hex_to_closest_gcal_color_id(task_type["color"])
            if closest:
                event_body["colorId"] = closest

    return event_body
