"""Desktop-only custody and signing for the processor trust domain.

The Desktop generates only processor keys. Private Ed25519 bytes are placed in
the operating-system credential store and never enter SQLite, transfer files,
logs, diagnostics, or ordinary UI responses.
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Any
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy.orm import Session

from app.core.secure_credentials import delete_secret, get_secret, set_secret
from app.models.operator_evidence import ProcessorEvidenceKey


REGISTRATION_FORMAT = "mp-opt-trust-key-registration-v1"
STATEMENT_FORMAT = "mp-opt-processor-statement-v1"
SIGNATURE_FORMAT = "mp-opt-ed25519-signature-v1"
TRUST_NAMESPACE = "mp-opt-role-trust-v1"
PROCESSOR_ROLE = "processor"
STATEMENT_TYPES = frozenset({"publication", "conversion", "erasure", "receipt"})
KEY_ID_RE = re.compile(r"^ek-[0-9a-f]{16}$")
ENTITY_ID_RE = re.compile(r"^prc-[a-z0-9]{8,48}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
PRIVATE_MARKERS = tuple(
    f"-----BEGIN {label}-----"
    for label in ("OPENSSH PRIVATE KEY", "PRIVATE KEY", "ENCRYPTED PRIVATE KEY")
)


class ProcessorEvidenceError(ValueError):
    """Raised when a processor-key operation is unsafe or inconsistent."""


def _reject_values(value: Any) -> None:
    if isinstance(value, float):
        raise ProcessorEvidenceError("Floating-point values are forbidden.")
    if value is None or isinstance(value, (bool, int)):
        return
    if isinstance(value, str):
        if len(value) > 2048 or any(ord(character) < 0x20 for character in value):
            raise ProcessorEvidenceError("The document contains an unsafe string.")
        if any(marker in value for marker in PRIVATE_MARKERS):
            raise ProcessorEvidenceError("Private-key material is not accepted.")
        return
    if isinstance(value, list):
        if len(value) > 64:
            raise ProcessorEvidenceError("The document contains an oversized array.")
        for item in value:
            _reject_values(item)
        return
    if isinstance(value, dict):
        if len(value) > 32 or any(not isinstance(key, str) for key in value):
            raise ProcessorEvidenceError("The document contains an invalid object.")
        for key, item in value.items():
            _reject_values(key)
            _reject_values(item)
        return
    raise ProcessorEvidenceError("The document contains an unsupported value.")


def canonical_json(value: dict[str, Any]) -> bytes:
    if not isinstance(value, dict):
        raise ProcessorEvidenceError("The evidence document must be an object.")
    _reject_values(value)
    raw = (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if len(raw) > 64 * 1024:
        raise ProcessorEvidenceError("The evidence document exceeds 64 KiB.")
    return raw


def _timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not TIMESTAMP_RE.fullmatch(value):
        raise ProcessorEvidenceError(f"{field} must be a canonical UTC timestamp.")
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _uuid(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ProcessorEvidenceError(f"{field} must be a UUID.")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise ProcessorEvidenceError(f"{field} must be a UUID.") from exc
    if str(parsed) != value:
        raise ProcessorEvidenceError(f"{field} must use canonical UUID form.")
    return value


def _public(private_key: Ed25519PrivateKey) -> str:
    return private_key.public_key().public_bytes(
        serialization.Encoding.OpenSSH,
        serialization.PublicFormat.OpenSSH,
    ).decode("ascii")


def key_id(public_key: str) -> str:
    return "ek-" + hashlib.sha256(public_key.encode("ascii")).hexdigest()[:16]


def private_key_account(identifier: str) -> str:
    if not KEY_ID_RE.fullmatch(identifier):
        raise ProcessorEvidenceError("The processor key ID is invalid.")
    return f"masterplan:processor-key:{identifier}:private-ed25519-pkcs8"


def _load_private(row: ProcessorEvidenceKey) -> Ed25519PrivateKey:
    raw = get_secret(private_key_account(row.key_id))
    if raw is None:
        raise ProcessorEvidenceError("The private key is not available in the OS credential store.")
    try:
        key = serialization.load_pem_private_key(raw.encode("ascii"), password=None)
    except (ValueError, TypeError, UnicodeError) as exc:
        raise ProcessorEvidenceError("The stored private key is invalid.") from exc
    if not isinstance(key, Ed25519PrivateKey) or _public(key) != row.public_key:
        raise ProcessorEvidenceError("The stored private key does not match its public metadata.")
    return key


def generate_key(
    db: Session, *, processor_id: str, supersedes_key_id: str | None = None,
) -> ProcessorEvidenceKey:
    """Generate one processor key directly into the OS credential store."""
    if not ENTITY_ID_RE.fullmatch(processor_id):
        raise ProcessorEvidenceError("The processor identity is invalid.")
    if supersedes_key_id is not None:
        previous = db.query(ProcessorEvidenceKey).filter(
            ProcessorEvidenceKey.key_id == supersedes_key_id,
            ProcessorEvidenceKey.processor_id == processor_id,
            ProcessorEvidenceKey.state == "active",
        ).first()
        if previous is None:
            raise ProcessorEvidenceError("The superseded processor key is not active for this identity.")
    private = Ed25519PrivateKey.generate()
    public = _public(private)
    identifier = key_id(public)
    row = ProcessorEvidenceKey(
        key_id=identifier,
        public_key=public,
        public_key_sha256=hashlib.sha256(public.encode("ascii")).hexdigest(),
        processor_id=processor_id,
        role=PROCESSOR_ROLE,
        supersedes_key_id=supersedes_key_id,
    )
    secret = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    account = private_key_account(identifier)
    set_secret(account, secret)
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        delete_secret(account)
        raise
    return row


def registration_file(row: ProcessorEvidenceKey) -> dict[str, Any]:
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return {
        "format": "mp-opt-processor-public-key-v1",
        "instance_id": None,
        "entity_id": row.processor_id,
        "key_id": row.key_id,
        "role": PROCESSOR_ROLE,
        "algorithm": "Ed25519",
        "public_key": row.public_key,
        "public_key_sha256": row.public_key_sha256,
        "created_at": created.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signature_namespace": TRUST_NAMESPACE,
    }


def action_payload(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": "mp-opt-trust-action-v1",
        "action": document.get("action"),
        "instance_id": document.get("instance_id"),
        "entity_id": document.get("entity_id"),
        "key_id": document.get("key_id"),
        "role": document.get("role"),
        "algorithm": document.get("algorithm"),
        "public_key_sha256": document.get("public_key_sha256"),
        "supersedes_key_id": document.get("supersedes_key_id"),
        "reason": document.get("reason"),
    }


def _validate_registration(document: dict[str, Any], row: ProcessorEvidenceKey) -> None:
    fields = {
        "format", "challenge_id", "action", "instance_id", "entity_id", "key_id",
        "role", "algorithm", "public_key_sha256", "supersedes_key_id", "reason",
        "action_sha256", "nonce", "created_at", "expires_at",
    }
    if set(document) != fields or document.get("format") != REGISTRATION_FORMAT:
        raise ProcessorEvidenceError("The registration challenge fields are invalid.")
    canonical_json(document)
    _uuid(document.get("challenge_id"), "challenge_id")
    _uuid(document.get("instance_id"), "instance_id")
    if document.get("entity_id") != row.processor_id or document.get("role") != PROCESSOR_ROLE:
        raise ProcessorEvidenceError("The challenge targets another identity or role.")
    if document.get("algorithm") != "Ed25519":
        raise ProcessorEvidenceError("The challenge algorithm is invalid.")
    if document.get("action") not in {"register", "rotate"}:
        raise ProcessorEvidenceError("The challenge action is invalid.")
    if document.get("key_id") != row.key_id or document.get("public_key_sha256") != row.public_key_sha256:
        raise ProcessorEvidenceError("The challenge does not target this processor key.")
    expected = hashlib.sha256(canonical_json(action_payload(document))).hexdigest()
    if document.get("action_sha256") != expected:
        raise ProcessorEvidenceError("The exact action digest is invalid.")
    if document["action"] == "register":
        if document.get("supersedes_key_id") is not None or document.get("reason") is not None:
            raise ProcessorEvidenceError("A new registration cannot contain rotation metadata.")
    elif (
        document.get("supersedes_key_id") != row.supersedes_key_id
        or document.get("reason") not in {"routine", "lost", "compromised"}
    ):
        raise ProcessorEvidenceError("The rotation metadata is invalid.")
    created = _timestamp(document.get("created_at"), "created_at")
    expires = _timestamp(document.get("expires_at"), "expires_at")
    if expires <= created or expires > created + timedelta(minutes=15) or expires < datetime.now(timezone.utc):
        raise ProcessorEvidenceError("The registration challenge has expired or has an invalid lifetime.")
    try:
        nonce = base64.b64decode(document.get("nonce"), validate=True)
    except (TypeError, ValueError) as exc:
        raise ProcessorEvidenceError("The registration nonce is invalid.") from exc
    if len(nonce) != 32:
        raise ProcessorEvidenceError("The registration nonce must contain 32 bytes.")


def _validate_statement(document: dict[str, Any], row: ProcessorEvidenceKey) -> None:
    fields = {
        "format", "instance_id", "entity_id", "key_id", "role", "algorithm",
        "public_key_sha256", "statement_type", "statement_sha256", "created_at",
    }
    if set(document) != fields or document.get("format") != STATEMENT_FORMAT:
        raise ProcessorEvidenceError("The processor statement fields are invalid.")
    canonical_json(document)
    _uuid(document.get("instance_id"), "instance_id")
    if (
        document.get("entity_id") != row.processor_id
        or document.get("key_id") != row.key_id
        or document.get("role") != PROCESSOR_ROLE
        or document.get("algorithm") != "Ed25519"
        or document.get("public_key_sha256") != row.public_key_sha256
    ):
        raise ProcessorEvidenceError("The processor statement has the wrong key, identity, or role.")
    if document.get("statement_type") not in STATEMENT_TYPES:
        raise ProcessorEvidenceError("The processor statement type is unsupported.")
    if not isinstance(document.get("statement_sha256"), str) or not SHA256_RE.fullmatch(document["statement_sha256"]):
        raise ProcessorEvidenceError("The exact statement digest is invalid.")
    if _timestamp(document.get("created_at"), "created_at") > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ProcessorEvidenceError("The processor statement time is too far in the future.")


def sign_document(db: Session, *, identifier: str, document: dict[str, Any], kind: str) -> dict[str, str]:
    row = db.query(ProcessorEvidenceKey).filter(ProcessorEvidenceKey.key_id == identifier).first()
    if row is None or row.state != "active":
        raise ProcessorEvidenceError("The local processor key is not active.")
    if kind == "registration":
        _validate_registration(document, row)
    elif kind == "statement":
        _validate_statement(document, row)
    else:
        raise ProcessorEvidenceError("The signing purpose is invalid.")
    signature = _load_private(row).sign(TRUST_NAMESPACE.encode("ascii") + b"\0" + canonical_json(document))
    return {
        "format": SIGNATURE_FORMAT,
        "key_id": row.key_id,
        "namespace": TRUST_NAMESPACE,
        "signature": base64.b64encode(signature).decode("ascii"),
    }


def retire_key(db: Session, *, identifier: str) -> ProcessorEvidenceKey:
    row = db.query(ProcessorEvidenceKey).filter(ProcessorEvidenceKey.key_id == identifier).first()
    if row is None or row.state != "active":
        raise ProcessorEvidenceError("The local processor key is not active.")
    row.state = "retired"
    row.retired_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


# Deliberately no controller-key generation or signing API exists in Desktop.
