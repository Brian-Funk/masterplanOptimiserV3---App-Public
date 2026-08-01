"""
API v1 Router
"""
from fastapi import APIRouter
from app.api.v1 import (
    events, persons, tasks, assignments, theme,
    capabilities, task_templates, task_types, capability_types,
    locations, groups, flow_check, optimize,
    masterplan_layouts, task_instances, google,
    export_formats, data_management, app_settings, mp_backend, publish_state,
    general_schedule, operator_evidence,
)

api_router = APIRouter()

# Include all endpoint routers
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(persons.router, prefix="/persons", tags=["persons"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(assignments.router, prefix="/assignments", tags=["assignments"])
api_router.include_router(theme.router, prefix="/theme", tags=["theme"])
api_router.include_router(capabilities.router, prefix="/capabilities", tags=["capabilities"])
api_router.include_router(capability_types.router, prefix="/capability-types", tags=["capability-types"])
api_router.include_router(task_templates.router, prefix="/task-templates", tags=["task-templates"])
api_router.include_router(task_types.router, prefix="/task-types", tags=["task-types"])
api_router.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
api_router.include_router(flow_check.router, prefix="/flow", tags=["flow-validation"])
api_router.include_router(optimize.router, prefix="/optimize", tags=["optimisation"])
api_router.include_router(masterplan_layouts.router, prefix="/masterplan-layouts", tags=["masterplan-layouts"])
api_router.include_router(task_instances.router, prefix="/task-instances", tags=["task-instances"])
api_router.include_router(google.router, prefix="/google", tags=["google-calendar"])
api_router.include_router(export_formats.router, prefix="/export-formats", tags=["export-formats"])
api_router.include_router(data_management.router, prefix="/data", tags=["data-management"])
api_router.include_router(app_settings.router, prefix="/app-settings", tags=["app-settings"])
api_router.include_router(mp_backend.router, prefix="/mp-backend", tags=["mp-backend"])
api_router.include_router(publish_state.router, prefix="/publish-state", tags=["publish-state"])
api_router.include_router(general_schedule.router, prefix="/general-schedule", tags=["general-schedule"])
api_router.include_router(operator_evidence.router, prefix="/processor-evidence", tags=["processor-evidence"])
