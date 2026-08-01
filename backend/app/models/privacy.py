"""Typed privacy-sensitive operational records and deletion report outbox."""

import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.encryption import EncryptedString
from app.db.database import Base


class PersonUnavailability(Base):
    """A reason-free interval during which a person cannot be assigned."""

    __tablename__ = "person_unavailability"
    __table_args__ = (
        UniqueConstraint(
            "person_id", "starts_at", "ends_at",
            name="uq_person_unavailability_interval",
        ),
        CheckConstraint("ends_at > starts_at", name="ck_person_unavailability_order"),
    )

    id = Column(Integer, primary_key=True)
    event_id = Column(
        Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    person_id = Column(
        Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    starts_at = Column(DateTime(timezone=False), nullable=False, index=True)
    ends_at = Column(DateTime(timezone=False), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DesktopDeletionOutbox(Base):
    """A privacy-safe report durably committed with its local erasure."""

    __tablename__ = "desktop_deletion_outbox"
    __table_args__ = (
        CheckConstraint("operation IN ('delete_subject','delete_event')", name="ck_desktop_outbox_operation"),
        CheckConstraint("state IN ('pending','sent')", name="ck_desktop_outbox_state"),
    )

    id = Column(Integer, primary_key=True)
    outbox_id = Column(
        String(36), nullable=False, unique=True,
        default=lambda: str(uuid.uuid4()), index=True,
    )
    work_order_id = Column(String(36), nullable=False, unique=True, index=True)
    event_ref = Column(String(36), nullable=False, index=True)
    subject_ref = Column(String(36), nullable=True, index=True)
    operation = Column(String(24), nullable=False)
    server_url = Column(String, nullable=False)
    publish_secret = Column(EncryptedString, nullable=True)
    claim_capability = Column(EncryptedString, nullable=True)
    report_json = Column(Text, nullable=False)
    report_sha256 = Column(String(64), nullable=False, unique=True)
    state = Column(String(16), nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    last_error_code = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
