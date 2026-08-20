const fs = require('fs');
const path = require('path');

const SETTINGS_FORMAT = 'mp-opt-pdf-export-settings-v1';
const SETTINGS_FILE = 'pdf-export-settings.json';
const MAX_DAYS = 62;
const MAX_TASKS_PER_DAY = 2000;
const MAX_TASK_BYTES_PER_DAY = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
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
  clearPdfExportSettings,
  describePdfExportDirectory,
  localTimestamp,
  nextPdfPath,
  readPdfExportSettings,
  sanitisePdfTitle,
  validatePdfExportPayload,
  withPdfTimeout,
  writePdfBufferAtomically,
  writePdfExportSettings,
};
