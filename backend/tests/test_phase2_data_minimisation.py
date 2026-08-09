"""Desktop Phase 2 field-classification boundary tests."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.task_templates import (
    TaskTemplateCreate,
    TaskTemplateUpdate,
    create_template,
    update_template,
)
from app.api.v1.general_schedule import SessionElementCreate, create_session_element
from app.core.data_minimisation import (
    PUBLISH_CONTRACT_VERSION,
    inferred_field_purpose,
    reviewed_publish_definition,
)
from app.db.database import Base
from app.models import FieldClassificationAudit
from app.models import Event, SessionElementType


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autoflush=False, bind=engine)()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize(("field_type", "purpose"), [
    ("duration", "timing"),
    ("time_range", "timing"),
    ("start_end_time", "timing"),
    ("location", "location"),
    ("capabilities_list", "assignment"),
    ("persons_list", "assignment"),
    ("link", "reference"),
    ("text", "operational_instruction"),
    ("number", "operational_instruction"),
])
def test_field_purpose_is_derived_from_type(field_type, purpose):
    assert inferred_field_purpose(field_type) == purpose


def test_field_has_automatic_authenticated_wire_metadata():
    definition = reviewed_publish_definition({
        "id": "brief",
        "name": "Operational brief",
        "type": "text",
        "purpose": "assignment",
        "visibility": "never_publish",
        "classification_reviewed": False,
    })
    assert definition == {
        "id": "brief",
        "name": "Operational brief",
        "type": "text",
        "purpose": "operational_instruction",
        "visibility": "participant",
    }
    assert PUBLISH_CONTRACT_VERSION == "2026-07-30"


def test_optimizer_only_field_is_not_a_participant_operational_field():
    assert reviewed_publish_definition({
        "id": "dynamic",
        "name": "Dynamic allocation",
        "type": "dynamic_transfer_allocation",
    }) is None


def test_unknown_field_type_cannot_cross_server_boundary():
    with pytest.raises(ValueError, match="no bounded Server wire type"):
        reviewed_publish_definition({"id": "unknown", "name": "Unknown", "type": "binary"})


@pytest.mark.asyncio
async def test_template_metadata_is_derived_and_audited(db_session):
    public_field = {
        "id": "brief",
        "name": "Public brief",
        "type": "text",
        "category": "arbitrary",
        "purpose": "operational_instruction",
        "visibility": "public",
        "classification_reviewed": True,
    }
    created = await create_template(
        TaskTemplateCreate(
            machine_name="audited_template",
            name="Audited template",
            fields=[public_field],
        ),
        db=db_session,
    )
    assert created.fields[0]["visibility"] == "participant"
    assert created.fields[0]["purpose"] == "operational_instruction"
    assert created.fields[0]["classification_reviewed"] is True
    await update_template(
        created.id,
        TaskTemplateUpdate(fields=[{
            **public_field,
            "type": "link",
            "purpose": "timing",
            "visibility": "never_publish",
            "classification_reviewed": False,
        }]),
        db=db_session,
    )

    records = (
        db_session.query(FieldClassificationAudit)
        .filter(FieldClassificationAudit.template_id == created.id)
        .order_by(FieldClassificationAudit.id)
        .all()
    )
    assert len(records) == 2
    assert records[0].previous_visibility is None
    assert records[0].new_visibility == "participant"
    assert records[1].previous_purpose == "operational_instruction"
    assert records[1].new_purpose == "reference"
    assert records[1].new_visibility == "participant"
    assert records[0].operator_subject == records[1].operator_subject
    assert len(records[0].operator_subject) == 64


@pytest.mark.asyncio
async def test_public_schedule_items_ignore_a_non_public_client_audience(db_session):
    event = Event(name="Synthetic public schedule")
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    session_type = SessionElementType(event_id=event.id, name="Session")
    db_session.add(session_type)
    db_session.commit()
    db_session.refresh(session_type)

    payload = SessionElementCreate(
        title="Public session",
        date="2032-04-21",
        start_time="09:00",
        end_time="10:00",
        session_element_type_id=session_type.id,
        visibility="internal",
    )
    created = await create_session_element(payload, event.id, db_session)
    assert created.visibility == "public"
