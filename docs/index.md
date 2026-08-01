# Masterplan Optimiser App

Masterplan Optimiser is a desktop planning application for live events. It helps organisers build a multi-day masterplan, manage people and capabilities, run constraint-based optimisation, review the result visually, and publish the final schedule to connected systems.

This documentation covers the desktop App repository only. It includes manual pages for setup, architecture, workflows, deployment, security, and contribution practice, plus generated API reference pages for the Python backend/compute code and the curated React/TypeScript frontend API.

## What This App Contains

- Electron desktop shell for startup, packaging, local service orchestration, and desktop hardening.
- Local FastAPI backend for event data, scheduling data, settings, Google Calendar integration, MP-Backend publishing, and optimisation jobs.
- Python compute modules for flow checking and OR-Tools based optimisation.
- Next.js React frontend for the project hub, settings, schedule input, optimisation review, metrics, presentation mode, and publishing flows.

## Documentation Layout

- [Setup](setup.md): local development prerequisites and commands.
- [Architecture](architecture.md): subsystem boundaries and data flow.
- [Workflows](workflows.md): user and developer workflows for planning and publishing.
- [Deployment](deployment.md): CI, packaging, release, and GitHub Pages documentation publishing.
- [Security](security.md): local app, data, OAuth, publishing, and CI security notes.
- [Contributing](contributing.md): branch protection, CODEOWNERS, tests, and documentation updates.
- [API Reference](generated/python/index.md): generated backend, compute, and TypeScript reference.
