"""
Google Calendar Connection Model
Stores OAuth2 credentials and calendar association for events.
"""
from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.db.database import Base
from app.core.encryption import EncryptedJSON


class GoogleCalendarConnection(Base):
    """Stores Google OAuth2 token and selected calendar info"""
    __tablename__ = "google_calendar_connections"

    id = Column(Integer, primary_key=True, index=True)
    account_email = Column(String, nullable=False)       # Google account email
    token_data = Column(EncryptedJSON, nullable=False)    # Non-secret OAuth metadata; tokens live in OS secure storage
    calendar_id = Column(String, nullable=True)           # Selected calendar ID (may be set later)
    calendar_name = Column(String, nullable=True)         # Display name of the selected calendar

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
