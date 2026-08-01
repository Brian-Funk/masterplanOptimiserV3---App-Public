from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.db.database import Base


class Theme(Base):
    """
    Theme configuration for the application.
    Stores customisable colour schemes that can be configured by admins.
    Only one theme should be active at a time.
    """

    __tablename__ = "themes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, default="Default Theme")
    is_active = Column(Boolean, default=False, index=True)

    # Primary Colours (1-3 customisable brand colours)
    primary_color_1 = Column(String, nullable=False, default="#2563eb")  # Blue-600
    primary_color_2 = Column(String, nullable=True, default="#7c3aed")  # Violet-600
    primary_color_3 = Column(String, nullable=True, default="#0891b2")  # Cyan-600

    # Semantic Colours
    success_color = Column(String, nullable=False, default="#10b981")  # Green-500
    warning_color = Column(String, nullable=False, default="#f59e0b")  # Yellow-500
    error_color = Column(String, nullable=False, default="#ef4444")  # Red-500
    info_color = Column(String, nullable=False, default="#3b82f6")  # Blue-500

    # Dark mode: 'light', 'dark', or 'system'
    dark_mode = Column(String, nullable=False, default="light")

    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self):
        return f"<Theme(name='{self.name}', active={self.is_active})>"
