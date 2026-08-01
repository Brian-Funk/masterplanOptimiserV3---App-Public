"""
Application Configuration
Desktop-only simplified configuration for Google Calendar integration.
"""
from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    """Application settings"""
    
    # Database - Local SQLite only (desktop app)
    DATABASE_URL: str = "sqlite:///./data/masterplan.db"
    
    # API
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000
    
    # Environment
    ENVIRONMENT: str = "desktop"  # desktop or development
    
    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    
    # Optimiser
    OPTIMIZER_URL: str = "http://127.0.0.1:8000/compute"
    DEBUG_OPTIMIZER_LOGS: bool = False
    
    # Google Calendar OAuth2
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    
    class Config:
        env_file = ".env"
        case_sensitive = True

# Global settings instance
settings = Settings()

# Ensure data directory exists for SQLite
if settings.DATABASE_URL.startswith("sqlite"):
    data_dir = os.path.dirname(settings.DATABASE_URL.replace("sqlite:///", ""))
    if data_dir and not os.path.exists(data_dir):
        os.makedirs(data_dir)
