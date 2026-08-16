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
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy.orm import Session

from app.core.secure_credentials import delete_secret, get_secret, set_secret
from app.models.operator_evidence import ProcessorEvidenceKey


REGISTRATION_FORMAT = "mp-opt-trust-key-registration-v1"
PROCESSOR_EVENT_REGISTRATION_FORMAT = "mp-opt-processor-event-registration-v1"
PRIVATE_PACKAGE_FORMAT = "mp-opt-processor-private-key-v1"
PUBLIC_PACKAGE_FORMAT = "mp-opt-processor-public-key-v1"
POLICY_ACK_FORMAT = "mp-opt-desktop-policy-acknowledgement-v1"
DELETION_RECEIPT_FORMAT = "mp-opt-desktop-deletion-receipt-v2"
COPY_RESOLUTION_FORMAT = "mp-opt-desktop-copy-resolution-v1"
WORK_ORDER_CLAIM_FORMAT = "mp-opt-desktop-work-order-claim-v1"
SIGNATURE_FORMAT = "mp-opt-ed25519-signature-v1"
TRUST_NAMESPACE = "mp-opt-role-trust-v1"
DESKTOP_EVIDENCE_NAMESPACE = "mp-opt-desktop-evidence-v1"
PROCESSOR_ROLE = "processor"
KEY_ID_RE = re.compile(r"^ek-[0-9a-f]{16}$")
ENTITY_ID_RE = re.compile(r"^prc-[a-z0-9]{8,48}$")
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
    db: Session, *, processor_id: str, event_evidence_id: str,
    display_label: str | None = None, supersedes_key_id: str | None = None,
) -> ProcessorEvidenceKey:
    """Generate one processor key directly into the OS credential store."""
    if not ENTITY_ID_RE.fullmatch(processor_id):
        raise ProcessorEvidenceError("The processor identity is invalid.")
    _uuid(event_evidence_id, "event_evidence_id")
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
        event_evidence_id=event_evidence_id,
        display_label=display_label,
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
        "format": PUBLIC_PACKAGE_FORMAT,
        "instance_id": None,
        "entity_id": row.processor_id,
        "key_id": row.key_id,
        "role": PROCESSOR_ROLE,
        "algorithm": "Ed25519",
        "public_key": row.public_key,
        "public_key_sha256": row.public_key_sha256,
        "supersedes_key_id": row.supersedes_key_id,
        "rotation_reason": "routine" if row.supersedes_key_id else None,
        "display_label": row.display_label,
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
    event_fields = {
        "format", "challenge_id", "action", "instance_id", "event_ref", "entity_id",
        "key_id", "role", "algorithm", "public_key_sha256", "supersedes_key_id",
        "reason", "action_sha256", "nonce", "created_at", "expires_at",
    }
    if document.get("format") == PROCESSOR_EVENT_REGISTRATION_FORMAT:
        if set(document) != event_fields or document.get("event_ref") != row.event_evidence_id:
            raise ProcessorEvidenceError("The event-bound registration challenge is invalid.")
        expected_action = {
            "format": "mp-opt-processor-event-action-v1",
            "action": document.get("action"), "instance_id": document.get("instance_id"),
            "event_ref": document.get("event_ref"), "entity_id": document.get("entity_id"),
            "key_id": document.get("key_id"), "role": document.get("role"),
            "algorithm": document.get("algorithm"),
            "public_key_sha256": document.get("public_key_sha256"),
            "supersedes_key_id": document.get("supersedes_key_id"), "reason": document.get("reason"),
        }
        if document.get("action_sha256") != hashlib.sha256(canonical_json(expected_action)).hexdigest():
            raise ProcessorEvidenceError("The event-bound registration action digest is invalid.")
    else:
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
    digest_payload = expected_action if document.get("format") == PROCESSOR_EVENT_REGISTRATION_FORMAT else action_payload(document)
    expected = hashlib.sha256(canonical_json(digest_payload)).hexdigest()
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


def sign_document(db: Session, *, identifier: str, document: dict[str, Any], kind: str) -> dict[str, str]:
    row = db.query(ProcessorEvidenceKey).filter(ProcessorEvidenceKey.key_id == identifier).first()
    allowed_states = {"pending_root_approval", "active"} if kind == "registration" else {"active"}
    if row is None or row.state not in allowed_states:
        raise ProcessorEvidenceError("The local processor key is not active.")
    if kind == "registration":
        _validate_registration(document, row)
    elif kind == "desktop_evidence":
        expected = {
            POLICY_ACK_FORMAT: "policy",
            DELETION_RECEIPT_FORMAT: "deletion",
            COPY_RESOLUTION_FORMAT: "copy_resolution",
            WORK_ORDER_CLAIM_FORMAT: "claim",
        }
        if document.get("format") not in expected:
            raise ProcessorEvidenceError("The processor may sign only typed Desktop evidence.")
        if (
            document.get("event_ref") != row.event_evidence_id
            or document.get("entity_id") != row.processor_id
            or document.get("key_id") != row.key_id
            or document.get("role") != PROCESSOR_ROLE
            or document.get("algorithm") != "Ed25519"
            or document.get("public_key_sha256") != row.public_key_sha256
        ):
            raise ProcessorEvidenceError("The Desktop evidence targets another event or key.")
        canonical_json(document)
    else:
        raise ProcessorEvidenceError("The signing purpose is invalid.")
    namespace = DESKTOP_EVIDENCE_NAMESPACE if kind == "desktop_evidence" else TRUST_NAMESPACE
    signature = _load_private(row).sign(namespace.encode("ascii") + b"\0" + canonical_json(document))
    return {
        "format": SIGNATURE_FORMAT,
        "key_id": row.key_id,
        "namespace": namespace,
        "signature": base64.b64encode(signature).decode("ascii"),
    }


def sign_rotation_continuity(
    db: Session, *, previous_identifier: str, successor_identifier: str, document: dict[str, Any]
) -> dict[str, str]:
    """Prove that the active predecessor authorises an event-bound routine rotation."""
    previous = db.query(ProcessorEvidenceKey).filter(
        ProcessorEvidenceKey.key_id == previous_identifier,
    ).first()
    successor = db.query(ProcessorEvidenceKey).filter(
        ProcessorEvidenceKey.key_id == successor_identifier,
    ).first()
    if previous is None or previous.state != "active" or successor is None:
        raise ProcessorEvidenceError("The processor-key rotation cannot be authorised locally.")
    if (
        successor.supersedes_key_id != previous.key_id
        or successor.processor_id != previous.processor_id
        or successor.event_evidence_id != previous.event_evidence_id
    ):
        raise ProcessorEvidenceError("The processor-key rotation crosses an identity or event boundary.")
    _validate_registration(document, successor)
    if document.get("action") != "rotate" or document.get("reason") != "routine":
        raise ProcessorEvidenceError("The predecessor may authorise only a routine rotation.")
    signature = _load_private(previous).sign(
        TRUST_NAMESPACE.encode("ascii") + b"\0" + canonical_json(document)
    )
    return {
        "format": SIGNATURE_FORMAT,
        "key_id": previous.key_id,
        "namespace": TRUST_NAMESPACE,
        "signature": base64.b64encode(signature).decode("ascii"),
    }


def import_encrypted_key(
    db: Session, *, package: dict[str, Any], passphrase: str,
    event_evidence_id: str, display_label: str | None = None,
) -> ProcessorEvidenceKey:
    """Import the public Pages key format into the OS credential store."""

    if len(passphrase) < 16:
        raise ProcessorEvidenceError("The processor key passphrase must contain at least 16 characters.")
    expected = {
        "format", "public_package", "kdf", "cipher", "ciphertext",
    }
    if not isinstance(package, dict) or set(package) != expected or package.get("format") != PRIVATE_PACKAGE_FORMAT:
        raise ProcessorEvidenceError("The encrypted processor key package is invalid.")
    public_package = package.get("public_package")
    if not isinstance(public_package, dict) or public_package.get("format") != PUBLIC_PACKAGE_FORMAT:
        raise ProcessorEvidenceError("The processor public package is invalid.")
    _uuid(event_evidence_id, "event_evidence_id")
    entity_id = str(public_package.get("entity_id", ""))
    if not ENTITY_ID_RE.fullmatch(entity_id):
        raise ProcessorEvidenceError("The processor identity is invalid.")
    kdf = package.get("kdf")
    cipher = package.get("cipher")
    if (
        not isinstance(kdf, dict) or set(kdf) != {"name", "hash", "iterations", "salt"}
        or kdf.get("name") != "PBKDF2" or kdf.get("hash") != "SHA-256"
        or kdf.get("iterations") != 600000
        or not isinstance(cipher, dict) or set(cipher) != {"name", "iv", "tag_length"}
        or cipher.get("name") != "AES-GCM" or cipher.get("tag_length") != 128
    ):
        raise ProcessorEvidenceError("The processor key encryption parameters are unsupported.")
    try:
        salt = base64.b64decode(kdf["salt"], validate=True)
        iv = base64.b64decode(cipher["iv"], validate=True)
        ciphertext = base64.b64decode(package["ciphertext"], validate=True)
    except (TypeError, ValueError) as exc:
        raise ProcessorEvidenceError("The processor key encryption data is invalid.") from exc
    if len(salt) != 16 or len(iv) != 12:
        raise ProcessorEvidenceError("The processor key encryption salt or IV is invalid.")
    aad = canonical_json(public_package)
    derived = bytearray(PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt, iterations=600000).derive(passphrase.encode("utf-8")))
    private_bytes: bytearray | None = None
    try:
        private_bytes = bytearray(AESGCM(bytes(derived)).decrypt(iv, ciphertext, aad))
        private = serialization.load_der_private_key(bytes(private_bytes), password=None)
    except (InvalidTag, ValueError, TypeError) as exc:
        raise ProcessorEvidenceError("The processor key passphrase or encrypted package is invalid.") from exc
    finally:
        derived[:] = b"\0" * len(derived)
        if private_bytes is not None:
            private_bytes[:] = b"\0" * len(private_bytes)
    if not isinstance(private, Ed25519PrivateKey):
        raise ProcessorEvidenceError("The imported processor key is not Ed25519.")
    public = _public(private)
    identifier = key_id(public)
    fingerprint = hashlib.sha256(public.encode("ascii")).hexdigest()
    if (
        public_package.get("key_id") != identifier
        or public_package.get("public_key") != public
        or public_package.get("public_key_sha256") != fingerprint
    ):
        raise ProcessorEvidenceError("The imported private key does not match its public package.")
    if db.query(ProcessorEvidenceKey).filter(ProcessorEvidenceKey.key_id == identifier).first():
        raise ProcessorEvidenceError("This processor key is already present.")
    row = ProcessorEvidenceKey(
        key_id=identifier, public_key=public, public_key_sha256=fingerprint,
        processor_id=entity_id, event_evidence_id=event_evidence_id,
        display_label=display_label or public_package.get("display_label"),
        supersedes_key_id=public_package.get("supersedes_key_id"),
    )
    secret = private.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    account = private_key_account(identifier)
    set_secret(account, secret)
    try:
        db.add(row); db.commit(); db.refresh(row)
    except Exception:
        db.rollback(); delete_secret(account); raise
    return row


def retire_key(db: Session, *, identifier: str) -> ProcessorEvidenceKey:
    row = db.query(ProcessorEvidenceKey).filter(ProcessorEvidenceKey.key_id == identifier).first()
    if row is None or row.state != "active":
        raise ProcessorEvidenceError("The local processor key is not active.")
    row.state = "retired"
    row.retired_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


def erase_event_keys(db: Session, *, local_event_id: int) -> int:
    """Permanently remove every local processor key for one Desktop event.

    Server-side public trust history is deliberately outside this local-only
    operation. Credential-store entries are removed before their public SQLite
    metadata so an interrupted attempt can be retried safely without claiming
    that private material was erased when it was not.
    """
    if not isinstance(local_event_id, int) or local_event_id <= 0:
        raise ProcessorEvidenceError("The local event identity is invalid.")
    rows = db.query(ProcessorEvidenceKey).filter(
        ProcessorEvidenceKey.local_event_id == local_event_id,
    ).order_by(ProcessorEvidenceKey.id).all()
    for row in rows:
        delete_secret(private_key_account(row.key_id))
    try:
        for row in rows:
            db.delete(row)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return len(rows)


# Deliberately no controller-key generation or signing API exists in Desktop.
