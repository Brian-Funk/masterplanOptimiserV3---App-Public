"""
Assignments API Endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import Optional
from app.db.database import get_db
from app.models.assignment import Assignment

router = APIRouter()

@router.get("/")
async def get_assignments(
    event_id: int = Query(..., description="Event ID - required"),
    db: Session = Depends(get_db),
):
    """Get assignments for an event."""
    assignments = db.query(Assignment).filter(Assignment.event_id == event_id).all()
    
    return assignments

# TODO: Add endpoints for optimiser integration
