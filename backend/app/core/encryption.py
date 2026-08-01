"""
Column-level encryption for sensitive data stored in the local SQLite database.
Uses Fernet (AES-128-CBC + HMAC-SHA256) via the cryptography library.

The encryption key is generated once and stored alongside the active database.
Packaged desktop builds pass ENCRYPTION_KEY_PATH so updates keep the key in
Electron's stable user-data directory. The key is NOT checked into version
control.
"""
import json
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import TypeDecorator, Text

def _default_key_path() -> str:
    """Return the encryption key path for the current runtime."""
    configured_path = os.getenv("ENCRYPTION_KEY_PATH")
    if configured_path:
        return os.path.abspath(configured_path)
    return os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "data",
        "encryption.key",
    )


_KEY_PATH = _default_key_path()

_fernet: Optional[Fernet] = None

# Prefix that marks a value as Fernet-encrypted (avoids double-encryption)
_ENC_PREFIX = "enc::"


def _get_fernet() -> Fernet:
    """Return a cached Fernet instance, creating the key file if needed."""
    global _fernet
    if _fernet is not None:
        return _fernet

    os.makedirs(os.path.dirname(_KEY_PATH), exist_ok=True)

    if os.path.exists(_KEY_PATH):
        key = open(_KEY_PATH, "rb").read().strip()
    else:
        key = Fernet.generate_key()
        fd = os.open(_KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(key)

    _fernet = Fernet(key)
    return _fernet


def encrypt_json(data: dict) -> str:
    """Encrypt a dict as a Fernet-encrypted JSON string."""
    if isinstance(data, str) and data.startswith(_ENC_PREFIX):
        return data
    plaintext = json.dumps(data).encode("utf-8")
    return _ENC_PREFIX + _get_fernet().encrypt(plaintext).decode("ascii")


def decrypt_json(value) -> dict:
    """Decrypt a current Fernet-encrypted JSON value."""
    if isinstance(value, str) and value.startswith(_ENC_PREFIX):
        token = value[len(_ENC_PREFIX):].encode("ascii")
        try:
            return json.loads(_get_fernet().decrypt(token))
        except InvalidToken:
            raise ValueError("Failed to decrypt value - encryption key may have changed")
    raise ValueError("Unencrypted JSON is not accepted by the current schema")


def encrypt_str(data: str) -> str:
    """Encrypt a plain string."""
    if not data:
        return data
    if data.startswith(_ENC_PREFIX):
        return data
    return _ENC_PREFIX + _get_fernet().encrypt(data.encode("utf-8")).decode("ascii")


def decrypt_str(value: Optional[str]) -> Optional[str]:
    """Decrypt a current Fernet-encrypted string."""
    if not value:
        return value
    if value.startswith(_ENC_PREFIX):
        token = value[len(_ENC_PREFIX):].encode("ascii")
        try:
            return _get_fernet().decrypt(token).decode("utf-8")
        except InvalidToken:
            raise ValueError("Failed to decrypt value - encryption key may have changed")
    raise ValueError("Unencrypted text is not accepted by the current schema")


# ---------------------------------------------------------------------------
# SQLAlchemy TypeDecorators for transparent column encryption
# ---------------------------------------------------------------------------

class EncryptedJSON(TypeDecorator):
    """Transparently encrypts a dict/JSON value at rest in a TEXT column."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Encrypt a JSON-compatible value before SQLAlchemy writes it."""
        if value is not None:
            return encrypt_json(value)
        return value

    def process_result_value(self, value, dialect):
        """Decrypt a JSON-compatible value after SQLAlchemy reads it."""
        if value is not None:
            return decrypt_json(value)
        return value


class EncryptedString(TypeDecorator):
    """Transparently encrypts a string value at rest in a TEXT column."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        """Encrypt a string before SQLAlchemy writes it."""
        if value is not None:
            return encrypt_str(value)
        return value

    def process_result_value(self, value, dialect):
        """Decrypt a string after SQLAlchemy reads it."""
        if value is not None:
            return decrypt_str(value)
        return value
