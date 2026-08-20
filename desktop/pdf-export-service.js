const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const {
  describePdfExportDirectory,
  validatePdfExportPayload,
  withPdfTimeout,
  writePdfBufferAtomically,
} = require('./pdf-export');
const { buildPdfChunkHtml, buildPdfChunks } = require('./pdf-document');

const PDF_PROTOCOL = 'mpopt-pdf';
const LOAD_TIMEOUT_MS = 20_000;
const DOM_TIMEOUT_MS = 20_000;
const PRINT_TIMEOUT_MS = 60_000;
const MERGE_WRITE_TIMEOUT_MS = 60_000;
const JOB_RETENTION_MS = 15 * 60_000;
const MAX_CHUNK_RETRIES = 1;

class PdfExportStageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PdfExportStageError';
    this.code = code;
  }
}

function dataUrl(mimeType, value) {
  return value ? `data:${mimeType};base64,${value.toString('base64')}` : '';
}

function readOptionalFile(candidate) {
  try {
    return fs.readFileSync(candidate);
  } catch {
    return null;
  }
}

function loadPdfAssets({ appDirectory, resourcesDirectory, packaged }) {
  const logo = readOptionalFile(path.join(appDirectory, 'assets', 'icon.png'));
  const developmentFont = path.join(
    appDirectory,
    '..',
    'web',
    'node_modules',
    '@fontsource',
    'source-sans-3',
    'files',
    'source-sans-3-latin-400-normal.woff2',
  );
  const packagedFont = path.join(
    resourcesDirectory,
    'pdf-assets',
    'source-sans-3-latin-400-normal.woff2',
  );
  const font = readOptionalFile(packaged ? packagedFont : developmentFont);
  return {
    logoDataUrl: dataUrl('image/png', logo),
    fontDataUrl: dataUrl('font/woff2', font),
    embeddedFontAvailable: Boolean(font),
  };
}

function buildChunkPrintOptions() {
  return {
    landscape: false,
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

function validateJobId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error('Invalid PDF export job.');
  }
  return value;
}

function safeJobStatus(job) {
  return {
    jobId: job.id,
    state: job.state,
    stage: job.stage,
    message: job.message,
    completed: job.completed,
    total: job.total,
    dayCount: job.dayCount,
    taskCount: job.taskCount,
    retry: job.retry,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    result: job.state === 'completed' ? job.result : undefined,
    error: job.state === 'failed' ? job.error : undefined,
  };
}

function safeFailure(error, stage) {
  if (error instanceof PdfExportStageError) {
    return { code: error.code, message: error.message };
  }
  if (stage === 'saving') {
    return { code: 'PDF_SAVE_FAILED', message: 'The completed PDF could not be saved to the selected folder.' };
  }
  if (stage === 'merging') {
    return { code: 'PDF_MERGE_FAILED', message: 'The rendered PDF pages could not be combined.' };
  }
  return { code: 'PDF_EXPORT_FAILED', message: 'The PDF export could not be completed.' };
}

function classifyRendererConsoleMessage(message) {
  const value = typeof message === 'string' ? message : '';
  if (/content security policy/i.test(value)) return 'csp';
  if (/font|woff/i.test(value)) return 'font';
  if (/image|png/i.test(value)) return 'image';
  if (/failed to load|net::/i.test(value)) return 'load';
  return 'other';
}

function registerPdfProtocolScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PDF_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: false,
        stream: true,
      },
    },
  ]);
}

async function waitForFontOrFallback(webContents, embeddedFontAvailable) {
  if (!embeddedFontAvailable) return 'system-fallback';
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = await webContents.executeJavaScript('document.fonts.status', true);
    if (status === 'loaded') return 'embedded';
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return 'system-fallback';
}

async function validateRenderedChunk(webContents, expected, embeddedFontAvailable) {
  const fontMode = await waitForFontOrFallback(webContents, embeddedFontAvailable);
  const result = await webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-pdf-root]');
    const timeline = document.querySelector('[data-pdf-timeline]');
    return {
      root: Boolean(root),
      details: document.querySelectorAll('[data-pdf-task-reference]').length,
      timelineTasks: document.querySelectorAll('[data-pdf-timeline-task]').length,
      width: root ? root.getBoundingClientRect().width : 0,
      height: root ? root.getBoundingClientRect().height : 0,
      timelineWidth: timeline ? timeline.getBoundingClientRect().width : 0,
      timelineHeight: timeline ? timeline.getBoundingClientRect().height : 0
    };
  })()`, true);
  if (!result.root || result.details !== expected.details) {
    throw new PdfExportStageError(
      'PDF_DOM_COUNT_MISMATCH',
      `PDF layout validation failed for task details (${result.details}/${expected.details}).`,
    );
  }
  if (result.timelineTasks !== expected.timelineTasks) {
    throw new PdfExportStageError(
      'PDF_TIMELINE_COUNT_MISMATCH',
      `PDF layout validation failed for timeline tasks (${result.timelineTasks}/${expected.timelineTasks}).`,
    );
  }
  if (result.width < 100 || result.height < 20) {
    throw new PdfExportStageError('PDF_DOM_DIMENSIONS_INVALID', 'The PDF document has no measurable layout.');
  }
  if (expected.timelineTasks > 0 && (result.timelineWidth < 100 || result.timelineHeight < 20)) {
    throw new PdfExportStageError('PDF_TIMELINE_DIMENSIONS_INVALID', 'The PDF timeline has no measurable layout.');
  }
  return { ...result, fontMode };
}

async function mergePdfBuffers(buffers) {
  const merged = await PDFDocument.create();
  for (const buffer of buffers) {
    const source = await PDFDocument.load(buffer, { updateMetadata: false });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const pages = merged.getPages();
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const { width } = page.getSize();
    const label = `${index + 1} / ${pages.length}`;
    page.drawText('MP-OPT Optimised Schedule', {
      x: 28,
      y: 15,
      size: 7.5,
      font,
      color: rgb(0.42, 0.45, 0.5),
    });
    page.drawText(label, {
      x: width - 28 - font.widthOfTextAtSize(label, 7.5),
      y: 15,
      size: 7.5,
      font,
      color: rgb(0.42, 0.45, 0.5),
    });
  }
  return Buffer.from(await merged.save({ useObjectStreams: true }));
}

async function runPdfChunkWithRetry(operation, onRetry = () => undefined) {
  let finalError = null;
  for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      finalError = error;
      if (error?.code === 'PDF_EXPORT_CANCELLED' || attempt >= MAX_CHUNK_RETRIES) break;
      onRetry(attempt + 1, error);
    }
  }
  throw finalError;
}

function createPdfExportManager({
  BrowserWindow,
  electronSession,
  getUserDataDirectory,
  appDirectory,
  resourcesDirectory,
  packaged,
  logger = () => undefined,
  now = () => Date.now(),
}) {
  const jobs = new Map();
  const activeByOwner = new Map();
  const assets = loadPdfAssets({ appDirectory, resourcesDirectory, packaged });
  let shuttingDown = false;

  const update = (job, values) => {
    Object.assign(job, values, { updatedAt: new Date(now()).toISOString() });
    logger({
      jobId: job.id,
      state: job.state,
      stage: job.stage,
      completed: job.completed,
      total: job.total,
      retry: job.retry,
      dayCount: job.dayCount,
      taskCount: job.taskCount,
    });
  };

  const assertOwner = (jobId, ownerId) => {
    const job = jobs.get(validateJobId(jobId));
    if (!job || job.ownerId !== ownerId) throw new Error('PDF export job is unavailable for this window.');
    return job;
  };

  const renderChunk = async (job, metadata, chunk, attempt) => {
    if (job.cancelled) throw new PdfExportStageError('PDF_EXPORT_CANCELLED', 'PDF export was cancelled.');
    const partition = `mpopt-pdf:${job.id}-${chunk.sequence}-${attempt}-${crypto.randomUUID()}`;
    const isolatedSession = electronSession.fromPartition(partition, { cache: false });
    const token = crypto.randomBytes(24).toString('hex');
    const expectedPath = `/render/${job.id}/${chunk.sequence}`;
    let html = buildPdfChunkHtml(metadata, chunk, assets);
    let fatalError = null;
    let consoleFailures = 0;
    const window = new BrowserWindow({
      width: 794,
      height: 1123,
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    job.activeWindow = window;
    const targetUrl = `${PDF_PROTOCOL}://render${expectedPath}?token=${token}`;
    await isolatedSession.protocol.handle(PDF_PROTOCOL, (request) => {
      const requested = new URL(request.url);
      if (requested.pathname !== expectedPath || requested.searchParams.get('token') !== token) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        },
      });
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, navigationUrl) => {
      if (navigationUrl !== targetUrl) event.preventDefault();
    });
    window.webContents.on('console-message', (_event, level, message) => {
      if (Number(level) < 3) return;
      consoleFailures += 1;
      logger({
        jobId: job.id,
        stage: 'renderer-console',
        consoleCode: classifyRendererConsoleMessage(message),
        consoleLevel: Number(level),
      });
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      fatalError = new PdfExportStageError(
        'PDF_RENDERER_TERMINATED',
        `The PDF renderer stopped unexpectedly (${details.reason}).`,
      );
    });
    window.on('unresponsive', () => {
      fatalError = new PdfExportStageError('PDF_RENDERER_UNRESPONSIVE', 'The PDF renderer became unresponsive.');
    });
    try {
      await withPdfTimeout(
        window.loadURL(targetUrl),
        LOAD_TIMEOUT_MS,
        'The PDF document did not load within 20 seconds.',
      );
      html = '';
      if (fatalError) throw fatalError;
      const validation = await withPdfTimeout(
        validateRenderedChunk(
          window.webContents,
          {
            details: chunk.details.length,
            timelineTasks: chunk.includeTimeline ? chunk.day.tasks.length : 0,
          },
          assets.embeddedFontAvailable,
        ),
        DOM_TIMEOUT_MS,
        'The PDF document did not validate within 20 seconds.',
      );
      if (fatalError) throw fatalError;
      if (consoleFailures > 0) {
        throw new PdfExportStageError('PDF_RENDERER_CONSOLE_FAILURE', 'The PDF renderer reported a document error.');
      }
      const pdf = await withPdfTimeout(
        window.webContents.printToPDF(buildChunkPrintOptions()),
        PRINT_TIMEOUT_MS,
        'Chromium did not finish this PDF section within 60 seconds.',
      );
      if (fatalError) throw fatalError;
      if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new PdfExportStageError('PDF_CHUNK_INVALID', 'Chromium returned an invalid PDF section.');
      }
      logger({
        jobId: job.id,
        stage: 'chunk-complete',
        sequence: chunk.sequence,
        retry: attempt,
        pageBytes: pdf.length,
        fontMode: validation.fontMode,
      });
      return pdf;
    } catch (error) {
      if (error instanceof PdfExportStageError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/load/i.test(message)) {
        throw new PdfExportStageError('PDF_LOAD_TIMEOUT', 'The PDF document did not load within 20 seconds.');
      }
      if (/validate/i.test(message)) {
        throw new PdfExportStageError('PDF_DOM_TIMEOUT', 'The PDF document did not validate within 20 seconds.');
      }
      if (/60 seconds/i.test(message)) {
        throw new PdfExportStageError('PDF_PRINT_TIMEOUT', 'Chromium did not finish this PDF section within 60 seconds.');
      }
      throw new PdfExportStageError('PDF_CHUNK_FAILED', 'A PDF section could not be rendered.');
    } finally {
      html = '';
      job.activeWindow = null;
      try {
        isolatedSession.protocol.unhandle(PDF_PROTOCOL);
      } catch {
        // A renderer crash may already have removed the isolated protocol handler.
      }
      if (!window.isDestroyed()) window.destroy();
      try {
        await isolatedSession.clearStorageData();
        await isolatedSession.clearCache();
      } catch {
        // The partition is non-persistent; explicit cleanup is best-effort only.
      }
    }
  };

  const run = async (job) => {
    let buffers = [];
    try {
      const document = buildPdfChunks(job.payload);
      job.payload = null;
      const totalChunks = document.chunks.length;
      update(job, {
        state: 'running',
        stage: 'preparing',
        message: 'Preparing task details',
        completed: 0,
        total: totalChunks,
      });
      for (let index = 0; index < totalChunks; index += 1) {
        const chunk = document.chunks[index];
        if (job.cancelled) throw new PdfExportStageError('PDF_EXPORT_CANCELLED', 'PDF export was cancelled.');
        const message = chunk.includeTimeline
          ? `Rendering day ${chunk.dayIndex + 1} of ${chunk.dayCount}`
          : `Preparing task details for day ${chunk.dayIndex + 1} of ${chunk.dayCount}`;
        update(job, {
          stage: chunk.includeTimeline ? 'rendering' : 'details',
          message,
          completed: index,
          total: totalChunks,
          retry: 0,
        });
        const rendered = await runPdfChunkWithRetry(
          async (attempt) => {
            update(job, { retry: attempt });
            if (job.cancelled) {
              throw new PdfExportStageError('PDF_EXPORT_CANCELLED', 'PDF export was cancelled.');
            }
            return renderChunk(job, document.metadata, chunk, attempt);
          },
          (attempt) => {
            if (job.cancelled) return;
            logger({ jobId: job.id, stage: 'chunk-retry', sequence: chunk.sequence, retry: attempt });
          },
        );
        buffers.push(rendered);
        update(job, { completed: index + 1, total: totalChunks });
      }
      update(job, { stage: 'merging', message: 'Merging pages', completed: 0, total: 1, retry: 0 });
      const merged = await withPdfTimeout(
        mergePdfBuffers(buffers),
        MERGE_WRITE_TIMEOUT_MS,
        'The rendered pages could not be merged within 60 seconds.',
      );
      buffers = [];
      if (job.cancelled) throw new PdfExportStageError('PDF_EXPORT_CANCELLED', 'PDF export was cancelled.');
      update(job, { stage: 'saving', message: 'Saving PDF', completed: 0, total: 1 });
      const directory = describePdfExportDirectory(getUserDataDirectory());
      if (!directory.available || !directory.outputDirectory) {
        throw new PdfExportStageError('PDF_OUTPUT_UNAVAILABLE', 'The selected PDF output folder is no longer available.');
      }
      const outputPath = await withPdfTimeout(
        Promise.resolve().then(() => writePdfBufferAtomically(
          directory.outputDirectory,
          document.metadata.title,
          merged,
        )),
        MERGE_WRITE_TIMEOUT_MS,
        'The completed PDF could not be saved within 60 seconds.',
      );
      merged.fill(0);
      update(job, {
        state: 'completed',
        stage: 'complete',
        message: 'PDF saved',
        completed: 1,
        total: 1,
        result: { success: true, path: outputPath, fileName: path.basename(outputPath) },
      });
    } catch (error) {
      buffers = [];
      if (job.cancelled || error?.code === 'PDF_EXPORT_CANCELLED') {
        update(job, {
          state: 'cancelled',
          stage: 'cancelled',
          message: 'PDF export cancelled',
          error: undefined,
        });
      } else {
        const failure = safeFailure(error, job.stage);
        update(job, {
          state: 'failed',
          stage: 'failed',
          message: failure.message,
          error: failure,
        });
      }
    } finally {
      activeByOwner.delete(job.ownerId);
      job.payload = null;
      job.activeWindow = null;
      const timer = setTimeout(() => jobs.delete(job.id), JOB_RETENTION_MS);
      timer.unref?.();
    }
  };

  return {
    start(payload, ownerId) {
      if (shuttingDown) throw new Error('The application is shutting down.');
      const activeId = activeByOwner.get(ownerId);
      if (activeId) {
        const active = jobs.get(activeId);
        if (active && (active.state === 'queued' || active.state === 'running')) {
          return { jobId: active.id, reused: true };
        }
      }
      const directory = describePdfExportDirectory(getUserDataDirectory());
      if (!directory.available || !directory.outputDirectory) {
        throw new Error('Choose an available PDF output folder in Settings first.');
      }
      const validated = validatePdfExportPayload(payload);
      const job = {
        id: crypto.randomUUID(),
        ownerId,
        payload: validated,
        state: 'queued',
        stage: 'queued',
        message: 'Preparing PDF export',
        completed: 0,
        total: validated.days.length,
        dayCount: validated.days.length,
        taskCount: validated.days.reduce((sum, day) => sum + day.tasks.length, 0),
        retry: 0,
        result: undefined,
        error: undefined,
        activeWindow: null,
        cancelled: false,
        startedAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
      };
      jobs.set(job.id, job);
      activeByOwner.set(ownerId, job.id);
      setImmediate(() => void run(job));
      return { jobId: job.id, reused: false };
    },

    status(jobId, ownerId) {
      return safeJobStatus(assertOwner(jobId, ownerId));
    },

    cancel(jobId, ownerId) {
      const job = assertOwner(jobId, ownerId);
      if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') {
        return safeJobStatus(job);
      }
      job.cancelled = true;
      if (job.activeWindow && !job.activeWindow.isDestroyed()) job.activeWindow.destroy();
      update(job, { message: 'Cancelling PDF export' });
      return safeJobStatus(job);
    },

    cancelOwner(ownerId) {
      const jobId = activeByOwner.get(ownerId);
      if (!jobId) return;
      const job = jobs.get(jobId);
      if (!job) return;
      job.cancelled = true;
      if (job.activeWindow && !job.activeWindow.isDestroyed()) job.activeWindow.destroy();
    },

    shutdown() {
      shuttingDown = true;
      for (const job of jobs.values()) {
        job.cancelled = true;
        if (job.activeWindow && !job.activeWindow.isDestroyed()) job.activeWindow.destroy();
      }
    },
  };
}

function registerPdfExportIpc({ ipcMain, manager, authorise }) {
  ipcMain.handle('start-schedule-pdf-export', async (event, payload) => {
    authorise(event);
    const ownerId = event.sender.id;
    const started = manager.start(payload, ownerId);
    event.sender.once('destroyed', () => manager.cancelOwner(ownerId));
    return started;
  });
  ipcMain.handle('get-schedule-pdf-export-status', async (event, jobId) => {
    authorise(event);
    return manager.status(jobId, event.sender.id);
  });
  ipcMain.handle('cancel-schedule-pdf-export', async (event, jobId) => {
    authorise(event);
    return manager.cancel(jobId, event.sender.id);
  });
}

module.exports = {
  DOM_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  MAX_CHUNK_RETRIES,
  MERGE_WRITE_TIMEOUT_MS,
  PDF_PROTOCOL,
  PRINT_TIMEOUT_MS,
  PdfExportStageError,
  buildChunkPrintOptions,
  classifyRendererConsoleMessage,
  createPdfExportManager,
  loadPdfAssets,
  mergePdfBuffers,
  registerPdfExportIpc,
  registerPdfProtocolScheme,
  runPdfChunkWithRetry,
  safeJobStatus,
  validateRenderedChunk,
};
