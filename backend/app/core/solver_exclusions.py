"""Queries shared by the CMI API, flow checker, and optimiser."""

from typing import TypeVar

from sqlalchemy.orm import Session

from app.models.task_instance import TaskInstance
from app.models.task_instance_solver_exclusion import TaskInstanceSolverExclusion

TaskWithId = TypeVar("TaskWithId")


def get_solver_excluded_task_ids(db: Session, event_id: int) -> set[int]:
    """Return persisted solver exclusions that still belong to ``event_id``."""

    rows = (
        db.query(TaskInstanceSolverExclusion.task_instance_id)
        .join(
            TaskInstance,
            TaskInstance.id == TaskInstanceSolverExclusion.task_instance_id,
        )
        .filter(TaskInstance.event_id == event_id)
        .all()
    )
    return {int(row[0]) for row in rows}


def filter_solver_active_tasks(
    db: Session,
    event_id: int,
    tasks: list[TaskWithId],
) -> list[TaskWithId]:
    """Apply persisted exclusions defensively to one solver request."""

    excluded_ids = get_solver_excluded_task_ids(db, event_id)
    return [task for task in tasks if int(getattr(task, "id")) not in excluded_ids]


def delete_solver_exclusions_for_task_ids(
    db: Session,
    task_instance_ids: list[int] | set[int],
) -> None:
    """Remove sidecar state explicitly for SQLite installations."""

    ids = {int(task_id) for task_id in task_instance_ids}
    if not ids:
        return
    (
        db.query(TaskInstanceSolverExclusion)
        .filter(TaskInstanceSolverExclusion.task_instance_id.in_(ids))
        .delete(synchronize_session=False)
    )
