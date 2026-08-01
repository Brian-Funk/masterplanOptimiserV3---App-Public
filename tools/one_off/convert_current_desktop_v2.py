#!/usr/bin/env python3
"""One-off, fail-closed conversion of the sole pre-v2 desktop database.

The source is opened read-only and is never modified. The converter creates a
new current-schema SQLite database plus an age-encrypted, row-for-row migration
archive. It publishes neither output unless conversion, archive encryption and
SQLite integrity checks all succeed.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

FORMAT = "mp-opt-desktop-one-off-v2"
OPERATOR_TOOL_SCOPE = "separate-temporary-one-time-converter"
IDENTITY_NAMESPACE = uuid.UUID("8df117c6-0736-45ca-a1fb-c06b047f39f6")
SQLITE_COMPANION_SUFFIXES = ("-wal", "-shm", "-journal")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _sqlite_companions(path: Path) -> list[Path]:
    return [Path(f"{path}{suffix}") for suffix in SQLITE_COMPANION_SUFFIXES]


def _assert_source_quiescent(path: Path) -> None:
    """Refuse a copy that may depend on a separate SQLite journal or WAL."""
    companions = [candidate for candidate in _sqlite_companions(path) if candidate.exists()]
    if companions:
        names = ", ".join(candidate.name for candidate in companions)
        raise RuntimeError(
            "Source database has SQLite companion files "
            f"({names}). Close the Desktop application and create a fresh, "
            "checkpointed copy before conversion."
        )


def _validate_source_connection(connection: sqlite3.Connection) -> None:
    integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
    if integrity != ["ok"]:
        raise RuntimeError("Source database integrity check failed")
    violations = connection.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise RuntimeError(
            f"Source database has {len(violations)} foreign-key violation(s)"
        )


def _json_value(value: Any) -> Any:
    """Represent every SQLite value losslessly in the encrypted archive."""
    if isinstance(value, bytes):
        return {"$sqlite_blob_base64": base64.b64encode(value).decode("ascii")}
    return value


def _source_connection(path: Path) -> sqlite3.Connection:
    _assert_source_quiescent(path)
    uri = f"file:{path.resolve().as_posix()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    _validate_source_connection(connection)
    return connection


def _tables(connection: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def _schema_inventory(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    return [
        {
            "table": table,
            "columns": [
                {
                    "name": row[1],
                    "type": row[2],
                    "not_null": bool(row[3]),
                    "primary_key": bool(row[5]),
                }
                for row in connection.execute(f"PRAGMA table_info({_quote(table)})")
            ],
        }
        for table in _tables(connection)
    ]


def _schema_sha256(connection: sqlite3.Connection) -> str:
    encoded = json.dumps(
        _schema_inventory(connection), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _rows(connection: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    return [
        {key: _json_value(row[key]) for key in row.keys()}
        for row in connection.execute(f"SELECT * FROM {_quote(table)}")
    ]


def build_archive(source: sqlite3.Connection, source_sha256: str) -> tuple[dict[str, Any], dict[str, int]]:
    """Build the complete source archive and a non-sensitive count summary."""
    archived_tables: dict[str, list[dict[str, Any]]] = {}
    counts: dict[str, int] = {}
    for table in _tables(source):
        table_rows = _rows(source, table)
        archived_tables[table] = table_rows
        counts[table] = len(table_rows)
    return (
        {
            "format": FORMAT,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_sha256": source_sha256,
            "purpose": "controller-held one-off migration archive",
            "tables": archived_tables,
        },
        counts,
    )


def _model_metadata(repo_root: Path):
    sys.path.insert(0, str(repo_root / "backend"))
    from app.db.database import Base  # pylint: disable=import-outside-toplevel
    import app.models  # noqa: F401  # pylint: disable=import-outside-toplevel,unused-import
    return Base.metadata


def _deterministic_id(source_sha256: str, table: str, row_id: Any) -> str:
    return str(uuid.uuid5(IDENTITY_NAMESPACE, f"{source_sha256}:{table}:{row_id}"))


def _insert_rows(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table: str,
    source_sha256: str,
) -> int:
    source_columns = [row[1] for row in source.execute(f"PRAGMA table_info({_quote(table)})")]
    target_columns = [row[1] for row in target.execute(f"PRAGMA table_info({_quote(table)})")]
    shared = [column for column in source_columns if column in target_columns]
    if not shared:
        return 0
    rows = source.execute(f"SELECT * FROM {_quote(table)}").fetchall()
    inserted = 0
    for row in rows:
        values = {column: row[column] for column in shared}
        row_identity = values.get("id", inserted + 1)
        if table == "events" and "evidence_id" in target_columns:
            values["evidence_id"] = _deterministic_id(source_sha256, table, row_identity)
        if table == "persons" and "evidence_subject_id" in target_columns:
            values["evidence_subject_id"] = _deterministic_id(source_sha256, table, row_identity)
        columns = list(values)
        target.execute(
            f"INSERT INTO {_quote(table)} ({','.join(_quote(column) for column in columns)}) "
            f"VALUES ({','.join('?' for _ in columns)})",
            [values[column] for column in columns],
        )
        inserted += 1
    return inserted


_CONVERTED_FIELD_CLASSIFICATIONS: dict[str, tuple[str, str, bool]] = {
    "persons_list": ("assignment", "participant", True),
    "capabilities_list": ("capability_requirement", "participant", True),
    "location": ("location", "participant", True),
    "start_location": ("location", "participant", True),
    "end_location": ("location", "participant", True),
    "datetime": ("timing", "participant", True),
    "start_end_time": ("timing", "participant", True),
    "time_range": ("timing", "participant", True),
    "duration": ("timing", "participant", True),
    # Optimiser-only structures have no Server wire representation.
    "transferee": ("assignment", "never_publish", True),
    "dynamic_transfer_allocation": ("assignment", "never_publish", True),
    "assignee_range": ("assignment", "never_publish", True),
}


def _classify_converted_template_fields(target: sqlite3.Connection) -> dict[str, int]:
    """Give converted fields an explicit current-schema disposition.

    Structural fields use a deterministic bounded classification. Broad or
    unknown fields remain fail-closed until the operator reviews them in the
    current App. This transformation exists only inside the one-off converter.
    """

    result = {
        "template_fields_classified": 0,
        "template_fields_pending_review": 0,
    }
    table_exists = target.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_templates'"
    ).fetchone()
    if not table_exists:
        return result
    for row in target.execute("SELECT id, fields FROM task_templates").fetchall():
        raw_fields = row["fields"]
        if raw_fields in (None, ""):
            fields: list[Any] = []
        else:
            try:
                fields = json.loads(raw_fields) if isinstance(raw_fields, str) else raw_fields
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"Task template {row['id']} has invalid field-definition JSON"
                ) from exc
        if not isinstance(fields, list):
            raise RuntimeError(
                f"Task template {row['id']} field definitions are not a list"
            )
        converted: list[dict[str, Any]] = []
        for index, field in enumerate(fields):
            if not isinstance(field, dict):
                raise RuntimeError(
                    f"Task template {row['id']} field {index} is not an object"
                )
            current = dict(field)
            classification = _CONVERTED_FIELD_CLASSIFICATIONS.get(current.get("type"))
            if classification is None:
                purpose = "reference" if current.get("type") == "link" else "operational_instruction"
                current.update({
                    "purpose": purpose,
                    "visibility": "never_publish",
                    "classification_reviewed": False,
                    "public_visibility_confirmed": False,
                })
                result["template_fields_pending_review"] += 1
            else:
                purpose, visibility, reviewed = classification
                current.update({
                    "purpose": purpose,
                    "visibility": visibility,
                    "classification_reviewed": reviewed,
                    "public_visibility_confirmed": False,
                })
                result["template_fields_classified"] += 1
            converted.append(current)
        target.execute(
            "UPDATE task_templates SET fields = ? WHERE id = ?",
            (json.dumps(converted, ensure_ascii=False), row["id"]),
        )
    return result


def _parse_json(value: Any) -> tuple[dict[str, Any], str | None]:
    if isinstance(value, dict):
        return value, None
    if not isinstance(value, str) or not value.strip():
        return {}, None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}, "invalid_global_data_json"
    if not isinstance(parsed, dict):
        return {}, "global_data_not_an_object"
    return parsed, None


def _parse_local_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.strip()).replace(tzinfo=None)
    except ValueError:
        return None


def _map_person_operational_fields(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    source_sha256: str,
) -> dict[str, Any]:
    """Map only capabilities and reason-free dated unavailability intervals."""
    result: dict[str, Any] = {
        "capability_links_added": 0,
        "capability_links_already_present": 0,
        "unavailability_intervals_added": 0,
        "unavailability_intervals_already_present": 0,
        "archived_only_global_fields": 0,
        "rejected_records": [],
    }
    source_person_columns = {row[1] for row in source.execute("PRAGMA table_info(persons)")}
    if "global_data" not in source_person_columns:
        return result
    capabilities = {
        row[0]: row[1]
        for row in target.execute("SELECT machine_name, id FROM capabilities")
    }
    for person in source.execute("SELECT id, event_id, global_data FROM persons"):
        subject_ref = _deterministic_id(source_sha256, "persons", person["id"])

        def reject(field: str, code: str) -> None:
            result["rejected_records"].append({
                "subject_ref": subject_ref,
                "field": field,
                "code": code,
            })

        data, parse_error = _parse_json(person["global_data"])
        if parse_error:
            reject("persons.global_data", parse_error)
        result["archived_only_global_fields"] += len(
            set(data) - {"capabilities", "unavailabilities"}
        )

        capability_values = data.get("capabilities", [])
        if not isinstance(capability_values, list):
            reject("persons.global_data.capabilities", "capabilities_not_a_list")
            capability_values = []
        seen_capabilities: set[str] = set()
        for machine_name in capability_values:
            if not isinstance(machine_name, str) or not machine_name.strip():
                reject("persons.global_data.capabilities", "invalid_capability_reference")
                continue
            if machine_name in seen_capabilities:
                continue
            seen_capabilities.add(machine_name)
            capability_id = capabilities.get(machine_name)
            if capability_id is None:
                reject("persons.global_data.capabilities", "unknown_capability_reference")
                continue
            existing = target.execute(
                "SELECT 1 FROM person_capabilities "
                "WHERE person_id = ? AND capability_id = ? LIMIT 1",
                (person["id"], capability_id),
            ).fetchone()
            if existing:
                result["capability_links_already_present"] += 1
                continue
            target.execute(
                "INSERT INTO person_capabilities (person_id, capability_id) VALUES (?, ?)",
                (person["id"], capability_id),
            )
            result["capability_links_added"] += 1
        intervals = data.get("unavailabilities", [])
        if not isinstance(intervals, list):
            reject("persons.global_data.unavailabilities", "unavailabilities_not_a_list")
            continue
        for interval in intervals:
            if not isinstance(interval, dict):
                reject("persons.global_data.unavailabilities", "invalid_interval_shape")
                continue
            starts_at = _parse_local_datetime(interval.get("starts_at", interval.get("from")))
            ends_at = _parse_local_datetime(interval.get("ends_at", interval.get("to")))
            if starts_at is None or ends_at is None or ends_at <= starts_at:
                reject("persons.global_data.unavailabilities", "invalid_interval_bounds")
                continue
            values = (
                person["event_id"], person["id"], starts_at.isoformat(), ends_at.isoformat()
            )
            existing = target.execute(
                "SELECT 1 FROM person_unavailability WHERE event_id = ? "
                "AND person_id = ? AND starts_at = ? AND ends_at = ? LIMIT 1",
                values,
            ).fetchone()
            if existing:
                result["unavailability_intervals_already_present"] += 1
                continue
            target.execute(
                "INSERT INTO person_unavailability "
                "(event_id, person_id, starts_at, ends_at) VALUES (?, ?, ?, ?)",
                values,
            )
            result["unavailability_intervals_added"] += 1
    return result


def _field_dispositions(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
) -> list[dict[str, Any]]:
    """Account for every source field without putting source values in the receipt."""
    source_tables = set(_tables(source))
    target_tables = set(_tables(target))
    dispositions: list[dict[str, Any]] = []
    for table in sorted(source_tables):
        source_columns = [
            row[1] for row in source.execute(f"PRAGMA table_info({_quote(table)})")
        ]
        target_columns = (
            {
                row[1]
                for row in target.execute(f"PRAGMA table_info({_quote(table)})")
            }
            if table in target_tables
            else set()
        )
        for column in source_columns:
            if column in target_columns:
                disposition = "copied"
            elif table == "persons" and column == "global_data":
                disposition = "mapped_and_archived"
            else:
                disposition = "archived_only"
            non_null_rows = source.execute(
                f"SELECT COUNT(*) FROM {_quote(table)} WHERE {_quote(column)} IS NOT NULL"
            ).fetchone()[0]
            dispositions.append({
                "table": table,
                "column": column,
                "disposition": disposition,
                "non_null_rows": non_null_rows,
            })
    return dispositions


def build_current_database(
    source: sqlite3.Connection,
    target_path: Path,
    source_sha256: str,
    repo_root: Path,
) -> tuple[dict[str, int], dict[str, Any]]:
    """Create the v2 schema and copy the supported intersection of every table."""
    from sqlalchemy import create_engine  # pylint: disable=import-outside-toplevel
    metadata = _model_metadata(repo_root)
    engine = create_engine(f"sqlite:///{target_path}")
    metadata.create_all(engine)
    engine.dispose()
    target = sqlite3.connect(target_path)
    target.row_factory = sqlite3.Row
    target.execute("PRAGMA foreign_keys=OFF")
    source_tables = set(_tables(source))
    copied: dict[str, int] = {}
    try:
        for table in metadata.sorted_tables:
            if table.name in source_tables:
                copied[table.name] = _insert_rows(source, target, table.name, source_sha256)
        mapped = _map_person_operational_fields(source, target, source_sha256)
        mapped.update(_classify_converted_template_fields(target))
        target.commit()
        target.execute("PRAGMA foreign_keys=ON")
        violations = target.execute("PRAGMA foreign_key_check").fetchall()
        integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
        if violations:
            raise RuntimeError(
                f"Converted database has {len(violations)} foreign-key violation(s)"
            )
        if integrity != "ok":
            raise RuntimeError(f"Converted database integrity check failed: {integrity}")
        for table, count in copied.items():
            source_count = source.execute(
                f"SELECT COUNT(*) FROM {_quote(table)}"
            ).fetchone()[0]
            if count != source_count:
                raise RuntimeError(
                    f"Unexplained row loss in {table}: copied {count} of {source_count}"
                )
        audit: dict[str, Any] = {
            "field_dispositions": _field_dispositions(source, target),
            "typed_fields": mapped,
            "changed_records": {
                "event_evidence_ids_generated": copied.get("events", 0),
                "person_evidence_ids_generated": copied.get("persons", 0),
                "capability_links_added": mapped["capability_links_added"],
                "unavailability_intervals_added": mapped["unavailability_intervals_added"],
                "template_fields_classified": mapped["template_fields_classified"],
                "template_fields_pending_review": mapped["template_fields_pending_review"],
            },
            "rejected_records": mapped["rejected_records"],
            "unexplained_loss": [],
        }
    finally:
        target.close()
    return copied, audit


def _resolve_age_executable(explicit: Path | None) -> tuple[str, str]:
    if explicit is not None:
        resolved = explicit.expanduser().resolve()
        if not resolved.is_file():
            raise ValueError(f"age executable does not exist: {resolved}")
        age = str(resolved)
    else:
        age = shutil.which("age")
        if age is None:
            raise RuntimeError(
                "age is required to encrypt the migration archive; add it to PATH "
                "or pass --age-executable"
            )
    version = subprocess.run(
        [age, "--version"], check=True, capture_output=True, text=True
    ).stdout.strip()
    return age, version


def _encrypt_archive(
    payload: dict[str, Any], recipient: str, output: Path, age: str
) -> None:
    with tempfile.TemporaryDirectory(prefix="mp-opt-migration-archive-") as directory:
        plaintext = Path(directory) / "archive.json"
        plaintext.write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )
        os.chmod(plaintext, 0o600)
        subprocess.run(
            [age, "--encrypt", "--recipient", recipient, "--output", str(output), str(plaintext)],
            check=True,
            stdout=subprocess.DEVNULL,
        )


def _fsync_file(path: Path) -> None:
    with path.open("r+b") as handle:
        handle.flush()
        os.fsync(handle.fileno())


def _fsync_directory(path: Path) -> None:
    """Flush directory metadata where the platform supports directory handles."""
    if os.name == "nt":
        return
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _publish_outputs(pairs: list[tuple[Path, Path]]) -> None:
    """Publish no-clobber atomic files, with the receipt supplied last."""
    published: list[Path] = []
    output_dir = pairs[0][1].parent
    try:
        for temporary, final in pairs:
            os.link(temporary, final)
            published.append(final)
            temporary.unlink()
        _fsync_directory(output_dir)
    except BaseException as publish_error:
        cleanup_failures: list[str] = []
        for final in reversed(published):
            try:
                final.unlink(missing_ok=True)
            except OSError as cleanup_error:
                cleanup_failures.append(f"{final}: {cleanup_error}")
        _fsync_directory(output_dir)
        if cleanup_failures:
            raise RuntimeError(
                "Output publication failed and partial outputs could not be removed: "
                + "; ".join(cleanup_failures)
            ) from publish_error
        raise


def _validate_paths(source: Path, target: Path, archive: Path, receipt: Path) -> None:
    if not source.is_file():
        raise ValueError("Source database does not exist")
    _assert_source_quiescent(source)
    resolved = [path.resolve() for path in (source, target, archive, receipt)]
    if len(set(resolved)) != len(resolved):
        raise ValueError("Source, target, archive and receipt must be different paths")
    output_parents = {path.parent.resolve() for path in (target, archive, receipt)}
    if len(output_parents) != 1:
        raise ValueError("Target database, archive and receipt must share one output directory")
    for path in (target, archive, receipt):
        if path.exists():
            raise FileExistsError(f"Refusing to overwrite {path}")
    target.parent.mkdir(parents=True, exist_ok=True)


def convert(
    source: Path,
    target: Path,
    archive: Path,
    recipient: str,
    age_executable: Path | None = None,
) -> dict[str, Any]:
    """Convert and publish the receipt last as the completion marker."""
    receipt = target.with_suffix(target.suffix + ".migration-receipt.json")
    _validate_paths(source, target, archive, receipt)
    if not recipient.startswith("age1"):
        raise ValueError("The archive recipient must be an age public recipient")
    age, age_version = _resolve_age_executable(age_executable)
    source_sha256 = _sha256(source)
    repo_root = Path(__file__).resolve().parents[2]
    source_db = _source_connection(source)
    try:
        source_schema_sha256 = _schema_sha256(source_db)
        archive_payload, source_counts = build_archive(source_db, source_sha256)
        with tempfile.TemporaryDirectory(prefix="mp-opt-desktop-v2-", dir=target.parent) as directory:
            temporary = Path(directory)
            temporary_db = temporary / "converted.db"
            temporary_archive = temporary / "migration-archive.age"
            copied_counts, conversion_audit = build_current_database(
                source_db, temporary_db, source_sha256, repo_root
            )
            _encrypt_archive(archive_payload, recipient, temporary_archive, age)
            _assert_source_quiescent(source)
            if _sha256(source) != source_sha256 or _schema_sha256(source_db) != source_schema_sha256:
                raise RuntimeError("Source database changed during conversion")
            result = {
                "format": FORMAT,
                "operator_tool_scope": OPERATOR_TOOL_SCOPE,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "source_sha256": source_sha256,
                "source_schema_sha256": source_schema_sha256,
                "target_sha256": _sha256(temporary_db),
                "archive_sha256": _sha256(temporary_archive),
                "archive_recipient_sha256": hashlib.sha256(recipient.encode("utf-8")).hexdigest(),
                "age_version": age_version,
                "source_row_counts": source_counts,
                "copied_row_counts": copied_counts,
                "conversion_audit": conversion_audit,
                "completion_marker": True,
                "source_unchanged": True,
            }
            temporary_receipt = temporary / "receipt.json"
            temporary_receipt.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            for output in (temporary_db, temporary_archive, temporary_receipt):
                os.chmod(output, 0o600)
                _fsync_file(output)
            _fsync_directory(temporary)
            _publish_outputs([
                (temporary_db, target),
                (temporary_archive, archive),
                (temporary_receipt, receipt),
            ])
    finally:
        source_db.close()
    return result


def dry_run(source: Path) -> dict[str, Any]:
    """Qualify a source copy without publishing a database or archive.

    This deliberately remains an operator-only action. It creates the current
    schema in a temporary directory, performs the semantic conversion and
    returns only non-sensitive accounting evidence.
    """
    if not source.is_file():
        raise ValueError("Source database does not exist")
    _assert_source_quiescent(source)
    source_sha256 = _sha256(source)
    repo_root = Path(__file__).resolve().parents[2]
    source_db = _source_connection(source)
    try:
        source_schema_sha256 = _schema_sha256(source_db)
        _archive_payload, source_counts = build_archive(source_db, source_sha256)
        with tempfile.TemporaryDirectory(prefix="mp-opt-desktop-v2-dry-run-") as directory:
            temporary_db = Path(directory) / "converted.db"
            copied_counts, conversion_audit = build_current_database(
                source_db, temporary_db, source_sha256, repo_root
            )
            target_sha256 = _sha256(temporary_db)
        _assert_source_quiescent(source)
        if _sha256(source) != source_sha256 or _schema_sha256(source_db) != source_schema_sha256:
            raise RuntimeError("Source database changed during dry run")
        return {
            "format": FORMAT,
            "operator_tool_scope": OPERATOR_TOOL_SCOPE,
            "source_sha256": source_sha256,
            "source_schema_sha256": source_schema_sha256,
            "prospective_target_sha256": target_sha256,
            "source_row_counts": source_counts,
            "copied_row_counts": copied_counts,
            "conversion_audit": conversion_audit,
            "source_unchanged": True,
            "dry_run": True,
            "outputs_published": False,
        }
    finally:
        source_db.close()


def rollback(target: Path, archive: Path) -> dict[str, Any]:
    """Remove one completed conversion after verifying its signed-off hashes.

    The source database is neither required nor opened. All three generated
    outputs are first moved into one private temporary directory. A failed move
    restores every already-moved output before returning an error.
    """
    receipt = target.with_suffix(target.suffix + ".migration-receipt.json")
    if target.parent.resolve() != archive.parent.resolve():
        raise ValueError("Target database and archive must share one output directory")
    for path in (target, archive, receipt):
        if not path.is_file():
            raise ValueError(f"Completed conversion output does not exist: {path}")
    try:
        record = json.loads(receipt.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Conversion receipt is unreadable") from exc
    if (
        record.get("format") != FORMAT
        or record.get("operator_tool_scope") != OPERATOR_TOOL_SCOPE
        or record.get("completion_marker") is not True
    ):
        raise ValueError("Conversion receipt is not a completed one-time conversion")
    if _sha256(target) != record.get("target_sha256"):
        raise ValueError("Converted database does not match its receipt")
    if _sha256(archive) != record.get("archive_sha256"):
        raise ValueError("Encrypted archive does not match its receipt")

    moved: list[tuple[Path, Path]] = []
    with tempfile.TemporaryDirectory(prefix="mp-opt-desktop-v2-rollback-", dir=target.parent) as directory:
        quarantine = Path(directory)
        try:
            for path in (target, archive, receipt):
                held = quarantine / path.name
                os.replace(path, held)
                moved.append((path, held))
            _fsync_directory(target.parent)
        except BaseException as rollback_error:
            restore_failures: list[str] = []
            for original, held in reversed(moved):
                try:
                    os.replace(held, original)
                except OSError as restore_error:
                    restore_failures.append(f"{original}: {restore_error}")
            _fsync_directory(target.parent)
            if restore_failures:
                raise RuntimeError(
                    "Rollback failed and generated outputs could not be restored: "
                    + "; ".join(restore_failures)
                ) from rollback_error
            raise
    _fsync_directory(target.parent)
    return {
        "format": FORMAT,
        "operator_tool_scope": OPERATOR_TOOL_SCOPE,
        "target_sha256": record["target_sha256"],
        "archive_sha256": record["archive_sha256"],
        "outputs_removed": True,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run", action="store_true",
        help="Validate and semantically convert into temporary storage without publishing outputs",
    )
    mode.add_argument(
        "--rollback", action="store_true",
        help="Hash-verify and remove one completed conversion's generated outputs",
    )
    parser.add_argument("--source", type=Path, help="Existing source database copy")
    parser.add_argument("--target", type=Path, help="New current-format database path")
    parser.add_argument("--archive", type=Path, help="New encrypted archive path")
    parser.add_argument("--recipient", help="Controller-held age public recipient")
    parser.add_argument(
        "--age-executable",
        type=Path,
        help="Resolved age executable path when age is not available on PATH",
    )
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.rollback:
            if args.target is None or args.archive is None:
                raise ValueError("--rollback requires --target and --archive")
            if args.source is not None or args.recipient is not None or args.age_executable is not None:
                raise ValueError("--rollback accepts only --target and --archive")
            result = rollback(args.target, args.archive)
            print("Generated conversion outputs were removed after hash verification.")
            print(f"Target SHA-256:  {result['target_sha256']}")
            print(f"Archive SHA-256: {result['archive_sha256']}")
            return 0
        if args.source is None:
            raise ValueError("--source is required")
        if args.dry_run:
            if any(value is not None for value in (args.target, args.archive, args.recipient, args.age_executable)):
                raise ValueError("--dry-run accepts only --source")
            result = dry_run(args.source)
            print("Dry run completed without publishing outputs or modifying the source database.")
            print(f"Source SHA-256: {result['source_sha256']}")
            print(f"Prospective target SHA-256: {result['prospective_target_sha256']}")
            return 0
        if args.target is None or args.archive is None or args.recipient is None:
            raise ValueError("conversion requires --source, --target, --archive and --recipient")
        result = convert(args.source, args.target, args.archive, args.recipient, args.age_executable)
    except (OSError, sqlite3.Error, subprocess.CalledProcessError, RuntimeError, ValueError) as exc:
        print(f"Conversion failed: {exc}", file=sys.stderr)
        return 1
    print("Conversion completed without modifying the source database.")
    print(f"Source SHA-256:  {result['source_sha256']}")
    print(f"Target SHA-256:  {result['target_sha256']}")
    print(f"Archive SHA-256: {result['archive_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
