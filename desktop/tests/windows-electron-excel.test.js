'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const ExcelJS = require('exceljs');

function waitForExit(child, logs, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron Excel fixture did not exit')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron Excel fixture exited with ${code}: ${logs.join('').trim()}`));
    });
    child.once('error', reject);
  });
}

test('Electron exports a styled workbook through the production IPC bridge', {
  skip: process.platform !== 'win32' || process.env.MP_RUN_ELECTRON_EXCEL_INTEGRATION !== '1',
  timeout: 90_000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-electron-excel-'));
  const outputDirectory = path.join(root, 'selected-output');
  const userData = path.join(root, 'user-data');
  fs.mkdirSync(outputDirectory);
  fs.mkdirSync(userData);
  const payloadPath = path.join(root, 'payload.json');
  const receiptPath = path.join(root, 'receipt.json');
  const fixturePath = path.join(root, 'excel-export-electron-fixture.js');
  const fixtureConfigPath = path.join(root, 'fixture-config.json');
  fs.copyFileSync(path.join(__dirname, 'excel-export-electron-fixture.js'), fixturePath);
  fs.writeFileSync(payloadPath, JSON.stringify({
    title: 'Field Plan',
    eventId: 42,
    eventName: 'Synthetic Assembly',
    eventStartDate: '2032-04-21',
    eventEndDate: '2032-04-22',
    people: [
      { id: 1, displayName: 'Ada Lovelace' },
      { id: 2, displayName: 'Alan Turing' },
    ],
    days: [
      {
        date: '2032-04-21',
        alias: 'Build',
        dayNumber: 1,
        tasks: [{
          id: 1,
          title: 'Opening task',
          startMinutes: 540,
          endMinutes: 600,
          colour: '#2563EB',
          assignedSummary: 'Lead: Ada Lovelace',
          additionalInfo: 'Notes: Synthetic fixture',
          assignedPersonIds: [1],
          venue: { name: 'Test Hall', address: 'Test Street 1' },
        }],
      },
      {
        date: '2032-04-22',
        alias: 'Review',
        dayNumber: 2,
        tasks: [{
          id: 2,
          title: 'Closing task',
          startMinutes: 600,
          endMinutes: 660,
          colour: '#7C3AED',
          assignedSummary: 'Lead: Alan Turing',
          additionalInfo: '',
          assignedPersonIds: [2],
          venue: null,
        }],
      },
    ],
  }));

  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  fs.writeFileSync(fixtureConfigPath, JSON.stringify({
    payloadPath,
    receiptPath,
    outputDirectory,
    userDataPath: userData,
    preloadPath: path.join(__dirname, '..', 'preload.js'),
    pdfExportModulePath: path.join(__dirname, '..', 'pdf-export.js'),
    excelExportServiceModulePath: path.join(__dirname, '..', 'excel-export-service.js'),
  }));

  const electronPath = require('electron');
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnv } = process.env;
  const logs = [];
  const fixture = spawn(electronPath, [fixturePath, fixtureConfigPath], {
    env: electronEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  fixture.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  fixture.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  try {
    await waitForExit(fixture, logs);
  } catch (error) {
    const debugPath = `${receiptPath}.log`;
    if (fs.existsSync(debugPath)) {
      throw new Error(`${error.message}\n${fs.readFileSync(debugPath, 'utf8')}`);
    }
    throw error;
  }

  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.dayCount, 2);
  assert.equal(receipt.taskCount, 2);
  assert.equal(path.dirname(path.resolve(receipt.outputPath)), path.resolve(outputDirectory));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(receipt.outputPath);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Build (Day 1)', 'Review (Day 2)']);
  assert.equal(workbook.worksheets[0].getCell('G3').value, 'x');
  assert.equal(workbook.worksheets[1].getCell('H3').value, 'x');
  assert.ok(receipt.progress.some((entry) => entry.stage === 'complete'));
});
