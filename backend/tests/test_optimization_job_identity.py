from datetime import date

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.optimize import (
    _delete_terminal_job_for_rerun,
    start_optimization,
)
from app.db.database import Base
from app.models import Event, OptimizationJob
from app.schemas.optimization import OptimizeRequest


def test_same_day_rerun_receives_a_fresh_job_id():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = session_factory()

    try:
        event = Event(
            name="Synthetic rerun",
            location="Synthetic venue",
            start_date=date(2035, 1, 1),
            end_date=date(2035, 1, 2),
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        first = OptimizationJob(
            event_id=event.id,
            date="2035-01-01",
            status="completed",
        )
        db.add(first)
        db.commit()
        db.refresh(first)
        first_id = first.id

        replacement_id = _delete_terminal_job_for_rerun(db, first)
        replacement = OptimizationJob(
            id=replacement_id,
            event_id=event.id,
            date="2035-01-01",
            status="pending",
        )
        db.add(replacement)
        db.commit()
        db.refresh(replacement)

        assert replacement.id == first_id + 1
        assert db.query(OptimizationJob).filter(OptimizationJob.id == first_id).first() is None
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.mark.asyncio
async def test_same_day_api_rerun_does_not_reuse_the_completed_job_id():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = session_factory()

    try:
        event = Event(
            name="Synthetic API rerun",
            location="Synthetic venue",
            start_date=date(2035, 1, 1),
            end_date=date(2035, 1, 2),
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        request = OptimizeRequest(
            event_id=event.id,
            date="2035-01-01",
            tasks=[
                {
                    "id": 501,
                    "event_id": event.id,
                    "date": "2035-01-01",
                    "name": "Synthetic task",
                    "field_values": {
                        "field_time_synthetic": {
                            "start": "09:00",
                            "end": "10:00",
                        },
                    },
                },
            ],
            persons=[],
            locations=[],
            capabilities=[],
            fatigue_scores={},
        )

        first = await start_optimization(request, BackgroundTasks(), db)
        first_job = db.query(OptimizationJob).filter(OptimizationJob.id == first.job_id).one()
        first_job.status = "completed"
        db.commit()

        second = await start_optimization(request, BackgroundTasks(), db)

        assert second.job_id == first.job_id + 1
        assert db.query(OptimizationJob).filter(OptimizationJob.id == first.job_id).first() is None
        assert db.query(OptimizationJob).filter(OptimizationJob.id == second.job_id).one().status == "pending"
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
