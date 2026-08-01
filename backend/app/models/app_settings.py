"""
AppSettings Model
Key-value store for application-wide configuration (e.g. OAuth credentials).
"""
from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.db.database import Base
from app.core.encryption import EncryptedString


class AppSettings(Base):
    """Application-wide settings stored as key-value pairs."""
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    value = Column(EncryptedString, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
