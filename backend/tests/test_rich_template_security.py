import pytest
from pydantic import ValidationError

from app.api.v1.data_management import validate_import_payload
from app.api.v1.export_formats import ExportFormatCreate
from app.api.v1.general_schedule import (
    DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE,
    SessionElementTypeCreate,
)
from app.core.rich_template import validate_rich_template


@pytest.mark.parametrize(
    "payload",
    [
        '<img src=x onerror="alert(1)">',
        '<svg onload="alert(1)"></svg>',
        '<a href="javascript:alert(1)">open</a>',
        '<b onclick="alert(1)">bold</b>',
        '<script>alert(1)</script>',
    ],
)
def test_rich_template_validator_rejects_executable_markup(payload):
    with pytest.raises(ValueError):
        validate_rich_template(payload)


def test_rich_template_validator_preserves_supported_formatting():
    value = (
        '<b>{title}</b><br><i>{description}</i> '
        '<a href="https://example.invalid/details">Details</a>'
    )
    assert validate_rich_template(value) == value
    assert validate_rich_template(DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE) == DEFAULT_SESSION_ELEMENT_COPY_TEMPLATE


def test_api_models_reject_unsafe_templates():
    with pytest.raises(ValidationError):
        ExportFormatCreate(
            task_type_id=1,
            description_template='<img src=x onerror="alert(1)">',
        )
    with pytest.raises(ValidationError):
        SessionElementTypeCreate(
            name="Session",
            copy_template_html='<a href="javascript:alert(1)">open</a>',
        )


def test_import_preview_blocks_unsafe_global_and_event_templates():
    result = validate_import_payload({
        "type": "project",
        "version": 2,
        "global_data": {
            "calendar_export_formats": [{
                "id": 1,
                "task_type_id": 1,
                "description_template": '<img src=x onerror="alert(1)">',
            }],
        },
        "events": [{
            "event": {
                "id": 1,
                "name": "Security test",
                "start_date": "2030-01-01",
                "end_date": "2030-01-02",
            },
            "session_element_types": [{
                "id": 1,
                "name": "Session",
                "copy_template_html": '<a href="javascript:alert(1)">open</a>',
            }],
        }],
    })

    unsafe_paths = {issue.path for issue in result.errors if issue.title == "Unsafe rich-text template"}
    assert unsafe_paths == {
        "global_data.calendar_export_formats[0].description_template",
        "events[0].session_element_types[0].copy_template_html",
    }
