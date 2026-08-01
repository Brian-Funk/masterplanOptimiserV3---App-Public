# Public repository cutover

Keep the current private repository as the development source. Do not change
its visibility in place: its history contains planning and debug material that
is deliberately absent from the publishable tree.

1. Validate the exact reviewed App commit, generated notices, licence metadata,
   Desktop packaging, source identity and publication audit.
2. Export only that reviewed tree into a new repository with one new
   parentless root commit. Copy no private branches, tags, releases, issues,
   pull requests, Actions artefacts or Git objects.
3. Run `npm --prefix desktop run audit:publication:history` in the new
   repository. Any historical `notes/`, debug file, internal report, secret or
   private key blocks publication.
4. Verify the exact public root tree against the reviewed private-source tree,
   then configure branch protection and private vulnerability reporting.
5. Build a signed release only from a public `main` commit with exact-SHA CI.

The frontend build normally derives its corresponding-source identity from the
Git remote and exact `HEAD`. A source archive without Git metadata, or a
modified build whose source is elsewhere, must set
`MP_PUBLIC_SOURCE_REPOSITORY_URL`, `MP_PUBLIC_SOURCE_REVISION` and
`MP_PUBLIC_SOURCE_URL`. URLs must be credential-free HTTPS, the revision must
be an exact 40-character commit SHA, and the source URL must contain that SHA.
