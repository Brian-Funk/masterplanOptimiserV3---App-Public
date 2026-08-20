const fs = require('fs');
const path = require('path');

const SETTINGS_FORMAT = 'mp-opt-pdf-export-settings-v1';
const SETTINGS_FILE = 'pdf-export-settings.json';
const MAX_DAYS = 62;
const MAX_TASKS_PER_DAY = 2000;
const MAX_TASK_BYTES_PER_DAY = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const PDF_NO_PROGRESS_TIMEOUT_MS = 60 * 1000;
// Chromium can spend well over a minute in one synchronous style/layout pass
// for a real seven-day schedule. During that pass the renderer cannot emit a
// heartbeat even though it is still doing useful work. Keep the short watchdog
// for I/O stages, but let CPU-bound construction/layout run until shortly
// before the independent five-minute absolute deadline.
const PDF_LAYOUT_NO_PROGRESS_TIMEOUT_MS = 4 * 60 * 1000;
const PDF_ABSOLUTE_RENDER_TIMEOUT_MS = 5 * 60 * 1000;
const PDF_PRINT_TIMEOUT_MS = 5 * 60 * 1000;
const PDF_PROGRESS_STAGES = new Set([
  'loading',
  'building',
  'assets',
  'layout',
  'ready',
  'printing',
]);
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const PDF_FOOTER_TEMPLATE = `
  <div style="box-sizing:border-box;display:flex;width:100%;align-items:center;justify-content:space-between;padding:0 10mm;color:#6b7280;font-family:'Source Sans 3',Arial,sans-serif;font-size:7.5pt;">
    <span>MP-OPT Optimised Schedule</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;

function buildPdfPrintOptions() {
  return {
    landscape: false,
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: PDF_FOOTER_TEMPLATE,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

function validatePdfProgress(stage, completed, total) {
  if (!PDF_PROGRESS_STAGES.has(stage)) {
    throw new Error('Invalid PDF export progress stage.');
  }
  if (
    !Number.isSafeInteger(completed) ||
    !Number.isSafeInteger(total) ||
    completed < 0 ||
    total < 0 ||
    completed > total
  ) {
    throw new Error('Invalid PDF export progress count.');
  }
  return { stage, completed, total };
}

function describePdfProgress(progress) {
  const validated = validatePdfProgress(
    progress?.stage,
    progress?.completed,
    progress?.total,
  );
  const count = validated.total > 0
    ? ` after ${validated.completed}/${validated.total}`
    : '';
  return `${validated.stage}${count}`;
}

function pdfProgressIdleTimeout(progress) {
  const validated = validatePdfProgress(
    progress?.stage,
    progress?.completed,
    progress?.total,
  );
  return validated.stage === 'building' || validated.stage === 'layout'
    ? PDF_LAYOUT_NO_PROGRESS_TIMEOUT_MS
    : PDF_NO_PROGRESS_TIMEOUT_MS;
}

function createPdfProgressWatchdog({
  onIdle,
  onAbsolute,
  idleTimeoutMs = PDF_NO_PROGRESS_TIMEOUT_MS,
  absoluteTimeoutMs = PDF_ABSOLUTE_RENDER_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let idleTimer = null;
  let absoluteTimer = setTimer(onAbsolute, absoluteTimeoutMs);

  const resetIdle = (timeoutMs = idleTimeoutMs) => {
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = setTimer(onIdle, timeoutMs);
  };
  resetIdle();

  return {
    progress(nextIdleTimeoutMs = idleTimeoutMs) {
      resetIdle(nextIdleTimeoutMs);
    },
    stop() {
      if (idleTimer !== null) clearTimer(idleTimer);
      if (absoluteTimer !== null) clearTimer(absoluteTimer);
      idleTimer = null;
      absoluteTimer = null;
    },
  };
}

function withPdfTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function settingsPath(userDataDir) {
  return path.join(userDataDir, SETTINGS_FILE);
}

function readPdfExportSettings(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(userDataDir), 'utf8'));
    const outputDirectory = typeof parsed.outputDirectory === 'string'
      ? path.resolve(parsed.outputDirectory)
      : null;
    return { outputDirectory };
  } catch {
    return { outputDirectory: null };
  }
}

function writePdfExportSettings(userDataDir, outputDirectory) {
  const resolved = path.resolve(outputDirectory);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('The selected PDF destination is not a folder.');
  fs.accessSync(resolved, fs.constants.W_OK);
  const target = settingsPath(userDataDir);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(
    temporary,
    `${JSON.stringify({ format: SETTINGS_FORMAT, outputDirectory: resolved }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'w' },
  );
  fs.renameSync(temporary, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
  return resolved;
}

function clearPdfExportSettings(userDataDir) {
  const target = settingsPath(userDataDir);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function describePdfExportDirectory(userDataDir) {
  const { outputDirectory } = readPdfExportSettings(userDataDir);
  if (!outputDirectory) return { outputDirectory: null, available: false };
  try {
    const stat = fs.statSync(outputDirectory);
    fs.accessSync(outputDirectory, fs.constants.W_OK);
    return { outputDirectory, available: stat.isDirectory() };
  } catch {
    return { outputDirectory, available: false };
  }
}

function sanitisePdfTitle(value) {
  let title = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  title = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  title = title.replace(/\s+/g, ' ').replace(/[. ]+$/g, '').slice(0, 120).trim();
  title = title.replace(/^\.+/, '_');
  if (!title || title === '.' || title === '..' || RESERVED_WINDOWS_NAMES.test(title)) {
    title = 'Optimised Schedule';
  }
  return title;
}

function localTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('_');
}

function nextPdfPath(outputDirectory, title, date = new Date()) {
  const directory = path.resolve(outputDirectory);
  const stem = `${sanitisePdfTitle(title)}_${localTimestamp(date)}`;
  for (let suffix = 1; suffix <= 9999; suffix += 1) {
    const fileName = `${stem}${suffix === 1 ? '' : `_${suffix}`}.pdf`;
    const candidate = path.join(directory, fileName);
    if (path.dirname(candidate) !== directory) throw new Error('Unsafe PDF output path.');
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique PDF filename.');
}

function writePdfBufferAtomically(outputDirectory, title, pdf, date = new Date()) {
  if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('Chromium returned an invalid PDF document.');
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = nextPdfPath(outputDirectory, title, date);
    const temporary = path.join(
      path.dirname(candidate),
      `.${path.basename(candidate)}.${process.pid}.${Date.now()}.${attempt}.tmp`,
    );
    let descriptor = null;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, pdf);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, candidate);
      if (process.platform !== 'win32') fs.chmodSync(candidate, 0o600);
      return candidate;
    } catch (error) {
      if (descriptor !== null) fs.closeSync(descriptor);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not allocate a unique PDF filename.');
}

function validatePdfExportPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid PDF export request.');
  }
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const eventId = Number(payload.eventId);
  const eventName = typeof payload.eventName === 'string' ? payload.eventName.trim() : '';
  const eventLocation = typeof payload.eventLocation === 'string'
    ? payload.eventLocation.trim()
    : '';
  if (!Number.isSafeInteger(eventId) || eventId < 1 || !title || title.length > 120 || !eventName || eventName.length > 240) {
    throw new Error('The PDF title or event name is invalid.');
  }
  const eventStartDate = typeof payload.eventStartDate === 'string' ? payload.eventStartDate : '';
  const eventEndDate = typeof payload.eventEndDate === 'string' ? payload.eventEndDate : '';
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(eventStartDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventEndDate) ||
    eventStartDate > eventEndDate
  ) {
    throw new Error('The PDF event date range is invalid.');
  }
  if (eventLocation.length > 500 || !Array.isArray(payload.days)) {
    throw new Error('The PDF event details are invalid.');
  }
  if (payload.days.length < 1 || payload.days.length > MAX_DAYS) {
    throw new Error('The PDF must contain between 1 and 62 schedule days.');
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('The PDF export request is too large.');
  }
  let previousDate = '';
  const days = payload.days.map((day) => {
    if (!day || typeof day !== 'object' || Array.isArray(day)) {
      throw new Error('Invalid PDF schedule day.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Array.isArray(day.tasks)) {
      throw new Error('Invalid PDF schedule date or tasks.');
    }
    if (day.date < eventStartDate || day.date > eventEndDate || day.date <= previousDate) {
      throw new Error('PDF schedule days must be unique, ordered, and inside the event.');
    }
    previousDate = day.date;
    if (day.tasks.length > MAX_TASKS_PER_DAY) {
      throw new Error('A PDF schedule day contains too many tasks.');
    }
    const encodedSize = Buffer.byteLength(JSON.stringify(day.tasks), 'utf8');
    if (encodedSize > MAX_TASK_BYTES_PER_DAY) {
      throw new Error('A PDF schedule day is too large.');
    }
    return {
      date: day.date,
      dayLabel: typeof day.dayLabel === 'string' ? day.dayLabel.slice(0, 240) : day.date,
      tasks: day.tasks,
    };
  });
  return {
    title,
    eventId,
    eventName,
    eventLocation,
    eventStartDate,
    eventEndDate,
    generatedAt: new Date().toISOString(),
    scheduleDayRange: payload.scheduleDayRange ?? null,
    scheduleDayBoundary: payload.scheduleDayBoundary ?? null,
    days,
  };
}

module.exports = {
  PDF_ABSOLUTE_RENDER_TIMEOUT_MS,
  PDF_LAYOUT_NO_PROGRESS_TIMEOUT_MS,
  PDF_NO_PROGRESS_TIMEOUT_MS,
  PDF_PRINT_TIMEOUT_MS,
  buildPdfPrintOptions,
  clearPdfExportSettings,
  createPdfProgressWatchdog,
  describePdfProgress,
  describePdfExportDirectory,
  localTimestamp,
  nextPdfPath,
  pdfProgressIdleTimeout,
  readPdfExportSettings,
  sanitisePdfTitle,
  validatePdfExportPayload,
  validatePdfProgress,
  withPdfTimeout,
  writePdfBufferAtomically,
  writePdfExportSettings,
};
