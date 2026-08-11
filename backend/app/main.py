"""
Main FastAPI Application
Desktop-only backend API for Google Calendar integrated masterplan optimisation.
"""
import os

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.api.v1 import api_router
from app.compute_app import compute_app
from app.db.database import engine, Base, SessionLocal
from sqlalchemy import inspect, text

# Per-session auth token injected by Electron at startup
_DESKTOP_AUTH_TOKEN = os.getenv("DESKTOP_AUTH_TOKEN")

# Create FastAPI app
app = FastAPI(
    title="Masterplan Optimiser API",
    description="Backend API for EYP Masterplan Optimisation (Google Calendar)",
    version="2.0.0"
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return a sanitized validation error response for malformed requests."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Validation error"},
    )

# ── Localhost auth token check ──────────────────────────────
# Paths exempt from the desktop auth token check. OAuth code exchange is a
# POST from the app and must still carry the desktop token.
_AUTH_EXEMPT_PATHS = {"/health", "/"}


def _is_auth_exempt(request: Request) -> bool:
    if request.method == "OPTIONS":
        return True
    if request.url.path in _AUTH_EXEMPT_PATHS:
        return True
    return request.method == "GET" and request.url.path == "/api/v1/google/oauth2callback"


@app.middleware("http")
async def check_desktop_token(request: Request, call_next):
    """Require Electron's per-launch desktop token for non-exempt routes."""
    if _DESKTOP_AUTH_TOKEN and not _is_auth_exempt(request):
        token = request.headers.get("x-desktop-token")
        if token != _DESKTOP_AUTH_TOKEN:
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)

# ── Request body size limit (5 MB, /compute paths exempt) ──
MAX_BODY_BYTES = 5 * 1024 * 1024

@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    """Reject oversized local API requests before they reach route handlers."""
    if not request.url.path.startswith("/compute"):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Desktop-Token"],
    expose_headers=["Content-Length"],
)

# Include API routes
app.include_router(api_router, prefix="/api/v1")

# Mount compute sub-app (previously a separate process on port 8765)
app.mount("/compute", compute_app)


# Health check
@app.get("/health", tags=["health"])
async def health_check():
    """Liveness / readiness probe."""
    db_ok = False
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        db_ok = True
    except Exception:
        pass
    return {"status": "ok" if db_ok else "degraded", "version": app.version, "db": db_ok}

@app.on_event("startup")
async def startup_event():
    """Initialise a current-schema database without compatibility migrations."""
    # Import all models to ensure they're registered with SQLAlchemy
    from app.models import (
        Person, Event, Task, Assignment,
        Location, Group, Capability, Theme, OptimizationJob,
        MasterplanLayout, GoogleCalendarConnection,
        AppSettings, EventPublishState,
        AudienceTeam, SessionElement, GeneralSchedulePublishState,
        ProcessorEvidenceKey,
    )
    
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "persons" in tables:
        person_columns = {column["name"] for column in inspector.get_columns("persons")}
        event_columns = {column["name"] for column in inspector.get_columns("events")}
        if (
            "evidence_subject_id" not in person_columns
            or "global_data" in person_columns
            or "evidence_id" not in event_columns
        ):
            raise RuntimeError(
                "This database uses the retired desktop schema. Run the one-off "
                "convert_current_desktop_v2.py tool against a copy, then start the "
                "application with its converted output."
            )

        from app.core.data_sanitation import erase_retired_person_phone_values

        erased_phone_values = erase_retired_person_phone_values(engine, person_columns)
        if erased_phone_values:
            print(
                "[Startup] Erased "
                f"{erased_phone_values} retired person phone value(s)"
            )

    # Create tables only for a new or already-current database.
    Base.metadata.create_all(bind=engine)
    
    # Clear any stuck optimisation jobs from previous sessions
    db = SessionLocal()
    try:
        from sqlalchemy import or_
        from datetime import datetime

        stuck_jobs = db.query(OptimizationJob).filter(
            or_(
                OptimizationJob.status == "running",
                OptimizationJob.status == "pending"
            )
        ).all()
        
        if stuck_jobs:
            print(f"[Startup] Found {len(stuck_jobs)} stuck optimisation job(s) from previous session")
            for job in stuck_jobs:
                job.status = "failed"
                job.error_message = "Job was interrupted by application restart"
                job.completed_at = datetime.utcnow()
            db.commit()
            print(f"[Startup] Cleared all stuck optimisation jobs")
            
    except Exception as e:
        print(f"Error during startup: {e}")
    finally:
        db.close()


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "Masterplan Optimiser API",
        "version": "2.0.0",
        "environment": settings.ENVIRONMENT,
        "mode": "Desktop"
    }


def _run_packaged_import_smoke_test():
    """Import native-backed modules that must work in packaged builds."""
    import importlib

    module_names = (
        "ssl",
        "sqlite3",
        "cryptography.fernet",
        "cryptography.hazmat.primitives.asymmetric.ed25519",
        "keyring",
        "pydantic_core",
        "ortools.sat.python.cp_model",
        "flow_checker",
        "fatigue_optimizer",
    )
    for module_name in module_names:
        importlib.import_module(module_name)

    import keyring

    keyring.get_keyring()
    print("[Smoke] Packaged backend native imports succeeded")


if __name__ == "__main__":
    import uvicorn
    import sys
    import os
    
    # Add backend directory to Python path
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    if os.getenv("MASTERPLAN_BACKEND_IMPORT_SMOKE") == "1":
        _run_packaged_import_smoke_test()
        sys.exit(0)
    
    # Pass app object directly (not string) so PyInstaller frozen imports work
    uvicorn.run(
        app,
        host=settings.API_HOST,
        port=settings.API_PORT,
    )
