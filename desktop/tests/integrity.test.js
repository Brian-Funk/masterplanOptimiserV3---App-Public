const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MANIFEST_FORMAT,
  PROTECTED_ROOTS,
  buildManifestFileMap,
  publicKeysMatch,
  sha256,
  verifySignedManifest,
} = require('../integrity');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'backend'));
  fs.mkdirSync(path.join(root, 'frontend'));
  fs.writeFileSync(path.join(root, 'app.asar'), 'application');
  fs.writeFileSync(path.join(root, 'backend', 'backend.exe'), 'backend');
  fs.writeFileSync(path.join(root, 'frontend', 'server.js'), 'frontend');

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPath = path.join(root, 'public.pem');
  const manifestPath = path.join(root, 'manifest.signed.json');
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  return { root, privateKey, publicKey, publicKeyPath, manifestPath };
}

function writeSignedManifest(fixture) {
  const manifest = JSON.stringify({
    format: MANIFEST_FORMAT,
    version: 'test',
    timestamp: new Date(0).toISOString(),
    protectedRoots: PROTECTED_ROOTS,
    files: buildManifestFileMap(fixture.root),
  }, null, 2);
  fs.writeFileSync(fixture.manifestPath, JSON.stringify({
    signed: true,
    manifest,
    signature: crypto.sign(null, Buffer.from(manifest), fixture.privateKey).toString('base64'),
  }));
}

test('signed manifest covers all packaged runtime files', (t) => {
  const fixture = createFixture(t);
  writeSignedManifest(fixture);
  assert.equal(publicKeysMatch(fixture.privateKey, fixture.publicKey), true);

  const result = verifySignedManifest({
    resourcesDir: fixture.root,
    publicKeyPath: fixture.publicKeyPath,
    manifestPath: fixture.manifestPath,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.files.map((entry) => entry.path), [
    'app.asar',
    'backend/backend.exe',
    'frontend/server.js',
  ]);
});

test('manifest hashing disables Electron ASAR filesystem virtualisation', (t) => {
  const fixture = createFixture(t);
  const appAsarPath = path.join(fixture.root, 'app.asar');
  const originalLstatSync = fs.lstatSync;
  const hadNoAsar = Object.prototype.hasOwnProperty.call(process, 'noAsar');
  const previousNoAsar = process.noAsar;
  let observedRawMode = false;

  process.noAsar = false;
  fs.lstatSync = function lstatSyncWithRawModeCheck(entryPath, ...args) {
    if (path.resolve(entryPath) === path.resolve(appAsarPath)) {
      observedRawMode = true;
      assert.equal(process.noAsar, true);
    }
    return originalLstatSync.call(this, entryPath, ...args);
  };

  try {
    const files = buildManifestFileMap(fixture.root);
    assert.equal(observedRawMode, true);
    assert.equal(files['app.asar'], sha256(appAsarPath));
    assert.equal(process.noAsar, false);
  } finally {
    fs.lstatSync = originalLstatSync;
    if (hadNoAsar) process.noAsar = previousNoAsar;
    else delete process.noAsar;
  }
});

test('verification rejects unsigned, modified, and unexpected resources', (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(fixture.manifestPath, JSON.stringify({ signed: false }));
  assert.equal(verifySignedManifest({
    resourcesDir: fixture.root,
    publicKeyPath: fixture.publicKeyPath,
    manifestPath: fixture.manifestPath,
  }).valid, false);

  writeSignedManifest(fixture);
  fs.writeFileSync(path.join(fixture.root, 'backend', 'backend.exe'), 'modified');
  fs.writeFileSync(path.join(fixture.root, 'frontend', 'injected.js'), 'unexpected');
  const result = verifySignedManifest({
    resourcesDir: fixture.root,
    publicKeyPath: fixture.publicKeyPath,
    manifestPath: fixture.manifestPath,
  });
  assert.equal(result.valid, false);
  assert.equal(result.files.find((entry) => entry.path === 'backend/backend.exe').status, 'modified');
  assert.equal(result.files.find((entry) => entry.path === 'frontend/injected.js').status, 'unexpected');
});
