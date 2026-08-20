'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { describePdfExportDirectory } = require('./pdf-export');
const {
  ExcelExportError,
  buildExcelWorkbookBuffer,
  validateExcelExportPayload,
  writeExcelBufferAtomically,
} = require('./excel-export');

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_RETENTION_MS = 10 * 60 * 1000;

function validateJobId(value) {
  if (typeof value !== 'string' || !JOB_ID_PATTERN.test(value)) {
    throw new Error('Invalid Excel export job.');
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
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function safeFailure(error) {
  if (error instanceof ExcelExportError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'EXCEL_EXPORT_FAILED', message: 'The Excel workbook could not be created.' };
}

function createExcelExportManager({
  getUserDataDirectory,
  logger = () => undefined,
  now = () => Date.now(),
  buildWorkbook = buildExcelWorkbookBuffer,
  writeWorkbook = writeExcelBufferAtomically,
}) {
  const jobs = new Map();
  const activeByOwner = new Map();
  let shuttingDown = false;

  const update = (job, values) => {
    Object.assign(job, values, { updatedAt: new Date(now()).toISOString() });
    logger({
      jobId: job.id,
      state: job.state,
      stage: job.stage,
      completed: job.completed,
      total: job.total,
      dayCount: job.dayCount,
      taskCount: job.taskCount,
    });
  };

  const assertOwner = (jobId, ownerId) => {
    const job = jobs.get(validateJobId(jobId));
    if (!job || job.ownerId !== ownerId) {
      throw new Error('Excel export job is unavailable for this window.');
    }
    return job;
  };

  const run = async (job) => {
    let workbook = null;
    try {
      update(job, {
        state: 'running',
        stage: 'preparing',
        message: 'Preparing Excel workbook',
        completed: 0,
        total: job.dayCount,
      });
      workbook = await buildWorkbook(job.payload, {
        validated: true,
        isCancelled: () => job.cancelled,
        onProgress: (progress) => {
          const building = progress.stage === 'building';
          update(job, {
            stage: progress.stage,
            message: building
              ? `Building day ${Math.min(progress.completed + 1, progress.total)} of ${progress.total}`
              : 'Serialising Excel workbook',
            completed: progress.completed,
            total: progress.total,
          });
        },
      });
      job.payload = null;
      if (job.cancelled) throw new ExcelExportError('EXCEL_EXPORT_CANCELLED', 'Excel export was cancelled.');
      const directory = describePdfExportDirectory(getUserDataDirectory());
      if (!directory.available || !directory.outputDirectory) {
        throw new ExcelExportError(
          'EXCEL_OUTPUT_UNAVAILABLE',
          'The selected local document output folder is no longer available.',
        );
      }
      update(job, { stage: 'saving', message: 'Saving Excel workbook', completed: 0, total: 1 });
      const outputPath = writeWorkbook(directory.outputDirectory, job.title, workbook);
      workbook.fill(0);
      workbook = null;
      update(job, {
        state: 'completed',
        stage: 'complete',
        message: 'Excel workbook saved',
        completed: 1,
        total: 1,
        result: { success: true, path: outputPath, fileName: path.basename(outputPath) },
      });
    } catch (error) {
      if (workbook) workbook.fill(0);
      workbook = null;
      if (job.cancelled || error?.code === 'EXCEL_EXPORT_CANCELLED') {
        update(job, {
          state: 'cancelled',
          stage: 'cancelled',
          message: 'Excel export cancelled',
          error: undefined,
        });
      } else {
        const failure = safeFailure(error);
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
        throw new Error('Choose an available local document output folder in Settings first.');
      }
      const validated = validateExcelExportPayload(payload);
      const job = {
        id: crypto.randomUUID(),
        ownerId,
        title: validated.title,
        payload: validated,
        state: 'queued',
        stage: 'queued',
        message: 'Preparing Excel workbook',
        completed: 0,
        total: validated.days.length,
        dayCount: validated.days.length,
        taskCount: validated.days.reduce((sum, day) => sum + day.tasks.length, 0),
        result: undefined,
        error: undefined,
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
      if (['completed', 'failed', 'cancelled'].includes(job.state)) return safeJobStatus(job);
      job.cancelled = true;
      update(job, { message: 'Cancelling Excel export' });
      return safeJobStatus(job);
    },

    cancelOwner(ownerId) {
      const jobId = activeByOwner.get(ownerId);
      if (!jobId) return;
      const job = jobs.get(jobId);
      if (job) job.cancelled = true;
    },

    shutdown() {
      shuttingDown = true;
      for (const job of jobs.values()) job.cancelled = true;
    },
  };
}

function registerExcelExportIpc({ ipcMain, manager, authorise }) {
  ipcMain.handle('start-schedule-excel-export', async (event, payload) => {
    authorise(event);
    const ownerId = event.sender.id;
    const started = manager.start(payload, ownerId);
    if (!started.reused) {
      event.sender.once('destroyed', () => manager.cancelOwner(ownerId));
    }
    return started;
  });
  ipcMain.handle('get-schedule-excel-export-status', async (event, jobId) => {
    authorise(event);
    return manager.status(jobId, event.sender.id);
  });
  ipcMain.handle('cancel-schedule-excel-export', async (event, jobId) => {
    authorise(event);
    return manager.cancel(jobId, event.sender.id);
  });
}

module.exports = {
  createExcelExportManager,
  registerExcelExportIpc,
  safeJobStatus,
  validateJobId,
};
