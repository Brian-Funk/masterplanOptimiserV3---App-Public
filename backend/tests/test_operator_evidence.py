"""Synthetic Desktop processor-key custody and role-separation tests."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import uuid

import pytest
from pydantic import ValidationError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.api.v1.operator_evidence import GenerateProcessorKeyRequest
from app.core.operator_evidence import (
    TRUST_NAMESPACE,
    DESKTOP_EVIDENCE_NAMESPACE,
    ProcessorEvidenceError,
    canonical_json,
    generate_key,
    import_encrypted_key,
    registration_file,
    retire_key,
    sign_document,
    sign_rotation_continuity,
)
from app.core.secure_credentials import set_credential_store_for_tests
from app.db.database import Base


PROCESSOR_ID = "prc-synthetic0001"
EVENT_REF = "4b71e292-0931-460d-a5f1-f536f4ca1f2e"


class MemoryCredentialStore:
    def __init__(self): self.values: dict[str, str] = {}
    def available(self) -> bool: return True
    def get(self, account: str) -> str | None: return self.values.get(account)
    def set(self, account: str, value: str) -> None: self.values[account] = value
    def delete(self, account: str) -> None: self.values.pop(account, None)


@pytest.fixture()
def custody_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    store = MemoryCredentialStore()
    set_credential_store_for_tests(store)
    try:
        yield db, store, engine
    finally:
        set_credential_store_for_tests(None)
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _challenge(row, *, instance_id: str | None = None, entity_id: str | None = None, expires_in: int = 600) -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    document = {
        "format": "mp-opt-processor-event-registration-v1",
        "challenge_id": str(uuid.uuid4()),
        "action": "register",
        "instance_id": instance_id or str(uuid.uuid4()),
        "event_ref": row.event_evidence_id,
        "entity_id": entity_id or row.processor_id,
        "key_id": row.key_id,
        "role": "processor",
        "algorithm": "Ed25519",
        "public_key_sha256": row.public_key_sha256,
        "supersedes_key_id": None,
        "reason": None,
        "action_sha256": "",
        "nonce": base64.b64encode(b"n" * 32).decode("ascii"),
        "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (now + timedelta(seconds=expires_in)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    action = {
        "format": "mp-opt-processor-event-action-v1", "action": document["action"],
        "instance_id": document["instance_id"], "event_ref": document["event_ref"],
        "entity_id": document["entity_id"], "key_id": document["key_id"],
        "role": document["role"], "algorithm": document["algorithm"],
        "public_key_sha256": document["public_key_sha256"],
        "supersedes_key_id": document["supersedes_key_id"], "reason": document["reason"],
    }
    document["action_sha256"] = hashlib.sha256(canonical_json(action)).hexdigest()
    return document


def _verify(row, document: dict, proof: dict, namespace: str = TRUST_NAMESPACE) -> None:
    public = serialization.load_ssh_public_key(row.public_key.encode("ascii"))
    assert isinstance(public, Ed25519PublicKey)
    public.verify(
        base64.b64decode(proof["signature"], validate=True),
        namespace.encode("ascii") + b"\0" + canonical_json(document),
    )


def test_processor_key_only_enters_os_store_and_public_metadata(custody_db):
    db, store, engine = custody_db
    private_key_label = "PRIVATE" + " KEY"
    private_key_marker = f"-----BEGIN {private_key_label}-----"
    row = generate_key(db, processor_id=PROCESSOR_ID, event_evidence_id=EVENT_REF)
    assert row.role == "processor"
    assert len(store.values) == 1
    assert next(iter(store.values.values())).startswith(private_key_marker)
    public_file = registration_file(row)
    assert public_file["role"] == "processor"
    assert public_file["entity_id"] == PROCESSOR_ID
    assert private_key_label not in repr(public_file)
    assert inspect(engine).has_table("processor_evidence_keys")
    raw = db.execute(text("SELECT processor_id, role, public_key FROM processor_evidence_keys")).one()
    assert raw[0:2] == (PROCESSOR_ID, "processor")
    assert "PRIVATE" not in raw[2]


def test_desktop_schema_rejects_every_non_processor_role_and_private_input():
    private_key_marker = "-----BEGIN " + "PRIVATE KEY-----"
    with pytest.raises(ValidationError):
        GenerateProcessorKeyRequest.model_validate({
            "event_id": 1,
            "processor_id": PROCESSOR_ID,
            "role": "controller",
        })
    with pytest.raises(ValidationError):
        GenerateProcessorKeyRequest.model_validate({
            "event_id": 1,
            "processor_id": PROCESSOR_ID,
            "private_key": private_key_marker,
        })


def test_registration_binds_instance_processor_role_fingerprint_action_and_expiry(custody_db):
    db, _store, _engine = custody_db
    row = generate_key(db, processor_id=PROCESSOR_ID, event_evidence_id=EVENT_REF)
    challenge = _challenge(row)
    proof = sign_document(db, identifier=row.key_id, document=challenge, kind="registration")
    _verify(row, challenge, proof)

    for change, message in (
        ({"entity_id": "prc-different0001"}, "action digest"),
        ({"role": "controller"}, "action digest"),
        ({"instance_id": str(uuid.uuid4())}, "action digest"),
        ({"action_sha256": "0" * 64}, "action digest"),
    ):
        with pytest.raises(ProcessorEvidenceError, match=message):
            sign_document(db, identifier=row.key_id, document=challenge | change, kind="registration")
    with pytest.raises(ProcessorEvidenceError, match="expired"):
        sign_document(db, identifier=row.key_id, document=_challenge(row, expires_in=-1), kind="registration")


def test_processor_key_signs_only_event_bound_desktop_evidence(custody_db):
    db, _store, _engine = custody_db
    row = generate_key(db, processor_id=PROCESSOR_ID, event_evidence_id=EVENT_REF)
    row.state = "active"
    db.commit()
    document = {
        "format": "mp-opt-desktop-policy-acknowledgement-v1",
        "instance_id": str(uuid.uuid4()),
        "event_ref": EVENT_REF,
        "entity_id": PROCESSOR_ID,
        "key_id": row.key_id,
        "role": "processor",
        "algorithm": "Ed25519",
        "public_key_sha256": row.public_key_sha256,
        "policy_version": 2,
        "policy_sha256": hashlib.sha256(b"synthetic policy").hexdigest(),
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    proof = sign_document(db, identifier=row.key_id, document=document, kind="desktop_evidence")
    _verify(row, document, proof, DESKTOP_EVIDENCE_NAMESPACE)
    with pytest.raises(ProcessorEvidenceError, match="another event or key"):
        sign_document(db, identifier=row.key_id, document=document | {"event_ref": str(uuid.uuid4())}, kind="desktop_evidence")
    with pytest.raises(ProcessorEvidenceError, match="typed Desktop evidence"):
        sign_document(db, identifier=row.key_id, document=document | {"format": "mp-opt-server-deletion-receipt-v1"}, kind="desktop_evidence")


def test_processor_rotation_is_identity_bound_and_retirement_blocks_new_signatures(custody_db):
    db, store, _engine = custody_db
    previous = generate_key(db, processor_id=PROCESSOR_ID, event_evidence_id=EVENT_REF)
    previous.state = "active"; db.commit()
    successor = generate_key(db, processor_id=PROCESSOR_ID, event_evidence_id=EVENT_REF, supersedes_key_id=previous.key_id)
    assert successor.supersedes_key_id == previous.key_id
    challenge = _challenge(successor)
    challenge["action"] = "rotate"
    challenge["supersedes_key_id"] = previous.key_id
    challenge["reason"] = "routine"
    action = {
        "format": "mp-opt-processor-event-action-v1", "action": challenge["action"],
        "instance_id": challenge["instance_id"], "event_ref": challenge["event_ref"],
        "entity_id": challenge["entity_id"], "key_id": challenge["key_id"],
        "role": challenge["role"], "algorithm": challenge["algorithm"],
        "public_key_sha256": challenge["public_key_sha256"],
        "supersedes_key_id": challenge["supersedes_key_id"], "reason": challenge["reason"],
    }
    challenge["action_sha256"] = hashlib.sha256(canonical_json(action)).hexdigest()
    continuity = sign_rotation_continuity(
        db,
        previous_identifier=previous.key_id,
        successor_identifier=successor.key_id,
        document=challenge,
    )
    _verify(previous, challenge, continuity)
    with pytest.raises(ProcessorEvidenceError, match="identity"):
        generate_key(db, processor_id="prc-different0001", event_evidence_id=EVENT_REF, supersedes_key_id=previous.key_id)
    retire_key(db, identifier=previous.key_id)
    assert store.values, "retirement must not silently destroy historic verification custody"
    with pytest.raises(ProcessorEvidenceError, match="not active"):
        sign_document(db, identifier=previous.key_id, document=_challenge(previous), kind="registration")


def test_pages_encrypted_package_imports_without_private_database_material(custody_db):
    db, store, engine = custody_db
    passphrase = "synthetic processor passphrase"
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode("ascii")
    fingerprint = hashlib.sha256(public.encode("ascii")).hexdigest()
    public_package = {
        "format": "mp-opt-processor-public-key-v1", "instance_id": None,
        "entity_id": "prc-1234567890abcdef", "key_id": f"ek-{fingerprint[:16]}",
        "role": "processor", "algorithm": "Ed25519", "public_key": public,
        "public_key_sha256": fingerprint, "supersedes_key_id": None,
        "rotation_reason": None, "display_label": "Imported workstation",
        "created_at": "2026-08-03T20:00:00Z", "signature_namespace": TRUST_NAMESPACE,
    }
    salt = b"s" * 16; iv = b"i" * 12
    derived = PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt, iterations=600000).derive(passphrase.encode())
    ciphertext = AESGCM(derived).encrypt(
        iv,
        private.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()),
        canonical_json(public_package),
    )
    package = {
        "format": "mp-opt-processor-private-key-v1", "public_package": public_package,
        "kdf": {"name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": base64.b64encode(salt).decode()},
        "cipher": {"name": "AES-GCM", "iv": base64.b64encode(iv).decode(), "tag_length": 128},
        "ciphertext": base64.b64encode(ciphertext).decode(),
    }
    row = import_encrypted_key(db, package=package, passphrase=passphrase, event_evidence_id=EVENT_REF)
    assert row.key_id == public_package["key_id"]
    assert row.state == "pending_root_approval"
    assert len(store.values) == 1
    raw = db.execute(text("SELECT public_key FROM processor_evidence_keys WHERE key_id=:key_id"), {"key_id": row.key_id}).scalar_one()
    assert "PRIVATE" not in raw
    with pytest.raises(ProcessorEvidenceError, match="passphrase or encrypted package"):
        import_encrypted_key(db, package=package, passphrase="definitely wrong passphrase", event_evidence_id=str(uuid.uuid4()))
