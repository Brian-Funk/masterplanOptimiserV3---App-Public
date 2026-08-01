"""
Script to reset all users - deletes all users and creates a single root-admin
Username: root-admin
Password: root-admin
"""
import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.orm import Session
from app.db.database import engine, SessionLocal, Base
from app.models.user import User, EventRole, UserEventRole
from app.models.person import Person
from app.core.security import get_password_hash

def reset_users():
    """Delete all users and create a single root-admin"""
    db: Session = SessionLocal()
    
    try:
        # Delete all user event roles first (foreign key constraint)
        deleted_roles = db.query(UserEventRole).delete()
        print(f"Deleted {deleted_roles} user event role assignments")
        
        # Delete all users
        deleted_users = db.query(User).delete()
        print(f"Deleted {deleted_users} users")
        
        # Delete all persons
        deleted_persons = db.query(Person).delete()
        print(f"Deleted {deleted_persons} persons")
        
        db.commit()
        
        print(f"\nCreating new root-admin user...")
        
        # Create person record
        person = Person(
            first_name="Root",
            last_name="Admin",
            email="root-admin@localhost"
        )
        db.add(person)
        db.flush()
        
        # Create user record
        user = User(
            person_id=person.id,
            email="root-admin",
            password_hash=get_password_hash("root-admin"),
            is_root_admin=True,
            is_active=True
        )
        db.add(user)
        db.commit()
        
        print(f"Created root-admin user")
        print(f"\nReset complete!")
        print(f"\nYou can now log in with:")
        print(f"   Username: root-admin")
        print(f"   Password: root-admin")
        
    except Exception as e:
        db.rollback()
        print(f"ERROR: Error resetting users: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    print("WARNING: This will DELETE ALL USERS!")
    print("=" * 50)
    response = input("Are you sure you want to continue? (yes/no): ")
    
    if response.lower() in ['yes', 'y']:
        print("\nResetting users...\n")
        reset_users()
    else:
        print("Operation cancelled")
