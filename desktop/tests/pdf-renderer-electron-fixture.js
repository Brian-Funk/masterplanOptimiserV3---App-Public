const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const {
  payloadPath,
  receiptPath,
  outputDirectory,
  userDataPath,
  preloadPath,
  pdfExportModulePath,
  pdfExportServiceModulePath,
} = config;
const { writePdfExportSettings } = require(pdfExportModulePath);
const {
  createPdfExportManager,
  registerPdfExportIpc,
  registerPdfProtocolScheme,
} = require(pdfExportServiceModulePath);
const { PDFDocument } = require(path.join(
  path.dirname(pdfExportServiceModulePath),
  'node_modules',
  'pdf-lib',
));

const debugPath = `${receiptPath}.log`;
const debug = (message) => fs.appendFileSync(debugPath, `${new Date().toISOString()} ${message}\n`);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const safeProgress = [];

registerPdfProtocolScheme(protocol);
app.setPath('userData', userDataPath);
// CI and restricted desktop runners may not expose a usable GPU process.
// PDF rendering is intentionally deterministic and does not require hardware
// acceleration, so keep this production-handler fixture on Chromium's software path.
app.disableHardwareAcceleration();

process.on('uncaughtException', (error) => {
  debug(`uncaught: ${error.stack || error}`);
  app.exit(1);
});
process.on('unhandledRejection', (error) => {
  debug(`unhandled: ${error?.stack || error}`);
  app.exit(1);
});

async function waitForCompletion(window, jobId) {
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    const status = await window.webContents.executeJavaScript(
      `window.electron.getSchedulePdfExportStatus(${JSON.stringify(jobId)})`,
      true,
    );
    safeProgress.push(status);
    if (status.state === 'completed') return status;
    if (status.state === 'failed' || status.state === 'cancelled') {
      throw new Error(JSON.stringify(status.error || { state: status.state }));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for production PDF job completion');
}

app.whenReady().then(async () => {
  debug('fixture ready');
  app.on('child-process-gone', (_event, details) => {
    debug(`child-process-gone ${JSON.stringify(details)}`);
  });
  writePdfExportSettings(userDataPath, outputDirectory);
  const manager = createPdfExportManager({
    BrowserWindow,
    electronSession: session,
    getUserDataDirectory: () => userDataPath,
    appDirectory: path.dirname(pdfExportServiceModulePath),
    resourcesDirectory: process.resourcesPath,
    packaged: false,
    logger: (entry) => safeProgress.push({ diagnostic: entry }),
  });
  registerPdfExportIpc({ ipcMain, manager, authorise: () => undefined });

  const window = new BrowserWindow({
    width: 520,
    height: 360,
    show: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    debug(`did-fail-load ${code} ${description} ${url}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    debug(`render-process-gone ${JSON.stringify(details)}`);
  });
  // Use an ordinary local initiator document just as the production app does.
  // It contains no schedule data; the payload crosses only the production IPC.
  const initiatorPath = path.join(path.dirname(process.argv[2]), 'initiator.html');
  fs.writeFileSync(initiatorPath, '<!doctype html><meta charset="utf-8"><title>PDF integration</title>');
  await window.loadFile(initiatorPath);
  const started = await window.webContents.executeJavaScript(
    `window.electron.startSchedulePdfExport(${JSON.stringify(payload)})`,
    true,
  );
  debug(`job started ${started.jobId}`);
  const completed = await waitForCompletion(window, started.jobId);
  const outputPath = completed.result.path;
  const pdf = fs.readFileSync(outputPath);
  const parsed = await PDFDocument.load(pdf);
  const pageCount = parsed.getPageCount();
  const firstPage = parsed.getPage(0);
  const mediaBox = { width: firstPage.getWidth(), height: firstPage.getHeight() };
  fs.writeFileSync(receiptPath, JSON.stringify({
    outputPath,
    fileName: completed.result.fileName,
    size: pdf.length,
    pageCount,
    mediaBox,
    progress: safeProgress,
    dayCount: completed.dayCount,
    taskCount: completed.taskCount,
  }, null, 2));
  manager.shutdown();
  if (!window.isDestroyed()) window.destroy();
  app.exit(0);
}).catch((error) => {
  debug(`safe progress: ${JSON.stringify(safeProgress)}`);
  debug(`failed: ${error.stack || error}`);
  app.exit(1);
});
