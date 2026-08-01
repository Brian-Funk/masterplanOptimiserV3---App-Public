from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


class ThemeBase(BaseModel):
    """Base schema for theme"""
    name: str = "Default Theme"
    primary_color_1: str = Field(default="#2563eb", pattern=r"^#[0-9A-Fa-f]{6}$")
    primary_color_2: Optional[str] = Field(default="#7c3aed", pattern=r"^#[0-9A-Fa-f]{6}$")
    primary_color_3: Optional[str] = Field(default="#0891b2", pattern=r"^#[0-9A-Fa-f]{6}$")
    success_color: str = Field(default="#10b981", pattern=r"^#[0-9A-Fa-f]{6}$")
    warning_color: str = Field(default="#f59e0b", pattern=r"^#[0-9A-Fa-f]{6}$")
    error_color: str = Field(default="#ef4444", pattern=r"^#[0-9A-Fa-f]{6}$")
    info_color: str = Field(default="#3b82f6", pattern=r"^#[0-9A-Fa-f]{6}$")
    dark_mode: Literal["light", "dark", "system"] = "light"


class ThemeCreate(ThemeBase):
    """Schema for creating a new theme"""
    pass


class ThemeUpdate(BaseModel):
    """Schema for updating theme - all fields optional"""
    name: Optional[str] = None
    primary_color_1: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    primary_color_2: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    primary_color_3: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    success_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    warning_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    error_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    info_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    dark_mode: Optional[Literal["light", "dark", "system"]] = None


class ThemeResponse(ThemeBase):
    """Schema for theme response"""
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
