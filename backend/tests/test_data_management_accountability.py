import asyncio
import json
from copy import deepcopy
from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.data_management import (
    CopyFromEventRequest,
    ExportRequest,
    FactoryResetRequest,
    _import_event,
    _reject_accountability_identity_conflicts,
    copy_from_event,
    export_data,
    factory_reset,
    validate_import_payload,
)
from app.core import event_deletion
from app.core.event_deletion import (
    cleanup_orphaned_event_scoped_data,
    delete_event_scoped_data,
)
from app.db.database import Base
from app.models import (
    Capability,
    CapabilityType,
    Event,
    Person,
    PersonUnavailability,
    TaskInstance,
    TaskTemplate,
    TaskType,
    Theme,
)


def _session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'data-management.db'}")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(autoflush=False, bind=engine)()


def _event(name: str) -> Event:
    return Event(
        name=name,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 2),
    )


def test_event_deletion_explicitly_erases_unavailability_without_fk_cascades(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(event_deletion, "delete_secret", lambda _key: None)
    engine, db = _session(tmp_path)
    try:
        event = _event("Delete")
        db.add(event)
        db.flush()
        person = Person(event_id=event.id, first_name="Data", last_name="Subject")
        db.add(person)
        db.flush()
        db.add(PersonUnavailability(
            event_id=event.id,
            person_id=person.id,
            starts_at=datetime(2026, 8, 1, 9),
            ends_at=datetime(2026, 8, 1, 10),
        ))
        db.commit()

        delete_event_scoped_data(db, event.id)
        db.commit()

        assert db.query(Event).count() == 0
        assert db.query(Person).count() == 0
        assert db.query(PersonUnavailability).count() == 0
    finally:
        db.close()
        engine.dispose()


def test_factory_reset_explicitly_erases_unavailability_without_fk_cascades(tmp_path):
    engine, db = _session(tmp_path)
    try:
        event = _event("Reset")
        db.add(event)
        db.flush()
        person = Person(event_id=event.id, first_name="Reset", last_name="Subject")
        db.add(person)
        db.flush()
        db.add(PersonUnavailability(
            event_id=event.id,
            person_id=person.id,
            starts_at=datetime(2026, 8, 1, 9),
            ends_at=datetime(2026, 8, 1, 10),
        ))
        db.commit()

        result = asyncio.run(factory_reset(FactoryResetRequest(confirmation="RESET"), db))

        assert result["status"] == "ok"
        assert db.query(Event).count() == 0
        assert db.query(Person).count() == 0
        assert db.query(PersonUnavailability).count() == 0
        assert db.query(Theme).count() == 1
    finally:
        db.close()
        engine.dispose()


def test_orphan_cleanup_removes_unavailability_left_by_older_deletion(tmp_path):
    engine, db = _session(tmp_path)
    try:
        event = _event("Previously deleted")
        db.add(event)
        db.flush()
        person = Person(event_id=event.id, first_name="Old", last_name="Subject")
        db.add(person)
        db.flush()
        db.add(PersonUnavailability(
            event_id=event.id,
            person_id=person.id,
            starts_at=datetime(2026, 8, 1, 9),
            ends_at=datetime(2026, 8, 1, 10),
        ))
        db.commit()
        db.delete(person)
        db.delete(event)
        db.commit()
        assert db.query(PersonUnavailability).count() == 1

        cleanup_orphaned_event_scoped_data(db)
        db.commit()

        assert db.query(PersonUnavailability).count() == 0
    finally:
        db.close()
        engine.dispose()


def test_copy_persons_assigns_unavailability_to_target_event(tmp_path):
    engine, db = _session(tmp_path)
    try:
        source = _event("Source")
        target = _event("Target")
        db.add_all([source, target])
        db.flush()
        person = Person(event_id=source.id, first_name="Copy", last_name="Subject")
        db.add(person)
        db.flush()
        db.add(PersonUnavailability(
            event_id=source.id,
            person_id=person.id,
            starts_at=datetime(2026, 8, 1, 9),
            ends_at=datetime(2026, 8, 1, 10),
        ))
        db.commit()

        result = asyncio.run(copy_from_event(CopyFromEventRequest(
            source_event_id=source.id,
            target_event_id=target.id,
            include=["persons"],
        ), db))

        copied_person = db.query(Person).filter(Person.event_id == target.id).one()
        copied_interval = db.query(PersonUnavailability).filter(
            PersonUnavailability.person_id == copied_person.id
        ).one()
        assert result["summary"]["persons"] == 1
        assert copied_interval.event_id == target.id
        assert copied_interval.starts_at == datetime(2026, 8, 1, 9)
        assert copied_interval.ends_at == datetime(2026, 8, 1, 10)
    finally:
        db.close()
        engine.dispose()


def test_import_remaps_unavailability_to_new_event_and_person(tmp_path):
    engine, db = _session(tmp_path)
    try:
        db.add(_event("Existing"))
        db.commit()
        payload = {
            "event": {
                "id": 77,
                "name": "Imported",
                "start_date": "2026-08-01",
                "end_date": "2026-08-02",
            },
            "persons": [{
                "id": 55,
                "event_id": 77,
                "first_name": "Imported",
                "last_name": "Subject",
            }],
            "person_unavailabilities": [{
                "id": 99,
                "event_id": 77,
                "person_id": 55,
                "starts_at": "2026-08-01T09:00:00",
                "ends_at": "2026-08-01T10:00:00",
            }],
        }

        imported_event = _import_event(db, payload, {})
        db.commit()

        imported_person = db.query(Person).filter(
            Person.event_id == imported_event.id
        ).one()
        interval = db.query(PersonUnavailability).one()
        assert imported_event.id != 77
        assert interval.event_id == imported_event.id
        assert interval.person_id == imported_person.id
    finally:
        db.close()
        engine.dispose()


def test_import_rejects_existing_accountability_identities_before_writes(tmp_path):
    engine, db = _session(tmp_path)
    try:
        event = _event("Existing")
        db.add(event)
        db.flush()
        person = Person(event_id=event.id, first_name="Existing", last_name="Subject")
        db.add(person)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            _reject_accountability_identity_conflicts(db, {
                "events": [{
                    "event": {"evidence_id": event.evidence_id},
                    "persons": [{
                        "evidence_subject_id": person.evidence_subject_id,
                    }],
                }],
            })

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["event_identity_conflicts"] == 1
        assert exc_info.value.detail["person_identity_conflicts"] == 1
        assert not db.new
        assert db.query(Event).count() == 1
        assert db.query(Person).count() == 1
    finally:
        db.close()
        engine.dispose()


def test_shareable_export_keeps_global_setup_and_redacts_event_identifiers(tmp_path):
    engine, db = _session(tmp_path)
    try:
        event = Event(
            name="Private Vienna Session",
            location="Private Assembly Hall",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 2),
            meta_data={"day_aliases": {"2026-08-01": "CMOJ-DAY"}},
        )
        db.add(event)
        db.flush()
        db.add(Person(
            event_id=event.id,
            first_name="Alice",
            last_name="Example",
            email="alice@example.test",
        ))

        task_type = TaskType(
            name="Session support",
            description="Reusable operational work",
            color="#334455",
        )
        capability_type = CapabilityType(
            name="Technical skills",
            description="Skills used by the planning team",
            color="#556677",
        )
        db.add_all([task_type, capability_type])
        db.flush()
        capability = Capability(
            machine_name="technical_support",
            name="Technical support",
            description=(
                "Previously coordinated by Alice Example for Private Vienna Session. "
                "Reference: https://private.example.test/runbook. CMOJ-DAY Driver"
            ),
            capability_type_id=capability_type.id,
        )
        db.add(capability)
        db.add(TaskTemplate(
            machine_name="session_support",
            name="Session support",
            description="Contact alice@example.test before Private Assembly Hall opens.",
            task_type_id=task_type.id,
            fields=[{
                "id": "notes",
                "name": "Notes",
                "type": "text",
                "category": "arbitrary",
                "required": False,
                "locked": False,
                "config": {},
            }],
        ))
        db.flush()
        reusable_checklist = TaskTemplate(
            machine_name="checklist",
            name="Checklist",
            description="Reusable checklist",
            task_type_id=task_type.id,
            fields=[],
        )
        reusable_transfer = Capability(
            machine_name="watch_transfer",
            name="Watch transfer",
            description="Reusable transfer preference",
            capability_type_id=capability_type.id,
        )
        db.add_all([reusable_checklist, reusable_transfer])
        db.flush()
        db.add(TaskInstance(
            name="Checklist",
            event_id=event.id,
            template_id=reusable_checklist.id,
            task_type_id=task_type.id,
            date="2026-08-01",
            field_values={"notes": "food transfer symposium leadership"},
        ))
        db.commit()

        result = asyncio.run(export_data(ExportRequest(scope="shareable"), db))
        rendered = json.dumps(result).casefold()

        assert result["version"] == 2
        assert result["type"] == "app_settings"
        assert result["profile"] == "shareable_setup"
        assert "events" not in result
        assert "alice" not in rendered
        assert "private vienna session" not in rendered
        assert "private assembly hall" not in rendered
        assert "https://private.example.test" not in rendered
        assert "created_at" not in rendered
        assert "updated_at" not in rendered
        assert "generated_at" not in rendered
        assert "day_aliases" not in rendered
        assert "cmoj-day driver" in rendered
        assert result["shareable_setup_report"]["redactions"] >= 4
        assert result["global_data"]["capabilities"][0]["machine_name"] == "technical_support"
        assert any(
            row["machine_name"] == "watch_transfer"
            for row in result["global_data"]["capabilities"]
        )
        assert any(
            row["machine_name"] == "checklist"
            for row in result["global_data"]["task_templates"]
        )
        assert validate_import_payload(deepcopy(result)).isValid is True
    finally:
        db.close()
        engine.dispose()


def test_shareable_export_blocks_identity_in_machine_identifier(tmp_path):
    engine, db = _session(tmp_path)
    try:
        event = _event("Private event")
        db.add(event)
        db.flush()
        db.add(Person(event_id=event.id, first_name="Alice", last_name="Example"))
        capability_type = CapabilityType(name="Skills", color="#123456")
        db.add(capability_type)
        db.flush()
        db.add(Capability(
            machine_name="alice_support",
            name="Support",
            capability_type_id=capability_type.id,
        ))
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(export_data(ExportRequest(scope="shareable"), db))

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "SHAREABLE_SETUP_STRUCTURAL_IDENTIFIER"
        assert exc_info.value.detail["paths"] == [
            "global_data.capabilities[0].machine_name"
        ]
    finally:
        db.close()
        engine.dispose()
