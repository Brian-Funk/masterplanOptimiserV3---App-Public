const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const desktopPackageName = require('../package.json').name;

function walk(root) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...walk(absolutePath));
    else if (entry.isFile()) results.push(absolutePath);
  }
  return results;
}

function findPackagedExecutable(distDir, platform = process.platform) {
  const files = walk(distDir);
  if (platform === 'win32') {
    return files.find((file) => (
      path.basename(path.dirname(file)) === 'win-unpacked' &&
      path.basename(file) === 'Masterplan Optimiser.exe'
    ));
  }
  if (platform === 'darwin') {
    return files.find((file) => (
      path.basename(path.dirname(file)) === 'MacOS' &&
      path.basename(file) === 'Masterplan Optimiser'
    ));
  }
  return files.find((file) => {
    if (path.basename(path.dirname(file)) !== 'linux-unpacked') return false;
    if (![
      desktopPackageName,
      'masterplan-optimizer',
      'Masterplan Optimiser',
    ].includes(path.basename(file))) return false;
    return Boolean(fs.statSync(file).mode & 0o111);
  });
}

function getPackagedSmokeArguments(platform = process.platform) {
  return platform === 'linux' ? ['--no-sandbox'] : [];
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Packaged app did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Packaged app exited with code ${code}${signal ? ` (${signal})` : ''}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function assertPortReleased(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPortReleased(port, options = {}) {
  const attempts = options.attempts || 50;
  const intervalMs = options.intervalMs || 100;
  const probe = options.probe || assertPortReleased;
  const pause = options.pause || delay;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await probe(port);
      return;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
      if (attempt === attempts) {
        throw new Error(
          `Packaged app did not release port ${port} within ${attempts * intervalMs}ms`,
          { cause: error },
        );
      }
      await pause(intervalMs);
    }
  }
}

async function main() {
  const distDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  const executable = findPackagedExecutable(distDir);
  assert.ok(executable, `Could not find an unpacked application executable under ${distDir}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-packaged-smoke-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const receiptPath = path.join(userDataDir, 'desktop-smoke-receipt.json');
  fs.mkdirSync(userDataDir, { recursive: true });
  const [backendPort, frontendPort] = await Promise.all([reservePort(), reservePort()]);
  assert.notEqual(backendPort, frontendPort);

  const logs = [];
  const child = spawn(executable, getPackagedSmokeArguments(), {
    env: {
      ...process.env,
      API_URL: `http://127.0.0.1:${backendPort}`,
      FRONTEND_URL: `http://127.0.0.1:${frontendPort}`,
      MP_DESKTOP_SMOKE_TEST: '1',
      MP_DESKTOP_SMOKE_USER_DATA: userDataDir,
    },
    windowsHide: true,
  });
  child.stdout?.on('data', (data) => logs.push(data.toString()));
  child.stderr?.on('data', (data) => logs.push(data.toString()));

  try {
    await waitForExit(child, 300000);
    assert.ok(fs.existsSync(receiptPath), 'Packaged app did not write its smoke receipt');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.completed, true);
    assert.equal(receipt.databaseExists, true);
    assert.equal(receipt.integrityValid, true);
    assert.equal(receipt.backendUrl, `http://127.0.0.1:${backendPort}`);
    assert.equal(receipt.frontendUrl, `http://127.0.0.1:${frontendPort}`);
    await Promise.all([waitForPortReleased(backendPort), waitForPortReleased(frontendPort)]);
    console.log(JSON.stringify({ executable, backendPort, frontendPort, receipt }, null, 2));
  } catch (error) {
    process.stderr.write(logs.join(''));
    throw error;
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  findPackagedExecutable,
  getPackagedSmokeArguments,
  waitForPortReleased,
};
