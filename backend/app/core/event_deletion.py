"""Shared event deletion cleanup for desktop data-management routes."""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.secure_credentials import (
    SecureCredentialStoreUnavailable,
    delete_secret,
    mp_backend_secret_key,
)

logger = logging.getLogger(__name__)


def _execute_if_table_exists(
    db: Session,
    table_names: set[str],
    table_name: str,
    statement: str,
    params: dict,
) -> None:
    """Run a statement only when an optional table exists."""
    if table_name in table_names:
        db.execute(text(statement), params)


def _execute_if_columns_exist(
    db: Session,
    table_columns: dict[str, set[str]],
    table_name: str,
    required_columns: set[str],
    statement: str,
    params: dict | None = None,
) -> None:
    """Run a statement only when an optional table has the required columns."""
    if required_columns.issubset(table_columns.get(table_name, set())):
        db.execute(text(statement), params or {})


def _get_table_columns(db: Session) -> dict[str, set[str]]:
    """Return the current database table-column map for optional cleanup SQL."""
    inspector = inspect(db.get_bind())
    return {
        table_name: {column["name"] for column in inspector.get_columns(table_name)}
        for table_name in inspector.get_table_names()
    }


def cleanup_orphaned_event_scoped_data(db: Session) -> None:
    """Remove stale event-owned rows whose owning event no longer exists."""
    table_columns = _get_table_columns(db)

    _execute_if_columns_exist(
        db,
        table_columns,
        "assignments",
        {"event_id", "person_id", "task_id"},
        "DELETE FROM assignments WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = assignments.event_id) "
        "OR NOT EXISTS (SELECT 1 FROM persons WHERE persons.id = assignments.person_id) "
        "OR (task_id IS NOT NULL AND NOT EXISTS "
        "(SELECT 1 FROM tasks WHERE tasks.id = assignments.task_id))",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "task_capability_requirements",
        {"task_id"},
        "DELETE FROM task_capability_requirements WHERE NOT EXISTS "
        "(SELECT 1 FROM tasks WHERE tasks.id = task_capability_requirements.task_id) "
        "OR NOT EXISTS (SELECT 1 FROM tasks JOIN events ON events.id = tasks.event_id "
        "WHERE tasks.id = task_capability_requirements.task_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "masterplan_layouts",
        {"event_id", "task_id"},
        "DELETE FROM masterplan_layouts WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = masterplan_layouts.event_id) "
        "OR NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id = masterplan_layouts.task_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "task_descriptions",
        {"event_id", "task_id"},
        "DELETE FROM task_descriptions WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = task_descriptions.event_id) "
        "OR NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_descriptions.task_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "task_instance_solver_exclusions",
        {"task_instance_id"},
        "DELETE FROM task_instance_solver_exclusions WHERE NOT EXISTS "
        "(SELECT 1 FROM task_instances WHERE task_instances.id = "
        "task_instance_solver_exclusions.task_instance_id) OR NOT EXISTS "
        "(SELECT 1 FROM task_instances JOIN events ON events.id = "
        "task_instances.event_id WHERE task_instances.id = "
        "task_instance_solver_exclusions.task_instance_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "task_instances",
        {"event_id"},
        "DELETE FROM task_instances WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = task_instances.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "tasks",
        {"event_id"},
        "DELETE FROM tasks WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = tasks.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "event_publish_states",
        {"event_id"},
        "DELETE FROM event_publish_states WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = event_publish_states.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "general_schedule_publish_states",
        {"event_id"},
        "DELETE FROM general_schedule_publish_states WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = general_schedule_publish_states.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "session_elements",
        {"event_id"},
        "DELETE FROM session_elements WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = session_elements.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "schedule_views",
        {"event_id"},
        "DELETE FROM schedule_views WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = schedule_views.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "audience_teams",
        {"event_id"},
        "DELETE FROM audience_teams WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = audience_teams.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "attachments",
        {"event_id"},
        "DELETE FROM attachments WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = attachments.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "description_templates",
        {"event_id"},
        "DELETE FROM description_templates WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = description_templates.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "room_allocations",
        {"event_id", "location_id"},
        "DELETE FROM room_allocations WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = room_allocations.event_id) "
        "OR NOT EXISTS (SELECT 1 FROM locations WHERE locations.id = room_allocations.location_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "activation_links",
        {"user_id", "created_by_id"},
        "DELETE FROM activation_links WHERE NOT EXISTS "
        "(SELECT 1 FROM users WHERE users.id = activation_links.user_id) "
        "OR (created_by_id IS NOT NULL AND NOT EXISTS "
        "(SELECT 1 FROM users WHERE users.id = activation_links.created_by_id)) "
        "OR NOT EXISTS (SELECT 1 FROM users JOIN events ON events.id = users.event_id "
        "WHERE users.id = activation_links.user_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "auth_sessions",
        {"user_id"},
        "DELETE FROM auth_sessions WHERE NOT EXISTS "
        "(SELECT 1 FROM users WHERE users.id = auth_sessions.user_id) "
        "OR NOT EXISTS (SELECT 1 FROM users JOIN events ON events.id = users.event_id "
        "WHERE users.id = auth_sessions.user_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "exchange_codes",
        {"user_id"},
        "DELETE FROM exchange_codes WHERE NOT EXISTS "
        "(SELECT 1 FROM users WHERE users.id = exchange_codes.user_id) "
        "OR NOT EXISTS (SELECT 1 FROM users JOIN events ON events.id = users.event_id "
        "WHERE users.id = exchange_codes.user_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "webauthn_credentials",
        {"user_id"},
        "DELETE FROM webauthn_credentials WHERE NOT EXISTS "
        "(SELECT 1 FROM users WHERE users.id = webauthn_credentials.user_id) "
        "OR NOT EXISTS (SELECT 1 FROM users JOIN events ON events.id = users.event_id "
        "WHERE users.id = webauthn_credentials.user_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "user_event_roles",
        {"event_id", "user_id"},
        "DELETE FROM user_event_roles WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = user_event_roles.event_id) "
        "OR NOT EXISTS (SELECT 1 FROM users WHERE users.id = user_event_roles.user_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "user_persons",
        {"person_id", "user_id"},
        "DELETE FROM user_persons WHERE NOT EXISTS "
        "(SELECT 1 FROM persons WHERE persons.id = user_persons.person_id) "
        "OR NOT EXISTS (SELECT 1 FROM users WHERE users.id = user_persons.user_id) "
        "OR NOT EXISTS (SELECT 1 FROM persons JOIN events ON events.id = persons.event_id "
        "WHERE persons.id = user_persons.person_id) "
        "OR NOT EXISTS (SELECT 1 FROM users JOIN events ON events.id = users.event_id "
        "WHERE users.id = user_persons.user_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "person_unavailability",
        {"event_id", "person_id"},
        "DELETE FROM person_unavailability WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = person_unavailability.event_id) "
        "OR NOT EXISTS (SELECT 1 FROM persons "
        "WHERE persons.id = person_unavailability.person_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "person_capabilities",
        {"person_id"},
        "DELETE FROM person_capabilities WHERE NOT EXISTS "
        "(SELECT 1 FROM persons WHERE persons.id = person_capabilities.person_id) "
        "OR NOT EXISTS (SELECT 1 FROM persons JOIN events ON events.id = persons.event_id "
        "WHERE persons.id = person_capabilities.person_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "group_memberships",
        {"group_id", "person_id"},
        "DELETE FROM group_memberships WHERE NOT EXISTS "
        "(SELECT 1 FROM groups WHERE groups.id = group_memberships.group_id) "
        "OR NOT EXISTS (SELECT 1 FROM persons WHERE persons.id = group_memberships.person_id) "
        "OR NOT EXISTS (SELECT 1 FROM groups JOIN events ON events.id = groups.event_id "
        "WHERE groups.id = group_memberships.group_id) "
        "OR NOT EXISTS (SELECT 1 FROM persons JOIN events ON events.id = persons.event_id "
        "WHERE persons.id = group_memberships.person_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "users",
        {"event_id"},
        "DELETE FROM users WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = users.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "groups",
        {"event_id"},
        "DELETE FROM groups WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = groups.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "persons",
        {"event_id"},
        "DELETE FROM persons WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = persons.event_id)",
    )
    _execute_if_columns_exist(
        db,
        table_columns,
        "locations",
        {"event_id"},
        "DELETE FROM locations WHERE NOT EXISTS "
        "(SELECT 1 FROM events WHERE events.id = locations.event_id)",
    )


def delete_event_scoped_data(db: Session, event_id: int) -> None:
    """Delete one event and all records that are scoped to it."""
    eid = event_id
    table_names = set(inspect(db.get_bind()).get_table_names())

    try:
        delete_secret(mp_backend_secret_key(eid))
    except SecureCredentialStoreUnavailable as exc:
        logger.warning("Could not delete MP-Backend secure credential for event %s: %s", eid, exc)

    db.execute(text("DELETE FROM assignments WHERE event_id = :eid"), {"eid": eid})
    db.execute(text("DELETE FROM optimization_jobs WHERE event_id = :eid"), {"eid": eid})

    _execute_if_table_exists(
        db,
        table_names,
        "event_publish_states",
        "DELETE FROM event_publish_states WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "general_schedule_publish_states",
        "DELETE FROM general_schedule_publish_states WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "session_elements",
        "DELETE FROM session_elements WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "session_element_types",
        "DELETE FROM session_element_types WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "schedule_views",
        "DELETE FROM schedule_views WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "audience_teams",
        "DELETE FROM audience_teams WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "audience_categories",
        "DELETE FROM audience_categories WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "task_descriptions",
        "DELETE FROM task_descriptions WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "attachments",
        "DELETE FROM attachments WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "description_templates",
        "DELETE FROM description_templates WHERE event_id = :eid",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "masterplan_layouts",
        "DELETE FROM masterplan_layouts WHERE event_id = :eid",
        {"eid": eid},
    )

    _execute_if_table_exists(
        db,
        table_names,
        "task_capability_requirements",
        "DELETE FROM task_capability_requirements WHERE task_id IN "
        "(SELECT id FROM tasks WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "task_instance_solver_exclusions",
        "DELETE FROM task_instance_solver_exclusions WHERE task_instance_id IN "
        "(SELECT id FROM task_instances WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "task_instances",
        "DELETE FROM task_instances WHERE event_id = :eid",
        {"eid": eid},
    )
    db.execute(text("DELETE FROM tasks WHERE event_id = :eid"), {"eid": eid})

    _execute_if_table_exists(
        db,
        table_names,
        "activation_links",
        "DELETE FROM activation_links WHERE user_id IN "
        "(SELECT id FROM users WHERE event_id = :eid) "
        "OR created_by_id IN (SELECT id FROM users WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "auth_sessions",
        "DELETE FROM auth_sessions WHERE user_id IN "
        "(SELECT id FROM users WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "exchange_codes",
        "DELETE FROM exchange_codes WHERE user_id IN "
        "(SELECT id FROM users WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "webauthn_credentials",
        "DELETE FROM webauthn_credentials WHERE user_id IN "
        "(SELECT id FROM users WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "user_event_roles",
        "DELETE FROM user_event_roles WHERE event_id = :eid "
        "OR user_id IN (SELECT id FROM users WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "user_persons",
        "DELETE FROM user_persons WHERE person_id IN "
        "(SELECT id FROM persons WHERE event_id = :eid) "
        "OR user_id IN (SELECT id FROM users WHERE event_id = :eid)",
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "person_unavailability",
        "DELETE FROM person_unavailability WHERE event_id = :eid "
        "OR person_id IN (SELECT id FROM persons WHERE event_id = :eid)",
        {"eid": eid},
    )
    db.execute(
        text(
            "DELETE FROM person_capabilities WHERE person_id IN "
            "(SELECT id FROM persons WHERE event_id = :eid)"
        ),
        {"eid": eid},
    )
    db.execute(
        text(
            "DELETE FROM group_memberships WHERE group_id IN "
            "(SELECT id FROM groups WHERE event_id = :eid) "
            "OR person_id IN (SELECT id FROM persons WHERE event_id = :eid)"
        ),
        {"eid": eid},
    )
    db.execute(text("DELETE FROM groups WHERE event_id = :eid"), {"eid": eid})
    _execute_if_table_exists(
        db,
        table_names,
        "room_allocations",
        "DELETE FROM room_allocations WHERE event_id = :eid",
        {"eid": eid},
    )
    db.execute(
        text(
            "UPDATE persons SET home_location_id = NULL "
            "WHERE event_id = :eid AND home_location_id IS NOT NULL"
        ),
        {"eid": eid},
    )
    _execute_if_table_exists(
        db,
        table_names,
        "users",
        "DELETE FROM users WHERE event_id = :eid",
        {"eid": eid},
    )
    db.execute(text("DELETE FROM locations WHERE event_id = :eid"), {"eid": eid})
    db.execute(text("DELETE FROM persons WHERE event_id = :eid"), {"eid": eid})
    db.execute(text("DELETE FROM events WHERE id = :eid"), {"eid": eid})
