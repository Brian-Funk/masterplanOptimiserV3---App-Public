"""Regression coverage for transfer metadata crossing the compute API boundary."""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import main


def test_compute_api_preserves_transfer_role_metadata(monkeypatch):
    captured = {}

    def fake_optimize(*, normalized_input, config, callback):
        captured["transfer"] = normalized_input.transfers[0]
        return SimpleNamespace(
            status="FEASIBLE",
            assignments={},
            capability_assignments={},
            fatigue_per_person={1: 0.0},
            breaks_per_person={1: 0},
            fatigue_min=0.0,
            fatigue_max=0.0,
            fatigue_range=0.0,
            solve_time=0.0,
            errors=[],
            transfer_assignments={},
            task_details={},
            field_assignments={},
            progress_snapshots=[],
            diagnostics={},
        )

    monkeypatch.setattr(main, "optimize_with_fatigue", fake_optimize)
    request = main.OptimizeDayRequest(
        event_id=1,
        date="2032-04-21",
        normalized_input={
            "persons": [
                {
                    "id": 1,
                    "initial_location_id": 10,
                    "capabilities": ["driver"],
                    "max_work_minutes_per_day": 480,
                }
            ],
            "tasks": [],
            "floating_tasks": [],
            "transfers": [
                {
                    "id": 20,
                    "from_location_id": 10,
                    "to_location_id": 11,
                    "depart_time": 480,
                    "arrive_time": 540,
                    "capacity": 4,
                    "required_capabilities": {"driver": 1},
                    "optional_capacity_slots": 2,
                    "field_requirements": {"staff": {"driver": 1}},
                    "transferee_field_id": "passengers",
                    "locked_person_ids": [1],
                    "person_field_assignments": {"passengers": [1]},
                    "counts_towards_work_time": True,
                }
            ],
            "errors": [],
        },
    )

    response = asyncio.run(main.optimize_day(request))

    assert response["status"] == "FEASIBLE"
    transfer = captured["transfer"]
    assert transfer.optional_capacity_slots == 2
    assert transfer.transferee_field_id == "passengers"
    assert transfer.locked_person_ids == [1]
    assert transfer.person_field_assignments == {"passengers": [1]}
    assert transfer.field_requirements == {"staff": {"driver": 1}}
