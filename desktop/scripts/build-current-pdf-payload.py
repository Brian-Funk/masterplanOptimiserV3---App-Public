"""Build a display-only PDF payload from a Desktop database opened immutably.

This opt-in regression helper never writes to the source database and prints no
schedule text. Its output file is expected to live in a temporary directory and
be removed by the Node orchestration script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


def json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def clock(minutes: Any) -> str:
    try:
        value = int(minutes)
    except (TypeError, ValueError):
        value = 0
    return f"{value // 60:02d}:{value % 60:02d}"


def row_map(connection: sqlite3.Connection, table: str) -> dict[int, dict[str, Any]]:
    return {int(row["id"]): dict(row) for row in connection.execute(f"SELECT * FROM {table}")}


def working_date(actual: str, start_minutes: Any, offset_hour: int) -> str:
    if offset_hour <= 0:
        return actual
    try:
        start = int(start_minutes)
    except (TypeError, ValueError):
        return actual
    parsed = date.fromisoformat(actual)
    if start < offset_hour * 60:
        parsed -= timedelta(days=1)
    return parsed.isoformat()


def build_payload(connection: sqlite3.Connection, event_id: int | None) -> dict[str, Any]:
    connection.row_factory = sqlite3.Row
    if event_id is None:
        event = connection.execute(
            "SELECT * FROM events WHERE status IN ('optimised','finalised','published') ORDER BY updated_at DESC, id DESC LIMIT 1"
        ).fetchone()
    else:
        event = connection.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        raise RuntimeError("No optimised event is available for the PDF regression.")

    event = dict(event)
    metadata = json_value(event.get("meta_data"), {})
    day_range = metadata.get("schedule_day_range") or {"startHour": 6, "endHour": 24}
    try:
        offset_hour = max(0, int(day_range.get("endHour", 24)) - 24)
    except (TypeError, ValueError):
        offset_hour = 0

    task_types = row_map(connection, "task_types")
    templates = row_map(connection, "task_templates")
    locations = row_map(connection, "locations")
    persons = row_map(connection, "persons")
    calendar_tasks: list[dict[str, Any]] = []

    instances = connection.execute(
        "SELECT * FROM task_instances WHERE event_id = ? AND (final IS NOT NULL OR optimised IS NOT NULL) ORDER BY date, id",
        (event["id"],),
    ).fetchall()
    for raw_instance in instances:
        instance = dict(raw_instance)
        schedule = json_value(instance.get("final"), {}) or json_value(instance.get("optimised"), {})
        template = templates.get(int(instance.get("template_id") or 0), {})
        task_type = task_types.get(int(instance.get("task_type_id") or 0), {})
        definitions = json_value(template.get("fields"), [])
        values = json_value(instance.get("field_values"), {})
        assignments = schedule.get("field_assignments") or {}
        allocation_parts: list[str] = []
        for field_id, person_ids in assignments.items():
            definition = next((item for item in definitions if item.get("id") == field_id), {})
            label = definition.get("name") or str(field_id).removeprefix("field_").replace("_", " ")
            names = [
                f"{persons[int(person_id)].get('first_name', '')} {persons[int(person_id)].get('last_name', '')}".strip()
                for person_id in person_ids
                if int(person_id) in persons
            ]
            if names:
                allocation_parts.append(f"{label}: {', '.join(names)}")
        if not allocation_parts:
            names = [
                f"{persons[int(person_id)].get('first_name', '')} {persons[int(person_id)].get('last_name', '')}".strip()
                for person_id in schedule.get("assigned_persons", [])
                if int(person_id) in persons
            ]
            if names:
                allocation_parts.append(", ".join(names))

        location_name = ""
        location_id = schedule.get("location")
        if location_id is not None and int(location_id) in locations:
            location_name = locations[int(location_id)].get("name") or ""
        location_fields = [item for item in definitions if item.get("type") == "location"]
        if len(location_fields) >= 2:
            location_ids: list[int] = []
            for definition in location_fields[:2]:
                value = values.get(definition.get("id"))
                if isinstance(value, dict):
                    value = value.get("value")
                try:
                    location_ids.append(int(value))
                except (TypeError, ValueError):
                    location_ids.append(0)
            if all(item in locations for item in location_ids):
                location_name = f"{locations[location_ids[0]].get('name', '')} → {locations[location_ids[1]].get('name', '')}"

        start_minutes = schedule.get("start_time")
        end_minutes = schedule.get("end_time")
        task_date = str(instance.get("date") or "")
        calendar_tasks.append(
            {
                "id": instance["id"],
                "name": instance.get("name") or template.get("name") or "Unnamed Task",
                "task_type_id": instance.get("task_type_id"),
                "task_type_name": task_type.get("name") or "",
                "task_type_color": task_type.get("color") or "#3b82f6",
                "location_id": location_id,
                "location_name": location_name,
                "resource_info": " | ".join(allocation_parts),
                "date": task_date,
                "working_date": working_date(task_date, start_minutes, offset_hour),
                "start_end_time": {"start": clock(start_minutes), "end": clock(end_minutes)},
                "fields": values,
                "field_definitions": definitions,
            }
        )

    days: list[dict[str, Any]] = []
    for working_day in sorted({task["working_date"] for task in calendar_tasks}):
        label = datetime.strptime(working_day, "%Y-%m-%d").strftime("%A, %d %B %Y")
        day_tasks = []
        for task in calendar_tasks:
            if task["working_date"] != working_day:
                continue
            item = dict(task)
            item.pop("working_date", None)
            day_tasks.append(item)
        days.append({"date": working_day, "dayLabel": label, "tasks": day_tasks})

    return {
        "title": f"Optimised Schedule - {event['name']}",
        "eventId": event["id"],
        "eventName": event["name"],
        "eventLocation": event.get("location") or "",
        "eventStartDate": event["start_date"],
        "eventEndDate": event["end_date"],
        "scheduleDayRange": day_range,
        "scheduleDayBoundary": {"offsetHour": offset_hour},
        "days": days,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--event-id", type=int)
    arguments = parser.parse_args()
    database = arguments.database.resolve(strict=True)
    output = arguments.output.resolve()
    if not output.is_absolute() or not output.parent.is_dir():
        raise RuntimeError("The temporary payload output directory is invalid.")
    uri = f"{database.as_uri()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    try:
        connection.execute("PRAGMA query_only = ON")
        payload = build_payload(connection, arguments.event_id)
    finally:
        connection.close()
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    output.write_bytes(encoded)
    print(json.dumps({
        "days": len(payload["days"]),
        "tasks": sum(len(day["tasks"]) for day in payload["days"]),
        "payload_sha256": hashlib.sha256(encoded).hexdigest(),
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
