"""General Schedule models for event-scoped public programme planning."""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, JSON, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.db.database import Base


class AudienceCategory(Base):
    """Event-scoped audience grouping used for separate published schedules."""

    __tablename__ = "audience_categories"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    sort_order = Column(Float, nullable=True, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AudienceTeam(Base):
    """Simple event-scoped audience label used by Session Elements."""

    __tablename__ = "audience_teams"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("audience_categories.id", ondelete="SET NULL"), nullable=True)
    name = Column(String, nullable=False)
    short_name = Column(String, nullable=True)
    description = Column(String, nullable=True)
    colour = Column(String, nullable=True)
    sort_order = Column(Float, nullable=True, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ScheduleView(Base):
    """Event-scoped public schedule view selected by Session Elements."""

    __tablename__ = "schedule_views"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    sort_order = Column(Float, nullable=True, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SessionElementType(Base):
    """Event-scoped type controlling Session Element colour and copy format."""

    __tablename__ = "session_element_types"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    colour = Column(String, nullable=True)
    sort_order = Column(Float, nullable=True, default=0)
    copy_template_html = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SessionElement(Base):
    """Programme block in the General Schedule, independent from tasks."""

    __tablename__ = "session_elements"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    session_element_type_id = Column(Integer, ForeignKey("session_element_types.id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=False)
    date = Column(String, nullable=False)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    location_id = Column(Integer, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    responsible_person_id = Column(Integer, ForeignKey("persons.id", ondelete="SET NULL"), nullable=True)
    responsible_text = Column(String, nullable=True)
    # Legacy compatibility fields. They are no longer exposed in the desktop UI.
    location_text = Column(String, nullable=True)
    location_note = Column(String, nullable=True)
    attendee_team_ids = Column(JSON, default=list)
    schedule_view_ids = Column(JSON, default=list)
    visibility = Column(String, nullable=False, default="public")
    description = Column(String, nullable=True)
    category = Column(String, nullable=True)
    colour = Column(String, nullable=True)
    sort_order = Column(Float, nullable=True, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class GeneralSchedulePublishState(Base):
    """Non-sensitive publish confidence state for one event's General Schedule."""

    __tablename__ = "general_schedule_publish_states"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_general_schedule_publish_state_event"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    fingerprint = Column(String, nullable=True)
    published_at = Column(String, nullable=True)
    publish_failed_at = Column(String, nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    last_error = Column(String, nullable=True)
    day_records = Column(JSON, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
