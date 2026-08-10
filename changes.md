# Changes

## Unreleased

The source version is `3.8.2` solely to identify the reviewed security-scan
baseline shared with the Server. It is not a release: do not create a tag,
installer, checksum bundle or public changelog entry for this version. The next
public release prepared from a qualified successor is `3.9.0`.

### Added

- Added PDF as an independently selectable publishing destination beside
  Google Calendar and MP-Backend. Selected-day publishing creates one light A4
  page; all-days publishing creates an ordered multi-page schedule using the
  event title and a protected workstation-only output folder.
- Added mandatory event-scoped Desktop processor enrolment when an event is
  connected to a Server. Desktop can generate a new Ed25519 identity locally
  or import a compatible encrypted processor package, retains private material
  in the operating-system credential store and sends public proof only.
- Added automatic signed permitted-data acknowledgements, deletion work-order
  claims, Desktop deletion receipts and local-copy resolution statements.
- Added durable encrypted-outbox handling so deletion evidence remains
  retryable after a local event or person has been removed.
- Added a persistent, non-destructive pending-deletion warning for every
  configured event before the operator processes Server work.

### Changed

- Bound every processor identity immutably to one Server event and retained
  historical public verification material after rotation or reassignment.
- Made the General Schedule always public and the Masterplan always available
  only to authenticated event users. Removed redundant per-field audience and
  workstation-only controls from ordinary planning workflows.
- Show the permitted-data guidance once per policy acknowledgement while
  retaining the dismissible **Operational data only** reminder.
- Apply calm automatic field categories for timing, location, assignment,
  reference and operational-instruction fields.
- Use a neutral self-hosting address in Server-connection guidance and point
  all release verification documentation to App-Public.

### Fixed and hardened

- Clear stale event selections after deletion and make local person deletion
  idempotent.
- Keep processor identities scoped to their exact Server event when a reusable
  local event is linked elsewhere.
- Patch Desktop, Electron and web dependency advisories, regenerate licensing
  notices and fail closed for future unexpected npm audit findings.
- Pin the current event-processor, audience, field-contract and external
  Desktop regression suites in the exact-SHA CI result.
