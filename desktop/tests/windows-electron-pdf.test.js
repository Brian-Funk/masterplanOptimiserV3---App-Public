const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { terminateProcessTree } = require('../process-ownership');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForHttp(url, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) return resolve();
        if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${url}`));
        else setTimeout(poll, 200);
      });
      request.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${url}`));
        else setTimeout(poll, 200);
      });
    };
    poll();
  });
}

function waitForExit(child, logs, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron PDF fixture did not exit')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron PDF fixture exited with ${code}: ${logs.join('').trim()}`));
    });
    child.once('error', reject);
  });
}

test('Electron renders a real portrait light schedule PDF with dense continuation details', {
  skip: process.platform !== 'win32' || process.env.MP_RUN_ELECTRON_PDF_INTEGRATION !== '1',
  timeout: 120000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-electron-pdf-'));
  const outputDirectory = path.join(root, 'selected-output');
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(outputDirectory);
  fs.mkdirSync(userData);
  const payloadPath = path.join(root, 'payload.json');
  const outputPath = path.join(outputDirectory, 'Field_Plan_2032_04_21_14_07.pdf');
  const receiptPath = path.join(root, 'receipt.json');
  const fixturePath = path.join(root, 'pdf-renderer-electron-fixture.js');
  const fixtureConfigPath = path.join(root, 'fixture-config.json');
  fs.copyFileSync(path.join(__dirname, 'pdf-renderer-electron-fixture.js'), fixturePath);
  const denseTasks = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    name: index === 0
      ? 'Build the complete primary stage and verify every operational handover point'
      : `Operational handover task ${index + 1} with a complete readable title`,
    date: '2032-04-21',
    start_end_time: {
      start: `${String(8 + index).padStart(2, '0')}:00`,
      end: `${String(9 + index).padStart(2, '0')}:00`,
    },
    task_type_name: 'Stage operations',
    task_type_color: index % 2 === 0 ? '#2563eb' : '#7c3aed',
    location_name: `Operational location ${index + 1} - north loading entrance`,
    resource_info: `Stage leads: Alex Example, Sam Example | Safety: Jo Example ${index + 1}`,
    fields: {
      instructions: `Bring the complete equipment manifest for task ${index + 1} and retain the signed handover sheet.`,
      reference: { label: `Run sheet ${index + 1}`, url: `https://example.invalid/run-sheet-${index + 1}` },
    },
    field_definitions: [
      { id: 'instructions', name: 'Operational instructions', type: 'text' },
      { id: 'reference', name: 'Reference', type: 'link' },
    ],
    _extra_card_fields: [{ label: 'Radio channel', value: `Operations ${index + 1}` }],
  }));
  fs.writeFileSync(payloadPath, JSON.stringify({
    title: 'Field Plan',
    eventId: 42,
    eventName: 'Synthetic Assembly',
    eventLocation: 'Test Hall',
    eventStartDate: '2032-04-21',
    eventEndDate: '2032-04-22',
    generatedAt: '2032-04-20T12:00:00.000Z',
    scheduleDayRange: { startHour: 8, endHour: 18 },
    scheduleDayBoundary: { offsetHour: 0 },
    days: [
      { date: '2032-04-21', dayLabel: 'Wednesday, 21 April 2032', tasks: denseTasks },
      { date: '2032-04-22', dayLabel: 'Thursday, 22 April 2032', tasks: [{ id: 2, name: 'Open doors', date: '2032-04-22', start_end_time: { start: '10:00', end: '11:00' }, task_type_color: '#7c3aed', location_name: 'Entrance', resource_info: 'Sam Example' }] },
    ],
  }));

  const port = await reservePort();
  const frontendUrl = `http://127.0.0.1:${port}`;
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'npm_execpath is required for the Electron PDF integration');
  const frontendLogs = [];
  const frontend = spawn(
    process.execPath,
    [npmCli, 'run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: path.join(__dirname, '..', '..', 'web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  frontend.stdout.on('data', (data) => frontendLogs.push(data.toString()));
  frontend.stderr.on('data', (data) => frontendLogs.push(data.toString()));
  t.after(() => {
    if (frontend.exitCode === null) terminateProcessTree(frontend);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  try {
    await waitForHttp(`${frontendUrl}/pdf-export`);
  } catch (error) {
    process.stderr.write(frontendLogs.join(''));
    throw error;
  }

  const electronPath = require('electron');
  fs.writeFileSync(fixtureConfigPath, JSON.stringify({
    payloadPath,
    outputPath,
    receiptPath,
    frontendUrl,
    userDataPath: userData,
    preloadPath: path.join(__dirname, '..', 'preload.js'),
    pdfExportModulePath: path.join(__dirname, '..', 'pdf-export.js'),
  }));
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnv } = process.env;
  const fixture = spawn(electronPath, [
    fixturePath,
    fixtureConfigPath,
  ], {
    env: {
      ...electronEnv,
      MP_DESKTOP_RENDERER_API_URL: 'http://127.0.0.1:65535',
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  try {
    await waitForExit(fixture, []);
  } catch (error) {
    const debugPath = `${receiptPath}.log`;
    if (fs.existsSync(debugPath)) {
      throw new Error(`${error.message}\n${fs.readFileSync(debugPath, 'utf8')}`);
    }
    throw error;
  }

  const pdf = fs.readFileSync(outputPath);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(receipt.pageCount >= 3, 'dense details must continue onto another portrait page');
  assert.match(receipt.bodyText, /Field Plan/);
  assert.match(receipt.bodyText, /Build the complete primary stage and verify every operational handover point/);
  assert.match(receipt.bodyText, /Open doors/);
  assert.match(receipt.bodyText, /T01/);
  assert.match(receipt.bodyText, /Stage leads: Alex Example, Sam Example/);
  assert.match(receipt.bodyText, /Operational instructions/i);
  assert.match(receipt.bodyText, /Bring the complete equipment manifest/);
  assert.match(receipt.bodyText, /Operational handover task 7 with a complete readable title/);
  assert.doesNotMatch(receipt.visualState.rootClassName, /dark/);
  assert.equal(receipt.visualState.background, 'rgb(255, 255, 255)');
  assert.match(receipt.visualState.fontFamily, /Source Sans 3/);
  assert.equal(receipt.visualState.logoReady, true);
  assert.equal(receipt.visualState.logoHasColour, true);
  assert.equal(receipt.visualState.detailRows, denseTasks.length + 1);
  assert.ok(receipt.mediaBox, 'PDF MediaBox is required');
  assert.ok(receipt.mediaBox.height > receipt.mediaBox.width, 'PDF must be portrait');
  assert.equal(path.dirname(path.resolve(receipt.outputPath)), path.resolve(outputDirectory));
  if (process.env.MP_PDF_INTEGRATION_OUTPUT) {
    const retainedPath = path.resolve(process.env.MP_PDF_INTEGRATION_OUTPUT);
    fs.mkdirSync(path.dirname(retainedPath), { recursive: true });
    fs.copyFileSync(outputPath, retainedPath);
  }
});
