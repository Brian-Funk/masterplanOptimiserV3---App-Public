# Workstation storage security

The desktop application stores operational and personal data on the controller's workstation. Application-level deletion is only one part of erasure. The controller must secure and account for the device, exports, backups and external copies.

## Required workstation controls

Before real participant data is used, the Head Organiser or controller must confirm all of the following:

- the operating-system account requires authentication and is not shared;
- BitLocker, FileVault, LUKS or equivalent full-disk encryption is enabled;
- operating-system and security updates are current;
- automatic screen locking is enabled;
- other local users cannot read the application profile, exports or backups;
- removable and backup media are encrypted and access-controlled;
- cloud-synchronised folders are either excluded or treated as additional processor-held copies; and
- device loss, repair and disposal procedures cover the application profile and every backup.

These are controller checks. The application cannot reliably attest to firmware settings, disk-encryption recovery custody, other local accounts, provider retention or every synchronisation client.

## Defined storage locations

The code-owned inventory is returned by `resolveDesktopStorageInventory` in `desktop/user-data-paths.js`. A deletion attestation must cover each identifier below.

| Identifier | Location | Contents and deletion coverage |
| --- | --- | --- |
| `desktop_database` | `<Electron userData>/data/masterplan.db` plus `-wal`, `-shm` or `-journal` companions when present | Primary SQLite data. Event and person workflows delete scoped rows. New SQLite connections enable `secure_delete`, which overwrites deleted payload bytes in database pages. This does not remove independent backups. |
| `desktop_encryption_key` | `<Electron userData>/data/encryption.key` | Shared key for encrypted application settings. It is retained while the database remains in use and is not an event-specific crypto-erasure key. |
| `electron_user_data` | Electron's platform-specific `userData` directory | Chromium profile state, preferences and caches. The HTTP cache is cleared at application start. Whole-profile disposal must include this directory and any operating-system crash reports. |
| `user_exports_and_diagnostics` | Downloads or another path selected by the user | JSON data exports, server-setup exports and manually saved diagnostic dumps. The controller must locate and remove all relevant copies. Diagnostic dumps can contain operational paths and error context and should be shared only through an approved support channel. |
| `operator_backups_and_cloud_copies` | Controller-selected media or synchronised folders | The application does not create automatic local backups. Any manual database copy, export, migration archive or cloud-synchronised copy remains the controller's responsibility. |
| `synthetic_test_temporary_data` | Operating-system temporary directory | Packaged-smoke and automated-test fixtures only. Cleanup handlers remove them. Real migration work uses a private temporary directory inside the chosen protected target directory, not the general temporary directory. |

## Operator accountability signing keys

The desktop **Settings > Evidence Keys** workflow generates an Ed25519 key on
the operator workstation. The private PKCS#8 bytes are written only to the
operating-system credential store. SQLite retains the derived key ID, OpenSSH
public key, SHA-256 fingerprint, role, lifecycle state and supersession link.
Normal project exports, diagnostic output, Server requests and evidence bundles
therefore contain no operator private key.

The Server root first receives the public registration file and creates a
short-lived, single-use challenge for one role. Paste that challenge into the
desktop workflow and return only its detached public proof package. For routine
rotation, sign the same challenge once with the new key and once with the old
key. Lost or compromised keys can be replaced without the unavailable old
private key, but the root must use the matching enumerated reason and the old
public key remains available for historic verification.

Only `controller`, `root_operator` and `evidence_auditor` keys can sign private
evidence-repository Git anchors. `desktop_operator` and `backup_custodian` keys
are deliberately unable to authorise a Git anchor. Retire a local key only
after the Server public key is revoked. Local retirement disables future
signing but does not silently erase historic custody material.

The application cannot recover a lost private key or prove that the OS
credential store is backed up securely. The controller must define an approved
encrypted backup method, verify fingerprints through an independent channel,
record the human-to-key mapping outside Masterplan evidence, and include key
loss or workstation disposal in the organisational response plan.

On macOS and Linux, the desktop launcher uses an owner-only process umask, creates its data directory with mode `0700`, and applies mode `0600` to existing database material. Windows protection relies on the access control list of Electron's per-user application-data directory and the required authenticated, encrypted workstation account.

## Exports, backups and cloud synchronisation

Browser downloads use the operating system's configured download destination. The application cannot know whether that destination is synchronised or backed up. Before exporting data or a diagnostic dump, select a protected non-synchronised directory unless the destination service is approved for this processing.

The one-off migration utility creates temporary decrypted material only below the selected protected output directory, uses restrictive creation semantics, removes partial outputs on failure, and publishes the encrypted archive and receipt through explicit paths. The source database, its key, the encrypted archive and any test copy all remain separate deletion targets.

## Event and subject deletion boundary

Desktop deletion removes the applicable database records, assignments, capability links, memberships, unavailability, task references, optimisation state, publish state and known local integration references. SQLite secure deletion reduces residual content in freed database pages for deletions performed after this change.

It does not silently delete:

- earlier JSON exports, server-setup files or diagnostic dumps;
- database copies, migration inputs or encrypted migration archives;
- operating-system, backup-product or cloud-sync versions;
- data already sent to Google Calendar, a publication server or another provider; or
- provider snapshots or support records.

Those copies must be recorded as outstanding actions and covered by the controller's later signed desktop deletion attestation. A signature records what the operator checked. It must not claim cryptographic proof of physical deletion.
