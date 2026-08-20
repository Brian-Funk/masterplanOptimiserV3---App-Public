/**
 * Electron Main Process
 * Launches backend and Next.js frontend locally.
 * In production, backend is bundled as a standalone executable (PyInstaller).
 * The compute/optimiser runs as a mounted sub-app inside the backend.
 * The local backend is protected by a per-session token.
 */

// Load .env from the desktop directory (must be before anything reads process.env)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { app, BrowserWindow, nativeImage, ipcMain, dialog, session, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Child services inherit this on POSIX, so new database material defaults to owner-only access.
process.umask(0o077);
const {
  buildStartupSteps,
  describeIntegrityResult,
  renderStartupPageHtml,
} = require('./startup-screen');
const { buildDesktopContentSecurityPolicy } = require('./security-policy');
const { verifySignedManifest } = require('./integrity');
const { createOwnedProcessRegistry } = require('./process-ownership');
const { resolveDesktopRuntimeConfig } = require('./runtime-config');
const { buildSmokeReceipt, shouldCreateRendererWindow } = require('./smoke-mode');
const {
  buildDesktopBackendEnv,
  prepareBackendEnvironmentFile,
  prepareDesktopUserData,
} = require('./user-data-paths');
const {
  PDF_ABSOLUTE_RENDER_TIMEOUT_MS,
  PDF_PRINT_TIMEOUT_MS,
  buildPdfPrintOptions,
  clearPdfExportSettings,
  createPdfProgressWatchdog,
  describePdfProgress,
  describePdfExportDirectory,
  pdfProgressIdleTimeout,
  validatePdfExportPayload,
  validatePdfProgress,
  withPdfTimeout,
  writePdfBufferAtomically,
  writePdfExportSettings,
} = require('./pdf-export');

const appVersion = require('./package.json').version;
const smokeTestMode = process.env.MP_DESKTOP_SMOKE_TEST === '1';
if (smokeTestMode) {
  const smokeUserData = process.env.MP_DESKTOP_SMOKE_USER_DATA;
  if (!smokeUserData || !path.isAbsolute(smokeUserData)) {
    throw new Error('MP_DESKTOP_SMOKE_USER_DATA must be an absolute path in smoke-test mode');
  }
  app.setPath('userData', smokeUserData);
}

let mainWindow;
let backendProcess;
let frontendProcess;
let startupStepOverrides = {};
let desktopDataPaths;
const fullscreenEventWindows = new WeakSet();
const ownedProcesses = createOwnedProcessRegistry();
const pdfExportJobs = new Map();

const diagnosticLogs = { main: [], backend: [], frontend: [], renderer: [] };
const MAX_LOG_LINES = 1000;
const LOG_DUMP_EXPLANATION =
  'A log dump is a text file containing recent diagnostic messages from the desktop shell, local backend, web interface, and browser error handler. Forward it to the developer so they can analyse what happened and fix the problem.';
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// Determine if running in development or production
const isDev = !app.isPackaged;

// Paths for services
const backendPath = isDev
  ? path.join(__dirname, '../backend')
  : path.join(process.resourcesPath, 'backend');

const frontendPath = isDev
  ? path.join(__dirname, '../web')
  : path.join(process.resourcesPath, 'frontend');

// Accept only explicit loopback origins and normalise them to 127.0.0.1.
const runtimeConfig = resolveDesktopRuntimeConfig(process.env);
const {
  backendUrl: BACKEND_URL,
  frontendUrl: FRONTEND_URL,
  backendPort: BACKEND_PORT,
  frontendPort: FRONTEND_PORT,
  backendOrigins: BACKEND_ORIGINS,
  frontendOrigins: FRONTEND_ORIGINS,
} = runtimeConfig;
process.env.MP_DESKTOP_RENDERER_API_URL = BACKEND_URL;
const GOOGLE_OAUTH_ORIGINS = new Set([
  'https://accounts.google.com',
  'https://oauth2.googleapis.com',
  'https://www.googleapis.com',
]);
const EXTERNAL_OPEN_ORIGINS = new Set(['https://console.cloud.google.com']);

// Per-session auth token for localhost API - prevents other processes from accessing the backend
const DESKTOP_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');

const serviceStartBlocked = { backend: false, frontend: false };
const gotSingleInstanceLock = app.requestSingleInstanceLock();

function stringifyLogValue(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendDiagnosticLog(section, level, value) {
  const log = diagnosticLogs[section];
  if (!log) return;

  const text = Array.isArray(value)
    ? value.map((item) => stringifyLogValue(item)).join(' ')
    : stringifyLogValue(value);
  const timestamp = new Date().toISOString();
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);

  for (const line of lines.length ? lines : ['']) {
    log.push(`[${timestamp}] [${level.toUpperCase()}] ${line}`);
  }
  while (log.length > MAX_LOG_LINES) log.shift();
}

function updateStartupStep(id, state, detail) {
  startupStepOverrides = {
    ...startupStepOverrides,
    [id]: { state, detail },
  };
}

function captureConsole(level, args) {
  appendDiagnosticLog('main', level, args);
  originalConsole[level](...args);
}

console.log = (...args) => captureConsole('log', args);
console.warn = (...args) => captureConsole('warn', args);
console.error = (...args) => captureConsole('error', args);

function getDesktopDataPaths() {
  if (!desktopDataPaths) {
    desktopDataPaths = prepareDesktopUserData({
      userDataDir: app.getPath('userData'),
      logger: console,
    });
  }
  return desktopDataPaths;
}

function buildBackendEnv() {
  return buildDesktopBackendEnv(
    process.env,
    getDesktopDataPaths(),
    DESKTOP_AUTH_TOKEN,
    runtimeConfig,
  );
}

function getOrigin(rawUrl) {
  try {
    const parsed = rawUrl.startsWith('/')
      ? new URL(rawUrl, FRONTEND_URL)
      : new URL(rawUrl);
    return parsed.origin;
  } catch {
    return null;
  }
}

function isLocalAppUrl(rawUrl) {
  const origin = getOrigin(rawUrl);
  return Boolean(origin && (BACKEND_ORIGINS.has(origin) || FRONTEND_ORIGINS.has(origin)));
}

function isAllowedNavigationUrl(rawUrl) {
  if (rawUrl.startsWith('data:text/html')) return true;
  const origin = getOrigin(rawUrl);
  return Boolean(origin && (
    BACKEND_ORIGINS.has(origin) ||
    FRONTEND_ORIGINS.has(origin) ||
    GOOGLE_OAUTH_ORIGINS.has(origin)
  ));
}

function isAllowedPopupUrl(rawUrl) {
  const origin = getOrigin(rawUrl);
  return Boolean(origin && (
    BACKEND_ORIGINS.has(origin) ||
    FRONTEND_ORIGINS.has(origin) ||
    GOOGLE_OAUTH_ORIGINS.has(origin)
  ));
}

function isAllowedExternalOpenUrl(rawUrl) {
  const origin = getOrigin(rawUrl);
  return Boolean(origin && EXTERNAL_OPEN_ORIGINS.has(origin));
}

function assertTrustedIpcSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (!isLocalAppUrl(senderUrl)) {
    throw new Error(`Blocked IPC call from untrusted sender: ${senderUrl || 'unknown'}`);
  }
}

function getTrustedSenderWindow(event) {
  assertTrustedIpcSender(event);
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow.isDestroyed()) {
    throw new Error('No active window for IPC sender');
  }
  return senderWindow;
}

function wireFullscreenEvents(windowToWire) {
  if (!windowToWire || windowToWire.isDestroyed() || fullscreenEventWindows.has(windowToWire)) {
    return;
  }
  fullscreenEventWindows.add(windowToWire);
  const sendState = () => {
    if (!windowToWire.isDestroyed()) {
      windowToWire.webContents.send('window-fullscreen-changed', windowToWire.isFullScreen());
    }
  };
  windowToWire.on('enter-full-screen', sendState);
  windowToWire.on('leave-full-screen', sendState);
}

function isTrustedDiagnosticSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  return isLocalAppUrl(senderUrl) || senderUrl.startsWith('data:text/html');
}

function assertTrustedDiagnosticIpcSender(event) {
  if (!isTrustedDiagnosticSender(event)) {
    const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
    throw new Error(`Blocked diagnostic IPC call from untrusted sender: ${senderUrl || 'unknown'}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatIntegritySummary() {
  if (!lastIntegrityResult) return 'Not checked yet';
  if (lastIntegrityResult.dev) return 'Development mode - integrity check skipped';
  if (lastIntegrityResult.valid) return 'Valid';
  return `Invalid: ${lastIntegrityResult.error || 'unknown integrity error'}`;
}

function buildLogDump(payload = {}) {
  const generatedAt = new Date().toISOString();
  const reason = typeof payload.reason === 'string' && payload.reason.trim()
    ? payload.reason.trim()
    : 'Manual diagnostic log dump';
  const detail = typeof payload.detail === 'string' && payload.detail.trim()
    ? payload.detail.trim()
    : '';

  const lines = [
    'Masterplan Optimiser Log Dump',
    `Generated: ${generatedAt}`,
    `Reason: ${reason}`,
  ];

  if (detail) lines.push(`Detail: ${detail}`);

  lines.push(
    '',
    LOG_DUMP_EXPLANATION,
    '',
    'Environment',
    `App version: ${appVersion}`,
    `Electron: ${process.versions.electron}`,
    `Node: ${process.versions.node}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Packaged: ${app.isPackaged ? 'yes' : 'no'}`,
    `Backend URL: ${BACKEND_URL}`,
    `Frontend URL: ${FRONTEND_URL}`,
    `Backend blocked: ${serviceStartBlocked.backend ? 'yes' : 'no'}`,
    `Frontend blocked: ${serviceStartBlocked.frontend ? 'yes' : 'no'}`,
    `Integrity: ${formatIntegritySummary()}`,
  );

  for (const [section, entries] of Object.entries(diagnosticLogs)) {
    lines.push('', `${section.toUpperCase()} LOGS`);
    if (entries.length) {
      lines.push(...entries);
    } else {
      lines.push('No log entries recorded.');
    }
  }

  return `${lines.join('\n')}\n`;
}

function defaultLogDumpPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(app.getPath('downloads'), `masterplan-optimiser-log-${timestamp}.txt`);
}

async function saveLogDump(payload = {}) {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Log Dump',
    defaultPath: defaultLogDumpPath(),
    filters: [{ name: 'Text files', extensions: ['txt'] }],
  });

  if (result.canceled || !result.filePath) {
    return { success: false, cancelled: true };
  }

  fs.writeFileSync(result.filePath, buildLogDump(payload), 'utf-8');
  appendDiagnosticLog('main', 'log', `Log dump saved to ${result.filePath}`);
  return { success: true, path: result.filePath };
}

function recordRendererDiagnostic(payload = {}) {
  const source = typeof payload.source === 'string' && payload.source.trim()
    ? payload.source.trim()
    : 'renderer';
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : 'Renderer diagnostic event';
  const stack = typeof payload.stack === 'string' && payload.stack.trim()
    ? `\n${payload.stack.trim()}`
    : '';
  const extra = typeof payload.extra === 'string' && payload.extra.trim()
    ? `\n${payload.extra.trim()}`
    : '';

  appendDiagnosticLog('renderer', 'error', `${source}: ${message}${stack}${extra}`);
}

function markPdfJobFailed(jobId, error) {
  const job = pdfExportJobs.get(jobId);
  if (!job || job.renderReady || job.renderError) return;
  job.renderError = error instanceof Error ? error : new Error(String(error));
  if (job.readyReject) {
    job.readyReject(job.renderError);
    job.readyReject = null;
  }
}

function updatePdfJobProgress(jobId, stage, completed, total) {
  const job = pdfExportJobs.get(jobId);
  if (!job) throw new Error('PDF export job is unavailable.');
  const progress = validatePdfProgress(stage, completed, total);
  job.lastProgress = progress;
  if (job.progressListener) job.progressListener();
  appendDiagnosticLog(
    'main',
    'log',
    `Hidden PDF renderer progress: ${describePdfProgress(progress)}.`,
  );
  return progress;
}

function describePdfWorkload(job) {
  return `${job.dayCount} day${job.dayCount === 1 ? '' : 's'}, ${job.taskCount} task${job.taskCount === 1 ? '' : 's'}`;
}

function describePdfIdleDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
}

function waitForPdfDocument(jobId) {
  const job = pdfExportJobs.get(jobId);
  if (!job) return Promise.reject(new Error('PDF export job is unavailable.'));
  if (job.renderReady) return Promise.resolve();
  if (job.renderError) return Promise.reject(job.renderError);
  return new Promise((resolve, reject) => {
    let settled = false;
    let watchdog;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      watchdog.stop();
      job.progressListener = null;
      job.cancelWait = null;
      job.readyResolve = null;
      job.readyReject = null;
      callback(value);
    };
    const stage = () => describePdfProgress(job.lastProgress);
    const idleTimeout = () => pdfProgressIdleTimeout(job.lastProgress);
    watchdog = createPdfProgressWatchdog({
      onIdle: () => finish(
        reject,
        new Error(
          `The PDF renderer made no validated progress for ${describePdfIdleDuration(idleTimeout())} during ${stage()} (${describePdfWorkload(job)}).`,
        ),
      ),
      onAbsolute: () => finish(
        reject,
        new Error(`The PDF renderer exceeded five minutes during ${stage()} (${describePdfWorkload(job)}).`),
      ),
      idleTimeoutMs: idleTimeout(),
    });
    job.progressListener = () => watchdog.progress(idleTimeout());
    job.readyResolve = () => finish(resolve);
    job.readyReject = (error) => finish(reject, error);
    job.cancelWait = () => {
      finish(reject, new Error('The PDF renderer was closed before completion.'));
    };
  });
}

async function exportSchedulePdf(payload) {
  const directory = describePdfExportDirectory(getDesktopDataPaths().userDataDir);
  if (!directory.available || !directory.outputDirectory) {
    throw new Error('Choose an available PDF output folder in Settings first.');
  }
  const validated = validatePdfExportPayload(payload);
  const jobId = crypto.randomUUID();
  const pdfWindow = new BrowserWindow({
    width: 1400,
    height: 990,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const totalDays = validated.days.length;
  const totalTasks = validated.days.reduce((sum, day) => sum + day.tasks.length, 0);
  const job = {
    payload: validated,
    webContentsId: pdfWindow.webContents.id,
    readyResolve: null,
    readyReject: null,
    renderReady: false,
    renderError: null,
    progressListener: null,
    cancelWait: null,
    lastProgress: validatePdfProgress('loading', 0, totalDays),
    rendererConsoleErrors: 0,
    dayCount: totalDays,
    taskCount: totalTasks,
  };
  pdfExportJobs.set(jobId, job);
  const printUrl = `${FRONTEND_URL}/pdf-export?job=${encodeURIComponent(jobId)}`;
  pdfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pdfWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== printUrl) event.preventDefault();
  });
  pdfWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (isMainFrame !== false) {
        markPdfJobFailed(
          jobId,
          new Error(`The PDF renderer could not load (${errorCode}: ${errorDescription}).`),
        );
      }
    },
  );
  pdfWindow.webContents.on('render-process-gone', (_event, details) => {
    markPdfJobFailed(
      jobId,
      new Error(`The PDF renderer stopped unexpectedly (${details.reason}).`),
    );
  });
  pdfWindow.webContents.on('console-message', (_event, level) => {
    if (Number(level) < 3) return;
    job.rendererConsoleErrors += 1;
    appendDiagnosticLog(
      'main',
      'warn',
      `Hidden PDF renderer reported a console failure during ${describePdfProgress(job.lastProgress)}.`,
    );
  });
  pdfWindow.on('unresponsive', () => {
    appendDiagnosticLog(
      'main',
      'warn',
      `The hidden PDF renderer is unresponsive during ${describePdfProgress(job.lastProgress)}.`,
    );
  });
  pdfWindow.on('closed', () => {
    if (!job.renderReady && !job.renderError) {
      markPdfJobFailed(jobId, new Error('The PDF renderer closed unexpectedly.'));
    }
  });

  try {
    const readiness = waitForPdfDocument(jobId);
    try {
      await Promise.all([
        withPdfTimeout(
          pdfWindow.loadURL(printUrl),
          PDF_ABSOLUTE_RENDER_TIMEOUT_MS,
          'The PDF renderer exceeded five minutes while loading.',
        ),
        readiness,
      ]);
    } catch (error) {
      markPdfJobFailed(jobId, error);
      throw error;
    }
    if (job.rendererConsoleErrors > 0) {
      throw new Error(
        `The PDF renderer reported an error during ${describePdfProgress(job.lastProgress)}.`,
      );
    }
    updatePdfJobProgress(jobId, 'printing', 0, 1);
    const pdf = await withPdfTimeout(
      pdfWindow.webContents.printToPDF(buildPdfPrintOptions()),
      PDF_PRINT_TIMEOUT_MS,
      'Chromium did not finish printing the PDF within five minutes.',
    );
    updatePdfJobProgress(jobId, 'printing', 1, 1);
    const outputPath = writePdfBufferAtomically(
      directory.outputDirectory,
      validated.title,
      pdf,
    );
    return { success: true, path: outputPath, fileName: path.basename(outputPath) };
  } finally {
    if (job.cancelWait) job.cancelWait();
    pdfExportJobs.delete(jobId);
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
  }
}

function handleMainProcessFailure(label, error) {
  appendDiagnosticLog('main', 'error', `${label}: ${stringifyLogValue(error)}`);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      loadApplicationErrorPage(label, error);
    }
  } catch (displayError) {
    originalConsole.error('Could not display application error page:', displayError);
  }
}

function failPackagedSmoke(detail) {
  if (!smokeTestMode) return false;

  console.error(`Packaged smoke test failed: ${detail}`);
  ownedProcesses.terminateAll();
  app.exit(1);
  return true;
}

process.on('uncaughtException', (error) => {
  if (!failPackagedSmoke(`Main process uncaught exception: ${stringifyLogValue(error)}`)) {
    handleMainProcessFailure('Main process uncaught exception', error);
  }
});

process.on('unhandledRejection', (reason) => {
  if (!failPackagedSmoke(`Main process unhandled rejection: ${stringifyLogValue(reason)}`)) {
    handleMainProcessFailure('Main process unhandled rejection', reason);
  }
});

// ---------------------------------------------------------------------------
// Integrity verification (Ed25519 signed hash manifest)
// ---------------------------------------------------------------------------

let lastIntegrityResult = null;

/**
 * Verify the signed hash manifest against the actual resource files.
 * Returns { valid, signatureOk, files: [{ path, status }] }.
 * In dev mode, returns a neutral result without checking.
 */
function verifyIntegrity() {
  if (isDev) {
    lastIntegrityResult = { valid: true, signatureOk: false, dev: true, files: [] };
    return lastIntegrityResult;
  }

  lastIntegrityResult = verifySignedManifest({
    resourcesDir: process.resourcesPath,
    manifestPath: path.join(process.resourcesPath, 'manifest.signed.json'),
    publicKeyPath: path.join(process.resourcesPath, 'app.asar', 'assets', 'manifest-public.pem'),
  });
  return lastIntegrityResult;
}

/**
 * Poll a URL until it responds (or timeout).
 * Returns true if the service is reachable, false on timeout.
 */
function waitForService(url, label, timeoutMs = 60000, logKey = null) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (logKey && serviceStartBlocked[logKey]) {
        clearInterval(interval);
        resolve(false);
        return;
      }

      try {
        const http = require('http');
        await new Promise((res, rej) => {
          const req = http.get(url, { timeout: 2000 }, (resp) => {
            resp.resume();          // drain the response
            res();
          });
          req.on('error', rej);
          req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
        });
        clearInterval(interval);
        console.log(`${label} is ready (${Date.now() - start}ms)`);
        resolve(true);
      } catch {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          console.error(`${label} did not start within ${timeoutMs}ms`);
          resolve(false);
        }
      }
    }, 500);
  });
}

/**
 * Return listener diagnostics for a port without terminating unrelated processes.
 */
function findProcessesOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        `netstat -ano | findstr ":${port} " | findstr "LISTENING"`,
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      );
      return output.trim().split('\n').map((line) => line.trim()).filter(Boolean);
    } else {
      const output = execSync(
        `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return output.trim().split('\n').slice(1).map((line) => line.trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
}

function ensurePortAvailable(port, label, logKey) {
  const listeners = findProcessesOnPort(port);
  if (listeners.length === 0) return true;

  const message = `${label} port ${port} is already in use. Close the process using this port, then restart the app.`;
  console.error(message);
  console.error(listeners.join('\n'));
  appendDiagnosticLog(logKey, 'error', `${message}\n${listeners.join('\n')}`);
  serviceStartBlocked[logKey] = true;
  return false;
}

function recordServiceSpawnFailure(logKey, label, error) {
  const message = `Failed to start ${label}: ${error.message}`;
  console.error(message);
  appendDiagnosticLog(logKey, 'error', `SPAWN ERROR: ${error.message}`);
  serviceStartBlocked[logKey] = true;
  return false;
}

/**
 * Kill a spawned process and its entire process tree.
 * On Windows, process.kill() only terminates the immediate process,
 * leaving child processes (e.g. uvicorn workers) as orphans.
 */
function startBackend() {
  console.log('Starting backend...');
  if (!ensurePortAvailable(BACKEND_PORT, 'Backend API', 'backend')) {
    return false;
  }

  prepareBackendEnvironmentFile({ backendPath, isDev, logger: console });

  if (isDev) {
    // Development: use Python from virtual environment
    const pythonCmd = path.join(__dirname, '../backend/venv/Scripts/python.exe');

    if (!fs.existsSync(pythonCmd)) {
      console.error('ERROR: Python virtual environment not found at:', pythonCmd);
      console.error('Please run rebuild-desktop.bat first to set up dependencies.');
      appendDiagnosticLog('backend', 'error', `Python virtual environment not found: ${pythonCmd}`);
      serviceStartBlocked.backend = true;
      return false;
    }

    // No shell: true - spawn python.exe directly so kill() works on the actual process
    try {
      backendProcess = spawn(pythonCmd, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)], {
        cwd: backendPath,
        env: buildBackendEnv(),
        windowsHide: true,
      });
    } catch (error) {
      return recordServiceSpawnFailure('backend', 'backend', error);
    }
  } else {
    // Production: use PyInstaller-bundled executable
    const exeName = process.platform === 'win32' ? 'backend.exe' : 'backend';
    const backendExe = path.join(backendPath, exeName);

    console.log('Starting backend from:', backendExe);

    if (!fs.existsSync(backendExe)) {
      console.error('ERROR: Backend executable not found at:', backendExe);
      appendDiagnosticLog('backend', 'error', `Backend executable not found: ${backendExe}`);
      serviceStartBlocked.backend = true;
      return false;
    }

    // Ensure execute permission on macOS/Linux (electron-builder may strip it from extraResources)
    if (process.platform !== 'win32') {
      try { fs.chmodSync(backendExe, 0o755); } catch (e) {
        console.warn('Could not chmod backend executable:', e.message);
      }
    }

    try {
      backendProcess = spawn(backendExe, [], {
        cwd: backendPath,
        env: buildBackendEnv(),
        windowsHide: true,
      });
    } catch (error) {
      return recordServiceSpawnFailure('backend', 'backend', error);
    }
  }

  ownedProcesses.register('backend', backendProcess);
  backendProcess.stdout.on('data', (data) => {
    appendDiagnosticLog('backend', 'log', data);
    console.log(`Backend: ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    appendDiagnosticLog('backend', 'error', data);
    console.error(`Backend: ${data.toString().trim()}`);
  });

  backendProcess.on('error', (error) => {
    console.error(`Failed to start backend: ${error}`);
    appendDiagnosticLog('backend', 'error', `SPAWN ERROR: ${error.message}`);
  });

  backendProcess.on('exit', (code, signal) => {
    if (code === 0 || code === null) return;
    const message = `Backend exited early with code ${code}${signal ? ` (${signal})` : ''}`;
    console.error(message);
    appendDiagnosticLog('backend', 'error', message);
    serviceStartBlocked.backend = true;
  });
  return true;
}

function startFrontend() {
  console.log('Starting frontend...');
  if (!ensurePortAvailable(FRONTEND_PORT, 'Frontend', 'frontend')) {
    return false;
  }

  if (isDev) {
    const command = process.platform === 'win32'
      ? (process.env.ComSpec || 'cmd.exe')
      : 'npm';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm.cmd run dev']
      : ['run', 'dev'];
    try {
      frontendProcess = spawn(command, args, {
        cwd: frontendPath,
        env: {
          ...process.env,
          PORT: String(FRONTEND_PORT),
          HOSTNAME: '127.0.0.1',
          NEXT_PUBLIC_API_URL: BACKEND_URL,
        },
        windowsHide: true,
      });
    } catch (error) {
      return recordServiceSpawnFailure('frontend', 'frontend', error);
    }
  } else {
    // Production: run Next.js standalone server.js with the bundled Node.js
    // ELECTRON_RUN_AS_NODE makes the Electron binary behave like plain node
    const serverJs = path.join(frontendPath, 'server.js');
    console.log('Starting frontend from:', serverJs);
    if (!fs.existsSync(serverJs)) {
      console.error('ERROR: Frontend server not found at:', serverJs);
      appendDiagnosticLog('frontend', 'error', `Frontend server not found: ${serverJs}`);
      serviceStartBlocked.frontend = true;
      return false;
    }
    try {
      frontendProcess = spawn(process.execPath, [serverJs], {
        cwd: frontendPath,
        env: {
          ...process.env,
          PORT: String(FRONTEND_PORT),
          HOSTNAME: '127.0.0.1',
          NEXT_PUBLIC_API_URL: BACKEND_URL,
          ELECTRON_RUN_AS_NODE: '1',
        },
        windowsHide: true,
      });
    } catch (error) {
      return recordServiceSpawnFailure('frontend', 'frontend', error);
    }
  }

  ownedProcesses.register('frontend', frontendProcess);
  frontendProcess.stdout.on('data', (data) => {
    appendDiagnosticLog('frontend', 'log', data);
    console.log(`Frontend: ${data.toString().trim()}`);
  });

  frontendProcess.stderr.on('data', (data) => {
    appendDiagnosticLog('frontend', 'error', data);
    console.error(`Frontend: ${data.toString().trim()}`);
  });

  frontendProcess.on('error', (error) => {
    console.error(`Failed to start frontend: ${error}`);
    appendDiagnosticLog('frontend', 'error', `SPAWN ERROR: ${error.message}`);
  });

  frontendProcess.on('exit', (code, signal) => {
    if (code === 0 || code === null) return;
    const message = `Frontend exited early with code ${code}${signal ? ` (${signal})` : ''}`;
    console.error(message);
    appendDiagnosticLog('frontend', 'error', message);
    serviceStartBlocked.frontend = true;
  });
  return true;
}

// Resolve the bundled app icon. Old user-customised icon files in userData are ignored.
function getIconPath() {
  return path.join(__dirname, 'assets', 'icon.png');
}

function loadStartupPage(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();

  const html = renderStartupPageHtml({
    status,
    steps: buildStartupSteps(startupStepOverrides),
  });

  return mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((err) => {
    console.warn('Could not load startup page:', err.message);
  });
}

function loadServiceFailurePage(failed) {
  const logSections = [];
  if (failed.some((name) => name.includes('Backend')) && diagnosticLogs.backend.length) {
    logSections.push('<h3>Backend</h3><pre>' + escapeHtml(diagnosticLogs.backend.slice(-80).join('\n')) + '</pre>');
  }
  if (failed.some((name) => name.includes('Frontend')) && diagnosticLogs.frontend.length) {
    logSections.push('<h3>Frontend</h3><pre>' + escapeHtml(diagnosticLogs.frontend.slice(-80).join('\n')) + '</pre>');
  }
  const logsHtml = logSections.length
    ? '<div class="logs"><h2>Diagnostics</h2>' + logSections.join('') + '</div>'
    : '';
  const failedText = failed.join(', ');

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head><style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { text-align: center; max-width: 680px; padding: 40px; }
      h1 { font-size: 1.5rem; margin-bottom: 16px; color: #f87171; }
      p { line-height: 1.6; color: #94a3b8; }
      code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 0.9rem; }
      .hint { margin-top: 24px; font-size: 0.85rem; color: #64748b; }
      .explain { margin: 24px auto 0; max-width: 560px; font-size: 0.9rem; color: #cbd5e1; }
      .actions { display: flex; justify-content: center; gap: 12px; margin-top: 22px; flex-wrap: wrap; }
      button { border: 0; border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer; background: #38bdf8; color: #082f49; }
      button.secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      .status { min-height: 20px; margin-top: 12px; color: #cbd5e1; font-size: 0.85rem; }
      .logs { margin-top: 32px; text-align: left; }
      .logs h2 { font-size: 1rem; color: #94a3b8; margin-bottom: 12px; }
      .logs h3 { font-size: 0.85rem; color: #64748b; margin: 12px 0 4px; }
      .logs pre { background: #1e293b; padding: 12px; border-radius: 8px; font-size: 0.75rem; overflow-x: auto; max-height: 200px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; color: #f87171; }
    </style></head>
    <body><div class="card">
      <h1>Failed to Start</h1>
      <p>The following services are unavailable:</p>
      <p><strong>${escapeHtml(failed.join(', '))}</strong></p>
      <p class="hint">If a port is already in use, close the listed process and restart the app.</p>
      <p class="explain">${escapeHtml(LOG_DUMP_EXPLANATION)}</p>
      <div class="actions">
        <button id="download-log">Download Log Dump</button>
      </div>
      <p id="download-status" class="status"></p>
      ${logsHtml}
    </div>
    <script>
      const button = document.getElementById('download-log');
      const status = document.getElementById('download-status');
      button?.addEventListener('click', async () => {
        if (!window.electron?.saveLogDump) {
          status.textContent = 'Log dumps are only available in the desktop app.';
          return;
        }
        button.disabled = true;
        status.textContent = 'Preparing log dump...';
        try {
          const result = await window.electron.saveLogDump({
            reason: 'Service startup failure',
            detail: ${JSON.stringify(failedText)}
          });
          if (result?.cancelled) {
            status.textContent = 'Log dump save cancelled.';
          } else if (result?.success) {
            status.textContent = 'Log dump saved.';
          } else {
            status.textContent = result?.error || 'Could not save the log dump.';
          }
        } catch (error) {
          status.textContent = error?.message || 'Could not save the log dump.';
        } finally {
          button.disabled = false;
        }
      });
    </script></body></html>
  `)}`);
}

function loadApplicationErrorPage(title, error) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const detail = stringifyLogValue(error);
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head><style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { text-align: center; max-width: 720px; padding: 40px; }
      h1 { font-size: 1.5rem; margin-bottom: 16px; color: #f87171; }
      p { line-height: 1.6; color: #94a3b8; }
      .explain { margin: 24px auto 0; max-width: 560px; font-size: 0.9rem; color: #cbd5e1; }
      .actions { display: flex; justify-content: center; gap: 12px; margin-top: 22px; flex-wrap: wrap; }
      button { border: 0; border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer; background: #38bdf8; color: #082f49; }
      button.secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      .status { min-height: 20px; margin-top: 12px; color: #cbd5e1; font-size: 0.85rem; }
      pre { margin-top: 24px; text-align: left; background: #1e293b; padding: 12px; border-radius: 8px; font-size: 0.75rem; overflow-x: auto; max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; color: #f87171; }
    </style></head>
    <body><div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>The desktop application hit an unexpected error.</p>
      <p class="explain">${escapeHtml(LOG_DUMP_EXPLANATION)}</p>
      <div class="actions">
        <button id="download-log">Download Log Dump</button>
        <button id="reload-app" class="secondary">Reload App</button>
      </div>
      <p id="download-status" class="status"></p>
      <pre>${escapeHtml(detail)}</pre>
    </div>
    <script>
      const button = document.getElementById('download-log');
      const reloadButton = document.getElementById('reload-app');
      const status = document.getElementById('download-status');
      reloadButton?.addEventListener('click', () => {
        window.location.href = ${JSON.stringify(FRONTEND_URL)};
      });
      button?.addEventListener('click', async () => {
        if (!window.electron?.saveLogDump) {
          status.textContent = 'Log dumps are only available in the desktop app.';
          return;
        }
        button.disabled = true;
        status.textContent = 'Preparing log dump...';
        try {
          const result = await window.electron.saveLogDump({
            reason: ${JSON.stringify(title)},
            detail: ${JSON.stringify(detail)}
          });
          if (result?.cancelled) {
            status.textContent = 'Log dump save cancelled.';
          } else if (result?.success) {
            status.textContent = 'Log dump saved.';
          } else {
            status.textContent = result?.error || 'Could not save the log dump.';
          }
        } catch (error) {
          status.textContent = error?.message || 'Could not save the log dump.';
        } finally {
          button.disabled = false;
        }
      });
    </script></body></html>
  `)}`);
}

async function createWindow() {
  startupStepOverrides = {};
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    title: `Masterplan Optimiser v${appVersion}`,
    show: false,
    focusable: true,
  });
  wireFullscreenEvents(mainWindow);

  // Show window when ready to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const message = `Renderer process stopped unexpectedly: ${details.reason} (${details.exitCode})`;
    appendDiagnosticLog('renderer', 'error', message);
    loadApplicationErrorPage('Web Interface Error', message);
  });

  mainWindow.webContents.on('unresponsive', () => {
    appendDiagnosticLog('renderer', 'warn', 'Renderer became unresponsive');
  });

  await loadStartupPage('Preparing startup checks...');
}

async function loadFrontendWhenReady() {
  // Wait for local services to start before loading
  console.log('Waiting for local services to start...');
  updateStartupStep('backend', 'checking', 'Waiting for backend health check');
  updateStartupStep('interface', 'checking', 'Waiting for web interface');
  await loadStartupPage('Waiting for local services to become available...');

  if (serviceStartBlocked.backend || serviceStartBlocked.frontend) {
    const failed = [];
    if (serviceStartBlocked.backend) {
      failed.push(`Backend API (port ${BACKEND_PORT})`);
      updateStartupStep('backend', 'failed', 'Backend API did not start');
    }
    if (serviceStartBlocked.frontend) {
      failed.push(`Frontend (port ${FRONTEND_PORT})`);
      updateStartupStep('interface', 'failed', 'Web interface did not start');
    }
    await loadStartupPage('Local services could not start.');
    if (failPackagedSmoke(`Local services could not start: ${failed.join(', ')}`)) return;
    loadServiceFailurePage(failed);
    return;
  }

  const [backendOk, frontendOk] = await Promise.all([
    waitForService(`${BACKEND_URL}/health`, 'Backend', 60000, 'backend'),
    waitForService(FRONTEND_URL, 'Frontend', 60000, 'frontend'),
  ]);

  if (!backendOk || !frontendOk) {
    const failed = [];
    if (!backendOk) {
      failed.push(`Backend API (port ${BACKEND_PORT})`);
      updateStartupStep('backend', 'failed', 'Backend API did not respond');
    } else {
      updateStartupStep('backend', 'complete', 'Backend API ready');
    }
    if (!frontendOk) {
      failed.push(`Frontend (port ${FRONTEND_PORT})`);
      updateStartupStep('interface', 'failed', 'Web interface did not respond');
    } else {
      updateStartupStep('interface', 'complete', 'Web interface ready');
    }
    console.error('Services failed to start:', failed.join(', '));
    await loadStartupPage('Local services could not start.');
    if (failPackagedSmoke(`Local services did not become healthy: ${failed.join(', ')}`)) return;
    loadServiceFailurePage(failed);
    return;
  }

  updateStartupStep('backend', 'complete', 'Backend API ready');
  updateStartupStep('interface', 'complete', 'Web interface ready');
  await loadStartupPage('Local services ready. Opening the interface...');

  if (smokeTestMode) {
    const dataPaths = getDesktopDataPaths();
    const receiptPath = path.join(dataPaths.userDataDir, 'desktop-smoke-receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify(buildSmokeReceipt({
      version: appVersion,
      backendUrl: BACKEND_URL,
      frontendUrl: FRONTEND_URL,
      databaseExists: fs.existsSync(dataPaths.databasePath),
      integrityValid: Boolean(lastIntegrityResult?.valid),
    }), null, 2), 'utf8');
    console.log(`Packaged smoke test completed: ${receiptPath}`);
    app.quit();
    return;
  }

  console.log(`Loading frontend at ${FRONTEND_URL}`);
  await mainWindow.loadURL(FRONTEND_URL);

  // Ensure the window and webContents are focused for input to work
  mainWindow.focus();
  mainWindow.webContents.focus();

  // Focus again when the page loads
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.focus();
    mainWindow.webContents.focus();
  });

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

}

// ---------------------------------------------------------------------------
// IPC: Integrity verification (on-demand from renderer)
// ---------------------------------------------------------------------------

ipcMain.handle('check-integrity', async (event) => {
  assertTrustedIpcSender(event);
  return verifyIntegrity();
});

// ---------------------------------------------------------------------------
// IPC: Native BrowserWindow fullscreen controls
// ---------------------------------------------------------------------------

ipcMain.handle('set-window-fullscreen', async (event, fullscreen) => {
  const senderWindow = getTrustedSenderWindow(event);
  wireFullscreenEvents(senderWindow);
  senderWindow.setFullScreen(Boolean(fullscreen));
  return { success: true, isFullscreen: senderWindow.isFullScreen() };
});

ipcMain.handle('get-window-fullscreen-state', async (event) => {
  const senderWindow = getTrustedSenderWindow(event);
  wireFullscreenEvents(senderWindow);
  return { success: true, isFullscreen: senderWindow.isFullScreen() };
});

// ---------------------------------------------------------------------------
// IPC: Diagnostics and log dumps
// ---------------------------------------------------------------------------

ipcMain.handle('record-renderer-error', async (event, payload) => {
  assertTrustedDiagnosticIpcSender(event);
  try {
    recordRendererDiagnostic(payload);
    return { success: true };
  } catch (error) {
    console.error('Failed to record renderer diagnostic:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-log-dump', async (event, payload) => {
  assertTrustedDiagnosticIpcSender(event);
  try {
    return await saveLogDump(payload);
  } catch (error) {
    console.error('Failed to save log dump:', error);
    return { success: false, error: error.message };
  }
});

// ---------------------------------------------------------------------------
// IPC: local PDF publishing
// ---------------------------------------------------------------------------

ipcMain.handle('get-pdf-export-directory', async (event) => {
  assertTrustedIpcSender(event);
  return describePdfExportDirectory(getDesktopDataPaths().userDataDir);
});

ipcMain.handle('choose-pdf-export-directory', async (event) => {
  const senderWindow = getTrustedSenderWindow(event);
  const result = await dialog.showOpenDialog(senderWindow, {
    title: 'Choose PDF Export Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length !== 1) {
    return { cancelled: true, ...describePdfExportDirectory(getDesktopDataPaths().userDataDir) };
  }
  const outputDirectory = writePdfExportSettings(
    getDesktopDataPaths().userDataDir,
    result.filePaths[0],
  );
  return { cancelled: false, outputDirectory, available: true };
});

ipcMain.handle('clear-pdf-export-directory', async (event) => {
  assertTrustedIpcSender(event);
  clearPdfExportSettings(getDesktopDataPaths().userDataDir);
  return { outputDirectory: null, available: false };
});

ipcMain.handle('get-pdf-export-job', async (event, jobId) => {
  assertTrustedIpcSender(event);
  const job = typeof jobId === 'string' ? pdfExportJobs.get(jobId) : null;
  if (!job || job.webContentsId !== event.sender.id) {
    throw new Error('PDF export job is unavailable for this window.');
  }
  return job.payload;
});

ipcMain.handle('notify-pdf-export-ready', async (event, jobId) => {
  assertTrustedIpcSender(event);
  const job = typeof jobId === 'string' ? pdfExportJobs.get(jobId) : null;
  if (!job || job.webContentsId !== event.sender.id) {
    throw new Error('PDF export readiness signal is invalid.');
  }
  job.renderReady = true;
  if (job.readyResolve) {
    job.readyResolve();
    job.readyResolve = null;
  }
  return { success: true };
});

ipcMain.handle(
  'notify-pdf-export-progress',
  async (event, jobId, stage, completed, total) => {
    assertTrustedIpcSender(event);
    const job = typeof jobId === 'string' ? pdfExportJobs.get(jobId) : null;
    if (!job || job.webContentsId !== event.sender.id) {
      throw new Error('PDF export progress signal is invalid.');
    }
    return updatePdfJobProgress(jobId, stage, completed, total);
  },
);

ipcMain.handle('notify-pdf-export-failed', async (event, jobId, code) => {
  assertTrustedIpcSender(event);
  const job = typeof jobId === 'string' ? pdfExportJobs.get(jobId) : null;
  if (!job || job.webContentsId !== event.sender.id) {
    throw new Error('PDF export failure signal is invalid.');
  }
  const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code
    : 'PDF_RENDER_FAILED';
  markPdfJobFailed(jobId, new Error(`The PDF document could not be rendered (${safeCode}).`));
  return { success: true };
});

ipcMain.handle('export-schedule-pdf', async (event, payload) => {
  assertTrustedIpcSender(event);
  return exportSchedulePdf(payload);
});

function configureSessionSecurity() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'fullscreen' && isLocalAppUrl(webContents.getURL())) {
      callback(true);
      return;
    }
    console.warn(`Denied permission request: ${permission}`);
    callback(false);
  });

  if (typeof session.defaultSession.setPermissionCheckHandler === 'function') {
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      return permission === 'fullscreen' && isLocalAppUrl(webContents.getURL());
    });
  }

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: runtimeConfig.backendUrlPatterns },
    (details, callback) => {
      details.requestHeaders['X-Desktop-Token'] = DESKTOP_AUTH_TOKEN;
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  if (!isDev) {
    const csp = buildDesktopContentSecurityPolicy([...BACKEND_ORIGINS]);

    session.defaultSession.webRequest.onHeadersReceived(
      { urls: runtimeConfig.frontendUrlPatterns },
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [csp],
          },
        });
      },
    );
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      if (!isAllowedNavigationUrl(navigationUrl)) {
        console.warn(`Blocked navigation to ${navigationUrl}`);
        event.preventDefault();
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedPopupUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              preload: path.join(__dirname, 'preload.js'),
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }

      if (isAllowedExternalOpenUrl(url)) {
        shell.openExternal(url).catch((err) => {
          console.warn(`Failed to open external URL ${url}: ${err.message}`);
        });
        return { action: 'deny' };
      }

      console.warn(`Blocked popup to ${url}`);
      return { action: 'deny' };
    });

    contents.on('did-create-window', (childWindow) => {
      wireFullscreenEvents(childWindow);
    });
  });
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    console.log('Electron app ready');
    console.log(`Development mode: ${isDev}`);
    console.log(`Backend URL: ${BACKEND_URL}`);
    console.log(`Frontend URL: ${FRONTEND_URL}`);

    // Clear Chromium HTTP / code cache so the app always loads fresh frontend content
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({});
      console.log('Cleared Electron cache');
    } catch (e) {
      console.warn('Cache clear failed (non-critical):', e.message);
    }

    configureSessionSecurity();

    if (shouldCreateRendererWindow(smokeTestMode)) {
      await createWindow();
    } else {
      console.log('Packaged smoke mode: running without a renderer window');
    }

    updateStartupStep('integrity', 'checking', 'Checking application integrity');
    await loadStartupPage('Checking application integrity...');

    // Verify integrity of bundled resources before launching services.
    const integrityStartedAt = Date.now();
    console.log('Verifying packaged resource integrity...');
    const integrity = verifyIntegrity();
    const integrityDescription = describeIntegrityResult(integrity);
    updateStartupStep('integrity', integrityDescription.state, integrityDescription.detail);

    if (!integrity.valid && !integrity.dev) {
      const modified = integrity.files
        .filter((f) => f.status !== 'ok')
        .map((f) => `  ${f.path}: ${f.status}`)
        .join('\n');
      const detailParts = [];
      if (integrity.error) detailParts.push(integrity.error);
      if (modified) {
        detailParts.push(`The following files have been modified or are missing:\n${modified}`);
      }
      if (detailParts.length === 0) {
        detailParts.push('All files are intact but the manifest signature could not be verified.');
      }
      const detail = detailParts.join('\n');
      await loadStartupPage('Integrity check failed.');
      if (failPackagedSmoke(`Integrity check failed: ${detail}`)) return;
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Integrity Check Failed',
        message: 'Application integrity check failed.',
        detail,
        buttons: ['Quit'],
        defaultId: 0,
        cancelId: 0,
      });
      app.quit();
      return;
    } else {
      console.log(`Packaged resource integrity verified in ${Date.now() - integrityStartedAt}ms`);
      await loadStartupPage(integrityDescription.status);
    }

    updateStartupStep('backend', 'checking', 'Starting backend API');
    await loadStartupPage('Starting backend API...');
    startBackend();
    updateStartupStep('backend', 'checking', 'Backend process started');
    updateStartupStep('interface', 'checking', 'Starting web interface');
    await loadStartupPage('Starting web interface...');
    startFrontend();

    await loadFrontendWhenReady();

    app.on('activate', () => {
      if (smokeTestMode) return;
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().then(() => loadFrontendWhenReady());
      }
    });
  });
}

app.on('window-all-closed', () => {
  console.log('Shutting down services...');

  ownedProcesses.terminateAll();
  console.log('Owned local services stopped');

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  ownedProcesses.terminateAll();
});

app.on('child-process-gone', (_event, details) => {
  appendDiagnosticLog(
    'main',
    'error',
    `Electron child process stopped unexpectedly: ${details.type} ${details.reason} (${details.exitCode})`,
  );
});
