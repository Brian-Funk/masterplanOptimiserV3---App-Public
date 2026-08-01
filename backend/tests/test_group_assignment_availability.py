from datetime import date
from copy import deepcopy

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.group_member_resolution import resolve_group_assignment_for_task
from app.core.normalizer_optimization import (
    OptimizationCapability,
    OptimizationLocation,
    OptimizationPerson,
    OptimizationTask,
    normalize_optimization_input,
)
from app.db.database import Base
from app.models import Event, Group, TaskTemplate, TaskType


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


@pytest.fixture()
def event(db_session):
    row = Event(
        name="Event",
        location="Venue",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 2),
    )
    db_session.add(row)
    db_session.commit()
    return row


def add_group(db_session, event_id, name, members):
    group = Group(event_id=event_id, name=name, meta_data={"members": members})
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)
    return group


def person_refs(*person_ids):
    return [{"type": "person", "id": person_id} for person_id in person_ids]


def resolve_for_group(db_session, group, unavailable=None, task_start=9 * 60, task_end=10 * 60):
    return resolve_group_assignment_for_task(
        [{"type": "group", "id": group.id}],
        db_session,
        {1, 2, 3, 4, 5},
        event_id=group.event_id,
        person_unavailable_intervals=unavailable or {},
        task_start=task_start,
        task_end=task_end,
    )


def test_group_with_one_unavailable_member_filters_runtime_assignment(db_session, event):
    group = add_group(db_session, event.id, "Group A", person_refs(1, 2, 3, 4, 5))
    original_members = deepcopy(group.meta_data["members"])

    resolved = resolve_for_group(db_session, group, {5: [(9 * 60 + 30, 9 * 60 + 45)]})

    assert resolved.person_ids == [1, 2, 3, 4]
    assert resolved.group_person_ids == [1, 2, 3, 4]
    assert resolved.excluded_persons[0].person_id == 5
    assert resolved.excluded_persons[0].reason == "unavailable"
    assert group.meta_data["members"] == original_members


@pytest.mark.parametrize(
    ("interval", "expected_person_ids", "expected_excluded"),
    [
        ((7 * 60, 8 * 60), [1, 2, 3, 4, 5], False),
        ((10 * 60, 11 * 60), [1, 2, 3, 4, 5], False),
        ((8 * 60 + 30, 9 * 60 + 15), [1, 2, 3, 4], True),
        ((9 * 60 + 45, 10 * 60 + 15), [1, 2, 3, 4], True),
        ((8 * 60, 11 * 60), [1, 2, 3, 4], True),
    ],
)
def test_group_availability_overlap_cases(
    db_session,
    event,
    interval,
    expected_person_ids,
    expected_excluded,
):
    group = add_group(db_session, event.id, "Group A", person_refs(1, 2, 3, 4, 5))

    resolved = resolve_for_group(db_session, group, {5: [interval]})

    assert resolved.person_ids == expected_person_ids
    assert [item.person_id for item in resolved.excluded_persons] == (
        [5] if expected_excluded else []
    )


def test_group_availability_does_not_shift_an_adjacent_day_interval(db_session, event):
    group = add_group(db_session, event.id, "Group A", person_refs(5))

    resolved = resolve_for_group(
        db_session,
        group,
        {5: [(24 * 60 + 9 * 60, 24 * 60 + 10 * 60)]},
    )

    assert resolved.person_ids == [5]
    assert resolved.excluded_persons == []


def test_group_availability_matches_linear_overnight_coordinates(db_session, event):
    group = add_group(db_session, event.id, "Group A", person_refs(5))

    resolved = resolve_for_group(
        db_session,
        group,
        {5: [(25 * 60, 26 * 60)]},
        task_start=25 * 60 + 15,
        task_end=25 * 60 + 45,
    )

    assert resolved.person_ids == []
    assert [item.person_id for item in resolved.excluded_persons] == [5]


def test_group_assignment_without_resolvable_time_keeps_members_and_warns(db_session, event):
    group = add_group(db_session, event.id, "Group A", person_refs(1, 2, 3, 4, 5))

    resolved = resolve_for_group(
        db_session,
        group,
        {5: [(9 * 60, 10 * 60)]},
        task_start=None,
        task_end=None,
    )

    assert resolved.person_ids == [1, 2, 3, 4, 5]
    assert resolved.excluded_persons == []
    assert any("could not be checked" in warning for warning in resolved.warnings)


def test_duplicate_person_across_groups_is_included_once(db_session, event):
    group_a = add_group(db_session, event.id, "Group A", person_refs(1, 2))
    group_b = add_group(db_session, event.id, "Group B", person_refs(2, 3))

    resolved = resolve_group_assignment_for_task(
        [{"type": "group", "id": group_a.id}, {"type": "group", "id": group_b.id}],
        db_session,
        {1, 2, 3},
        event_id=event.id,
        person_unavailable_intervals={},
        task_start=9 * 60,
        task_end=10 * 60,
    )

    assert resolved.person_ids == [1, 2, 3]


def test_unavailable_duplicate_person_is_excluded_for_each_group(db_session, event):
    group_a = add_group(db_session, event.id, "Group A", person_refs(1, 2))
    group_b = add_group(db_session, event.id, "Group B", person_refs(2, 3))

    resolved = resolve_group_assignment_for_task(
        [{"type": "group", "id": group_a.id}, {"type": "group", "id": group_b.id}],
        db_session,
        {1, 2, 3},
        event_id=event.id,
        person_unavailable_intervals={2: [(9 * 60 + 15, 9 * 60 + 45)]},
        task_start=9 * 60,
        task_end=10 * 60,
    )

    assert resolved.person_ids == [1, 3]
    assert sorted((item.group_name, item.person_id) for item in resolved.excluded_persons) == [
        ("Group A", 2),
        ("Group B", 2),
    ]


def test_all_group_members_unavailable_warns_without_crashing(db_session, event):
    group = add_group(db_session, event.id, "Group A", person_refs(1, 2))

    resolved = resolve_group_assignment_for_task(
        [{"type": "group", "id": group.id}],
        db_session,
        {1, 2},
        event_id=event.id,
        person_unavailable_intervals={1: [(8 * 60, 11 * 60)], 2: [(8 * 60, 11 * 60)]},
        task_start=9 * 60,
        task_end=10 * 60,
    )

    assert resolved.person_ids == []
    assert [item.person_id for item in resolved.excluded_persons] == [1, 2]
    assert "All members of Group A are unavailable during this task." in resolved.warnings


def test_optimization_normalization_excludes_unavailable_group_members_from_payload(db_session, event):
    task_type = TaskType(name="Session", sort_order=0, fatigue_score=1)
    db_session.add(task_type)
    db_session.commit()

    template = TaskTemplate(
        machine_name="session_template",
        name="Session Template",
        task_type_id=task_type.id,
        fields=[
            {"id": "field_time", "name": "Time", "type": "start_end_time"},
            {"id": "field_people", "name": "People", "type": "persons_list"},
        ],
        is_floating=False,
        is_transfer=False,
    )
    db_session.add(template)
    db_session.commit()

    group = add_group(db_session, event.id, "Group A", person_refs(1, 2, 3, 4, 5))
    original_task_group_value = [{"type": "group", "id": group.id}]
    task_field_values = {
        "field_time": {"start": "09:00", "end": "10:00"},
        "field_people": deepcopy(original_task_group_value),
    }

    normalized = normalize_optimization_input(
        tasks=[
            OptimizationTask(
                id=101,
                name="Task",
                task_type_id=task_type.id,
                template_id=template.id,
                event_id=event.id,
                location_id=1,
                field_values=task_field_values,
            )
        ],
        persons=[
            OptimizationPerson(id=1, first_name="Person", last_name="1"),
            OptimizationPerson(id=2, first_name="Person", last_name="2"),
            OptimizationPerson(id=3, first_name="Person", last_name="3"),
            OptimizationPerson(id=4, first_name="Person", last_name="4"),
            OptimizationPerson(
                id=5,
                first_name="Person",
                last_name="5",
                unavailabilities=[
                    {
                        "starts_at": "2026-01-01T09:30",
                        "ends_at": "2026-01-01T09:45",
                    }
                ],
            ),
        ],
        locations=[OptimizationLocation(id=1, name="Room")],
        capabilities=[OptimizationCapability(id=1, name="Skill", machine_name="skill")],
        task_type_fatigue_map={task_type.id: 1.0},
        db=db_session,
        event_id=event.id,
        working_day_date="2026-01-01",
    )

    assert normalized.errors == []
    assert normalized.tasks[0].preassigned_person_ids == [1, 2, 3, 4]
    assert task_field_values["field_people"] == original_task_group_value
    assert group.meta_data["members"] == person_refs(1, 2, 3, 4, 5)
