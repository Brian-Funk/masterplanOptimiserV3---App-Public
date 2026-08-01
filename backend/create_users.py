"""
Script to create default users for testing/development
Creates users with username = password:
- root-admin / root-admin
- admin / admin
- organiser / organiser
- viewer / viewer
"""
import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.orm import Session
from app.db.database import engine, SessionLocal, Base
from app.models.user import User, EventRole
from app.models.person import Person
from app.core.security import get_password_hash

def create_default_users():
    """Create default users for testing"""
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    
    try:
        users_to_create = [
            {
                "username": "root-admin",
                "password": "root-admin",
                "email": "root-admin@example.com",
                "first_name": "Root",
                "last_name": "Admin",
                "is_root_admin": True
            },
            {
                "username": "admin",
                "password": "admin",
                "email": "admin@example.com",
                "first_name": "Admin",
                "last_name": "User",
                "is_root_admin": False
            },
            {
                "username": "organiser",
                "password": "organiser",
                "email": "organiser@example.com",
                "first_name": "Organiser",
                "last_name": "User",
                "is_root_admin": False
            },
            {
                "username": "viewer",
                "password": "viewer",
                "email": "viewer@example.com",
                "first_name": "Viewer",
                "last_name": "User",
                "is_root_admin": False
            }
        ]
        
        created_count = 0
        skipped_count = 0
        
        for user_data in users_to_create:
            # Check if user already exists
            existing_user = db.query(User).filter(User.email == user_data["email"]).first()
            
            if existing_user:
                print(f"WARNING: User '{user_data['username']}' already exists, skipping...")
                skipped_count += 1
                continue
            
            # Create person record
            person = Person(
                first_name=user_data["first_name"],
                last_name=user_data["last_name"],
                email=user_data["email"]
            )
            db.add(person)
            db.flush()  # Get the person.id
            
            # Create user record
            user = User(
                person_id=person.id,
                email=user_data["email"],
                password_hash=get_password_hash(user_data["password"]),
                is_root_admin=user_data["is_root_admin"],
                is_active=True
            )
            db.add(user)
            
            print(f"Created user '{user_data['username']}' (password: {user_data['password']})")
            created_count += 1
        
        db.commit()
        
        print(f"\nSummary:")
        print(f"   Created: {created_count}")
        print(f"   Skipped: {skipped_count}")
        print(f"   Total: {created_count + skipped_count}")
        
        if created_count > 0:
            print(f"\nUsers created successfully!")
            print(f"\nYou can now log in with:")
            for user_data in users_to_create:
                print(f"   - {user_data['username']} / {user_data['password']}")
        
    except Exception as e:
        db.rollback()
        print(f"ERROR: Error creating users: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    print("Creating default users...\n")
    create_default_users()
