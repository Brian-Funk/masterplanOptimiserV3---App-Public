const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildSmokeReceipt, shouldCreateRendererWindow } = require('../smoke-mode');
const {
  findPackagedExecutable,
  getPackagedSmokeArguments,
  waitForPortReleased,
} = require('../scripts/smoke-packaged');

test('packaged smoke mode runs without a renderer window', () => {
  assert.equal(shouldCreateRendererWindow(true), false);
  assert.equal(shouldCreateRendererWindow(false), true);
});

test('packaged smoke receipt records exact isolated runtime evidence', () => {
  assert.deepEqual(buildSmokeReceipt({
    version: '3.8.0-test',
    backendUrl: 'http://127.0.0.1:41001',
    frontendUrl: 'http://127.0.0.1:41002',
    databaseExists: true,
    integrityValid: true,
  }), {
    completed: true,
    version: '3.8.0-test',
    backendUrl: 'http://127.0.0.1:41001',
    frontendUrl: 'http://127.0.0.1:41002',
    databaseExists: true,
    integrityValid: true,
  });
});

test('packaged smoke disables the Chromium sandbox only on Linux', () => {
  assert.deepEqual(getPackagedSmokeArguments('linux'), ['--no-sandbox']);
  assert.deepEqual(getPackagedSmokeArguments('darwin'), []);
  assert.deepEqual(getPackagedSmokeArguments('win32'), []);
});

test('packaged smoke locates the Electron Builder Linux executable', {
  skip: process.platform === 'win32',
}, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-smoke-locator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unpackedDir = path.join(root, 'linux-unpacked');
  const executable = path.join(unpackedDir, 'masterplan-optimizer-desktop');
  fs.mkdirSync(unpackedDir, { recursive: true });
  fs.writeFileSync(executable, 'executable');
  fs.chmodSync(executable, 0o755);

  assert.equal(findPackagedExecutable(root, 'linux'), executable);
});

test('packaged smoke waits for owned service ports to finish releasing', async () => {
  const busy = Object.assign(new Error('port is still busy'), { code: 'EADDRINUSE' });
  let probes = 0;
  let pauses = 0;

  await waitForPortReleased(49250, {
    attempts: 3,
    intervalMs: 1,
    probe: async () => {
      probes += 1;
      if (probes < 3) throw busy;
    },
    pause: async () => { pauses += 1; },
  });

  assert.equal(probes, 3);
  assert.equal(pauses, 2);
});

test('packaged smoke still rejects a persistent occupied port', async () => {
  const busy = Object.assign(new Error('port is still busy'), { code: 'EADDRINUSE' });

  await assert.rejects(
    waitForPortReleased(49250, {
      attempts: 2,
      intervalMs: 1,
      probe: async () => { throw busy; },
      pause: async () => {},
    }),
    /did not release port 49250 within 2ms/,
  );
});

test('packaged smoke does not hide unrelated port probe failures', async () => {
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });

  await assert.rejects(
    waitForPortReleased(49250, {
      probe: async () => { throw denied; },
    }),
    denied,
  );
});
