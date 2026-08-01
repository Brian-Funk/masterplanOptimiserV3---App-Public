"""Public metadata for Desktop-held processor evidence keys."""

from sqlalchemy import CheckConstraint, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.database import Base


class ProcessorEvidenceKey(Base):
    """Describe one processor Ed25519 key without private material."""

    __tablename__ = "processor_evidence_keys"
    __table_args__ = (
        CheckConstraint("role = 'processor'", name="ck_desktop_processor_evidence_role"),
        CheckConstraint(
            "state IN ('active','retired','private_key_missing')",
            name="ck_desktop_processor_evidence_state",
        ),
    )

    id = Column(Integer, primary_key=True)
    key_id = Column(String(19), nullable=False, unique=True, index=True)
    public_key = Column(Text, nullable=False)
    public_key_sha256 = Column(String(64), nullable=False, unique=True)
    processor_id = Column(String(64), nullable=False, index=True)
    role = Column(String(32), nullable=False, default="processor")
    state = Column(String(24), nullable=False, default="active")
    supersedes_key_id = Column(String(19), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    retired_at = Column(DateTime(timezone=True), nullable=True)
