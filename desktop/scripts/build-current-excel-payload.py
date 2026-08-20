"""Build a narrow Excel payload from a Desktop database opened immutably.

The helper prints counts and a digest only. The payload is written to a caller-
provided temporary path and is removed by the Node regression runner.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any


CONDITION_TYPES = {
    "time_range",
    "duration",
    "capabilities_list",
    "start_end_time",
    "persons_list",
    "location",
    "dynamic_transfer_allocation",
    "transferee",
}


def json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        parsed = json.loads(value)
        return fallback if parsed is None else parsed
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


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


def render_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    if isinstance(value, list):
        return ", ".join(item for item in (render_value(entry) for entry in value) if item)
    if isinstance(value, dict):
        for key in ("label", "name", "value", "url"):
            if key in value and value[key] not in (None, ""):
                return render_value(value[key])
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return str(value)


def add_info_line(lines: list[str], seen: set[str], label: str, value: Any) -> None:
    rendered = render_value(value)
    if not rendered:
        return
    line = f"{label}: {rendered}" if label else rendered
    if line not in seen:
        seen.add(line)
        lines.append(line)


def person_name(person: dict[str, Any]) -> str:
    return f"{person.get('first_name') or ''} {person.get('last_name') or ''}".strip()


def build_people(persons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        persons,
        key=lambda item: (
            str(item.get("last_name") or "").casefold(),
            str(item.get("first_name") or "").casefold(),
            int(item["id"]),
        ),
    )
    base = [person_name(item) or f"Person {item['id']}" for item in ordered]
    totals: dict[str, int] = {}
    for name in base:
        totals[name.casefold()] = totals.get(name.casefold(), 0) + 1
    positions: dict[str, int] = {}
    result = []
    for person, name in zip(ordered, base, strict=True):
        key = name.casefold()
        positions[key] = positions.get(key, 0) + 1
        display = f"{name} ({positions[key]})" if totals[key] > 1 else name
        result.append({"id": int(person["id"]), "displayName": display})
    return result


def build_payload(connection: sqlite3.Connection, event_id: int | None) -> dict[str, Any]:
    connection.row_factory = sqlite3.Row
    if event_id is None:
        row = connection.execute(
            "SELECT * FROM events WHERE status IN ('optimised','finalised','published') "
            "ORDER BY updated_at DESC, id DESC LIMIT 1"
        ).fetchone()
    else:
        row = connection.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if row is None:
        raise RuntimeError("No optimised event is available for the Excel regression.")
    event = dict(row)
    metadata = json_value(event.get("meta_data"), {})
    day_range = metadata.get("schedule_day_range") or {"endHour": 24}
    try:
        offset_hour = max(0, min(12, int(day_range.get("endHour", 24)) - 24))
    except (TypeError, ValueError):
        offset_hour = 0

    task_types = row_map(connection, "task_types")
    templates = row_map(connection, "task_templates")
    locations = row_map(connection, "locations")
    event_people = [
        dict(item)
        for item in connection.execute(
            "SELECT * FROM persons WHERE event_id = ?", (event["id"],)
        )
    ]
    person_by_id = {int(item["id"]): item for item in event_people}
    layouts = {
        int(item["task_id"]): item["custom_color"]
        for item in connection.execute(
            "SELECT task_id, custom_color FROM masterplan_layouts WHERE event_id = ?",
            (event["id"],),
        )
        if item["custom_color"]
    }

    tasks_by_day: dict[str, list[dict[str, Any]]] = {}
    instances = connection.execute(
        "SELECT * FROM task_instances WHERE event_id = ? "
        "AND (final IS NOT NULL OR optimised IS NOT NULL) ORDER BY date, id",
        (event["id"],),
    ).fetchall()
    for raw in instances:
        instance = dict(raw)
        schedule = json_value(instance.get("final"), {}) or json_value(instance.get("optimised"), {})
        template = templates.get(int(instance.get("template_id") or 0), {})
        task_type = task_types.get(int(instance.get("task_type_id") or 0), {})
        definitions = json_value(template.get("fields"), [])
        values = json_value(instance.get("field_values"), {})
        additional = json_value(instance.get("additional"), {})
        assignments = schedule.get("field_assignments") or {}
        assigned_ids: set[int] = set()
        for candidate in schedule.get("assigned_persons") or []:
            assigned_ids.add(int(candidate))
        allocation_parts: list[str] = []
        for field_id, raw_ids in assignments.items():
            ids = [int(candidate) for candidate in (raw_ids or [])]
            assigned_ids.update(ids)
            definition = next((item for item in definitions if item.get("id") == field_id), {})
            label = definition.get("name") or str(field_id).removeprefix("field_").replace("_", " ")
            names = [person_name(person_by_id[item]) for item in ids if item in person_by_id]
            if names:
                allocation_parts.append(f"{label}: {', '.join(names)}")
        if not allocation_parts:
            names = [person_name(person_by_id[item]) for item in sorted(assigned_ids) if item in person_by_id]
            if names:
                allocation_parts.append(", ".join(names))

        info: list[str] = []
        seen_info: set[str] = set()
        add_info_line(info, seen_info, "Description", additional.get("description"))
        add_info_line(info, seen_info, "Notes", additional.get("notes"))
        for definition in definitions:
            category = definition.get("category")
            field_type = definition.get("type")
            if category == "conditions" or (category != "arbitrary" and field_type in CONDITION_TYPES):
                continue
            field_id = definition.get("id")
            if not field_id:
                continue
            label = definition.get("name") or str(field_id).removeprefix("field_").replace("_", " ").title()
            add_info_line(info, seen_info, label, values.get(field_id, additional.get(field_id)))

        venue = None
        route_start = None
        route_end = None
        location_fields = [item for item in definitions if item.get("type") == "location"]
        if len(location_fields) >= 2:
            location_ids = []
            for definition in location_fields[:2]:
                value = values.get(definition.get("id"))
                if isinstance(value, dict):
                    value = value.get("value")
                try:
                    location_ids.append(int(value))
                except (TypeError, ValueError):
                    location_ids.append(0)
            if all(item in locations for item in location_ids):
                route_start = {
                    "name": locations[location_ids[0]].get("name") or "",
                    "address": locations[location_ids[0]].get("address") or "",
                }
                route_end = {
                    "name": locations[location_ids[1]].get("name") or "",
                    "address": locations[location_ids[1]].get("address") or "",
                }
        if route_start is None:
            try:
                location_id = int(schedule.get("location"))
            except (TypeError, ValueError):
                location_id = 0
            if location_id in locations:
                venue = {
                    "name": locations[location_id].get("name") or "",
                    "address": locations[location_id].get("address") or "",
                }

        task_date = str(instance.get("date") or "")
        day = working_date(task_date, schedule.get("start_time"), offset_hour)
        tasks_by_day.setdefault(day, []).append({
            "id": int(instance["id"]),
            "title": instance.get("name") or template.get("name") or "Unnamed Task",
            "startMinutes": schedule.get("start_time"),
            "endMinutes": schedule.get("end_time"),
            "colour": layouts.get(int(instance["id"])) or task_type.get("color") or "#3b82f6",
            "assignedSummary": " | ".join(allocation_parts),
            "additionalInfo": "\n".join(info),
            "assignedPersonIds": sorted(assigned_ids),
            "venue": venue,
            "routeStart": route_start,
            "routeEnd": route_end,
        })

    start_date = date.fromisoformat(str(event["start_date"]))
    aliases = metadata.get("day_aliases") or {}
    days = []
    for day in sorted(tasks_by_day):
        day_number = (date.fromisoformat(day) - start_date).days + 1
        tasks = sorted(
            tasks_by_day[day],
            key=lambda item: (
                item["startMinutes"] if isinstance(item["startMinutes"], int) else 10**9,
                item["endMinutes"] if isinstance(item["endMinutes"], int) else 10**9,
                item["id"],
            ),
        )
        days.append({
            "date": day,
            "alias": aliases.get(day) or "Schedule",
            "dayNumber": day_number,
            "tasks": tasks,
        })

    title = str(metadata.get("pdf_export_title") or event["name"])
    return {
        "title": title,
        "eventId": int(event["id"]),
        "eventName": event["name"],
        "eventStartDate": str(event["start_date"]),
        "eventEndDate": str(event["end_date"]),
        "people": build_people(event_people),
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
    connection = sqlite3.connect(f"{database.as_uri()}?mode=ro&immutable=1", uri=True)
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
        "people": len(payload["people"]),
        "assignments": sum(
            len(task["assignedPersonIds"])
            for day in payload["days"]
            for task in day["tasks"]
        ),
        "payload_sha256": hashlib.sha256(encoded).hexdigest(),
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
