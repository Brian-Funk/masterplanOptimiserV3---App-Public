# Contributing

## Code Ownership

The repository defines Brian-Funk as the default code owner for all files through `.github/CODEOWNERS`.

For code owner approval to be enforced, configure `main` branch protection in GitHub:

1. Require a pull request before merging.
2. Require approvals.
3. Enable `Require review from Code Owners`.
4. Require status checks to pass.
5. Require `desktop-ci-result`.
6. Disable direct pushes to `main` for normal development.

GitHub requires listed code owners to have write access to the repository. If the repository later moves to an organisation, replace or supplement the user owner with an organisation team.

## Development Flow

1. Create a feature branch.
2. Keep changes focused.
3. Run app-native tests for the touched subsystem.
4. Update manual docs when behaviour or workflows change.
5. Update docstrings or exported TypeScript comments when public APIs change.
6. Open a pull request into `main`.
7. Wait for CI and code owner review before merge.

## Tests

Use the desktop CI workflow as the minimum acceptance bar. Locally, run the focused command for the area you touched:

- Web: `npm --prefix web run build`
- Backend: `cd backend && venv/Scripts/python -m pytest`
- Compute: `cd compute && python -m pytest`
- Desktop: `npm --prefix desktop run verify:frontend`
- External Testing repo: `npm run test:desktop` and `python -m pytest desktop_backend -v`

## Documentation Updates

Manual docs live in `/docs`. Generated docs are rebuilt from source:

```bash
python -m pip install -r docs/requirements.txt
npm --prefix web ci
npm --prefix web run docs:typedoc
mkdocs build --strict
```

CI sets `DISABLE_MKDOCS_2_WARNING=true` before strict MkDocs builds. Set the same variable locally if the upstream MkDocs ecosystem warning appears.

The TypeScript docs use `web/src/docs-api.ts` as the curated public entrypoint. Add exports there only when they represent reusable app APIs, components, hooks, utilities, or types.

Python docs are generated from `backend/app` and `compute/src` during the MkDocs build.
