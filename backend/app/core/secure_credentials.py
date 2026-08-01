"""OS-backed secure credential storage for desktop secrets.

The secure store contains only raw secret strings. Metadata such as URLs,
calendar ids, account emails, and configured status remains in SQLite.
"""
from __future__ import annotations

import logging
from typing import Protocol

logger = logging.getLogger(__name__)

SERVICE_NAME = "Masterplan Optimiser"


class SecureCredentialStoreUnavailable(RuntimeError):
    """Raised when the OS credential store cannot be used."""


class SecureCredentialStore(Protocol):
    """Small interface used by app code and tests."""

    def available(self) -> bool:
        """Return whether the backing store can be used."""

    def get(self, account: str) -> str | None:
        """Return a secret string or None when not stored."""

    def set(self, account: str, value: str) -> None:
        """Store one raw secret string."""

    def delete(self, account: str) -> None:
        """Delete a stored secret if present."""


class KeyringCredentialStore:
    """Credential store backed by the platform keyring."""

    def _keyring(self):
        try:
            import keyring

            return keyring
        except Exception as exc:  # pragma: no cover - depends on environment
            raise SecureCredentialStoreUnavailable(
                "OS credential storage is not available on this system."
            ) from exc

    def available(self) -> bool:
        try:
            keyring = self._keyring()
            backend = keyring.get_keyring()
            priority = getattr(backend, "priority", 0)
            return bool(priority and priority > 0)
        except Exception:
            return False

    def get(self, account: str) -> str | None:
        try:
            return self._keyring().get_password(SERVICE_NAME, account)
        except Exception as exc:  # pragma: no cover - depends on environment
            raise SecureCredentialStoreUnavailable(
                "OS credential storage is not available on this system."
            ) from exc

    def set(self, account: str, value: str) -> None:
        if not isinstance(value, str):
            raise TypeError("Secure credential values must be strings.")
        try:
            self._keyring().set_password(SERVICE_NAME, account, value)
        except Exception as exc:  # pragma: no cover - depends on environment
            raise SecureCredentialStoreUnavailable(
                "OS credential storage is not available on this system."
            ) from exc

    def delete(self, account: str) -> None:
        try:
            self._keyring().delete_password(SERVICE_NAME, account)
        except Exception as exc:  # pragma: no cover - depends on environment
            message = str(exc).lower()
            if "not found" in message or "no password" in message:
                return
            raise SecureCredentialStoreUnavailable(
                "OS credential storage is not available on this system."
            ) from exc


_store_override: SecureCredentialStore | None = None


def set_credential_store_for_tests(store: SecureCredentialStore | None) -> None:
    """Inject a fake credential store for tests."""
    global _store_override
    _store_override = store


def get_credential_store() -> SecureCredentialStore:
    """Return the active credential store."""
    return _store_override or KeyringCredentialStore()


def credential_store_available() -> bool:
    """Return whether secure credential storage is usable."""
    return get_credential_store().available()


def get_secret(account: str) -> str | None:
    """Read one secret string from secure storage."""
    return get_credential_store().get(account)


def set_secret(account: str, value: str) -> None:
    """Store one secret string in secure storage."""
    get_credential_store().set(account, value)


def delete_secret(account: str) -> None:
    """Delete one secret from secure storage."""
    get_credential_store().delete(account)


def mp_backend_secret_key(event_id: int) -> str:
    return f"masterplan:mp-backend:event:{event_id}:publish-secret"


def google_access_token_key(connection_id: int) -> str:
    return f"masterplan:google:connection:{connection_id}:access-token"


def google_refresh_token_key(connection_id: int) -> str:
    return f"masterplan:google:connection:{connection_id}:refresh-token"


def google_oauth_client_secret_key() -> str:
    return "masterplan:google-oauth:client-secret"
