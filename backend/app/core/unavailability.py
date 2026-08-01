"""Person unavailability normalisation shared by flow check and optimisation."""

from __future__ import annotations

from datetime import date, datetime
import re
from typing import Any, List, Optional, Tuple


Interval = Tuple[int, int]


_DATE_TIME_RE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})[T\s](?P<hour>\d{1,2}):(?P<minute>\d{2})"
)


def _parse_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


def _parse_clock_minutes(value: Any) -> Optional[int]:
    parsed = _parse_int(value)
    if parsed is not None:
        return parsed
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    match = re.match(r"^(?P<hour>\d{1,2}):(?P<minute>\d{2})", stripped)
    if not match:
        return None
    hour = int(match.group("hour"))
    minute = int(match.group("minute"))
    if minute < 0 or minute >= 60 or hour < 0 or hour > 24:
        return None
    if hour == 24 and minute != 0:
        return None
    return hour * 60 + minute


def _parse_local_datetime(value: Any) -> Optional[datetime]:
    """Parse a local datetime string without timezone conversion."""
    if not isinstance(value, str):
        return None
    match = _DATE_TIME_RE.match(value.strip())
    if not match:
        return None
    try:
        day = date.fromisoformat(match.group("date"))
        hour = int(match.group("hour"))
        minute = int(match.group("minute"))
        if hour < 0 or hour > 23 or minute < 0 or minute >= 60:
            return None
        return datetime(day.year, day.month, day.day, hour, minute)
    except ValueError:
        return None


def _working_window(boundary_offset_hour: int) -> Interval:
    offset_minutes = max(0, int(boundary_offset_hour or 0)) * 60
    if offset_minutes == 0:
        return (0, 24 * 60)
    return (offset_minutes, 24 * 60 + offset_minutes)


def _intersect(interval: Interval, window: Interval) -> Optional[Interval]:
    start = max(interval[0], window[0])
    end = min(interval[1], window[1])
    if start >= end:
        return None
    return (start, end)


def _normalise_intervals(intervals: List[Interval]) -> List[Interval]:
    seen = set()
    result: List[Interval] = []
    for start, end in sorted(intervals):
        if start >= end:
            continue
        key = (int(start), int(end))
        if key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def _parse_selected_day(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _dated_interval_to_working_day(
    start_dt: datetime,
    end_dt: datetime,
    selected_working_date: str,
    boundary_offset_hour: int,
) -> Optional[Interval]:
    selected_day = _parse_selected_day(selected_working_date)
    if selected_day is None:
        return None

    def to_linear_minutes(value: datetime) -> int:
        day_delta = (value.date() - selected_day).days
        return day_delta * 24 * 60 + value.hour * 60 + value.minute

    start = to_linear_minutes(start_dt)
    end = to_linear_minutes(end_dt)
    if end <= start:
        end += 24 * 60
    return _intersect((start, end), _working_window(boundary_offset_hour))


def _time_only_interval_to_working_day(
    start: int,
    end: int,
    boundary_offset_hour: int,
) -> List[Interval]:
    if end <= start:
        end += 24 * 60

    window = _working_window(boundary_offset_hour)
    intervals: List[Interval] = []
    for shift in (-24 * 60, 0, 24 * 60):
        clipped = _intersect((start + shift, end + shift), window)
        if clipped is not None:
            intervals.append(clipped)
    return intervals


def _extract_interval_values(entry: Any) -> Tuple[Any, Any]:
    if isinstance(entry, dict):
        return (
            entry.get("starts_at"),
            entry.get("ends_at"),
        )
    if isinstance(entry, (list, tuple)) and len(entry) == 2:
        return entry[0], entry[1]
    return None, None


def normalize_unavailable_intervals(
    unavailabilities: Optional[list[dict[str, Any]]],
    *,
    selected_working_date: Optional[str] = None,
    working_day_boundary_offset_hour: int = 0,
) -> Tuple[List[Interval], List[str]]:
    """Return solver-ready unavailable intervals for the selected working day.

    Typed entries are one-off local datetime ranges and are included only when
    they overlap the selected working day. No reason or profile data is used.
    """
    if not isinstance(unavailabilities, list):
        return [], []

    intervals: List[Interval] = []
    warnings: List[str] = []

    for entry in unavailabilities:
        raw_start, raw_end = _extract_interval_values(entry)
        start_dt = _parse_local_datetime(raw_start)
        end_dt = _parse_local_datetime(raw_end)

        if start_dt is not None and end_dt is not None and selected_working_date:
            interval = _dated_interval_to_working_day(
                start_dt,
                end_dt,
                selected_working_date,
                working_day_boundary_offset_hour,
            )
            if interval is not None:
                intervals.append(interval)
            continue

        if start_dt is None or end_dt is None:
            warnings.append("Ignored invalid unavailability entry.")
            continue
        start = start_dt.hour * 60 + start_dt.minute
        end = end_dt.hour * 60 + end_dt.minute
        if end_dt.date() > start_dt.date() or end <= start:
            end += 24 * 60
        intervals.append((start, end))

    return _normalise_intervals(intervals), warnings
