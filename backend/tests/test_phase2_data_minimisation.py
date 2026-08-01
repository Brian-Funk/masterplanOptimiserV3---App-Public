"""Desktop Phase 2 field-classification boundary tests."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.task_templates import (
    TaskTemplateCreate,
    TaskTemplateUpdate,
    create_template,
    update_template,
)
from app.core.data_minimisation import (
    PUBLISH_CONTRACT_VERSION,
    reviewed_publish_definition,
)
from app.db.database import Base
from app.models import FieldClassificationAudit


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
    with pytest.raises(ValueError, match="must have its purpose and visibility reviewed"):
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
        "visibility": "organiser",
        "classification_reviewed": True,
    })
    assert definition == {
        "id": "brief",
        "name": "Operational brief",
        "type": "text",
        "purpose": "operational_instruction",
        "visibility": "organiser",
    }
    assert PUBLISH_CONTRACT_VERSION == "2026-07-30"


def test_public_field_requires_explicit_confirmation():
    with pytest.raises(ValueError, match="explicit public-visibility confirmation"):
        reviewed_publish_definition({
            "id": "public_brief",
            "name": "Public brief",
            "type": "text",
            "purpose": "operational_instruction",
            "visibility": "public",
            "classification_reviewed": True,
            "public_visibility_confirmed": False,
        })


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
async def test_public_classification_requires_confirmation_and_is_audited(db_session):
    public_field = {
        "id": "brief",
        "name": "Public brief",
        "type": "text",
        "category": "arbitrary",
        "purpose": "operational_instruction",
        "visibility": "public",
        "classification_reviewed": True,
    }
    with pytest.raises(HTTPException) as exc:
        await create_template(
            TaskTemplateCreate(
                machine_name="unconfirmed_public",
                name="Unconfirmed public",
                fields=[public_field],
            ),
            db=db_session,
        )
    assert exc.value.status_code == 422

    participant_field = {
        **public_field,
        "visibility": "participant",
        "classification_reviewed": True,
    }
    created = await create_template(
        TaskTemplateCreate(
            machine_name="audited_template",
            name="Audited template",
            fields=[participant_field],
        ),
        db=db_session,
    )
    await update_template(
        created.id,
        TaskTemplateUpdate(fields=[{
            **public_field,
            "public_visibility_confirmed": True,
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
    assert records[1].new_visibility == "public"
    assert records[0].operator_subject == records[1].operator_subject
    assert len(records[0].operator_subject) == 64
