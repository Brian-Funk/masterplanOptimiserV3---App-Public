"""Generate lightweight Python API reference pages for MkDocs."""

import mkdocs_gen_files


PAGES = {
    "generated/python/index.md": """# Python API Reference

This section is generated during the MkDocs build from the desktop app Python
source. The backend reference covers the packaged FastAPI service; the compute
reference covers the optimiser and flow-checking modules.
""",
    "generated/python/backend.md": """# Backend API

## Application

::: app.main

## App Settings

::: app.api.v1.app_settings

## Data Management

::: app.api.v1.data_management

## Events

::: app.api.v1.events

## Google Publishing

::: app.api.v1.google

## Encryption

::: app.core.encryption

## Google Calendar Service

::: app.core.google_calendar_service

## Optimisation Runner

::: app.core.optimization_runner
""",
    "generated/python/compute.md": """# Compute API

## Optimiser

::: optimizer

## Fatigue Optimiser

::: fatigue_optimizer

## Flow Checker

::: flow_checker

## Compute Entrypoint

::: main
""",
}


for path, content in PAGES.items():
    with mkdocs_gen_files.open(path, "w") as file:
        file.write(content)
