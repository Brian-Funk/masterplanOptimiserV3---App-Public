import asyncio
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1 import mp_backend
from app.db.database import Base
from app.models import Capability, Event, Person, Task, TaskTemplate, TaskType


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def test_capability_requirements_use_bounded_labels():
    by_id = {
        7: Capability(id=7, machine_name="driver", name="Driver"),
    }
    by_machine_name = {
        "driver": by_id[7],
    }

    assert mp_backend._published_capability_labels(
        [{"id": 7, "quantity": 2}, {"machine_name": "driver", "amount": 1}],
        by_id,
        by_machine_name,
    ) == ["Driver ×2", "Driver"]


@pytest.mark.parametrize("value", [
    [{"id": 999, "quantity": 1}],
    [{"id": 7, "quantity": 0}],
    {"id": 7, "quantity": 1},
])
def test_invalid_capability_requirements_fail_closed(value):
    with pytest.raises(ValueError):
        mp_backend._published_capability_labels(value, {}, {})


def test_publish_uses_one_wire_type_per_capability_field(db_session, monkeypatch):
    event = Event(
        name="Synthetic event",
        start_date=date(2032, 4, 21),
        end_date=date(2032, 4, 21),
        meta_data={"schedule_day_range": {"startHour": 6, "endHour": 24}},
    )
    task_type = TaskType(name="Operational task", color="#123456")
    capability = Capability(machine_name="driver", name="Driver")
    db_session.add_all([event, task_type, capability])
    db_session.flush()
    template = TaskTemplate(
        machine_name="driver_task",
        name="Driver task",
        task_type_id=task_type.id,
        fields=[{
            "id": "field_driver",
            "name": "Driver",
            "type": "capabilities_list",
        }],
    )
    person = Person(event_id=event.id, first_name="Synthetic", last_name="Person")
    db_session.add_all([template, person])
    db_session.flush()
    assigned = Task(
        event_id=event.id,
        task_template_id=template.id,
        task_type_id=task_type.id,
        title="Assigned task",
        constraints={
            "start_time": 9 * 60,
            "end_time": 10 * 60,
            "field_values": {
                "field_driver": [{"id": capability.id, "quantity": 1}],
            },
        },
        final={
            "start_time": 9 * 60,
            "end_time": 10 * 60,
            "field_assignments": {"field_driver": [person.id]},
        },
        additional={"date": "2032-04-21"},
    )
    db_session.add(assigned)
    db_session.commit()

    captured = {}

    class Response:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"tasks_created": 1, "persons_created": 1}

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, **kwargs):
            captured["payload"] = kwargs["json"]
            return Response()

    async def acknowledged(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(
        mp_backend,
        "_get_connection",
        lambda *_args: ("https://server.example", "synthetic-secret"),
    )
    monkeypatch.setattr(mp_backend, "_require_current_policy_acknowledgement", acknowledged)
    monkeypatch.setattr(mp_backend.httpx, "AsyncClient", Client)

    result = asyncio.run(mp_backend.publish_to_mp_backend(event.id, None, db_session))

    assert result.tasks_created == 1
    published = {task["name"]: task for task in captured["payload"]["tasks"]}
    assigned_wire = published["Assigned task"]
    assert assigned_wire["field_values"] is None
    assert assigned_wire["field_assignments"] == {
        "field_driver": [{"name": "Synthetic Person", "person_id": person.id}],
    }
    assert assigned_wire["field_definitions"][0]["type"] == "persons_list"


def test_publish_rejects_incomplete_capability_allocation(db_session, monkeypatch):
    event = Event(
        name="Synthetic event",
        start_date=date(2032, 4, 21),
        end_date=date(2032, 4, 21),
        meta_data={"schedule_day_range": {"startHour": 6, "endHour": 24}},
    )
    task_type = TaskType(name="Operational task", color="#123456")
    capability = Capability(machine_name="orga", name="Orga")
    db_session.add_all([event, task_type, capability])
    db_session.flush()
    template = TaskTemplate(
        machine_name="transfer",
        name="Transfer",
        task_type_id=task_type.id,
        fields=[
            {"id": "front", "name": "Front-Orga", "type": "capabilities_list"},
            {"id": "back", "name": "Back-Orga", "type": "capabilities_list"},
        ],
    )
    person = Person(event_id=event.id, first_name="Synthetic", last_name="Person")
    db_session.add_all([template, person])
    db_session.flush()
    task = Task(
        event_id=event.id,
        task_template_id=template.id,
        task_type_id=task_type.id,
        title="Incomplete transfer",
        constraints={
            "start_time": 9 * 60,
            "end_time": 10 * 60,
            "field_values": {
                "front": [{"id": capability.id, "quantity": 1}],
                "back": [{"id": capability.id, "quantity": 1}],
            },
        },
        final={
            "start_time": 9 * 60,
            "end_time": 10 * 60,
            "field_assignments": {"front": [person.id]},
        },
        additional={"date": "2032-04-21"},
    )
    db_session.add(task)
    db_session.commit()

    async def acknowledged(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(
        mp_backend,
        "_get_connection",
        lambda *_args: ("https://server.example", "synthetic-secret"),
    )
    monkeypatch.setattr(
        mp_backend,
        "_require_current_policy_acknowledgement",
        acknowledged,
    )

    with pytest.raises(mp_backend.HTTPException) as exc_info:
        asyncio.run(mp_backend.publish_to_mp_backend(event.id, None, db_session))

    assert exc_info.value.status_code == 409
    assert "Back-Orga" in str(exc_info.value.detail)
    assert "Re-run optimisation" in str(exc_info.value.detail)

    task.final = {
        "start_time": 9 * 60,
        "end_time": 10 * 60,
        "field_assignments": {
            "front": [person.id],
            "back": [person.id],
        },
    }
    db_session.commit()

    with pytest.raises(mp_backend.HTTPException) as duplicate_exc:
        asyncio.run(mp_backend.publish_to_mp_backend(event.id, None, db_session))

    assert duplicate_exc.value.status_code == 409
    assert "more than one allocation field" in str(duplicate_exc.value.detail)


def test_publish_converts_concrete_transferees_to_bounded_people(db_session, monkeypatch):
    event = Event(
        name="Synthetic transfer event",
        start_date=date(2032, 4, 21),
        end_date=date(2032, 4, 21),
        meta_data={"schedule_day_range": {"startHour": 6, "endHour": 24}},
    )
    task_type = TaskType(name="Transfer", color="#123456")
    front_capability = Capability(machine_name="front_orga", name="Front-Orga")
    side_capability = Capability(machine_name="side_orga", name="Side-Orga")
    db_session.add_all([event, task_type, front_capability, side_capability])
    db_session.flush()
    template = TaskTemplate(
        machine_name="transfer",
        name="Transfer",
        task_type_id=task_type.id,
        fields=[
            {"id": "people_transferee", "name": "Transferee", "type": "transferee"},
            {"id": "text_transferee", "name": "Transferee", "type": "text"},
            {"id": "front", "name": "Front-Orga", "type": "capabilities_list"},
            {"id": "side", "name": "Side-Orga", "type": "capabilities_list"},
            {"id": "back", "name": "Back-Orga", "type": "capabilities_list"},
            {
                "id": "dynamic_limit",
                "name": "Dynamic allocation limit",
                "type": "dynamic_transfer_allocation",
            },
        ],
    )
    people = [
        Person(event_id=event.id, first_name="Synthetic", last_name=f"Person {index}")
        for index in range(1, 7)
    ]
    db_session.add_all([template, *people])
    db_session.flush()
    task = Task(
        event_id=event.id,
        task_template_id=template.id,
        task_type_id=task_type.id,
        title="Pilatus Transfer",
        constraints={
            "start_time": 20 * 60 + 5,
            "end_time": 20 * 60 + 40,
            "field_values": {
                "people_transferee": [people[0].id, people[1].id],
                "text_transferee": "Synthetic delegations",
                "front": [{"id": front_capability.id, "quantity": 1}],
                "side": [{"id": side_capability.id, "quantity": 2}],
                "back": [{"id": side_capability.id, "quantity": 1}],
                "dynamic_limit": 4,
            },
        },
        final={
            "start_time": 20 * 60 + 5,
            "end_time": 20 * 60 + 40,
            "field_assignments": {
                "people_transferee": [people[0].id, people[1].id],
                "front": [people[2].id],
                "side": [people[3].id, people[4].id],
                "back": [people[5].id],
            },
        },
        additional={"date": "2032-04-21"},
    )
    db_session.add(task)
    db_session.commit()

    captured = {}

    class Response:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"tasks_created": 1, "persons_created": len(people)}

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, **kwargs):
            captured["payload"] = kwargs["json"]
            return Response()

    async def acknowledged(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(
        mp_backend,
        "_get_connection",
        lambda *_args: ("https://server.example", "synthetic-secret"),
    )
    monkeypatch.setattr(
        mp_backend,
        "_require_current_policy_acknowledgement",
        acknowledged,
    )
    monkeypatch.setattr(mp_backend.httpx, "AsyncClient", Client)

    result = asyncio.run(mp_backend.publish_to_mp_backend(event.id, None, db_session))

    assert result.tasks_created == 1
    published = captured["payload"]["tasks"][0]
    definitions = published["field_definitions"]
    assert [definition["id"] for definition in definitions] == [
        "people_transferee",
        "text_transferee",
        "front",
        "side",
        "back",
    ]
    assert [definition["type"] for definition in definitions] == [
        "persons_list",
        "text",
        "persons_list",
        "persons_list",
        "persons_list",
    ]
    assert published["field_values"] == {"text_transferee": "Synthetic delegations"}
    assert {
        field_id: [person["person_id"] for person in assigned_people]
        for field_id, assigned_people in published["field_assignments"].items()
    } == {
        "people_transferee": [people[0].id, people[1].id],
        "front": [people[2].id],
        "side": [people[3].id, people[4].id],
        "back": [people[5].id],
    }
    assert all(
        definition["type"] not in {"transferee", "dynamic_transfer_allocation", "capabilities_list"}
        for definition in definitions
    )
