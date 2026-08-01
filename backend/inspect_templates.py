"""
Script to inspect task templates in the database
"""
import sys
import sqlite3
import json
from pathlib import Path

# Path to the database
DB_PATH = Path(__file__).parent / "data" / "masterplan.db"

def inspect_templates():
    """Display all task templates and their fields"""
    if not DB_PATH.exists():
        print(f"Database not found at: {DB_PATH}")
        return
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Access columns by name
    cursor = conn.cursor()
    
    # Get all templates
    cursor.execute("""
        SELECT id, machine_name, name, description, task_type_id, 
               is_floating, is_transfer, fields
        FROM task_templates
        ORDER BY id
    """)
    
    templates = cursor.fetchall()
    
    if not templates:
        print("No templates found in database.")
        return
    
    print(f"\n{'='*80}")
    print(f"Found {len(templates)} template(s) in database")
    print(f"{'='*80}\n")
    
    for template in templates:
        print(f"ID: {template['id']}")
        print(f"Machine Name: {template['machine_name']}")
        print(f"Name: {template['name']}")
        print(f"Description: {template['description']}")
        print(f"Task Type ID: {template['task_type_id']}")
        print(f"Is Floating: {template['is_floating']}")
        print(f"Is Transfer: {template['is_transfer']}")
        print(f"\nFields:")
        
        # Parse and display fields
        fields_json = template['fields']
        if fields_json:
            try:
                fields = json.loads(fields_json)
                if fields:
                    for idx, field in enumerate(fields, 1):
                        print(f"  {idx}. Name: {field.get('name', 'N/A')}")
                        print(f"     Type: {field.get('type', 'N/A')}")
                        print(f"     Category: {field.get('category', 'N/A')}")
                        print(f"     Locked: {field.get('locked', False)}")
                        print(f"     ID: {field.get('id', 'N/A')}")
                        if field.get('config'):
                            print(f"     Config: {field.get('config')}")
                        print()
                else:
                    print("  (no fields)")
            except json.JSONDecodeError as e:
                print(f"  ERROR parsing fields JSON: {e}")
                print(f"  Raw JSON: {fields_json}")
        else:
            print("  (null fields)")
        
        print(f"{'-'*80}\n")
    
    conn.close()

if __name__ == "__main__":
    inspect_templates()
