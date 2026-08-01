# Setup

## Prerequisites

Use the same major versions as CI:

- Node.js 22
- Python 3.11
- npm
- Git
- A platform that can run Electron for local desktop testing

The app is split into `web`, `backend`, `compute`, and `desktop`. Install dependencies in each area instead of treating the repository as a single package.

## Frontend

```bash
npm --prefix web ci
npm --prefix web run build
```

The frontend is a Next.js application. In development it usually runs on `http://localhost:3000`; in the packaged desktop app it is bundled as a standalone Next server under Electron resources.

## Backend

```bash
cd backend
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt
venv/Scripts/python -m compileall app
venv/Scripts/python -m pytest
```

On macOS or Linux, replace `venv/Scripts/python` with `venv/bin/python`.

The backend is a local FastAPI service. Electron injects a per-launch desktop token into requests when the app is running as a desktop application.

## Compute

```bash
cd compute
python -m pip install -r requirements-dev.txt
PYTHONPATH=src python -m pytest
```

The compute package contains the flow checker and optimisation code used by the backend.

## Desktop Shell

```bash
npm --prefix desktop ci
npm --prefix desktop run verify:frontend
npm --prefix desktop start
```

The desktop shell starts the local backend and frontend services, opens the Electron window, injects the local auth token, and applies desktop security policy.

## Documentation

```bash
python -m pip install -r docs/requirements.txt
npm --prefix web ci
npm --prefix web run docs:typedoc
mkdocs build --strict
```

CI sets `DISABLE_MKDOCS_2_WARNING=true` for strict builds so an upstream MkDocs ecosystem warning does not fail the project docs. For local PowerShell runs, set `$env:DISABLE_MKDOCS_2_WARNING="true"` before `mkdocs build --strict`.

For live preview:

```bash
mkdocs serve
```

Run `npm --prefix web run docs:typedoc` before `mkdocs build` so the TypeScript reference exists under `docs/generated/typescript`.
