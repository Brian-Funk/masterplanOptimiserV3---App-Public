const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

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

test('Electron renders a production-sized portrait schedule PDF with dense continuation details', {
  skip: process.platform !== 'win32' || process.env.MP_RUN_ELECTRON_PDF_INTEGRATION !== '1',
  timeout: 480000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-electron-pdf-'));
  const outputDirectory = path.join(root, 'selected-output');
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(outputDirectory);
  fs.mkdirSync(userData);
  const payloadPath = path.join(root, 'payload.json');
  const receiptPath = path.join(root, 'receipt.json');
  const fixturePath = path.join(root, 'pdf-renderer-electron-fixture.js');
  const fixtureConfigPath = path.join(root, 'fixture-config.json');
  fs.copyFileSync(path.join(__dirname, 'pdf-renderer-electron-fixture.js'), fixturePath);
  const suppliedPayloadPath = process.env.MP_PDF_INTEGRATION_PAYLOAD;
  let expectedTaskCount = 333;
  if (suppliedPayloadPath) {
    const supplied = JSON.parse(fs.readFileSync(path.resolve(suppliedPayloadPath), 'utf8'));
    expectedTaskCount = supplied.days.reduce((sum, day) => sum + day.tasks.length, 0);
    fs.writeFileSync(payloadPath, JSON.stringify(supplied));
  } else {
  const dates = [
    '2032-04-21',
    '2032-04-22',
    '2032-04-23',
    '2032-04-24',
    '2032-04-25',
    '2032-04-26',
    '2032-04-27',
  ];
  const dayLabels = [
    'Wednesday, 21 April 2032',
    'Thursday, 22 April 2032',
    'Friday, 23 April 2032',
    'Saturday, 24 April 2032',
    'Sunday, 25 April 2032',
    'Monday, 26 April 2032',
    'Tuesday, 27 April 2032',
  ];
  const taskCounts = [18, 48, 57, 50, 60, 65, 35];
  let nextTaskId = 1;
  const days = dates.map((date, dayIndex) => ({
    date,
    dayLabel: dayLabels[dayIndex],
    tasks: Array.from({ length: taskCounts[dayIndex] }, (_, taskIndex) => {
      const id = nextTaskId++;
      const hour = 8 + (taskIndex % 10);
      return {
        id,
        name: id === 1
          ? 'Build the complete primary stage and verify every operational handover point'
          : id === 333
            ? 'Close the final operations desk'
            : `Operational handover task ${id} with a complete readable title`,
        date,
        start_end_time: {
          start: `${String(hour).padStart(2, '0')}:00`,
          end: `${String(hour + 1).padStart(2, '0')}:00`,
        },
        task_type_name: 'Stage operations',
        task_type_color: id % 2 === 0 ? '#2563eb' : '#7c3aed',
        location_name: `Operational location ${(taskIndex % 12) + 1}`,
        resource_info: `Stage leads: Alex Example, Sam Example | Team ${id}`,
        fields: {
          instructions: `Bring the equipment manifest for task ${id} and retain the signed handover sheet.`,
        },
        field_definitions: [
          { id: 'instructions', name: 'Operational instructions', type: 'text' },
        ],
      };
    }),
  }));
  fs.writeFileSync(payloadPath, JSON.stringify({
    title: 'Field Plan',
    eventId: 42,
    eventName: 'Synthetic Assembly',
    eventLocation: 'Test Hall',
    eventStartDate: '2032-04-21',
    eventEndDate: '2032-04-27',
    generatedAt: '2032-04-20T12:00:00.000Z',
    scheduleDayRange: { startHour: 8, endHour: 18 },
    scheduleDayBoundary: { offsetHour: 0 },
    days,
  }));
  }

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const electronPath = require('electron');
  fs.writeFileSync(fixtureConfigPath, JSON.stringify({
    payloadPath,
    outputDirectory,
    receiptPath,
    userDataPath: userData,
    preloadPath: path.join(__dirname, '..', 'preload.js'),
    pdfExportModulePath: path.join(__dirname, '..', 'pdf-export.js'),
    pdfExportServiceModulePath: path.join(__dirname, '..', 'pdf-export-service.js'),
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
    await waitForExit(fixture, [], 360000);
  } catch (error) {
    const debugPath = `${receiptPath}.log`;
    if (fs.existsSync(debugPath)) {
      throw new Error(`${error.message}\n${fs.readFileSync(debugPath, 'utf8')}`);
    }
    throw error;
  }

  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const pdf = fs.readFileSync(receipt.outputPath);
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(receipt.pageCount >= 3, 'dense details must continue onto another portrait page');
  assert.equal(receipt.dayCount, 7);
  assert.equal(receipt.taskCount, expectedTaskCount);
  const stages = new Set(receipt.progress.map((item) => item.stage || item.diagnostic?.stage));
  assert.ok(stages.has('rendering'));
  assert.ok(stages.has('details'));
  assert.ok(stages.has('merging'));
  assert.ok(stages.has('saving'));
  assert.ok(stages.has('complete'));
  assert.ok(receipt.progress.some((item) => item.diagnostic?.fontMode === 'embedded'));
  assert.ok(receipt.mediaBox, 'PDF MediaBox is required');
  assert.ok(receipt.mediaBox.height > receipt.mediaBox.width, 'PDF must be portrait');
  assert.equal(path.dirname(path.resolve(receipt.outputPath)), path.resolve(outputDirectory));
  if (process.env.MP_PDF_INTEGRATION_OUTPUT) {
    const retainedPath = path.resolve(process.env.MP_PDF_INTEGRATION_OUTPUT);
    fs.mkdirSync(path.dirname(retainedPath), { recursive: true });
    fs.copyFileSync(receipt.outputPath, retainedPath);
  }
});
