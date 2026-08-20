'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writePdfExportSettings } = require('../pdf-export');
const {
  createExcelExportManager,
  registerExcelExportIpc,
  safeJobStatus,
} = require('../excel-export-service');

function minimalPayload() {
  return {
    title: 'Plan',
    eventId: 1,
    eventName: 'Synthetic Event',
    eventStartDate: '2032-04-21',
    eventEndDate: '2032-04-21',
    people: [],
    days: [{ date: '2032-04-21', alias: 'Build', dayNumber: 1, tasks: [] }],
  };
}

async function waitForState(manager, jobId, ownerId, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = manager.status(jobId, ownerId);
    if (status.state === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Excel job did not reach ${expected}`);
}

test('safe status never exposes workbook payloads', () => {
  const status = safeJobStatus({
    id: '5fd0e75e-2877-4bc3-9109-5607a61ca4c1',
    state: 'running',
    stage: 'building',
    message: 'Building day 1 of 2',
    completed: 0,
    total: 2,
    dayCount: 2,
    taskCount: 40,
    startedAt: '2032-04-20T12:00:00Z',
    updatedAt: '2032-04-20T12:00:01Z',
    payload: { taskText: 'private task' },
  });
  assert.equal(status.message, 'Building day 1 of 2');
  assert.equal('payload' in status, false);
  assert.doesNotMatch(JSON.stringify(status), /private task/);
});

test('manager binds a successful export to its owner and selected folder', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-excel-manager-'));
  const output = path.join(root, 'output');
  fs.mkdirSync(output);
  writePdfExportSettings(root, output);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createExcelExportManager({
    getUserDataDirectory: () => root,
    buildWorkbook: async (_payload, options) => {
      options.onProgress({ stage: 'building', completed: 1, total: 1 });
      return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]);
    },
    writeWorkbook: (directory, _title, buffer) => {
      const target = path.join(directory, 'result.xlsx');
      fs.writeFileSync(target, buffer);
      return target;
    },
  });
  const started = manager.start(minimalPayload(), 41);
  const status = await waitForState(manager, started.jobId, 41, 'completed');
  assert.equal(status.result.fileName, 'result.xlsx');
  assert.throws(() => manager.status(started.jobId, 42), /unavailable/);
});

test('manager cancellation is durable and does not write output', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-excel-cancel-'));
  const output = path.join(root, 'output');
  fs.mkdirSync(output);
  writePdfExportSettings(root, output);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let release;
  const manager = createExcelExportManager({
    getUserDataDirectory: () => root,
    buildWorkbook: async (_payload, options) => {
      await new Promise((resolve) => { release = resolve; });
      if (options.isCancelled()) {
        const error = new Error('Excel export was cancelled.');
        error.code = 'EXCEL_EXPORT_CANCELLED';
        throw error;
      }
      return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]);
    },
  });
  const started = manager.start(minimalPayload(), 7);
  await new Promise((resolve) => setImmediate(resolve));
  manager.cancel(started.jobId, 7);
  release();
  const status = await waitForState(manager, started.jobId, 7, 'cancelled');
  assert.equal(status.result, undefined);
  assert.deepEqual(fs.readdirSync(output), []);
});

test('serialisation or atomic-write failures are safe and permit an immediate retry', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-excel-retry-'));
  const output = path.join(root, 'output');
  fs.mkdirSync(output);
  writePdfExportSettings(root, output);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let writeAttempts = 0;
  const manager = createExcelExportManager({
    getUserDataDirectory: () => root,
    buildWorkbook: async () => Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]),
    writeWorkbook: (directory, _title, buffer) => {
      writeAttempts += 1;
      if (writeAttempts === 1) throw new Error('synthetic write failure with private details');
      const target = path.join(directory, 'retry.xlsx');
      fs.writeFileSync(target, buffer);
      return target;
    },
  });

  const first = manager.start(minimalPayload(), 51);
  const failed = await waitForState(manager, first.jobId, 51, 'failed');
  assert.deepEqual(failed.error, {
    code: 'EXCEL_EXPORT_FAILED',
    message: 'The Excel workbook could not be created.',
  });
  assert.doesNotMatch(JSON.stringify(failed), /private details/);

  const second = manager.start(minimalPayload(), 51);
  const completed = await waitForState(manager, second.jobId, 51, 'completed');
  assert.equal(completed.result.fileName, 'retry.xlsx');
});

test('folder removal after a job starts fails before a workbook is written', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-excel-folder-'));
  const output = path.join(root, 'output');
  fs.mkdirSync(output);
  writePdfExportSettings(root, output);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let release;
  let writeCalled = false;
  const manager = createExcelExportManager({
    getUserDataDirectory: () => root,
    buildWorkbook: async () => {
      await new Promise((resolve) => { release = resolve; });
      return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]);
    },
    writeWorkbook: () => {
      writeCalled = true;
      throw new Error('must not write');
    },
  });
  const started = manager.start(minimalPayload(), 61);
  await new Promise((resolve) => setImmediate(resolve));
  fs.rmSync(output, { recursive: true, force: true });
  release();
  const failed = await waitForState(manager, started.jobId, 61, 'failed');
  assert.equal(failed.error.code, 'EXCEL_OUTPUT_UNAVAILABLE');
  assert.equal(writeCalled, false);
});

test('IPC uses the same owner for start, status, cancellation, and teardown', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const calls = [];
  const manager = {
    start: (payload, owner) => { calls.push(['start', payload, owner]); return { jobId: 'job' }; },
    status: (jobId, owner) => { calls.push(['status', jobId, owner]); return { state: 'running' }; },
    cancel: (jobId, owner) => { calls.push(['cancel', jobId, owner]); return { state: 'cancelled' }; },
    cancelOwner: (owner) => calls.push(['cancelOwner', owner]),
  };
  let destroyed;
  const event = { sender: { id: 41, once: (_name, callback) => { destroyed = callback; } } };
  const authorised = [];
  registerExcelExportIpc({ ipcMain, manager, authorise: (value) => authorised.push(value.sender.id) });
  await handlers.get('start-schedule-excel-export')(event, { title: 'Plan' });
  await handlers.get('get-schedule-excel-export-status')(event, 'job');
  await handlers.get('cancel-schedule-excel-export')(event, 'job');
  destroyed();
  assert.deepEqual(authorised, [41, 41, 41]);
  assert.deepEqual(calls.map((call) => call[0]), ['start', 'status', 'cancel', 'cancelOwner']);
});
