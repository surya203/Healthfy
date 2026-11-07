from alembic.runtime.migration import MigrationContext
from sqlalchemy import inspect

from app.database import get_engine


def test_migration_creates_auth_tables() -> None:
    engine = get_engine()
    inspected = inspect(engine)
    assert set(inspected.get_table_names()) >= {"users", "sessions", "login_failures"}
    assert {column["name"] for column in inspected.get_columns("users")} == {
        "id",
        "name",
        "email",
        "password_hash",
        "created_at",
    }
    assert {column["name"] for column in inspected.get_columns("sessions")} == {
        "id",
        "user_id",
        "token_hash",
        "created_at",
        "expires_at",
        "revoked_at",
    }
    assert {column["name"] for column in inspected.get_columns("login_failures")} == {
        "id",
        "client_ip",
        "attempted_at",
    }
    user_uniques = {item["name"] for item in inspected.get_unique_constraints("users")}
    session_uniques = {item["name"] for item in inspected.get_unique_constraints("sessions")}
    assert "uq_users_email" in user_uniques
    assert "uq_sessions_token_hash" in session_uniques
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        assert context.get_current_revision() == "20261107_0001"
