from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.app_settings import (
    PublishTargetPayload,
    ShortcutSettingsPayload,
    get_publish_target,
    get_shortcuts,
    reset_shortcuts,
    set_publish_target,
    set_shortcuts,
)
from app.api.v1.capabilities import CapabilityCreate, create_capability, get_capabilities
from app.api.v1.persons import get_persons
from app.api.v1.task_templates import TaskTemplateCreate, create_template
from app.db.database import Base
from app.models import AppSettings, Capability, CapabilityType, Event, Person, PersonCapability, TaskType


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.mark.asyncio
async def test_publish_target_defaults_to_none_and_round_trips_valid_targets(db_session):
    default_response = await get_publish_target(db=db_session)
    assert default_response.target == "none"

    for target in ("none", "google", "mp-backend", "both"):
        saved = await set_publish_target(
            PublishTargetPayload(target=target),
            db=db_session,
        )
        loaded = await get_publish_target(db=db_session)
        assert saved.target == target
        assert loaded.target == target


@pytest.mark.asyncio
async def test_publish_target_rejects_invalid_targets(db_session):
    with pytest.raises(HTTPException) as exc:
        await set_publish_target(
            PublishTargetPayload(target="server"),
            db=db_session,
        )

    assert exc.value.status_code == 400
    assert "none" in exc.value.detail


@pytest.mark.asyncio
async def test_publish_target_treats_blank_or_unknown_stored_values_as_none(db_session):
    db_session.add(AppSettings(key="publish_target", value=""))
    db_session.commit()
    assert (await get_publish_target(db=db_session)).target == "none"

    row = db_session.query(AppSettings).filter(AppSettings.key == "publish_target").first()
    row.value = "server"
    db_session.commit()
    assert (await get_publish_target(db=db_session)).target == "none"


@pytest.mark.asyncio
async def test_shortcuts_default_to_empty_overrides(db_session):
    response = await get_shortcuts(db=db_session)
    assert response.shortcuts == {}


@pytest.mark.asyncio
async def test_shortcuts_round_trip_and_reset(db_session):
    saved = await set_shortcuts(
        ShortcutSettingsPayload(
            shortcuts={
                "optimised.openMetrics": "Ctrl+Shift+M",
                "presentation.toggleView": "V",
            }
        ),
        db=db_session,
    )
    assert saved.shortcuts == {
        "optimised.openMetrics": "Ctrl+Shift+M",
        "presentation.toggleView": "V",
    }

    loaded = await get_shortcuts(db=db_session)
    assert loaded.shortcuts == saved.shortcuts

    await reset_shortcuts(db=db_session)
    assert (await get_shortcuts(db=db_session)).shortcuts == {}


@pytest.mark.asyncio
async def test_shortcuts_invalid_stored_json_falls_back_to_empty(db_session):
    db_session.add(AppSettings(key="keyboard_shortcuts", value="{not-json"))
    db_session.commit()

    assert (await get_shortcuts(db=db_session)).shortcuts == {}


@pytest.mark.asyncio
async def test_capabilities_are_sorted_by_type_then_machine_name(db_session):
    early_type = CapabilityType(name="Early", sort_order=0)
    late_type = CapabilityType(name="Late", sort_order=100)
    db_session.add_all([early_type, late_type])
    db_session.commit()

    z_cap = Capability(machine_name="z_cap", name="A Display", capability_type_id=early_type.id)
    b_cap = Capability(machine_name="b_cap", name="B Display", capability_type_id=early_type.id)
    a_cap = Capability(machine_name="a_cap", name="Z Display", capability_type_id=late_type.id)
    m_cap = Capability(machine_name="m_cap", name="M Display", capability_type_id=None)
    db_session.add_all([z_cap, b_cap, a_cap, m_cap])
    db_session.commit()

    all_caps = await get_capabilities(event_id=None, db=db_session)
    assert [cap.machine_name for cap in all_caps] == ["m_cap", "b_cap", "z_cap", "a_cap"]

    event = Event(
        name="Event",
        location="Venue",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 2),
        enabled_capability_ids=[z_cap.id, a_cap.id],
    )
    db_session.add(event)
    db_session.commit()

    event_caps = await get_capabilities(event_id=event.id, db=db_session)
    assert [cap.machine_name for cap in event_caps] == ["z_cap", "a_cap"]


@pytest.mark.asyncio
async def test_capability_machine_name_rejects_unicode_identifier_but_allows_unicode_display_name(db_session):
    cap_type = CapabilityType(name="People", sort_order=0)
    db_session.add(cap_type)
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await create_capability(
            CapabilityCreate(
                machine_name="ćapability",
                name="Ćapability",
                capability_type_id=cap_type.id,
            ),
            db=db_session,
        )

    assert exc.value.status_code == 400
    assert "ASCII" in exc.value.detail

    created = await create_capability(
        CapabilityCreate(
            machine_name="valid_capability",
            name="Zaświadczać",
            capability_type_id=cap_type.id,
        ),
        db=db_session,
    )

    assert created.machine_name == "valid_capability"
    assert created.name == "Zaświadczać"


@pytest.mark.asyncio
async def test_task_template_machine_name_rejects_unicode_identifier_but_allows_unicode_display_name(db_session):
    task_type = TaskType(name="Session", sort_order=0)
    db_session.add(task_type)
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await create_template(
            TaskTemplateCreate(
                machine_name="demo_ć",
                name="Demo ć",
                task_type_id=task_type.id,
                fields=[],
            ),
            db=db_session,
        )

    assert exc.value.status_code == 400
    assert "ASCII" in exc.value.detail

    created = await create_template(
        TaskTemplateCreate(
            machine_name="demo_template",
            name="Zaświadczać template",
            task_type_id=task_type.id,
            fields=[],
        ),
        db=db_session,
    )

    assert created.machine_name == "demo_template"
    assert created.name == "Zaświadczać template"


@pytest.mark.asyncio
async def test_person_capabilities_are_returned_in_type_then_machine_name_order(db_session):
    early_type = CapabilityType(name="Early", sort_order=0)
    late_type = CapabilityType(name="Late", sort_order=100)
    db_session.add_all([early_type, late_type])
    db_session.commit()

    event = Event(
        name="Event",
        location="Venue",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 2),
    )
    db_session.add(event)
    db_session.commit()

    z_cap = Capability(machine_name="z_cap", name="A Display", capability_type_id=early_type.id)
    b_cap = Capability(machine_name="b_cap", name="B Display", capability_type_id=early_type.id)
    a_cap = Capability(machine_name="a_cap", name="Z Display", capability_type_id=late_type.id)
    db_session.add_all([z_cap, b_cap, a_cap])
    db_session.commit()

    person = Person(
        event_id=event.id,
        first_name="Ada",
        last_name="Lovelace",
    )
    db_session.add(person)
    db_session.commit()

    db_session.add_all(
        [
            PersonCapability(person_id=person.id, capability_id=z_cap.id),
            PersonCapability(person_id=person.id, capability_id=b_cap.id),
            PersonCapability(person_id=person.id, capability_id=a_cap.id),
        ]
    )
    db_session.commit()

    persons = await get_persons(event_id=event.id, db=db_session)
    assert persons[0]["capabilities"] == ["b_cap", "z_cap", "a_cap"]
    assert "global_data" not in persons[0]
