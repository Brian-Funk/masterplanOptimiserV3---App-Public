const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { terminateProcessTree } = require('../process-ownership');

function waitFor(predicate, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for Electron fixture'));
      setTimeout(poll, 100);
    };
    poll();
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('terminating one owned Electron tree leaves an unrelated Electron instance alive', {
  skip: process.platform !== 'win32' || process.env.MP_RUN_ELECTRON_INTEGRATION !== '1',
  timeout: 60000,
}, async (t) => {
  const electronPath = require('electron');
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-electron-ownership-'));
  const fixturePath = path.join(fixtureDir, 'fixture.js');
  fs.writeFileSync(fixturePath, `
    const fs = require('node:fs');
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', process.argv[3]);
    app.whenReady().then(() => {
      global.keepWindow = new BrowserWindow({ show: false });
      fs.writeFileSync(process.argv[2], String(process.pid));
    });
  `);

  const launch = (name) => {
    const marker = path.join(fixtureDir, `${name}.ready`);
    const userData = path.join(fixtureDir, `${name}-user-data`);
    const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnv } = process.env;
    const child = spawn(electronPath, [fixturePath, marker, userData], {
      env: electronEnv,
      stdio: 'ignore',
      windowsHide: true,
    });
    return { child, marker };
  };

  const first = launch('owned');
  const unrelated = launch('unrelated');
  t.after(async () => {
    if (isAlive(first.child.pid)) terminateProcessTree(first.child);
    if (isAlive(unrelated.child.pid)) terminateProcessTree(unrelated.child);
    await Promise.all([
      waitFor(() => !isAlive(first.child.pid), 10000),
      waitFor(() => !isAlive(unrelated.child.pid), 10000),
    ]);
    fs.rmSync(fixtureDir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  });

  await Promise.all([
    waitFor(() => fs.existsSync(first.marker)),
    waitFor(() => fs.existsSync(unrelated.marker)),
  ]);
  console.log(`owned Electron PID ${first.child.pid}; unrelated Electron PID ${unrelated.child.pid}`);
  assert.equal(isAlive(first.child.pid), true);
  assert.equal(isAlive(unrelated.child.pid), true);

  terminateProcessTree(first.child);
  await waitFor(() => !isAlive(first.child.pid));
  assert.equal(isAlive(unrelated.child.pid), true);
  console.log(`owned Electron stopped; unrelated Electron PID ${unrelated.child.pid} remained alive`);
});
