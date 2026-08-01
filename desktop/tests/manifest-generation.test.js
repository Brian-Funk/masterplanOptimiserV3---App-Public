const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const afterPack = require('../scripts/generate-manifest');
const { verifySignedManifest } = require('../integrity');

function createBuildFixture(t, { platform = 'win32' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-after-pack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktopDir = path.join(root, 'desktop');
  const webDir = path.join(root, 'web');
  const appOutDir = path.join(root, 'out');
  const productFilename = 'Masterplan Optimiser';
  const resourcesDir = platform === 'darwin'
    ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  fs.mkdirSync(path.join(desktopDir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(resourcesDir, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(webDir, '.next', 'standalone', 'node_modules', 'next'), { recursive: true });
  fs.mkdirSync(path.join(webDir, '.next', 'standalone', 'node_modules', 'react'), { recursive: true });
  fs.mkdirSync(path.join(webDir, '.next', 'standalone', 'node_modules', 'react-dom'), { recursive: true });
  fs.mkdirSync(path.join(webDir, '.next', 'static'), { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, 'app.asar'), 'application');
  fs.writeFileSync(path.join(resourcesDir, 'backend', 'backend.exe'), 'backend');
  fs.writeFileSync(path.join(webDir, '.next', 'standalone', 'server.js'), 'frontend');
  for (const name of ['next', 'react', 'react-dom']) {
    fs.writeFileSync(
      path.join(webDir, '.next', 'standalone', 'node_modules', name, 'package.json'),
      JSON.stringify({ name }),
    );
  }
  fs.writeFileSync(path.join(webDir, '.next', 'static', 'chunk.js'), 'chunk');

  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKeyPath = path.join(desktopDir, 'assets', 'manifest-public.pem');
  fs.writeFileSync(publicKeyPath, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  return {
    context: {
      projectDir: desktopDir,
      electronPlatformName: platform,
      appOutDir,
      packager: { appInfo: { version: '3.8.0-test', productFilename } },
    },
    keys,
    publicKeyPath,
    resourcesDir,
  };
}

function privatePem(privateKey) {
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

test('packaging fails when the signing key is missing or mismatched', async (t) => {
  const fixture = createBuildFixture(t);
  const previous = process.env.MANIFEST_SIGNING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MANIFEST_SIGNING_KEY;
    else process.env.MANIFEST_SIGNING_KEY = previous;
  });

  delete process.env.MANIFEST_SIGNING_KEY;
  await assert.rejects(afterPack(fixture.context), /MANIFEST_SIGNING_KEY is required/);

  process.env.MANIFEST_SIGNING_KEY = privatePem(crypto.generateKeyPairSync('ed25519').privateKey);
  await assert.rejects(afterPack(fixture.context), /does not match/);
});

test('packaging emits a verifiable manifest for the complete runtime', async (t) => {
  const fixture = createBuildFixture(t);
  const previous = process.env.MANIFEST_SIGNING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MANIFEST_SIGNING_KEY;
    else process.env.MANIFEST_SIGNING_KEY = previous;
  });
  process.env.MANIFEST_SIGNING_KEY = privatePem(fixture.keys.privateKey);

  await afterPack(fixture.context);
  const result = verifySignedManifest({
    resourcesDir: fixture.resourcesDir,
    publicKeyPath: fixture.publicKeyPath,
    manifestPath: path.join(fixture.resourcesDir, 'manifest.signed.json'),
  });
  assert.equal(result.valid, true);
  assert.equal(result.files.some((entry) => entry.path === 'app.asar'), true);
  assert.equal(result.files.some((entry) => entry.path === 'backend/backend.exe'), true);
  assert.equal(result.files.some((entry) => entry.path === 'frontend/.next/static/chunk.js'), true);
  assert.equal(result.files.some((entry) => entry.path === 'frontend/server.js'), true);
});

test('packaging resolves the macOS application bundle resources directory', async (t) => {
  const fixture = createBuildFixture(t, { platform: 'darwin' });
  const previous = process.env.MANIFEST_SIGNING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MANIFEST_SIGNING_KEY;
    else process.env.MANIFEST_SIGNING_KEY = previous;
  });
  process.env.MANIFEST_SIGNING_KEY = privatePem(fixture.keys.privateKey);

  await afterPack(fixture.context);
  assert.equal(fs.existsSync(path.join(fixture.resourcesDir, 'manifest.signed.json')), true);
  assert.equal(verifySignedManifest({
    resourcesDir: fixture.resourcesDir,
    publicKeyPath: fixture.publicKeyPath,
    manifestPath: path.join(fixture.resourcesDir, 'manifest.signed.json'),
  }).valid, true);
});

test('packaging materializes protected in-tree symbolic links before signing', {
  skip: process.platform === 'win32',
}, async (t) => {
  const fixture = createBuildFixture(t);
  const previous = process.env.MANIFEST_SIGNING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MANIFEST_SIGNING_KEY;
    else process.env.MANIFEST_SIGNING_KEY = previous;
  });
  process.env.MANIFEST_SIGNING_KEY = privatePem(fixture.keys.privateKey);

  const targetPath = path.join(fixture.resourcesDir, 'backend', 'lib-example.so.1');
  const linkPath = path.join(fixture.resourcesDir, 'backend', 'lib-example.so');
  fs.writeFileSync(targetPath, 'shared-library');
  fs.symlinkSync(path.basename(targetPath), linkPath);

  await afterPack(fixture.context);
  assert.equal(fs.lstatSync(linkPath).isFile(), true);
  assert.equal(fs.readFileSync(linkPath, 'utf8'), 'shared-library');
  assert.equal(verifySignedManifest({
    resourcesDir: fixture.resourcesDir,
    publicKeyPath: fixture.publicKeyPath,
    manifestPath: path.join(fixture.resourcesDir, 'manifest.signed.json'),
  }).valid, true);
});

test('packaging materializes protected in-tree directory links before signing', {
  skip: process.platform === 'win32',
}, async (t) => {
  const fixture = createBuildFixture(t, { platform: 'darwin' });
  const previous = process.env.MANIFEST_SIGNING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MANIFEST_SIGNING_KEY;
    else process.env.MANIFEST_SIGNING_KEY = previous;
  });
  process.env.MANIFEST_SIGNING_KEY = privatePem(fixture.keys.privateKey);

  const frameworkPath = path.join(
    fixture.resourcesDir,
    'backend',
    '_internal',
    'Python.framework',
  );
  const versionPath = path.join(frameworkPath, 'Versions', '3.11');
  const resourcesLink = path.join(frameworkPath, 'Resources');
  const currentLink = path.join(frameworkPath, 'Versions', 'Current');
  const pythonLink = path.join(frameworkPath, 'Python');
  fs.mkdirSync(path.join(versionPath, 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(versionPath, 'Python'), 'python framework binary');
  fs.writeFileSync(path.join(versionPath, 'Resources', 'Info.plist'), 'framework metadata');
  fs.symlinkSync('3.11', currentLink, 'dir');
  fs.symlinkSync(path.join('Versions', 'Current', 'Python'), pythonLink);
  fs.symlinkSync(path.join('Versions', 'Current', 'Resources'), resourcesLink, 'dir');

  await afterPack(fixture.context);
  assert.equal(fs.lstatSync(resourcesLink).isDirectory(), true);
  assert.equal(fs.lstatSync(resourcesLink).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(currentLink).isDirectory(), true);
  assert.equal(fs.lstatSync(currentLink).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(pythonLink).isFile(), true);
  assert.equal(fs.readFileSync(path.join(resourcesLink, 'Info.plist'), 'utf8'), 'framework metadata');
  assert.equal(verifySignedManifest({
    resourcesDir: fixture.resourcesDir,
    publicKeyPath: fixture.publicKeyPath,
    manifestPath: path.join(fixture.resourcesDir, 'manifest.signed.json'),
  }).valid, true);
});

test('packaging rejects protected symbolic-link directory cycles', {
  skip: process.platform === 'win32',
}, async (t) => {
  const fixture = createBuildFixture(t);
  const previous = process.env.MANIFEST_SIGNING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MANIFEST_SIGNING_KEY;
    else process.env.MANIFEST_SIGNING_KEY = previous;
  });
  process.env.MANIFEST_SIGNING_KEY = privatePem(fixture.keys.privateKey);

  const targetPath = path.join(fixture.resourcesDir, 'backend', 'cycle-source');
  const linkPath = path.join(targetPath, 'back');
  fs.mkdirSync(targetPath);
  fs.symlinkSync('..', linkPath, 'dir');

  await assert.rejects(afterPack(fixture.context), /symbolic link creates a directory cycle/);
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
});

test('packaging rejects protected symbolic links that escape resources', {
  skip: process.platform === 'win32',
}, async (t) => {
  const fixture = createBuildFixture(t);
  const previous = process.env.MANIFEST_SIGNING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.MANIFEST_SIGNING_KEY;
    else process.env.MANIFEST_SIGNING_KEY = previous;
  });
  process.env.MANIFEST_SIGNING_KEY = privatePem(fixture.keys.privateKey);

  const externalPath = path.join(path.dirname(fixture.context.appOutDir), 'outside.so');
  const linkPath = path.join(fixture.resourcesDir, 'backend', 'escape.so');
  fs.writeFileSync(externalPath, 'outside');
  fs.symlinkSync(externalPath, linkPath);

  await assert.rejects(afterPack(fixture.context), /symbolic link escapes packaged resources/);
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
});
