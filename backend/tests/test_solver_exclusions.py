from datetime import date

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.task_instances import (
    SolverExclusionUpdate,
    delete_task_instance,
    delete_task_instances_for_event,
    list_solver_exclusions,
    set_solver_exclusions,
)
from app.api.v1.flow_check import FlowCheckRequest, check_flow_endpoint
from app.api.v1.optimize import start_optimization
from app.db.database import Base
from app.core.solver_exclusions import filter_solver_active_tasks
from app.models import Event, TaskInstance, TaskInstanceSolverExclusion
from app.schemas.optimization import OptimizeRequest


@pytest.fixture()
def database():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    try:
        yield session_factory
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _event(db, name: str) -> Event:
    event = Event(
        name=name,
        location="Synthetic venue",
        start_date=date(2035, 1, 1),
        end_date=date(2035, 1, 2),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _task(db, event_id: int, name: str) -> TaskInstance:
    task = TaskInstance(
        event_id=event_id,
        name=name,
        date="2035-01-01",
        field_values={"note": name},
        constraints={"fixed": True},
        optimised={"start_time": 600},
        final={"start_time": 610},
        additional={"safe": "metadata"},
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def test_solver_exclusion_persists_without_mutating_task(database):
    db = database()
    event = _event(db, "Persistent exclusions")
    task = _task(db, event.id, "Blocking task")
    event_id = event.id
    task_id = task.id
    original = {
        "field_values": task.field_values,
        "constraints": task.constraints,
        "optimised": task.optimised,
        "final": task.final,
        "additional": task.additional,
        "updated_at": task.updated_at,
    }

    response = set_solver_exclusions(
        SolverExclusionUpdate(task_instance_ids=[task_id], ignored=True),
        event_id=event_id,
        db=db,
    )
    assert response.ignored_task_instance_ids == [task_id]
    db.close()

    reopened = database()
    assert list_solver_exclusions(event_id=event_id, db=reopened).ignored_task_instance_ids == [
        task_id
    ]
    persisted = reopened.query(TaskInstance).filter(TaskInstance.id == task_id).one()
    for field, value in original.items():
        assert getattr(persisted, field) == value
    reopened.close()


def test_solver_exclusion_bulk_updates_are_idempotent(database):
    db = database()
    event = _event(db, "Bulk exclusions")
    first = _task(db, event.id, "First")
    second = _task(db, event.id, "Second")

    body = SolverExclusionUpdate(
        task_instance_ids=[first.id, first.id, second.id],
        ignored=True,
    )
    assert set_solver_exclusions(body, event.id, db).ignored_task_instance_ids == [
        first.id,
        second.id,
    ]
    assert set_solver_exclusions(body, event.id, db).ignored_task_instance_ids == [
        first.id,
        second.id,
    ]
    assert db.query(TaskInstanceSolverExclusion).count() == 2

    restored = set_solver_exclusions(
        SolverExclusionUpdate(task_instance_ids=[first.id], ignored=False),
        event.id,
        db,
    )
    assert restored.ignored_task_instance_ids == [second.id]


def test_solver_exclusion_rejects_cross_event_batch_atomically(database):
    db = database()
    first_event = _event(db, "First event")
    second_event = _event(db, "Second event")
    first = _task(db, first_event.id, "First")
    other = _task(db, second_event.id, "Other")

    with pytest.raises(HTTPException) as exc:
        set_solver_exclusions(
            SolverExclusionUpdate(
                task_instance_ids=[first.id, other.id],
                ignored=True,
            ),
            first_event.id,
            db,
        )

    assert exc.value.status_code == 404
    assert db.query(TaskInstanceSolverExclusion).count() == 0


def test_task_deletion_removes_solver_exclusion(database):
    db = database()
    event = _event(db, "Deletion cleanup")
    first = _task(db, event.id, "First")
    second = _task(db, event.id, "Second")
    set_solver_exclusions(
        SolverExclusionUpdate(
            task_instance_ids=[first.id, second.id],
            ignored=True,
        ),
        event.id,
        db,
    )

    delete_task_instance(first.id, event.id, db)
    assert db.query(TaskInstanceSolverExclusion).count() == 1

    delete_task_instances_for_event(event.id, db)
    assert db.query(TaskInstanceSolverExclusion).count() == 0


def test_solver_requests_defensively_remove_persisted_exclusions(database):
    db = database()
    event = _event(db, "Defensive filtering")
    ignored = _task(db, event.id, "Ignored")
    active = _task(db, event.id, "Active")
    set_solver_exclusions(
        SolverExclusionUpdate(task_instance_ids=[ignored.id], ignored=True),
        event.id,
        db,
    )

    filtered = filter_solver_active_tasks(db, event.id, [ignored, active])

    assert [task.id for task in filtered] == [active.id]


def test_legacy_synthetic_flow_request_remains_event_optional():
    request = FlowCheckRequest(
        tasks=[{"id": 901, "name": "Synthetic diagnostic task"}],
        persons=[],
        locations=[],
        capabilities=[],
    )

    assert request.event_id is None


@pytest.mark.asyncio
async def test_all_ignored_flow_and_optimisation_requests_are_rejected(database):
    db = database()
    event = _event(db, "Empty solver scope")
    ignored = _task(db, event.id, "Ignored")
    set_solver_exclusions(
        SolverExclusionUpdate(task_instance_ids=[ignored.id], ignored=True),
        event.id,
        db,
    )

    with pytest.raises(HTTPException) as flow_exc:
        await check_flow_endpoint(
            FlowCheckRequest(
                event_id=event.id,
                tasks=[{"id": ignored.id, "event_id": event.id}],
                persons=[],
                locations=[],
                capabilities=[],
            ),
            db=db,
            skip_floating=False,
        )
    assert flow_exc.value.status_code == 422
    assert flow_exc.value.detail["code"] == "NO_ACTIVE_TASKS"

    with pytest.raises(HTTPException) as optimisation_exc:
        await start_optimization(
            OptimizeRequest(
                event_id=event.id,
                date="2035-01-01",
                tasks=[{"id": ignored.id, "event_id": event.id}],
                persons=[],
                locations=[],
                capabilities=[],
                fatigue_scores={},
            ),
            background_tasks=BackgroundTasks(),
            db=db,
        )
    assert optimisation_exc.value.status_code == 422
    assert optimisation_exc.value.detail["code"] == "NO_ACTIVE_TASKS"
