# Privacy and deletion

## Supported operational data

The current desktop schema stores named operational fields. A person has core
contact fields, typed capabilities and reason-free unavailability intervals.
The application does not provide a general participant-profile dictionary.
Health, dietary, political, religious, safeguarding, disciplinary and unrelated
private profiling are unsupported.

This boundary reduces accidental collection but does not decide the
controller's lawful basis, transparency duties or retention periods.

## Processing server work orders

In **Settings > MP-Backend Server**, select **Process deletion requests**. The
desktop claims only work orders for the server-bound event identity.

For a personal-data work order, the desktop removes the person, assignments,
capability links, group memberships, unavailability, task references,
optimisation state, publish state and known local integration references. For a
whole-event work order it removes the complete event scope. The deletion and a
privacy-safe report are committed in one SQLite transaction.

The report contains pseudonymous identifiers, bounded counters and exact
outstanding action codes. It contains no name, email address, event title,
schedule content or free-text reason. Its server secret and claim capability
are encrypted in the local outbox until delivery succeeds. If the event has
already been removed, use **Retry pending deletion reports** from the same
settings area without selecting an event.

An `external_integration_copy` action means that deleting the desktop record did
not itself delete a copy held by a configured external provider. The controller
must remove that copy and confirm the exact action on the server before the case
can complete.

Deletion of database rows does not remove independent exports, backups, cloud
versions, diagnostic dumps or provider copies. Use the storage identifiers and
controller checklist in [Workstation storage security](workstation-storage-security.md)
when creating the later desktop deletion attestation.

## One-off conversion of the sole existing database

The live application has no legacy import or automatic legacy migration. The
standalone tool at `tools/one_off/convert_current_desktop_v2.py` is the only
conversion path.

Before using it:

1. close every desktop process and make two byte-identical backups of the source
   database and its existing `encryption.key`;
2. confirm the copied database has no live `-wal`, `-shm` or `-journal`
   companion file;
3. install `age` and create or select a controller-held age recipient;
4. choose three unused output paths in one protected output directory; and
5. test only on a copied database first.

Example:

```bash
python tools/one_off/convert_current_desktop_v2.py \
  --source /protected-copy/masterplan.db \
  --target /protected-output/masterplan-v2.db \
  --archive /protected-output/masterplan-source.age \
  --recipient age1... \
  --age-executable /trusted-tools/age
```

The `--age-executable` option is needed only when the trusted `age` executable
is not available on `PATH`. The converter opens the source read-only and fails
if a SQLite companion file could contain uncheckpointed data. It validates the
source integrity and foreign keys, refuses to overwrite an output, checks the
source file and schema again before publication, creates a fresh current schema
and maps only supported capabilities and reason-free unavailability.

The encrypted archive contains a row-for-row representation of every source
table and blob. The non-sensitive receipt accounts for every source field,
copied and generated records, intentional archive-only fields, rejected
records and unexplained loss. It records source, schema, target and archive
SHA-256 evidence, the age tool version and a hash of the public recipient. The
converted database and encrypted archive are published first and the receipt
is published last as the completion marker. A later publication failure removes
the earlier partial outputs. Any unexplained row loss blocks conversion.

Unsupported source values remain fully represented only inside the
controller-held encrypted archive and are never loaded by the current
application. The receipt contains dispositions and counts, not protected field
values.

Keep the source `encryption.key` with the converted database when existing
encrypted settings were copied. Do not delete the original or replace the live
database until the receipt, target contents, archive decryption and an
application start from a separate test directory have all been verified.
