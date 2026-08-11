"""One-way data-minimisation sanitation for retired current-schema fields."""

from collections.abc import Collection

from sqlalchemy import Engine, text


def erase_retired_person_phone_values(
    db_engine: Engine,
    person_columns: Collection[str],
) -> int:
    """Erase historical phone values without reading or logging their contents."""

    if "phone" not in person_columns:
        return 0

    with db_engine.begin() as connection:
        count = int(
            connection.execute(
                text("SELECT COUNT(*) FROM persons WHERE phone IS NOT NULL")
            ).scalar_one()
        )
        if count:
            connection.execute(
                text("UPDATE persons SET phone = NULL WHERE phone IS NOT NULL")
            )
    return count
