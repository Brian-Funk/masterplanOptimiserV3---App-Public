import asyncio
import importlib.util
import hashlib
import json
import sqlite3
import uuid
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core import encryption
from app.core import operator_evidence
from app.core.desktop_deletion import stage_deletion_report
from app.db.database import Base
from app.models import DesktopDeletionOutbox, Event, Person, PersonUnavailability, ProcessorEvidenceKey


def test_current_encryption_rejects_plaintext_values():
    """The live schema has no transparent plaintext compatibility path."""

    for value in ("plain text", '{"token":"plain"}'):
        try:
            encryption.decrypt_str(value)
        except ValueError as exc:
            assert "Unencrypted text" in str(exc)
        else:
            raise AssertionError("Plaintext encrypted-string value was accepted")

    try:
        encryption.decrypt_json('{"token":"plain"}')
    except ValueError as exc:
        assert "Unencrypted JSON" in str(exc)
    else:
        raise AssertionError("Plaintext encrypted-JSON value was accepted")


def _converter_module():
    path = Path(__file__).resolve().parents[2] / "tools" / "one_off" / "convert_current_desktop_v2.py"
    spec = importlib.util.spec_from_file_location("convert_current_desktop_v2", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _data_management_module():
    path = Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "data_management.py"
    spec = importlib.util.spec_from_file_location("current_data_management", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _mp_backend_module():
    path = Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "mp_backend.py"
    spec = importlib.util.spec_from_file_location("current_mp_backend", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'current.db'}")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(autoflush=False, bind=engine)()


def _activate_processor(db, event, monkeypatch):
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        serialization.Encoding.OpenSSH,
        serialization.PublicFormat.OpenSSH,
    ).decode("ascii")
    fingerprint = hashlib.sha256(public.encode("ascii")).hexdigest()
    row = ProcessorEvidenceKey(
        processor_id="prc-synthetic0001",
        key_id=f"ek-{fingerprint[:16]}",
        role="processor",
        event_evidence_id=event.evidence_id,
        server_instance_id=str(uuid.uuid4()),
        public_key=public,
        public_key_sha256=fingerprint,
        state="active",
    )
    db.add(row)
    db.flush()
    monkeypatch.setattr(operator_evidence, "_load_private", lambda _row: private)
    return row


def _work_order(event, processor, *, subject_ref, operation):
    return {
        "version": 1,
        "work_order_id": str(uuid.uuid4()),
        "event_ref": event.evidence_id,
        "subject_ref": subject_ref,
        "operation": operation,
        "processor_entity_id": processor.processor_id,
    }


def test_subject_erasure_and_report_are_committed_together(tmp_path, monkeypatch):
    monkeypatch.setattr(encryption, "_KEY_PATH", str(tmp_path / "encryption.key"))
    monkeypatch.setattr(encryption, "_fernet", None)
    engine, db = _session(tmp_path)
    try:
        event = Event(name="Current event", start_date=date(2026, 8, 1), end_date=date(2026, 8, 2))
        person = Person(event_id=1, first_name="Data", last_name="Subject")
        db.add(event)
        db.flush()
        person.event_id = event.id
        db.add(person)
        db.flush()
        db.add(PersonUnavailability(
            event_id=event.id,
            person_id=person.id,
            starts_at=datetime(2026, 8, 1, 9),
            ends_at=datetime(2026, 8, 1, 10),
        ))
        processor = _activate_processor(db, event, monkeypatch)
        db.commit()

        row = stage_deletion_report(
            db,
            work_order=_work_order(
                event, processor,
                subject_ref=person.evidence_subject_id,
                operation="delete_subject",
            ),
            claim_capability="one-time-claim",
            server_url="https://server.example",
            publish_secret="publish-secret",
        )
        db.commit()

        assert db.query(Person).count() == 0
        assert db.query(PersonUnavailability).count() == 0
        assert db.query(DesktopDeletionOutbox).one().id == row.id
        report = json.loads(row.report_json)["document"]
        assert report["outcome"] == "deleted"
        assert report["deleted_counts"]["persons"] == 1
        assert report["deleted_counts"]["unavailability_intervals"] == 1
    finally:
        db.close()
        engine.dispose()


def test_pending_report_can_be_retried_after_local_event_erasure(tmp_path, monkeypatch):
    """The outbox carries enough encrypted routing state after event deletion."""

    mp_backend = _mp_backend_module()

    monkeypatch.setattr(encryption, "_KEY_PATH", str(tmp_path / "retry-encryption.key"))
    monkeypatch.setattr(encryption, "_fernet", None)
    engine, db = _session(tmp_path)
    try:
        event = Event(name="Erase all", start_date=date(2026, 8, 1), end_date=date(2026, 8, 2))
        db.add(event)
        db.flush()
        db.add(Person(event_id=event.id, first_name="Only", last_name="Person"))
        db.flush()
        processor = _activate_processor(db, event, monkeypatch)
        event_id = event.id
        row = stage_deletion_report(
            db,
            work_order=_work_order(event, processor, subject_ref=None, operation="delete_event"),
            claim_capability="one-time-claim",
            server_url="https://server.example",
            publish_secret="publish-secret",
        )
        db.commit()
        assert db.query(Event).filter(Event.id == event_id).first() is None

        class Response:
            status_code = 200

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                return Response()

        monkeypatch.setattr(mp_backend.httpx, "AsyncClient", lambda **_kwargs: Client())
        assert asyncio.run(mp_backend._flush_deletion_outbox(db)) == 1
        db.refresh(row)
        assert row.state == "sent"
        assert row.publish_secret is None
        assert row.claim_capability is None
    finally:
        db.close()
        engine.dispose()


def test_subject_erasure_is_idempotent_when_person_is_already_absent(tmp_path, monkeypatch):
    """Desktop reports a zero-count success instead of blocking an already-finished deletion."""

    monkeypatch.setattr(encryption, "_KEY_PATH", str(tmp_path / "idempotent-encryption.key"))
    monkeypatch.setattr(encryption, "_fernet", None)
    engine, db = _session(tmp_path)
    try:
        event = Event(name="Current event", start_date=date(2026, 8, 1), end_date=date(2026, 8, 2))
        db.add(event)
        db.flush()
        processor = _activate_processor(db, event, monkeypatch)
        db.commit()

        row = stage_deletion_report(
            db,
            work_order=_work_order(
                event, processor,
                subject_ref=str(uuid.uuid4()),
                operation="delete_subject",
            ),
            claim_capability="one-time-claim",
            server_url="https://server.example",
            publish_secret="publish-secret",
        )
        db.commit()

        report = json.loads(row.report_json)["document"]
        assert report["outcome"] == "deleted"
        assert all(value == 0 for value in report["deleted_counts"].values())
        assert report["outstanding_actions"] == []
    finally:
        db.close()
        engine.dispose()


def test_deletion_sync_reports_a_stale_selected_event_as_deleted(tmp_path, monkeypatch):
    """The UI receives an explicit signal instead of retaining a deleted event."""

    mp_backend = _mp_backend_module()

    async def no_pending_reports(_db):
        return 0

    monkeypatch.setattr(mp_backend, "_flush_deletion_outbox", no_pending_reports)
    engine, db = _session(tmp_path)
    try:
        result = asyncio.run(mp_backend.sync_deletion_work_orders(404, db))
        assert result.event_deleted is True
        assert result.applied == 0
        assert result.reports_pending == 0
    finally:
        db.close()
        engine.dispose()


def test_pending_deletion_status_is_visible_without_claiming_work(tmp_path, monkeypatch):
    """The Desktop can notify the operator without applying a deletion."""

    mp_backend = _mp_backend_module()
    engine, db = _session(tmp_path)
    try:
        event = Event(name="Pending deletion status")
        db.add(event)
        db.commit()
        monkeypatch.setattr(
            mp_backend,
            "_get_connection",
            lambda _db, _event_id: ("https://server.synthetic", "secret"),
        )

        class Response:
            status_code = 200

            def raise_for_status(self):
                return None

            def json(self):
                return [
                    {"work_order_id": "open", "state": "open"},
                    {"work_order_id": "claimed", "state": "claimed"},
                    {"work_order_id": "complete", "state": "report_received"},
                    "invalid-entry",
                ]

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def get(self, *_args, **_kwargs):
                return Response()

        monkeypatch.setattr(mp_backend.httpx, "AsyncClient", lambda **_kwargs: Client())
        result = asyncio.run(mp_backend.deletion_work_order_status(event.id, db))

        assert result.pending == 2
        assert db.query(DesktopDeletionOutbox).count() == 0
        assert db.query(Person).count() == 0
    finally:
        db.close()
        engine.dispose()


def test_server_policy_bridge_exposes_versioned_privacy_retention_and_features(monkeypatch):
    """Desktop organisers receive the exact Phase 5 policy context."""

    mp_backend = _mp_backend_module()
    monkeypatch.setattr(mp_backend, "_get_connection", lambda _db, _event_id: ("https://server.synthetic", "secret"))
    monkeypatch.setattr(mp_backend, "_stored_policy_acknowledgement", lambda _db, _event_id: None)

    async def policy(_server_url):
        return {
            "version": 5,
            "content_sha256": "a" * 64,
            "controller_legal_name": "Synthetic Controller",
            "permitted_data": {
                "purpose": "Operational scheduling",
                "allowed": ["names"],
                "unsupported": ["health"],
            },
            "retention": {"event_grace_days": 7},
            "feature_disclosures": [
                {"code": "manual_activation", "text": "Manual links."},
                {"code": "dns_only_routing", "text": "Direct TLS."},
                {"code": "public_schedule", "text": "Expiring public links."},
            ],
            "incident_contact_email": "incident@synthetic-controller.ch",
        }

    monkeypatch.setattr(mp_backend, "_current_server_policy", policy)
    result = asyncio.run(mp_backend.server_data_policy(7, db=None))

    assert result["privacy_url"].endswith("/versions/5/privacy.html")
    assert result["policy_url"].endswith("/versions/5/data-policy.html")
    assert result["retention_days"] == 7
    assert result["enabled_optional_features"] == ["public_schedule"]
    assert result["incident_contact"] == "incident@synthetic-controller.ch"


def test_server_policy_bridge_rejects_a_stale_local_acknowledgement(monkeypatch):
    """A local receipt cannot enable publishing after the Server loses the row."""

    mp_backend = _mp_backend_module()
    local = {
        "policy_version": 3,
        "policy_sha256": "a" * 64,
        "key_id": "ek-0123456789abcdef",
        "document_sha256": "b" * 64,
        "operator_subject": "desktop-synthetic",
    }
    monkeypatch.setattr(
        mp_backend, "_get_connection",
        lambda _db, _event_id: ("https://server.synthetic", "secret"),
    )
    monkeypatch.setattr(mp_backend, "_stored_policy_acknowledgement", lambda _db, _event_id: local)

    async def policy(_server_url):
        return {
            "version": 3,
            "content_sha256": "a" * 64,
            "permitted_data": {"purpose": "Scheduling", "allowed": [], "unsupported": []},
            "retention": {},
            "feature_disclosures": [],
        }

    async def missing(_server_url, _secret):
        return {"acknowledged": False, "policy_version": 3, "policy_sha256": "a" * 64}

    monkeypatch.setattr(mp_backend, "_current_server_policy", policy)
    monkeypatch.setattr(mp_backend, "_server_policy_acknowledgement", missing)
    result = asyncio.run(mp_backend.server_data_policy(7, db=None))
    assert result["acknowledged"] is False
    assert result["operator_subject"] is None
    assert result["processor_key_id"] is None


def test_policy_acknowledgement_retries_the_exact_persisted_signature(tmp_path, monkeypatch):
    """An uncertain network result never creates a different signed action."""

    mp_backend = _mp_backend_module()
    engine, db = _session(tmp_path)
    try:
        event = Event(
            name="Synthetic retry", start_date=date(2026, 8, 5), end_date=date(2026, 8, 6),
            mp_backend_url="https://server.synthetic",
        )
        db.add(event)
        db.flush()
        _activate_processor(db, event, monkeypatch)
        db.commit()
        monkeypatch.setattr(
            mp_backend, "_get_connection",
            lambda _db, _event_id: ("https://server.synthetic", "secret"),
        )

        async def policy(_server_url):
            return {"version": 3, "content_sha256": "a" * 64}

        monkeypatch.setattr(mp_backend, "_current_server_policy", policy)
        submitted = []

        class Client:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, _url, *, headers, json):
                assert headers["Authorization"] == "Bearer secret"
                submitted.append(json)
                if len(submitted) == 1:
                    raise mp_backend.httpx.ConnectError("synthetic disconnect")

                class Response:
                    status_code = 201

                    @staticmethod
                    def json():
                        return {
                            "document_sha256": "b" * 64,
                            "instance_record_sha256": "c" * 64,
                            "evidence_package_sha256": "d" * 64,
                        }

                return Response()

        monkeypatch.setattr(mp_backend.httpx, "AsyncClient", Client)
        body = mp_backend.DataPolicyAcknowledgementRequest(
            policy_version=3, policy_sha256="a" * 64,
        )
        try:
            asyncio.run(mp_backend.acknowledge_server_data_policy(event.id, body, db))
        except mp_backend.HTTPException as exc:
            assert exc.status_code == 502
        else:
            raise AssertionError("the synthetic network failure was accepted")
        pending = mp_backend._get_setting(db, mp_backend._pending_policy_ack_key(event.id))
        assert pending

        result = asyncio.run(mp_backend.acknowledge_server_data_policy(event.id, body, db))
        assert result["acknowledged"] is True
        assert submitted[0] == submitted[1]
        assert mp_backend._get_setting(db, mp_backend._pending_policy_ack_key(event.id)) is None
    finally:
        db.close()
        engine.dispose()


def test_one_off_converter_preserves_archive_and_maps_only_typed_fields(tmp_path):
    converter = _converter_module()
    source_path = tmp_path / "source.db"
    source = sqlite3.connect(source_path)
    source.executescript(
        """
        CREATE TABLE events (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT,
            start_date DATE, end_date DATE, meta_data JSON, status TEXT,
            google_calendar_id TEXT, enabled_capability_ids JSON,
            mp_backend_url TEXT, mp_backend_secret TEXT, created_at DATETIME, updated_at DATETIME
        );
        CREATE TABLE persons (
            id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, first_name TEXT NOT NULL,
            last_name TEXT NOT NULL, email TEXT, phone TEXT, google_email TEXT,
            global_data JSON, max_hours_per_day FLOAT, home_location_id INTEGER,
            created_at DATETIME, updated_at DATETIME
        );
        CREATE TABLE capabilities (
            id INTEGER PRIMARY KEY, machine_name TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
            description TEXT, color TEXT, capability_type_id INTEGER, created_at DATETIME
        );
        CREATE TABLE person_capabilities (
            id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL,
            capability_id INTEGER NOT NULL, level INTEGER, notes TEXT
        );
        CREATE TABLE task_templates (
            id INTEGER PRIMARY KEY, machine_name TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL, description TEXT, task_type_id INTEGER,
            fields JSON, is_floating BOOLEAN NOT NULL,
            is_transfer BOOLEAN NOT NULL, is_active BOOLEAN,
            created_at DATETIME, updated_at DATETIME
        );
        CREATE TABLE retired_private_profile (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
        """
    )
    source.execute(
        "INSERT INTO events (id, name, start_date, end_date, status, mp_backend_secret) "
        "VALUES (1, 'Event', '2026-08-01', '2026-08-02', 'draft', 'retired-secret')"
    )
    source.execute(
        "INSERT INTO persons (id, event_id, first_name, last_name, global_data) VALUES (?, ?, ?, ?, ?)",
        (1, 1, "A", "Person", json.dumps({
            "capabilities": ["chair"],
            "unavailabilities": [{"from": "2026-08-01T09:00", "to": "2026-08-01T10:00"}],
            "unsupported_private_note": "kept only in encrypted archive",
        })),
    )
    source.execute("INSERT INTO capabilities (id, machine_name, name) VALUES (1, 'chair', 'Chair')")
    source.execute(
        "INSERT INTO person_capabilities (id, person_id, capability_id, level) "
        "VALUES (1, 1, 1, 2)"
    )
    source.execute(
        "INSERT INTO task_templates "
        "(id, machine_name, name, fields, is_floating, is_transfer, is_active) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "converted", "Converted", json.dumps([
            {"id": "crew", "name": "Crew", "type": "persons_list"},
            {"id": "notes", "name": "Notes", "type": "text"},
            {"id": "limit", "name": "Limit", "type": "dynamic_transfer_allocation"},
        ]), False, False, True),
    )
    source.execute("INSERT INTO retired_private_profile VALUES (1, 'exact original')")
    source.commit()
    source.close()

    source_sha = converter._sha256(source_path)
    read_only = converter._source_connection(source_path)
    try:
        archive, counts = converter.build_archive(read_only, source_sha)
        target = tmp_path / "target.db"
        copied, audit = converter.build_current_database(
            read_only, target, source_sha, Path(__file__).resolve().parents[2]
        )
    finally:
        read_only.close()

    assert converter._sha256(source_path) == source_sha
    assert counts["retired_private_profile"] == 1
    assert archive["tables"]["retired_private_profile"][0]["payload"] == "exact original"
    assert copied["persons"] == 1
    assert audit["typed_fields"]["capability_links_added"] == 0
    assert audit["typed_fields"]["capability_links_already_present"] == 1
    assert audit["typed_fields"]["unavailability_intervals_added"] == 1
    assert audit["typed_fields"]["archived_only_global_fields"] == 1
    assert audit["typed_fields"]["template_fields_classified"] == 2
    assert audit["typed_fields"]["template_fields_pending_review"] == 1
    assert audit["rejected_records"] == []
    assert audit["unexplained_loss"] == []
    assert any(
        item == {
            "table": "persons",
            "column": "global_data",
            "disposition": "mapped_and_archived",
            "non_null_rows": 1,
        }
        for item in audit["field_dispositions"]
    )

    current = sqlite3.connect(target)
    try:
        person_columns = {row[1] for row in current.execute("PRAGMA table_info(persons)")}
        assert "global_data" not in person_columns
        assert "evidence_subject_id" in person_columns
        assert current.execute("SELECT COUNT(*) FROM person_unavailability").fetchone()[0] == 1
        assert current.execute("SELECT COUNT(*) FROM person_capabilities").fetchone()[0] == 1
        assert current.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='retired_private_profile'"
        ).fetchone()[0] == 0
        converted_fields = json.loads(
            current.execute("SELECT fields FROM task_templates WHERE id = 1").fetchone()[0]
        )
        assert converted_fields[0] == {
            "id": "crew",
            "name": "Crew",
            "type": "persons_list",
            "purpose": "assignment",
            "visibility": "participant",
            "classification_reviewed": True,
            "public_visibility_confirmed": False,
        }
        assert converted_fields[1]["visibility"] == "never_publish"
        assert converted_fields[1]["classification_reviewed"] is False
        assert converted_fields[2]["visibility"] == "never_publish"
        assert converted_fields[2]["classification_reviewed"] is True
    finally:
        current.close()


def test_one_off_converter_rejects_source_with_live_wal(tmp_path):
    converter = _converter_module()
    source_path = tmp_path / "source.db"
    writer = sqlite3.connect(source_path)
    try:
        writer.execute("PRAGMA journal_mode=WAL")
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        writer.execute("INSERT INTO events VALUES (1, 'WAL-only event')")
        writer.commit()
        assert Path(f"{source_path}-wal").exists()

        try:
            converter._source_connection(source_path)
        except RuntimeError as exc:
            assert "SQLite companion files" in str(exc)
        else:
            raise AssertionError("Converter ignored a live SQLite WAL")
    finally:
        writer.close()


def test_output_publication_rolls_back_when_later_move_fails(tmp_path, monkeypatch):
    converter = _converter_module()
    temporary = [tmp_path / f"temporary-{index}" for index in range(3)]
    final = [tmp_path / f"final-{index}" for index in range(3)]
    for index, path in enumerate(temporary):
        path.write_text(str(index), encoding="utf-8")

    real_link = converter.os.link
    calls = 0

    def fail_second_move(source, target):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("injected archive publication failure")
        return real_link(source, target)

    monkeypatch.setattr(converter.os, "link", fail_second_move)
    try:
        converter._publish_outputs(list(zip(temporary, final)))
    except OSError as exc:
        assert "injected archive publication failure" in str(exc)
    else:
        raise AssertionError("Injected publication failure was ignored")

    assert calls == 2
    assert not any(path.exists() for path in final)


def test_output_publication_refuses_to_overwrite_existing_file(tmp_path):
    converter = _converter_module()
    temporary = [tmp_path / f"temporary-{index}" for index in range(3)]
    final = [tmp_path / f"final-{index}" for index in range(3)]
    for index, path in enumerate(temporary):
        path.write_text(str(index), encoding="utf-8")
    final[1].write_text("preserve me", encoding="utf-8")

    try:
        converter._publish_outputs(list(zip(temporary, final)))
    except FileExistsError:
        pass
    else:
        raise AssertionError("Converter overwrote an output created before publication")

    assert not final[0].exists()
    assert final[1].read_text(encoding="utf-8") == "preserve me"
    assert not final[2].exists()


def test_live_import_rejects_legacy_or_unversioned_payloads():
    """Legacy conversion stays outside the application import path."""

    validate_import_payload = _data_management_module().validate_import_payload
    older = validate_import_payload({
        "version": 1,
        "type": "full_backup",
        "global_data": {},
        "events": [],
    })
    missing = validate_import_payload({
        "type": "full_backup",
        "global_data": {},
        "events": [],
    })

    assert any(issue.title == "Older file version is unsupported" for issue in older.errors)
    assert any(issue.title == "Missing file version" for issue in missing.errors)
