"""
Database Configuration
Supports both SQLite (desktop) and PostgreSQL (web)
"""
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Create database engine
# SQLite for desktop, PostgreSQL for web
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {},
    echo=settings.ENVIRONMENT == "development"
)


if settings.DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_sqlite_secure_deletion(dbapi_connection, _connection_record):
        """Overwrite deleted SQLite payload bytes instead of leaving reusable page content."""

        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA secure_delete=ON")
        finally:
            cursor.close()

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()

def get_db():
    """
    Dependency for FastAPI routes to get database session
    Usage: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
