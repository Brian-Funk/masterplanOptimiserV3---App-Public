"""
Group Models
"""
from sqlalchemy import Column, Integer, String, ForeignKey, Text, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.db.database import Base

class GroupType(Base):
    """Root-Admin configurable group categories"""
    __tablename__ = "group_types"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    color_hex = Column(String(7))
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class LeadershipLevel(Base):
    """Root-Admin configurable leadership tiers"""
    __tablename__ = "leadership_levels"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    color_hex = Column(String(7))
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class GroupRole(Base):
    """Root-Admin configurable roles within group types"""
    __tablename__ = "group_roles"
    
    id = Column(Integer, primary_key=True, index=True)
    group_type_id = Column(Integer, ForeignKey("group_types.id"), nullable=False)
    leadership_level_id = Column(Integer, ForeignKey("leadership_levels.id"), nullable=False)
    code = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text)
    color_hex = Column(String(7))
    is_active = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class Group(Base):
    """Concrete groups within events"""
    __tablename__ = "groups"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    group_type_id = Column(Integer, ForeignKey("group_types.id"), nullable=True)  # Optional group type
    name = Column(String, nullable=False)
    meta_data = Column(JSON, default=dict)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class GroupMembership(Base):
    """Links persons to groups with roles"""
    __tablename__ = "group_memberships"
    
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    person_id = Column(Integer, ForeignKey("persons.id"), nullable=False)
    group_role_id = Column(Integer, ForeignKey("group_roles.id"), nullable=False)
    membership_data = Column(JSON, default=dict)  # Delegation, country, etc.
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
