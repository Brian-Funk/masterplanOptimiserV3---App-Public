"""Synthetic Desktop processor-key custody and role-separation tests."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import uuid

import pytest
from pydantic import ValidationError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.api.v1.operator_evidence import GenerateProcessorKeyRequest
from app.core.operator_evidence import (
    TRUST_NAMESPACE,
    ProcessorEvidenceError,
    action_payload,
    canonical_json,
    generate_key,
    registration_file,
    retire_key,
    sign_document,
)
from app.core.secure_credentials import set_credential_store_for_tests
from app.db.database import Base


PROCESSOR_ID = "prc-synthetic0001"


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
        "format": "mp-opt-trust-key-registration-v1",
        "challenge_id": str(uuid.uuid4()),
        "action": "register",
        "instance_id": instance_id or str(uuid.uuid4()),
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
    document["action_sha256"] = hashlib.sha256(canonical_json(action_payload(document))).hexdigest()
    return document


def _verify(row, document: dict, proof: dict) -> None:
    public = serialization.load_ssh_public_key(row.public_key.encode("ascii"))
    assert isinstance(public, Ed25519PublicKey)
    public.verify(
        base64.b64decode(proof["signature"], validate=True),
        TRUST_NAMESPACE.encode("ascii") + b"\0" + canonical_json(document),
    )


def test_processor_key_only_enters_os_store_and_public_metadata(custody_db):
    db, store, engine = custody_db
    private_key_label = "PRIVATE" + " KEY"
    private_key_marker = f"-----BEGIN {private_key_label}-----"
    row = generate_key(db, processor_id=PROCESSOR_ID)
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
            "processor_id": PROCESSOR_ID,
            "role": "controller",
        })
    with pytest.raises(ValidationError):
        GenerateProcessorKeyRequest.model_validate({
            "processor_id": PROCESSOR_ID,
            "private_key": private_key_marker,
        })


def test_registration_binds_instance_processor_role_fingerprint_action_and_expiry(custody_db):
    db, _store, _engine = custody_db
    row = generate_key(db, processor_id=PROCESSOR_ID)
    challenge = _challenge(row)
    proof = sign_document(db, identifier=row.key_id, document=challenge, kind="registration")
    _verify(row, challenge, proof)

    for change, message in (
        ({"entity_id": "prc-different0001"}, "identity|role"),
        ({"role": "controller"}, "identity|role"),
        ({"instance_id": str(uuid.uuid4())}, "action digest"),
        ({"action_sha256": "0" * 64}, "action digest"),
    ):
        with pytest.raises(ProcessorEvidenceError, match=message):
            sign_document(db, identifier=row.key_id, document=challenge | change, kind="registration")
    with pytest.raises(ProcessorEvidenceError, match="expired"):
        sign_document(db, identifier=row.key_id, document=_challenge(row, expires_in=-1), kind="registration")


def test_processor_key_signs_only_bounded_processor_statements(custody_db):
    db, _store, _engine = custody_db
    row = generate_key(db, processor_id=PROCESSOR_ID)
    document = {
        "format": "mp-opt-processor-statement-v1",
        "instance_id": str(uuid.uuid4()),
        "entity_id": PROCESSOR_ID,
        "key_id": row.key_id,
        "role": "processor",
        "algorithm": "Ed25519",
        "public_key_sha256": row.public_key_sha256,
        "statement_type": "conversion",
        "statement_sha256": hashlib.sha256(b"synthetic conversion receipt").hexdigest(),
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    proof = sign_document(db, identifier=row.key_id, document=document, kind="statement")
    _verify(row, document, proof)
    with pytest.raises(ProcessorEvidenceError, match="wrong key, identity, or role"):
        sign_document(db, identifier=row.key_id, document=document | {"role": "controller"}, kind="statement")
    with pytest.raises(ProcessorEvidenceError, match="fields"):
        sign_document(db, identifier=row.key_id, document=document | {"controller_declaration": True}, kind="statement")


def test_processor_rotation_is_identity_bound_and_retirement_blocks_new_signatures(custody_db):
    db, store, _engine = custody_db
    previous = generate_key(db, processor_id=PROCESSOR_ID)
    successor = generate_key(db, processor_id=PROCESSOR_ID, supersedes_key_id=previous.key_id)
    assert successor.supersedes_key_id == previous.key_id
    with pytest.raises(ProcessorEvidenceError, match="identity"):
        generate_key(db, processor_id="prc-different0001", supersedes_key_id=previous.key_id)
    retire_key(db, identifier=previous.key_id)
    assert store.values, "retirement must not silently destroy historic verification custody"
    with pytest.raises(ProcessorEvidenceError, match="not active"):
        sign_document(db, identifier=previous.key_id, document=_challenge(previous), kind="registration")
