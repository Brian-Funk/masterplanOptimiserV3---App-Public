const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const {
  payloadPath,
  outputPath,
  receiptPath,
  frontendUrl,
  userDataPath,
  preloadPath,
} = config;
const debugPath = `${receiptPath}.log`;
const debug = (message) => fs.appendFileSync(debugPath, `${new Date().toISOString()} ${message}\n`);
debug(`fixture started: ${JSON.stringify({ frontendUrl, userDataPath, preloadPath })}`);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const jobId = 'pdf-electron-integration';
process.on('uncaughtException', (error) => {
  debug(`uncaught: ${error.stack || error}`);
  app.exit(1);
});
process.on('unhandledRejection', (error) => {
  debug(`unhandled: ${error?.stack || error}`);
  app.exit(1);
});

app.setPath('userData', userDataPath);

let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});

ipcMain.handle('get-pdf-export-job', (event, requestedJobId) => {
  if (requestedJobId !== jobId) throw new Error('Unexpected PDF job id');
  return payload;
});
ipcMain.handle('notify-pdf-export-ready', (event, requestedJobId) => {
  if (requestedJobId !== jobId) throw new Error('Unexpected PDF readiness id');
  readyResolve();
  return { success: true };
});

app.whenReady().then(async () => {
  debug('app ready');
  const window = new BrowserWindow({
    width: 1400,
    height: 990,
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    debug(`renderer console ${level}: ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    debug(`did-fail-load ${code}: ${description} ${url}`);
  });
  const timeout = setTimeout(() => {
    throw new Error('Timed out waiting for the PDF renderer');
  }, 45000);
  await window.loadURL(frontendUrl);
  await window.webContents.executeJavaScript("localStorage.setItem('dark-mode', 'dark')");
  await window.loadURL(`${frontendUrl}/pdf-export?job=${jobId}`);
  debug('route loaded');
  await ready;
  debug('renderer ready');
  clearTimeout(timeout);
  const bodyText = await window.webContents.executeJavaScript('document.body.innerText');
  const visualState = await window.webContents.executeJavaScript(`({
    rootClassName: document.documentElement.className,
    background: getComputedStyle(document.body).backgroundColor,
    fontFamily: getComputedStyle(document.querySelector('.pdf-document')).fontFamily,
    logoReady: Boolean(document.querySelector('.pdf-brand img')?.complete),
  })`);
  const pdf = await window.webContents.printToPDF({
    landscape: true,
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  fs.writeFileSync(outputPath, pdf, { flag: 'wx' });
  debug(`pdf written: ${pdf.length}`);
  const source = pdf.toString('latin1');
  const pageCount = (source.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  fs.writeFileSync(
    receiptPath,
    JSON.stringify({ bodyText, visualState, pageCount, size: pdf.length, outputPath }, null, 2),
  );
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
