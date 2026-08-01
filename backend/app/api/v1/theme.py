from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.db.database import get_db
from app.schemas.theme import ThemeCreate, ThemeUpdate, ThemeResponse
from app.models.theme import Theme

router = APIRouter()


@router.get("/active", response_model=ThemeResponse)
def get_active_theme(db: Session = Depends(get_db)):
    """
    Get the currently active theme.
    Public endpoint - no authentication required.
    """
    theme = db.query(Theme).filter(Theme.is_active == True).first()
    
    if not theme:
        # Create and return default theme if none exists
        default_theme = Theme(
            name="Default Theme",
            is_active=True,
            primary_color_1="#2563eb",
            primary_color_2="#7c3aed",
            primary_color_3="#0891b2",
            success_color="#10b981",
            warning_color="#f59e0b",
            error_color="#ef4444",
            info_color="#3b82f6",
            dark_mode="light",
        )
        db.add(default_theme)
        db.commit()
        db.refresh(default_theme)
        return default_theme
    
    return theme


@router.get("/", response_model=List[ThemeResponse])
def get_all_themes(
    db: Session = Depends(get_db),
):
    """
    Get all themes.
    """
    themes = db.query(Theme).all()
    return themes


@router.post("/", response_model=ThemeResponse, status_code=status.HTTP_201_CREATED)
def create_theme(
    theme_data: ThemeCreate,
    db: Session = Depends(get_db),
):
    """
    Create a new theme.
    """
    theme = Theme(**theme_data.model_dump())
    db.add(theme)
    db.commit()
    db.refresh(theme)
    
    return theme


@router.put("/{theme_id}", response_model=ThemeResponse)
def update_theme(
    theme_id: int,
    theme_data: ThemeUpdate,
    db: Session = Depends(get_db),
):
    """
    Update an existing theme.
    """
    theme = db.query(Theme).filter(Theme.id == theme_id).first()
    if not theme:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Theme not found"
        )
    
    # Update only provided fields
    update_data = theme_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(theme, field, value)
    
    db.commit()
    db.refresh(theme)
    
    return theme


@router.put("/{theme_id}/activate", response_model=ThemeResponse)
def activate_theme(
    theme_id: int,
    db: Session = Depends(get_db),
):
    """
    Activate a theme (deactivates all others).
    """
    theme = db.query(Theme).filter(Theme.id == theme_id).first()
    if not theme:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Theme not found"
        )
    
    # Deactivate all themes
    db.query(Theme).update({Theme.is_active: False})
    
    # Activate the selected theme
    theme.is_active = True
    db.commit()
    db.refresh(theme)
    
    return theme


@router.delete("/{theme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_theme(
    theme_id: int,
    db: Session = Depends(get_db),
):
    """
    Delete a theme.
    Cannot delete active theme.
    """
    theme = db.query(Theme).filter(Theme.id == theme_id).first()
    if not theme:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Theme not found"
        )
    
    if theme.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete active theme"
        )
    
    theme_name = theme.name  # Store name before deletion
    
    db.delete(theme)
    db.commit()
    
    return None
