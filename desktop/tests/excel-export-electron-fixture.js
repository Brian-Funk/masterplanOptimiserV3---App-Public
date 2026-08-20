'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const {
  payloadPath,
  receiptPath,
  outputDirectory,
  userDataPath,
  preloadPath,
  pdfExportModulePath,
  excelExportServiceModulePath,
} = config;
const { writePdfExportSettings } = require(pdfExportModulePath);
const {
  createExcelExportManager,
  registerExcelExportIpc,
} = require(excelExportServiceModulePath);

const debugPath = `${receiptPath}.log`;
const debug = (message) => fs.appendFileSync(debugPath, `${new Date().toISOString()} ${message}\n`);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const progress = [];

app.setPath('userData', userDataPath);
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await window.webContents.executeJavaScript(
      `window.electron.getScheduleExcelExportStatus(${JSON.stringify(jobId)})`,
      true,
    );
    progress.push(status);
    if (status.state === 'completed') return status;
    if (status.state === 'failed' || status.state === 'cancelled') {
      throw new Error(JSON.stringify(status.error || { state: status.state }));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for production Excel job completion');
}

app.whenReady().then(async () => {
  writePdfExportSettings(userDataPath, outputDirectory);
  const manager = createExcelExportManager({
    getUserDataDirectory: () => userDataPath,
    logger: (entry) => progress.push({ diagnostic: entry }),
  });
  registerExcelExportIpc({ ipcMain, manager, authorise: () => undefined });

  const window = new BrowserWindow({
    width: 520,
    height: 360,
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const initiatorPath = path.join(path.dirname(process.argv[2]), 'initiator.html');
  fs.writeFileSync(initiatorPath, '<!doctype html><meta charset="utf-8"><title>Excel integration</title>');
  await window.loadFile(initiatorPath);
  const started = await window.webContents.executeJavaScript(
    `window.electron.startScheduleExcelExport(${JSON.stringify(payload)})`,
    true,
  );
  const completed = await waitForCompletion(window, started.jobId);
  fs.writeFileSync(receiptPath, JSON.stringify({
    outputPath: completed.result.path,
    fileName: completed.result.fileName,
    dayCount: completed.dayCount,
    taskCount: completed.taskCount,
    progress,
  }, null, 2));
  manager.shutdown();
  if (!window.isDestroyed()) window.destroy();
  app.exit(0);
}).catch((error) => {
  debug(`safe progress: ${JSON.stringify(progress)}`);
  debug(`failed: ${error.stack || error}`);
  app.exit(1);
});
