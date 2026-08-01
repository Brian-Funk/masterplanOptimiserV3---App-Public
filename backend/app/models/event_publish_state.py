"""Persistent publish-state metadata for desktop events."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.sql import func

from app.db.database import Base


class EventPublishState(Base):
    """Stores non-sensitive schedule publish metadata for one event."""

    __tablename__ = "event_publish_states"

    event_id = Column(
        Integer,
        ForeignKey("events.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    published_schedule_fingerprint = Column(String, nullable=True)
    published_schedule_scope = Column(String, nullable=True)
    published_at = Column(String, nullable=True)
    publish_failed_at = Column(String, nullable=True)
    day_records = Column(JSON, default=dict, nullable=False)
    last_publish_target = Column(String, nullable=True)
    last_publish_result_summary = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
