"""
App Settings API Endpoints
Manages application-wide configuration like Google OAuth credentials
and solver tuning parameters.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Literal, Optional

from app.db.database import get_db
from app.models.app_settings import AppSettings
from app.core.google_credentials import (
    delete_google_oauth_credentials,
    google_oauth_configured,
    set_google_oauth_credentials,
)
from app.core.secure_credentials import (
    SecureCredentialStoreUnavailable,
    credential_store_available,
)

router = APIRouter()

# ──────────────────────────────────────────────────────────────
# Solver Settings
# ──────────────────────────────────────────────────────────────

# Default values (must match compute/src/fatigue_optimizer.py defaults)
SOLVER_DEFAULTS = {
    "solver_max_time_seconds": 30.0,
    "solver_break_threshold_min": 30,
    "solver_break_recovery_bonus": -3.0,
    "solver_fatigue_scale": 100,
}


class SolverSettingsPayload(BaseModel):
    """Writable solver tuning values supplied by the settings UI."""

    max_time_seconds: float = Field(ge=1, le=3600, default=30.0)
    break_threshold_min: int = Field(ge=1, le=240, default=30)
    break_recovery_bonus: float = Field(ge=-100, le=0, default=-3.0)
    fatigue_scale: int = Field(ge=1, le=10000, default=100)


class SolverSettingsResponse(BaseModel):
    """Solver tuning values returned to the frontend."""

    max_time_seconds: float
    break_threshold_min: int
    break_recovery_bonus: float
    fatigue_scale: int


def get_solver_settings(db: Session) -> dict:
    """Read solver settings from AppSettings table, falling back to defaults."""
    result = {}
    for key, default in SOLVER_DEFAULTS.items():
        row = db.query(AppSettings).filter(AppSettings.key == key).first()
        if row and row.value is not None:
            # Coerce to the correct type based on the default
            try:
                if isinstance(default, float):
                    result[key] = float(row.value)
                elif isinstance(default, int):
                    result[key] = int(float(row.value))
                else:
                    result[key] = row.value
            except (ValueError, TypeError):
                result[key] = default
        else:
            result[key] = default
    return result


@router.get("/solver", response_model=SolverSettingsResponse)
async def get_solver_settings_endpoint(db: Session = Depends(get_db)):
    """Get current solver tuning parameters."""
    s = get_solver_settings(db)
    return SolverSettingsResponse(
        max_time_seconds=s["solver_max_time_seconds"],
        break_threshold_min=s["solver_break_threshold_min"],
        break_recovery_bonus=s["solver_break_recovery_bonus"],
        fatigue_scale=s["solver_fatigue_scale"],
    )


@router.put("/solver", response_model=SolverSettingsResponse)
async def set_solver_settings(payload: SolverSettingsPayload, db: Session = Depends(get_db)):
    """Save solver tuning parameters."""
    mapping = {
        "solver_max_time_seconds": str(payload.max_time_seconds),
        "solver_break_threshold_min": str(payload.break_threshold_min),
        "solver_break_recovery_bonus": str(payload.break_recovery_bonus),
        "solver_fatigue_scale": str(payload.fatigue_scale),
    }
    for key, value in mapping.items():
        row = db.query(AppSettings).filter(AppSettings.key == key).first()
        if row:
            row.value = value
        else:
            db.add(AppSettings(key=key, value=value))
    db.commit()
    return SolverSettingsResponse(
        max_time_seconds=payload.max_time_seconds,
        break_threshold_min=payload.break_threshold_min,
        break_recovery_bonus=payload.break_recovery_bonus,
        fatigue_scale=payload.fatigue_scale,
    )


@router.delete("/solver")
async def reset_solver_settings(db: Session = Depends(get_db)):
    """Reset solver parameters to defaults."""
    db.query(AppSettings).filter(
        AppSettings.key.in_(list(SOLVER_DEFAULTS.keys()))
    ).delete(synchronize_session=False)
    db.commit()
    return {
        "status": "success",
        "message": "Solver settings reset to defaults",
        "defaults": {
            "max_time_seconds": SOLVER_DEFAULTS["solver_max_time_seconds"],
            "break_threshold_min": SOLVER_DEFAULTS["solver_break_threshold_min"],
            "break_recovery_bonus": SOLVER_DEFAULTS["solver_break_recovery_bonus"],
            "fatigue_scale": SOLVER_DEFAULTS["solver_fatigue_scale"],
        },
    }


class GoogleOAuthPayload(BaseModel):
    """Google OAuth client credentials saved by the desktop app."""

    client_id: str
    client_secret: str


class GoogleOAuthStatus(BaseModel):
    """Configuration status for locally stored Google OAuth credentials."""

    configured: bool
    client_id_preview: str | None = None
    credential_storage_available: bool = True
    client_secret_available: bool = False


def _mask(value: str, visible: int = 6) -> str:
    """Mask a secret, leaving only the first few characters visible."""
    if len(value) <= visible:
        return "****"
    return value[:visible] + "****"


@router.get("/google-oauth", response_model=GoogleOAuthStatus)
async def get_google_oauth_status(db: Session = Depends(get_db)):
    """Check whether Google OAuth credentials are configured."""
    configured, client_id, secret_available = google_oauth_configured(db)
    preview = _mask(client_id) if client_id else None

    return GoogleOAuthStatus(
        configured=configured,
        client_id_preview=preview,
        credential_storage_available=credential_store_available(),
        client_secret_available=secret_available,
    )


@router.put("/google-oauth", response_model=GoogleOAuthStatus)
async def set_google_oauth(payload: GoogleOAuthPayload, db: Session = Depends(get_db)):
    """Save or update Google OAuth credentials."""
    if not payload.client_id.strip() or not payload.client_secret.strip():
        raise HTTPException(status_code=400, detail="Both client_id and client_secret are required")

    try:
        set_google_oauth_credentials(
            db,
            payload.client_id.strip(),
            payload.client_secret.strip(),
        )
    except SecureCredentialStoreUnavailable as e:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(e))

    db.commit()
    return GoogleOAuthStatus(
        configured=True,
        client_id_preview=_mask(payload.client_id.strip()),
        credential_storage_available=credential_store_available(),
        client_secret_available=True,
    )


@router.delete("/google-oauth")
async def delete_google_oauth(db: Session = Depends(get_db)):
    """Remove stored Google OAuth credentials."""
    try:
        delete_google_oauth_credentials(db)
    except SecureCredentialStoreUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    db.commit()
    return {"status": "success", "message": "Google OAuth credentials removed"}


# ──────────────────────────────────────────────────────────────
# Publish Target
# ──────────────────────────────────────────────────────────────

_KEY_PUBLISH_TARGET = "publish_target"
PublishDestination = Literal["google", "mp-backend", "pdf"]
_PUBLISH_DESTINATION_ORDER = ("google", "mp-backend", "pdf")


def _normalise_publish_targets(value: object) -> list[PublishDestination]:
    """Return a canonical destination list and translate retired scalar values."""
    if isinstance(value, str):
        scalar = value.strip()
        legacy = {
            "": [],
            "none": [],
            "google": ["google"],
            "mp-backend": ["mp-backend"],
            "both": ["google", "mp-backend"],
        }
        if scalar in legacy:
            value = legacy[scalar]
        else:
            try:
                value = json.loads(scalar)
            except (TypeError, ValueError):
                return []
    if not isinstance(value, list):
        return []
    selected = {item for item in value if item in _PUBLISH_DESTINATION_ORDER}
    return [item for item in _PUBLISH_DESTINATION_ORDER if item in selected]


class PublishTargetPayload(BaseModel):
    """Requested publish target for schedule export actions."""

    targets: list[PublishDestination] = Field(default_factory=list, max_length=3)


class PublishTargetResponse(BaseModel):
    """Current publish target saved in local app settings."""

    targets: list[PublishDestination]


@router.get("/publish-target", response_model=PublishTargetResponse)
async def get_publish_target(db: Session = Depends(get_db)):
    """Get the current publish target. Defaults to 'none'."""
    row = db.query(AppSettings).filter(AppSettings.key == _KEY_PUBLISH_TARGET).first()
    targets = _normalise_publish_targets(row.value if row else None)
    return PublishTargetResponse(targets=targets)


@router.put("/publish-target", response_model=PublishTargetResponse)
async def set_publish_target(payload: PublishTargetPayload, db: Session = Depends(get_db)):
    """Set the publish target."""
    targets = _normalise_publish_targets(payload.targets)
    if len(targets) != len(set(payload.targets)) or len(targets) != len(payload.targets):
        raise HTTPException(
            status_code=400,
            detail="targets must contain unique values from 'google', 'mp-backend', and 'pdf'",
        )
    stored = json.dumps(targets, separators=(",", ":"))
    row = db.query(AppSettings).filter(AppSettings.key == _KEY_PUBLISH_TARGET).first()
    if row:
        row.value = stored
    else:
        db.add(AppSettings(key=_KEY_PUBLISH_TARGET, value=stored))
    db.commit()
    return PublishTargetResponse(targets=targets)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Keyboard Shortcuts
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_KEY_KEYBOARD_SHORTCUTS = "keyboard_shortcuts"


class ShortcutSettingsPayload(BaseModel):
    """Keyboard shortcut override map keyed by frontend shortcut id."""

    shortcuts: dict[str, str] = Field(default_factory=dict)


class ShortcutSettingsResponse(BaseModel):
    """Persisted keyboard shortcut override map returned to the frontend."""

    shortcuts: dict[str, str]


def _coerce_shortcut_map(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): str(binding)
        for key, binding in value.items()
        if isinstance(key, str) and isinstance(binding, str)
    }


def _load_shortcut_overrides(row: AppSettings | None) -> dict[str, str]:
    if not row or not row.value:
        return {}
    try:
        decoded = json.loads(row.value)
    except (TypeError, ValueError):
        return {}
    return _coerce_shortcut_map(decoded)


@router.get("/shortcuts", response_model=ShortcutSettingsResponse)
async def get_shortcuts(db: Session = Depends(get_db)):
    """Get keyboard shortcut overrides. Defaults are held by the frontend."""
    row = db.query(AppSettings).filter(AppSettings.key == _KEY_KEYBOARD_SHORTCUTS).first()
    return ShortcutSettingsResponse(shortcuts=_load_shortcut_overrides(row))


@router.put("/shortcuts", response_model=ShortcutSettingsResponse)
async def set_shortcuts(payload: ShortcutSettingsPayload, db: Session = Depends(get_db)):
    """Save keyboard shortcut overrides."""
    shortcuts = _coerce_shortcut_map(payload.shortcuts)
    encoded = json.dumps(shortcuts, sort_keys=True)
    row = db.query(AppSettings).filter(AppSettings.key == _KEY_KEYBOARD_SHORTCUTS).first()
    if row:
        row.value = encoded
    else:
        db.add(AppSettings(key=_KEY_KEYBOARD_SHORTCUTS, value=encoded))
    db.commit()
    return ShortcutSettingsResponse(shortcuts=shortcuts)


@router.delete("/shortcuts")
async def reset_shortcuts(db: Session = Depends(get_db)):
    """Clear keyboard shortcut overrides."""
    db.query(AppSettings).filter(AppSettings.key == _KEY_KEYBOARD_SHORTCUTS).delete(synchronize_session=False)
    db.commit()
    return {"status": "success", "message": "Keyboard shortcuts reset to defaults"}
