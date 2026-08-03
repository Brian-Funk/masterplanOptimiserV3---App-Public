"""Local-only processor-key custody and signing API."""

import secrets
from typing import Any, Literal

import httpx

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.operator_evidence import (
    ProcessorEvidenceError,
    generate_key,
    import_encrypted_key,
    registration_file,
    retire_key,
    sign_document,
    sign_rotation_continuity,
)
from app.db.database import get_db
from app.models.operator_evidence import ProcessorEvidenceKey
from app.models.event import Event


router = APIRouter()


class GenerateProcessorKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: int = Field(gt=0)
    processor_id: str | None = Field(default=None, pattern=r"^prc-[a-z0-9]{8,48}$")
    display_label: str | None = Field(default=None, max_length=128)
    supersedes_key_id: str | None = Field(default=None, pattern=r"^ek-[0-9a-f]{16}$")


class SignDocumentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document: dict[str, Any]


class ImportProcessorKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: int = Field(gt=0)
    package: dict[str, Any]
    passphrase: str = Field(min_length=16, max_length=1024)
    display_label: str | None = Field(default=None, max_length=128)


class EnrolProcessorKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: int = Field(gt=0)
    key_id: str = Field(pattern=r"^ek-[0-9a-f]{16}$")


class RetireProcessorKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: Literal["REVOKED ON SERVER"]


def _public(row: ProcessorEvidenceKey) -> dict[str, Any]:
    return {
        "key_id": row.key_id,
        "public_key": row.public_key,
        "public_key_sha256": row.public_key_sha256,
        "processor_id": row.processor_id,
        "local_event_id": row.local_event_id,
        "event_evidence_id": row.event_evidence_id,
        "display_label": row.display_label,
        "server_instance_id": row.server_instance_id,
        "role": "processor",
        "algorithm": "Ed25519",
        "state": row.state,
        "supersedes_key_id": row.supersedes_key_id,
        "created_at": row.created_at,
        "retired_at": row.retired_at,
    }


def _reject(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"code": "LOCAL_PROCESSOR_EVIDENCE_REJECTED", "message": str(exc)},
    )


@router.get("/keys")
def list_local_processor_keys(db: Session = Depends(get_db)):
    """List processor public metadata without reading private key bytes."""
    return [_public(row) for row in db.query(ProcessorEvidenceKey).order_by(ProcessorEvidenceKey.id).all()]


@router.post("/keys")
def create_local_processor_key(body: GenerateProcessorKeyRequest, db: Session = Depends(get_db)):
    """Generate one processor key directly in the OS credential store."""
    try:
        event = db.query(Event).filter(Event.id == body.event_id).first()
        if event is None: raise ProcessorEvidenceError("The local event does not exist.")
        row = generate_key(
            db,
            processor_id=body.processor_id or f"prc-{secrets.token_hex(8)}",
            event_evidence_id=event.evidence_id,
            display_label=body.display_label,
            supersedes_key_id=body.supersedes_key_id,
        )
        row.local_event_id = event.id
        db.commit(); db.refresh(row)
        return {"key": _public(row), "registration": registration_file(row)}
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        raise _reject(exc) from exc


@router.post("/keys/import")
def import_local_processor_key(body: ImportProcessorKeyRequest, db: Session = Depends(get_db)):
    try:
        event = db.query(Event).filter(Event.id == body.event_id).first()
        if event is None: raise ProcessorEvidenceError("The local event does not exist.")
        row = import_encrypted_key(
            db, package=body.package, passphrase=body.passphrase,
            event_evidence_id=event.evidence_id, display_label=body.display_label,
        )
        row.local_event_id = event.id
        db.commit(); db.refresh(row)
        return {"key": _public(row), "registration": registration_file(row)}
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        raise _reject(exc) from exc


@router.post("/keys/enrol")
async def enrol_local_processor_key(body: EnrolProcessorKeyRequest, db: Session = Depends(get_db)):
    """Transfer public material and proof directly to the paired Server."""
    try:
        event = db.query(Event).filter(Event.id == body.event_id).first()
        if event is None:
            raise ProcessorEvidenceError("The local event does not exist.")
        row = db.query(ProcessorEvidenceKey).filter(
            ProcessorEvidenceKey.key_id == body.key_id,
            ProcessorEvidenceKey.event_evidence_id == event.evidence_id,
        ).first()
        if row is None or not event.mp_backend_url:
            raise ProcessorEvidenceError("The event and processor key must be linked to a Server first.")
        from app.api.v1.mp_backend import _resolve_mp_backend_secret
        secret = _resolve_mp_backend_secret(db, event)
        if not secret: raise ProcessorEvidenceError("The event publish secret is unavailable.")
        headers = {"Authorization": f"Bearer {secret}"}
        async with httpx.AsyncClient(timeout=20) as client:
            start = await client.post(
                f"{event.mp_backend_url.rstrip('/')}/api/v1/publish/processor-keys/enrolments",
                headers=headers, json=registration_file(row),
            )
            if start.status_code not in {200, 202}:
                raise ProcessorEvidenceError(f"Server rejected processor enrolment ({start.status_code}).")
            started = start.json()
            if started.get("status") == "active":
                row.state = "active"; db.commit(); return {"status": "active", "key": _public(row)}
            challenge = started.get("challenge")
            if not isinstance(challenge, dict): raise ProcessorEvidenceError("Server returned an invalid enrolment challenge.")
            proof = sign_document(db, identifier=row.key_id, document=challenge, kind="registration")
            previous_proof = None
            if row.supersedes_key_id:
                previous_proof = sign_rotation_continuity(
                    db,
                    previous_identifier=row.supersedes_key_id,
                    successor_identifier=row.key_id,
                    document=challenge,
                )
            submitted = await client.post(
                f"{event.mp_backend_url.rstrip('/')}/api/v1/publish/processor-keys/enrolments/{challenge['challenge_id']}/proof",
                headers=headers,
                json={"challenge": challenge, "proof": proof, "previous_proof": previous_proof},
            )
            if submitted.status_code not in {200, 202}:
                raise ProcessorEvidenceError(f"Server rejected processor proof ({submitted.status_code}).")
        row.server_instance_id = challenge["instance_id"]
        row.state = "pending_root_approval"
        db.commit(); db.refresh(row)
        return {"status": "pending_root_approval", "key": _public(row), "challenge_id": challenge["challenge_id"]}
    except (ProcessorEvidenceError, RuntimeError, ValueError, httpx.HTTPError) as exc:
        db.rollback(); raise _reject(exc) from exc


@router.post("/events/{event_id}/refresh-status")
async def refresh_processor_key_status(event_id: int, db: Session = Depends(get_db)):
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if event is None or not event.mp_backend_url:
            raise ProcessorEvidenceError("The event is not linked to a Server.")
        from app.api.v1.mp_backend import _resolve_mp_backend_secret
        secret = _resolve_mp_backend_secret(db, event)
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{event.mp_backend_url.rstrip('/')}/api/v1/publish/processor-keys/status",
                headers={"Authorization": f"Bearer {secret}"},
            )
        if response.status_code != 200:
            raise ProcessorEvidenceError(f"Server key status is unavailable ({response.status_code}).")
        status = response.json()
        active = {item["active_key_id"] for item in status.get("processors", []) if item.get("status") == "active"}
        for row in db.query(ProcessorEvidenceKey).filter(ProcessorEvidenceKey.event_evidence_id == event.evidence_id):
            if row.key_id in active: row.state = "active"
        db.commit()
        return {"status": status, "keys": [_public(row) for row in db.query(ProcessorEvidenceKey).filter(ProcessorEvidenceKey.event_evidence_id == event.evidence_id)]}
    except (ProcessorEvidenceError, RuntimeError, ValueError, httpx.HTTPError) as exc:
        db.rollback(); raise _reject(exc) from exc


@router.post("/keys/{identifier}/sign-registration")
def sign_registration_challenge(identifier: str, body: SignDocumentRequest, db: Session = Depends(get_db)):
    try:
        return {"document": body.document, "proof": sign_document(
            db, identifier=identifier, document=body.document, kind="registration",
        )}
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        db.rollback()
        raise _reject(exc) from exc


@router.post("/keys/{identifier}/sign-desktop-evidence")
def sign_desktop_evidence(identifier: str, body: SignDocumentRequest, db: Session = Depends(get_db)):
    try:
        return {"document": body.document, "proof": sign_document(
            db, identifier=identifier, document=body.document, kind="desktop_evidence",
        )}
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        db.rollback(); raise _reject(exc) from exc


@router.post("/keys/{identifier}/retire")
def retire_local_processor_key(
    identifier: str, body: RetireProcessorKeyRequest, db: Session = Depends(get_db),
):
    del body
    try:
        return _public(retire_key(db, identifier=identifier))
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        db.rollback()
        raise _reject(exc) from exc
