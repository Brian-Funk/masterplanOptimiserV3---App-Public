# Security

## Local Desktop Boundary

The desktop app runs a local backend service and a local frontend server. Electron generates a per-launch desktop token and injects it into local backend requests. This prevents unrelated local processes from using the backend API without the current app session token.

The backend and frontend use separate HTTP loopback ports. Explicit overrides must remain on `127.0.0.1` or `localhost`, may not contain credentials or paths, and are passed consistently to the backend, renderer and Content Security Policy. The Electron shell keeps navigation and popup destinations allowlisted, denies permissions by default, and avoids loading untrusted remote content in the renderer.

Electron records only the backend and frontend child processes it starts. Shutdown targets those validated process identifiers and their children. The launcher never terminates unrelated `electron.exe` processes by image name.

## Sensitive Settings

Sensitive credentials and integration secrets should be encrypted at rest when stored in application settings or event records. This includes Google OAuth credentials, Google tokens, and MP-Backend publish secrets.

Exports must omit publish secrets and integration identifiers that are not needed for a portable planning backup. The workstation PDF output path is Electron-only state and is never part of project exports or backend diagnostics.

The workstation and storage boundary, including exact desktop storage categories and controller checks, is documented in [Workstation storage security](workstation-storage-security.md).

## OAuth

Google OAuth uses short-lived state and verifier data. Callback handling should require a matching state, and frontend callback messages should be accepted only from the expected local backend origin or a validated fallback channel.

OAuth logs must not include auth codes, full state values, tokens, or verifier keys.

## Publishing

The app supports independently selectable Google Calendar, MP-Backend, and local PDF publishing. A new install has no selected destinations; users must explicitly configure where publishing should go.

MP-Backend publishing uses per-event server settings and a publish secret. Those values are operational secrets and should not appear in exports, logs, or generated documentation.

The renderer supplies only bounded structured schedule data for PDF jobs. Electron validates the trusted IPC sender, event/date bounds, payload size, title, configured folder, and writability; it constructs the output path itself and uses exclusive file creation so a PDF cannot traverse outside the selected folder or overwrite an older file.

## CI And Releases

GitHub Actions should use least-privilege permissions. Release signing keys and repository tokens stay in Actions secrets. The external Testing repository token, if needed, should be read-only and used only in trusted contexts.

Every packaged build requires an Ed25519 manifest signing key which matches the tracked public key. The signed manifest covers every regular file under `app.asar`, `backend` and `frontend`. Startup fails closed when the manifest is missing, unsigned, malformed, signed by another key, modified, incomplete or accompanied by an unexpected protected resource.

The private manifest-signing key is release-only material. It must remain outside the repository and developer environment files, be injected only into the trusted package workflow, and be held in protected offline recovery custody. Compromise requires packaging to stop, the key pair to be rotated, affected artefacts to be invalidated, and the exposed release range to be documented.

The desktop database encryption key is a separate workstation key stored under Electron's per-user data directory. It is never reused for package signing, evidence, recovery archives or server secrets.

Desktop CI runs the shell contracts and a Windows real-Electron process ownership regression. Release builds also launch the unpacked package with isolated data and dynamic loopback ports, verify the signed runtime, wait for both local services and require a completion receipt before artefacts are uploaded.

## Documentation

Generated docs are built from public source code and docstrings. Do not include real OAuth secrets, publish secrets, private calendar IDs, production database contents, or personal data in docstrings or manual docs.
