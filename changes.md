# Changes

## Unreleased

### Fixed

- Keep Desktop processor identities scoped to their exact Server event when a
  reusable local event is linked to a different Server event. Historical keys
  remain available for verification but no longer appear ready for the new
  event.
- Replace the obsolete Desktop dependency-audit exception with patched
  Electron and transitive security floors, and fail closed for every future
  npm advisory.

### Added

- Show a persistent, non-destructive pending-deletion warning across the
  Desktop for every configured event before the operator processes a Server
  work order.
