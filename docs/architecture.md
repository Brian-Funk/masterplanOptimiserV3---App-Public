# Architecture

## System Shape

The desktop app is a local-first application. Electron owns process startup and packaging, the FastAPI backend owns persistent data and integrations, the compute package owns optimisation logic, and the Next.js frontend owns the user interface.

```text
Electron shell
  starts and supervises
    FastAPI backend
    Next.js frontend

React UI
  calls local FastAPI API
  opens metrics and presentation windows

FastAPI backend
  reads/writes local SQLite data
  invokes compute modules
  publishes to Google Calendar or MP-Backend when configured

Electron shell
  stores the workstation-only PDF folder
  renders structured schedule data to a local PDF
```

## Desktop Shell

The Electron shell is responsible for:

- starting the backend and frontend services;
- detecting occupied ports and startup failures;
- applying renderer hardening such as navigation allowlists and permission denial by default;
- injecting the per-session desktop token into local backend requests;
- validating structured PDF jobs, constructing safe collision-free filenames, and rendering local A4 landscape files;
- packaging resources into the released desktop application.

## Backend

The backend is a local FastAPI service under `backend/app`. It exposes APIs for events, locations, people, groups, task templates, task instances, optimisation, finalisation, data import/export, settings, Google Calendar, MP-Backend publishing, and the event-specific PDF title. PDF files themselves never pass through the backend.

Persistent state is stored in the app database. Sensitive values such as OAuth tokens and publish secrets are encrypted where the model marks them as encrypted fields.

## Compute

The compute package under `compute/src` contains the optimisation and flow checking logic. The backend normalises event/task/person data into compute-friendly structures, runs the relevant solver or checker, and writes results back to task instances.

## Frontend

The frontend is a Next.js React app under `web/src`. The main user areas are:

- project hub;
- settings and configuration;
- task builder and CMI calendar input;
- optimisation execution and review;
- final masterplan view;
- metrics board;
- presentation mode.

Shared contexts hold selected event state, task instance state, optimisation progress, theme, toast notifications, and shortcut settings.

## Data Flow

1. The user configures an event, people, capabilities, locations, task types, and task templates.
2. The user creates task instances in the task builder or CMI calendar input.
3. The frontend calls the backend to persist task data.
4. The backend normalises the current event data and invokes compute.
5. Optimised results are stored on task instances.
6. The frontend lets the user inspect, edit, finalise, publish, or present the result.

## Generated Documentation

Python API documentation is generated through mkdocstrings from `backend/app` and `compute/src`. TypeScript API documentation is generated through TypeDoc from a curated frontend entrypoint so route pages and internal page glue do not dominate the reference.
