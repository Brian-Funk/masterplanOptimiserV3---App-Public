"""Phase F qualification of the separate one-time Desktop converter."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest


APP_ROOT = Path(__file__).resolve().parents[2]
CONVERTER_PATH = APP_ROOT / "tools" / "one_off" / "convert_current_desktop_v2.py"


def _converter():
    spec = importlib.util.spec_from_file_location("phase_f_one_off_converter", CONVERTER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the one-time converter")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _source(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            PRAGMA foreign_keys=ON;
            CREATE TABLE events (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT
            );
            CREATE TABLE persons (
                id INTEGER PRIMARY KEY,
                event_id INTEGER NOT NULL REFERENCES events(id),
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                global_data TEXT
            );
            INSERT INTO events VALUES (7, 'Synthetic conversion event', 'draft');
            INSERT INTO persons VALUES (
                11, 7, 'Synthetic', 'Operator',
                '{"capabilities": [], "unavailabilities": [], "legacy_note": "archive only"}'
            );
            """
        )
        connection.commit()
    finally:
        connection.close()


def test_dry_run_conversion_semantic_comparison_and_rollback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    converter = _converter()
    source = tmp_path / "synthetic-source.db"
    target = tmp_path / "current-format.db"
    archive = tmp_path / "source-archive.age"
    _source(source)
    source_before = source.read_bytes()

    dry_run = converter.dry_run(source)

    assert dry_run["operator_tool_scope"] == "separate-temporary-one-time-converter"
    assert dry_run["dry_run"] is True
    assert dry_run["outputs_published"] is False
    assert dry_run["source_row_counts"] == {"events": 1, "persons": 1}
    assert dry_run["copied_row_counts"]["events"] == 1
    assert dry_run["copied_row_counts"]["persons"] == 1
    assert dry_run["conversion_audit"]["unexplained_loss"] == []
    assert source.read_bytes() == source_before
    assert set(tmp_path.iterdir()) == {source}

    captured_archive: dict = {}

    def synthetic_encrypt(payload, _recipient, output, _age):
        captured_archive.update(payload)
        output.write_bytes(
            b"synthetic-age-fixture\0"
            + json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        )

    monkeypatch.setattr(converter, "_resolve_age_executable", lambda _path: ("synthetic-age", "synthetic-age 1"))
    monkeypatch.setattr(converter, "_encrypt_archive", synthetic_encrypt)
    converted = converter.convert(source, target, archive, "age1synthetic")
    receipt = target.with_suffix(target.suffix + ".migration-receipt.json")

    assert converted["operator_tool_scope"] == "separate-temporary-one-time-converter"
    assert converted["source_sha256"] == hashlib.sha256(source_before).hexdigest()
    assert converted["source_row_counts"] == dry_run["source_row_counts"]
    assert converted["copied_row_counts"] == dry_run["copied_row_counts"]
    assert converted["conversion_audit"] == dry_run["conversion_audit"]
    assert captured_archive["tables"]["events"][0]["name"] == "Synthetic conversion event"
    assert source.read_bytes() == source_before
    assert target.is_file() and archive.is_file() and receipt.is_file()

    current = sqlite3.connect(target)
    try:
        assert current.execute("SELECT name FROM events WHERE id = 7").fetchone() == (
            "Synthetic conversion event",
        )
        person = current.execute(
            "SELECT first_name, last_name, evidence_subject_id FROM persons WHERE id = 11"
        ).fetchone()
        assert person[:2] == ("Synthetic", "Operator")
        assert len(person[2]) == 36
    finally:
        current.close()

    original_archive = archive.read_bytes()
    archive.write_bytes(original_archive + b"tampered")
    with pytest.raises(ValueError, match="Encrypted archive does not match"):
        converter.rollback(target, archive)
    assert target.is_file() and archive.is_file() and receipt.is_file()
    archive.write_bytes(original_archive)

    rolled_back = converter.rollback(target, archive)

    assert rolled_back["outputs_removed"] is True
    assert not target.exists() and not archive.exists() and not receipt.exists()
    assert source.read_bytes() == source_before


def test_desktop_runtime_does_not_import_or_expose_the_converter() -> None:
    runtime_roots = (APP_ROOT / "backend" / "app", APP_ROOT / "web" / "src", APP_ROOT / "desktop")
    converter_name_references: list[Path] = []
    for root in runtime_roots:
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".py", ".js", ".jsx", ".ts", ".tsx"}:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore").casefold()
            assert "tools.one_off" not in text, path
            assert "import convert_current_desktop_v2" not in text, path
            if "convert_current_desktop_v2" in text:
                converter_name_references.append(path)

    assert converter_name_references == [APP_ROOT / "backend" / "app" / "main.py"]
    startup = converter_name_references[0].read_text(encoding="utf-8")
    assert "retired desktop schema" in startup
    assert "against a copy" in startup
    assert "subprocess" not in startup
