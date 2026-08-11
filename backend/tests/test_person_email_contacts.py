"""Email-only operational contact contracts for Desktop people."""

import asyncio

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.api.v1.data_management import validate_import_payload
from app.api.v1.mp_backend import export_server_setup
from app.api.v1.persons import (
    PersonCreate,
    PersonUpdate,
    create_person,
    update_person,
)
from app.core.data_sanitation import erase_retired_person_phone_values
from app.db.database import Base
from app.models import Event, Location, Person


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(autoflush=False, bind=engine)()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def _event_and_location(db):
    event = Event(name="Email transport")
    db.add(event)
    db.flush()
    location = Location(event_id=event.id, name="Synthetic room")
    db.add(location)
    db.commit()
    return event, location


def test_new_person_schema_has_no_phone_column():
    engine = create_engine("sqlite:///:memory:")
    try:
        Base.metadata.create_all(engine)
        columns = {column["name"] for column in inspect(engine).get_columns("persons")}
        assert "email" in columns
        assert "phone" not in columns
    finally:
        engine.dispose()


def test_startup_sanitation_erases_phone_values_without_converting_them():
    engine = create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE persons (id INTEGER PRIMARY KEY, email TEXT, phone TEXT)"
            ))
            connection.execute(
                text("INSERT INTO persons (email, phone) VALUES (:email, :phone)"),
                {"email": None, "phone": "+41 00 000 00 00"},
            )

        erased = erase_retired_person_phone_values(
            engine,
            {"id", "email", "phone"},
        )
        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT email, phone FROM persons")
            ).one()

        assert erased == 1
        assert row.email is None
        assert row.phone is None
        assert erase_retired_person_phone_values(
            engine,
            {"id", "email", "phone"},
        ) == 0
    finally:
        engine.dispose()


def test_person_api_rejects_retired_phone_input():
    with pytest.raises(ValidationError, match="phone"):
        PersonCreate.model_validate({
            "first_name": "Retired",
            "last_name": "Contact",
            "phone": "+41 00 000 00 00",
            "home_location_id": 1,
        })


def test_person_email_can_be_created_changed_and_cleared(db_session):
    event, location = _event_and_location(db_session)
    created = asyncio.run(create_person(
        PersonCreate(
            first_name="Email",
            last_name="Person",
            email="first@example.org",
            home_location_id=location.id,
        ),
        event.id,
        db_session,
    ))
    assert created["email"] == "first@example.org"

    changed = asyncio.run(update_person(
        created["id"],
        PersonUpdate(email="second@example.org"),
        event.id,
        db_session,
    ))
    assert changed["email"] == "second@example.org"

    cleared = asyncio.run(update_person(
        created["id"],
        PersonUpdate(email=None),
        event.id,
        db_session,
    ))
    assert cleared["email"] is None


def test_setup_export_preserves_optional_person_email(db_session):
    event, location = _event_and_location(db_session)
    db_session.add_all([
        Person(
            event_id=event.id,
            first_name="Has",
            last_name="Email",
            email="has.email@example.org",
            home_location_id=location.id,
        ),
        Person(
            event_id=event.id,
            first_name="No",
            last_name="Email",
            email=None,
            home_location_id=location.id,
        ),
    ])
    db_session.commit()

    exported = asyncio.run(export_server_setup(event.id, db_session))
    by_name = {user.display_name: user for user in exported.users}

    assert by_name["Has Email"].email == "has.email@example.org"
    assert by_name["No Email"].email is None


def test_current_project_import_rejects_retired_phone_field():
    result = validate_import_payload({
        "version": 2,
        "global_data": {
            "task_types": [],
            "capability_types": [],
            "capabilities": [],
            "task_templates": [],
            "group_types": [],
            "leadership_levels": [],
            "group_roles": [],
            "assignment_sources": [],
            "calendar_export_formats": [],
        },
        "events": [{
            "event": {"id": 1, "name": "Imported"},
            "locations": [],
            "persons": [{
                "id": 1,
                "first_name": "Retired",
                "last_name": "Contact",
                "phone": "+41 00 000 00 00",
            }],
        }],
    })

    retired = [issue for issue in result.errors if issue.title == "Retired person phone field"]
    assert len(retired) == 1
    assert retired[0].path == "events[0].persons[0].phone"
