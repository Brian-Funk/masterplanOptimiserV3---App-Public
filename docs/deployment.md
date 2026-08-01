# Deployment

## Continuous Integration

The App repository has desktop-focused CI for pull requests and pushes to `main`. The workflow detects desktop-relevant changes, runs app-native validation, and runs the external desktop test suite from the Testing repository in trusted contexts.

The required branch protection check should be `desktop-ci-result`.

## Desktop Packaging

Desktop release builds are triggered by version tags or manual workflow dispatch. The build workflow:

1. installs backend and compute dependencies;
2. packages the backend with PyInstaller;
3. builds the Next.js frontend;
4. verifies the standalone frontend bundle;
5. installs desktop dependencies;
6. packages Windows, macOS, and Linux artefacts with electron-builder;
7. creates a checksum manifest for the three exact platform artefacts;
8. signs that manifest with keyless Sigstore identity bound to the tagged GitHub
   Actions workflow; and
9. creates and anonymously re-verifies the public GitHub Release.

The packaged frontend is copied explicitly during the Electron after-pack step so Linux, Windows, and macOS builds all include the standalone Next server and required `node_modules`.

## Release Authenticity

The packaged application verifies its embedded Ed25519-signed resource manifest
before starting local services. Before installing a downloaded package, verify
the separate release checksum manifest and then the package checksum. Replace
`vMAJOR.MINOR.PATCH` with the exact release tag:

```bash
TAG=vMAJOR.MINOR.PATCH
BASE="https://github.com/Brian-Funk/masterplanOptimiserV3---App/releases/download/${TAG}"
PACKAGE="Masterplan-Optimiser-MAJOR.MINOR.PATCH.exe" # choose the package you need
curl -fLO "${BASE}/${PACKAGE}"
curl -fLO "${BASE}/checksums.txt"
curl -fLO "${BASE}/checksums.txt.bundle"
cosign verify-blob --bundle checksums.txt.bundle \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity \
  "https://github.com/Brian-Funk/masterplanOptimiserV3---App/.github/workflows/build.yml@refs/tags/${TAG}" \
  checksums.txt
awk -v package="${PACKAGE}" '$2 == package' checksums.txt | sha256sum -c -
```

The Sigstore bundle establishes the publishing workflow and tag identity. The
signed checksum manifest binds the Windows installer, macOS disk image, and
Linux AppImage byte-for-byte. This is the supported pre-install authenticity
mechanism while platform-specific publisher certificates are unavailable.

## Desktop Update Data Preservation

Desktop updates are safe when the new app version uses the same database schema as the previous version. The installer replaces application files, while persistent data stays in Electron's per-user data directory.

Persistent desktop data includes:

- the local SQLite database;
- the database encryption key;
- application settings such as Google OAuth, solver settings, shortcuts, and publish targets;
- event and project data stored inside the database;
- user-customised desktop assets such as the app icon.

The desktop shell passes the backend an absolute `DATABASE_URL` and `ENCRYPTION_KEY_PATH` under `app.getPath("userData")`. Startup reuses existing files and never deletes or overwrites the user-data directory. A fresh install creates the database and encryption key there when the backend first needs them.

Manual update verification:

1. Install version A.
2. Create or import an event.
3. Change application settings.
4. Install version B over version A without deleting app data.
5. Start version B.
6. Confirm the event and settings are still present.
7. Confirm the startup logs show the same active desktop data directory.

Do not claim update safety across database schema changes yet. A future release that changes the database schema must include a separate migration and backup mechanism.

## Documentation Publishing

The docs workflow builds the MkDocs site from source on every relevant pull request and publishes it on pushes to `main` or manual dispatch.

The workflow:

1. installs Python docs dependencies from `docs/requirements.txt`;
2. installs frontend dependencies;
3. runs TypeDoc to generate TypeScript Markdown under `docs/generated/typescript`;
4. runs `mkdocs build --strict` with `DISABLE_MKDOCS_2_WARNING=true`;
5. uploads the `site` directory as a GitHub Pages artefact;
6. deploys with GitHub Pages actions when the event is not a pull request.

Generated documentation is not committed. The published site is rebuilt from source each time.

## GitHub Pages Setup

In repository settings, set Pages source to GitHub Actions. The docs workflow deploys to the `github-pages` environment using the repository `GITHUB_TOKEN`.

## Release Checklist

- Desktop CI is green on the merge request.
- External desktop tests are green.
- Web production audit passes.
- Desktop audit passes.
- Documentation build passes.
- The repository is public and the exact tagged commit is the green `main` head.
- Release tag follows the existing `v*` convention.
- GitHub Release contains all three installer artefacts, `checksums.txt`, and
  its verifiable `checksums.txt.bundle`.
- Anonymous downloads, Sigstore identity verification, and all three checksums
  pass before the release workflow completes.
