"""Local-only processor-key custody and signing API."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.operator_evidence import (
    ProcessorEvidenceError,
    generate_key,
    registration_file,
    retire_key,
    sign_document,
)
from app.db.database import get_db
from app.models.operator_evidence import ProcessorEvidenceKey


router = APIRouter()


class GenerateProcessorKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    processor_id: str = Field(pattern=r"^prc-[a-z0-9]{8,48}$")
    supersedes_key_id: str | None = Field(default=None, pattern=r"^ek-[0-9a-f]{16}$")


class SignDocumentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document: dict[str, Any]


class RetireProcessorKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: Literal["REVOKED ON SERVER"]


def _public(row: ProcessorEvidenceKey) -> dict[str, Any]:
    return {
        "key_id": row.key_id,
        "public_key": row.public_key,
        "public_key_sha256": row.public_key_sha256,
        "processor_id": row.processor_id,
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
        row = generate_key(
            db,
            processor_id=body.processor_id,
            supersedes_key_id=body.supersedes_key_id,
        )
        return {"key": _public(row), "registration": registration_file(row)}
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        raise _reject(exc) from exc


@router.post("/keys/{identifier}/sign-registration")
def sign_registration_challenge(identifier: str, body: SignDocumentRequest, db: Session = Depends(get_db)):
    try:
        return {"document": body.document, "proof": sign_document(
            db, identifier=identifier, document=body.document, kind="registration",
        )}
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        db.rollback()
        raise _reject(exc) from exc


@router.post("/keys/{identifier}/sign-statement")
def sign_processor_statement(identifier: str, body: SignDocumentRequest, db: Session = Depends(get_db)):
    try:
        return {"document": body.document, "proof": sign_document(
            db, identifier=identifier, document=body.document, kind="statement",
        )}
    except (ProcessorEvidenceError, RuntimeError, ValueError) as exc:
        db.rollback()
        raise _reject(exc) from exc


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
