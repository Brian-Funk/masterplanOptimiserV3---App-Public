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
  pdfExportModulePath,
} = config;
const { buildPdfPrintOptions } = require(pdfExportModulePath);
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
  const visualState = await window.webContents.executeJavaScript(`(() => {
    const logo = document.querySelector('.pdf-brand img');
    let logoHasColour = false;
    if (logo?.complete && logo.naturalWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = logo.naturalWidth;
      canvas.height = logo.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(logo, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha > 32 && Math.max(red, green, blue) - Math.min(red, green, blue) > 24) {
          logoHasColour = true;
          break;
        }
      }
    }
    return {
      rootClassName: document.documentElement.className,
      background: getComputedStyle(document.body).backgroundColor,
      fontFamily: getComputedStyle(document.querySelector('.pdf-document')).fontFamily,
      logoReady: Boolean(logo?.complete),
      logoHasColour,
      detailRows: document.querySelectorAll('[data-pdf-task-reference]').length,
    };
  })()`);
  const pdf = await window.webContents.printToPDF(buildPdfPrintOptions());
  fs.writeFileSync(outputPath, pdf, { flag: 'wx' });
  debug(`pdf written: ${pdf.length}`);
  const source = pdf.toString('latin1');
  const pageCount = (source.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const mediaBoxMatch = source.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const mediaBox = mediaBoxMatch
    ? { width: Number(mediaBoxMatch[1]), height: Number(mediaBoxMatch[2]) }
    : null;
  fs.writeFileSync(
    receiptPath,
    JSON.stringify({ bodyText, visualState, pageCount, mediaBox, size: pdf.length, outputPath }, null, 2),
  );
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
