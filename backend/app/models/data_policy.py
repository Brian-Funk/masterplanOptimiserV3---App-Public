"""Local accountability records for task-field classification changes."""

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.db.database import Base


class FieldClassificationAudit(Base):
    """Pseudonymous, data-minimised record of a visibility or purpose change."""

    __tablename__ = "field_classification_audit"

    id = Column(Integer, primary_key=True)
    template_id = Column(Integer, nullable=False, index=True)
    field_id = Column(String(200), nullable=False)
    previous_purpose = Column(String(48), nullable=True)
    previous_visibility = Column(String(48), nullable=True)
    new_purpose = Column(String(48), nullable=True)
    new_visibility = Column(String(48), nullable=True)
    operator_subject = Column(String(64), nullable=False, index=True)
    changed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
