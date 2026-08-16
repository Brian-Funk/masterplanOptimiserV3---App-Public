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
    unassigned = Task(
        event_id=event.id,
        task_template_id=template.id,
        task_type_id=task_type.id,
        title="Unassigned task",
        constraints={
            "start_time": 10 * 60,
            "end_time": 11 * 60,
            "field_values": {
                "field_driver": [{"id": capability.id, "quantity": 2}],
            },
        },
        final={"start_time": 10 * 60, "end_time": 11 * 60},
        additional={"date": "2032-04-21"},
    )
    db_session.add_all([assigned, unassigned])
    db_session.commit()

    captured = {}

    class Response:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"tasks_created": 2, "persons_created": 1}

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

    assert result.tasks_created == 2
    published = {task["name"]: task for task in captured["payload"]["tasks"]}
    assigned_wire = published["Assigned task"]
    assert assigned_wire["field_values"] is None
    assert assigned_wire["field_assignments"] == {
        "field_driver": [{"name": "Synthetic Person", "person_id": person.id}],
    }
    assert assigned_wire["field_definitions"][0]["type"] == "persons_list"
    unassigned_wire = published["Unassigned task"]
    assert unassigned_wire["field_assignments"] is None
    assert unassigned_wire["field_values"] == {"field_driver": ["Driver ×2"]}
    assert unassigned_wire["field_definitions"][0]["type"] == "capabilities_list"
