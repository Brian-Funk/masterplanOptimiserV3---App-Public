# Masterplan Optimiser App

Masterplan Optimiser is a desktop planning application for live events. It helps organisers build a multi-day masterplan, manage people and capabilities, run constraint-based optimisation, review the result visually, and publish the final schedule to connected systems.

This documentation covers the desktop App repository only. It includes manual pages for setup, architecture, workflows, deployment, security, and contribution practice, plus generated API reference pages for the Python backend/compute code and the curated React/TypeScript frontend API.

## Choose Your Responsibility

| Audience | Start here | Boundary |
| --- | --- | --- |
| General audience | [Architecture](architecture.md) | Understand the local-planning and deliberate-publication boundary |
| Desktop users | [Workflows](workflows.md) | Create, optimise, review and publish operational schedules |
| Event admins | [Privacy and deletion](privacy-deletion.md) | Coordinate event-scoped publishing and Desktop deletion work |
| Root and controller | [Workstation storage security](workstation-storage-security.md) | Protect local custody, exports and processor-key material |
| Technical reviewers | [Security](security.md) and [API reference](generated/python/index.md) | Inspect implementation and trust boundaries |

The Public Schedule is deliberately public. The Masterplan is always limited to
authenticated people assigned to the event. These audiences are fixed by the
publication surface rather than selected independently for each field.

## What This App Contains

- Electron desktop shell for startup, packaging, local service orchestration, and desktop hardening.
- Local FastAPI backend for event data, scheduling data, settings, Google Calendar integration, MP-Backend publishing, PDF-title metadata, and optimisation jobs.
- Python compute modules for flow checking and OR-Tools based optimisation.
- Next.js React frontend for the project hub, settings, schedule input, optimisation review, metrics, presentation mode, and Google Calendar, MP-Backend, or local PDF publishing flows.

## Documentation Layout

- [Setup](setup.md): local development prerequisites and commands.
- [Architecture](architecture.md): subsystem boundaries and data flow.
- [Workflows](workflows.md): user and developer workflows for planning and publishing.
- [Deployment](deployment.md): CI, packaging, release, and GitHub Pages documentation publishing.
- [Security](security.md): local app, data, OAuth, publishing, and CI security notes.
- [Contributing](contributing.md): branch protection, CODEOWNERS, tests, and documentation updates.
- [API Reference](generated/python/index.md): generated backend, compute, and TypeScript reference.

## Evidence Tools

- The [processor-key generator](https://brian-funk.github.io/masterplanOptimiserV3---Evidence-Public/processor-key/)
  creates a Desktop-compatible encrypted private import and public package
  without uploading private material.
- The [complete-chain verifier](https://brian-funk.github.io/masterplanOptimiserV3---Evidence-Public/verify-evidence/)
  checks portable evidence ZIPs independently.

A signature proves an exact signed statement and chain integrity. It does not
prove physical deletion from undeclared copies or systems outside the signing
processor's or deployment's control.
