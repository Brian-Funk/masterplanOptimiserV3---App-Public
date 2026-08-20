const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { PDFDocument } = require('pdf-lib');

const {
  DOM_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  MERGE_WRITE_TIMEOUT_MS,
  PRINT_TIMEOUT_MS,
  PdfExportStageError,
  buildChunkPrintOptions,
  loadPdfAssets,
  mergePdfBuffers,
  registerPdfExportIpc,
  runPdfChunkWithRetry,
  safeJobStatus,
} = require('../pdf-export-service');

test('packaging includes the static renderer, merge library, logo, and local font', () => {
  const packageJson = require('../package.json');
  assert.ok(packageJson.build.files.includes('pdf-document.js'));
  assert.ok(packageJson.build.files.includes('pdf-export-service.js'));
  assert.equal(packageJson.dependencies['pdf-lib'], '^1.17.1');
  assert.ok(packageJson.build.extraResources.some((item) =>
    item.to === 'pdf-assets/source-sans-3-latin-400-normal.woff2'));
  const assets = loadPdfAssets({
    appDirectory: path.resolve(__dirname, '..'),
    resourcesDirectory: path.resolve(__dirname, 'missing-resources'),
    packaged: false,
  });
  assert.equal(assets.embeddedFontAvailable, true);
  assert.match(assets.fontDataUrl, /^data:font\/woff2;base64,/);
  assert.match(assets.logoDataUrl, /^data:image\/png;base64,/);
});

test('PDF rendering uses bounded stage deadlines and A4 chunk printing', () => {
  assert.equal(LOAD_TIMEOUT_MS, 20_000);
  assert.equal(DOM_TIMEOUT_MS, 20_000);
  assert.equal(PRINT_TIMEOUT_MS, 60_000);
  assert.equal(MERGE_WRITE_TIMEOUT_MS, 60_000);
  assert.deepEqual(buildChunkPrintOptions(), {
    landscape: false,
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
});

test('PDF chunks retry once in a clean renderer and then succeed', async () => {
  const attempts = [];
  const retries = [];
  const result = await runPdfChunkWithRetry(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt === 0) throw new Error('first renderer failed');
      return 'complete';
    },
    (attempt) => retries.push(attempt),
  );
  assert.equal(result, 'complete');
  assert.deepEqual(attempts, [0, 1]);
  assert.deepEqual(retries, [1]);
});

test('cancellation never retries a PDF chunk', async () => {
  const attempts = [];
  await assert.rejects(
    runPdfChunkWithRetry(async (attempt) => {
      attempts.push(attempt);
      throw new PdfExportStageError('PDF_EXPORT_CANCELLED', 'cancelled');
    }),
    /cancelled/,
  );
  assert.deepEqual(attempts, [0]);
});

test('safe job status excludes payloads and renderer state', () => {
  const status = safeJobStatus({
    id: '5fd0e75e-2877-4bc3-9109-5607a61ca4c1',
    state: 'running',
    stage: 'rendering',
    message: 'Rendering day 1 of 2',
    completed: 0,
    total: 2,
    dayCount: 2,
    taskCount: 40,
    retry: 0,
    startedAt: '2032-04-20T12:00:00Z',
    updatedAt: '2032-04-20T12:00:01Z',
    payload: { taskText: 'private task' },
    activeWindow: { secret: true },
  });
  assert.equal(status.message, 'Rendering day 1 of 2');
  assert.equal('payload' in status, false);
  assert.equal('activeWindow' in status, false);
  assert.doesNotMatch(JSON.stringify(status), /private task/);
});

test('IPC registration delegates start, status, and cancellation to the same manager', async () => {
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
  const event = {
    sender: {
      id: 41,
      once: (name, callback) => { if (name === 'destroyed') destroyed = callback; },
    },
  };
  const authorised = [];
  registerPdfExportIpc({ ipcMain, manager, authorise: (value) => authorised.push(value.sender.id) });
  assert.deepEqual(await handlers.get('start-schedule-pdf-export')(event, { title: 'Plan' }), { jobId: 'job' });
  assert.deepEqual(await handlers.get('get-schedule-pdf-export-status')(event, 'job'), { state: 'running' });
  assert.deepEqual(await handlers.get('cancel-schedule-pdf-export')(event, 'job'), { state: 'cancelled' });
  destroyed();
  assert.deepEqual(authorised, [41, 41, 41]);
  assert.deepEqual(calls.map((call) => call[0]), ['start', 'status', 'cancel', 'cancelOwner']);
});

test('merged PDF preserves chronological buffer order and adds global pages', async () => {
  const first = await PDFDocument.create();
  first.addPage([595.28, 841.89]);
  const second = await PDFDocument.create();
  second.addPage([595.28, 841.89]);
  second.addPage([595.28, 841.89]);
  const merged = await mergePdfBuffers([
    Buffer.from(await first.save()),
    Buffer.from(await second.save()),
  ]);
  assert.equal(merged.subarray(0, 5).toString('ascii'), '%PDF-');
  const loaded = await PDFDocument.load(merged);
  assert.equal(loaded.getPageCount(), 3);
  assert.ok(loaded.getPages().every((page) => page.getHeight() > page.getWidth()));
});
