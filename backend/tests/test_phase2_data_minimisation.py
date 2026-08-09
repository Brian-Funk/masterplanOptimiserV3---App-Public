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


def test_unclassified_field_is_fail_closed_until_reviewed():
    with pytest.raises(ValueError, match="purpose and Server sharing reviewed"):
        reviewed_publish_definition({"id": "notes", "name": "Notes", "type": "text"})


def test_never_publish_field_is_omitted_after_review():
    assert reviewed_publish_definition({
        "id": "notes",
        "name": "Notes",
        "type": "text",
        "purpose": "operational_instruction",
        "visibility": "never_publish",
        "classification_reviewed": True,
    }) is None


def test_reviewed_field_has_exact_wire_metadata():
    definition = reviewed_publish_definition({
        "id": "brief",
        "name": "Operational brief",
        "type": "text",
        "purpose": "operational_instruction",
        "visibility": "participant",
        "classification_reviewed": True,
    })
    assert definition == {
        "id": "brief",
        "name": "Operational brief",
        "type": "text",
        "purpose": "operational_instruction",
        "visibility": "participant",
    }
    assert PUBLISH_CONTRACT_VERSION == "2026-07-30"


@pytest.mark.parametrize("legacy_visibility", ["organiser", "public"])
def test_older_publishable_classifications_are_narrowed_to_authenticated(legacy_visibility):
    definition = reviewed_publish_definition({
        "id": "brief",
        "name": "Operational brief",
        "type": "text",
        "purpose": "operational_instruction",
        "visibility": legacy_visibility,
        "classification_reviewed": True,
    })
    assert definition["visibility"] == "participant"


def test_unbounded_field_type_cannot_cross_server_boundary():
    with pytest.raises(ValueError, match="no bounded Server wire type"):
        reviewed_publish_definition({
            "id": "dynamic",
            "name": "Dynamic allocation",
            "type": "dynamic_transfer_allocation",
            "purpose": "assignment",
            "visibility": "participant",
            "classification_reviewed": True,
        })


@pytest.mark.asyncio
async def test_template_sharing_is_normalised_to_authenticated_and_audited(db_session):
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
    await update_template(
        created.id,
        TaskTemplateUpdate(fields=[{
            **public_field,
            "visibility": "never_publish",
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
    assert records[1].previous_visibility == "participant"
    assert records[1].new_visibility == "never_publish"
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
