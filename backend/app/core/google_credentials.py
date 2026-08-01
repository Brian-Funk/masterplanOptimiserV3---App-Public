"""Google credential helpers that keep secrets outside SQLite."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.secure_credentials import (
    SecureCredentialStoreUnavailable,
    delete_secret,
    get_secret,
    google_access_token_key,
    google_oauth_client_secret_key,
    google_refresh_token_key,
    set_secret,
)
from app.models.app_settings import AppSettings
from app.models.google_calendar import GoogleCalendarConnection

_SECRET_TOKEN_FIELDS = {"access_token", "refresh_token", "client_secret"}
_GOOGLE_CLIENT_ID_KEY = "google_client_id"


def _normalise_scopes(value: Any) -> list[str] | None:
    if isinstance(value, list):
        return [str(item) for item in value]
    return None


def sanitize_token_metadata(
    token_data: dict[str, Any] | None,
    connection_id: int | None,
) -> dict[str, Any]:
    """Return non-secret Google token metadata safe for SQLite."""
    token_data = token_data or {}
    metadata: dict[str, Any] = {
        "token_uri": token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
        "client_id": token_data.get("client_id") or settings.GOOGLE_CLIENT_ID,
        "scopes": _normalise_scopes(token_data.get("scopes")),
        "expiry": token_data.get("expiry"),
    }
    if connection_id:
        metadata["access_token_ref"] = google_access_token_key(connection_id)
        metadata["refresh_token_ref"] = google_refresh_token_key(connection_id)
    return {key: value for key, value in metadata.items() if value is not None}


def _delete_app_setting(db: Session, key: str) -> None:
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    if row:
        db.delete(row)


def get_google_client_id(db: Session | None = None) -> str:
    """Read non-secret Google OAuth client id from DB/settings."""
    client_id = settings.GOOGLE_CLIENT_ID
    if db is None:
        return client_id
    row = db.query(AppSettings).filter(AppSettings.key == _GOOGLE_CLIENT_ID_KEY).first()
    if row and row.value:
        return row.value
    return client_id


def get_google_client_secret(db: Session | None = None) -> str:
    """Read the Google OAuth client secret from current secure storage."""
    del db
    return get_secret(google_oauth_client_secret_key()) or settings.GOOGLE_CLIENT_SECRET


def set_google_oauth_credentials(db: Session, client_id: str, client_secret: str) -> None:
    """Store OAuth client id in DB and client secret in secure storage."""
    set_secret(google_oauth_client_secret_key(), client_secret)
    row = db.query(AppSettings).filter(AppSettings.key == _GOOGLE_CLIENT_ID_KEY).first()
    if row:
        row.value = client_id
    else:
        db.add(AppSettings(key=_GOOGLE_CLIENT_ID_KEY, value=client_id))


def delete_google_oauth_credentials(db: Session) -> None:
    """Delete stored Google OAuth client id and secure client secret."""
    delete_secret(google_oauth_client_secret_key())
    db.query(AppSettings).filter(
        AppSettings.key == _GOOGLE_CLIENT_ID_KEY
    ).delete(synchronize_session=False)


def google_oauth_configured(db: Session) -> tuple[bool, str | None, bool]:
    """Return configured flag, client id preview source, and secret availability."""
    client_id = get_google_client_id(db)
    try:
        client_secret = get_google_client_secret(db)
    except SecureCredentialStoreUnavailable:
        client_secret = ""
    return bool(client_id and client_secret), client_id or None, bool(client_secret)


def store_connection_token_secrets(
    connection: GoogleCalendarConnection,
    token_data: dict[str, Any],
) -> None:
    """Persist only token values in secure storage and sanitize DB metadata."""
    if not connection.id:
        raise ValueError("Google connection must have an id before storing token secrets.")

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    client_secret = token_data.get("client_secret")
    if access_token:
        set_secret(google_access_token_key(connection.id), str(access_token))
    if refresh_token:
        set_secret(google_refresh_token_key(connection.id), str(refresh_token))
    if client_secret:
        set_secret(google_oauth_client_secret_key(), str(client_secret))
    connection.token_data = sanitize_token_metadata(token_data, connection.id)


def delete_connection_token_secrets(connection_id: int) -> None:
    """Delete access and refresh tokens for one Google connection."""
    delete_secret(google_access_token_key(connection_id))
    delete_secret(google_refresh_token_key(connection_id))


def get_connection_token_data(
    db: Session,
    connection: GoogleCalendarConnection,
) -> dict[str, Any]:
    """Hydrate Google token metadata with secret values from secure storage."""
    token_data = dict(connection.token_data or {})
    if any(field in token_data for field in _SECRET_TOKEN_FIELDS):
        raise SecureCredentialStoreUnavailable(
            "Retired database-stored Google credentials are unsupported. Reconnect Google Calendar."
        )

    metadata = sanitize_token_metadata(token_data, connection.id)
    if metadata != token_data:
        connection.token_data = metadata
        db.commit()
        db.refresh(connection)

    access_token = get_secret(google_access_token_key(connection.id))
    refresh_token = get_secret(google_refresh_token_key(connection.id))
    client_secret = get_google_client_secret(db)

    if not access_token:
        raise SecureCredentialStoreUnavailable(
            "Google Calendar credentials are missing. Reconnect Google Calendar."
        )

    full_token_data = dict(connection.token_data or metadata)
    full_token_data["access_token"] = access_token
    if refresh_token:
        full_token_data["refresh_token"] = refresh_token
    if client_secret:
        full_token_data["client_secret"] = client_secret
    full_token_data["client_id"] = (
        full_token_data.get("client_id") or get_google_client_id(db)
    )
    return full_token_data


def persist_refreshed_connection_tokens(
    db: Session,
    connection: GoogleCalendarConnection,
    refreshed_token_data: dict[str, Any],
) -> None:
    """Persist refreshed access token and non-secret expiry metadata."""
    store_connection_token_secrets(connection, refreshed_token_data)
    db.commit()
    db.refresh(connection)
