const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  hardenDesktopDataPermissions,
  prepareBackendEnvironmentFile,
  resolveDesktopDataPaths,
  resolveDesktopStorageInventory,
} = require('../user-data-paths');

function createBackendFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-backend-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backendPath = path.join(root, 'backend');
  fs.mkdirSync(backendPath);
  fs.writeFileSync(path.join(backendPath, '.env.desktop'), 'ENVIRONMENT=desktop\n');
  return backendPath;
}

test('packaged backend startup leaves signed resources immutable across restarts', (t) => {
  const backendPath = createBackendFixture(t);
  const envPath = path.join(backendPath, '.env');

  assert.equal(prepareBackendEnvironmentFile({ backendPath, isDev: false }).copied, false);
  assert.equal(prepareBackendEnvironmentFile({ backendPath, isDev: false }).copied, false);
  assert.equal(fs.existsSync(envPath), false);
  assert.deepEqual(fs.readdirSync(backendPath), ['.env.desktop']);
});

test('development backend setup still refreshes its source-tree environment file', (t) => {
  const backendPath = createBackendFixture(t);
  const messages = [];

  const result = prepareBackendEnvironmentFile({
    backendPath,
    isDev: true,
    logger: { log: (message) => messages.push(message) },
  });

  assert.equal(result.copied, true);
  assert.equal(fs.readFileSync(result.envPath, 'utf8'), 'ENVIRONMENT=desktop\n');
  assert.deepEqual(messages, ['Using desktop environment configuration']);
});

test('desktop storage inventory defines every deletion-attestation category', () => {
  const inventory = resolveDesktopStorageInventory({
    userDataDir: path.resolve('user-data'),
    downloadsDir: path.resolve('downloads'),
    tempDir: path.resolve('synthetic-temp'),
  });

  assert.deepEqual(inventory.map((entry) => entry.id), [
    'desktop_database',
    'desktop_encryption_key',
    'electron_user_data',
    'user_exports_and_diagnostics',
    'operator_backups_and_cloud_copies',
    'synthetic_test_temporary_data',
  ]);
  assert.equal(inventory.every((entry) => entry.eventDeletionCoverage.length > 20), true);
  assert.equal(inventory.find((entry) => entry.controller === 'operator').path.endsWith('downloads'), true);
});

test('desktop data permissions are owner-only on POSIX systems', {
  skip: process.platform === 'win32',
}, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-data-mode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = resolveDesktopDataPaths(root);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.databasePath, 'database');
  fs.writeFileSync(paths.encryptionKeyPath, 'key');

  hardenDesktopDataPermissions(paths, 'linux');

  assert.equal(fs.statSync(paths.dataDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(paths.databasePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.encryptionKeyPath).mode & 0o777, 0o600);
});
