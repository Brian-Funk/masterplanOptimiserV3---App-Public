from datetime import date
from pathlib import Path
import time

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.api.v1 import masterplan_layouts
from app.api.v1.data_management import ExportRequest, export_data
from app.core import encryption
from app.core.encryption import encrypt_json, encrypt_str
from app.core import google_calendar_service
from app.db.database import Base, _enable_sqlite_secure_deletion
from app.main import _is_auth_exempt, app
from app.models import AppSettings, Event


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


def _request(method: str, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": [],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 12345),
        }
    )


@pytest.mark.asyncio
async def test_event_export_redacts_publish_integrations(db_session):
    event = Event(
        name="Secure Event",
        location="Venue",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 2),
        google_calendar_id="calendar@example.com",
        mp_backend_url="https://example.com",
        meta_data={"pdf_export_title": "Field Operations"},
    )
    db_session.add(event)
    db_session.commit()

    exported = await export_data(ExportRequest(scope="event", event_ids=[event.id]), db=db_session)
    event_payload = exported["events"][0]["event"]

    assert "mp_backend_url" not in event_payload
    assert "google_calendar_id" not in event_payload
    assert event_payload["meta_data"]["pdf_export_title"] == "Field Operations"


def test_app_settings_encrypts_oauth_credentials_and_reads_plaintext(db_session):
    row = AppSettings(key="google_client_secret", value="plain-secret")
    db_session.add(row)
    db_session.commit()

    raw_value = db_session.execute(
        text("SELECT value FROM app_settings WHERE key = 'google_client_secret'")
    ).scalar_one()
    assert raw_value.startswith("enc::")

    loaded = db_session.query(AppSettings).filter(AppSettings.key == "google_client_secret").one()
    assert loaded.value == "plain-secret"


def test_encryption_helpers_do_not_double_encrypt():
    encrypted = encrypt_str("secret")
    assert encrypt_str(encrypted) == encrypted

    encrypted_json = encrypt_json({"token": "secret"})
    assert encrypt_json(encrypted_json) == encrypted_json


def test_encryption_key_path_prefers_desktop_env_var(monkeypatch, tmp_path):
    key_path = tmp_path / "user-data" / "data" / "encryption.key"

    monkeypatch.setenv("ENCRYPTION_KEY_PATH", str(key_path))

    assert encryption._default_key_path() == str(key_path.resolve())


def test_encryption_key_path_keeps_development_fallback(monkeypatch):
    monkeypatch.delenv("ENCRYPTION_KEY_PATH", raising=False)

    fallback = Path(encryption._default_key_path())

    assert fallback.name == "encryption.key"
    assert fallback.parent.name == "data"
    assert fallback.parent.parent.name == "backend"


def test_existing_encryption_key_is_reused(monkeypatch, tmp_path):
    key_path = tmp_path / "data" / "encryption.key"
    monkeypatch.setattr(encryption, "_KEY_PATH", str(key_path))
    monkeypatch.setattr(encryption, "_fernet", None)

    encryption.encrypt_str("first secret")
    original_key = key_path.read_bytes()

    monkeypatch.setattr(encryption, "_fernet", None)
    encryption.encrypt_str("second secret")

    assert key_path.read_bytes() == original_key


def test_sqlite_connections_enable_secure_deletion(tmp_path):
    statements = []

    class Cursor:
        def execute(self, statement):
            statements.append(statement)

        def close(self):
            statements.append("closed")

    class Connection:
        def cursor(self):
            return Cursor()

    _enable_sqlite_secure_deletion(Connection(), None)

    assert statements == ["PRAGMA secure_delete=ON", "closed"]

    sqlite_engine = create_engine(f"sqlite:///{tmp_path / 'secure-delete.db'}")
    event.listen(sqlite_engine, "connect", _enable_sqlite_secure_deletion)
    try:
        with sqlite_engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA secure_delete").scalar_one() == 1
    finally:
        sqlite_engine.dispose()


def test_oauth_state_is_mandatory_single_use_and_expiring():
    google_calendar_service._pending_verifiers.clear()

    with pytest.raises(ValueError, match="Missing OAuth state"):
        google_calendar_service._consume_code_verifier("")

    google_calendar_service._pending_verifiers["state-1"] = ("verifier", time.time() + 60)
    assert google_calendar_service._consume_code_verifier("state-1") == "verifier"

    with pytest.raises(ValueError, match="Unknown or expired"):
        google_calendar_service._consume_code_verifier("state-1")

    google_calendar_service._pending_verifiers["state-2"] = ("verifier", time.time() - 1)
    with pytest.raises(ValueError, match="Unknown or expired"):
        google_calendar_service._consume_code_verifier("state-2")


def test_oauth_post_callback_requires_desktop_token():
    assert _is_auth_exempt(_request("GET", "/api/v1/google/oauth2callback"))
    assert not _is_auth_exempt(_request("POST", "/api/v1/google/oauth2callback"))
    assert _is_auth_exempt(_request("OPTIONS", "/api/v1/google/oauth2callback"))


def test_single_health_route_is_registered():
    health_routes = [route for route in app.routes if getattr(route, "path", None) == "/health"]
    assert len(health_routes) == 1


def test_masterplan_bulk_route_precedes_dynamic_task_route():
    paths = [route.path for route in masterplan_layouts.router.routes]
    assert paths.index("/bulk/upsert") < paths.index("/{task_id}")
