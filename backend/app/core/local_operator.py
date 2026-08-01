"""Stable pseudonymous identity for local accountability records."""

import hashlib
import uuid

from sqlalchemy.orm import Session

from app.models.app_settings import AppSettings


def local_operator_subject(db: Session) -> str:
    """Return a local pseudonym without asserting a human identity."""

    key = "desktop_operator_install_id"
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    if row is None:
        row = AppSettings(key=key, value=str(uuid.uuid4()))
        db.add(row)
        db.flush()
    return hashlib.sha256(f"desktop-operator:{row.value}".encode("utf-8")).hexdigest()
