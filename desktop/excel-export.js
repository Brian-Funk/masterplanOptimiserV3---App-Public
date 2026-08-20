'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { sanitisePdfTitle } = require('./pdf-export');

const MAX_DAYS = 62;
const MAX_PEOPLE = 1000;
const MAX_TASKS_PER_DAY = 2000;
const MAX_ASSIGNMENT_CELLS = 1_000_000;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_CELL_TEXT = 32_767;
const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const INVALID_SHEET_NAME = /[\\/*?:[\]]/g;

class ExcelExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExcelExportError';
    this.code = code;
  }
}

function cleanText(value, label = 'Workbook text') {
  let text = value == null ? '' : String(value);
  text = text.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (text.length > MAX_CELL_TEXT) {
    throw new ExcelExportError('EXCEL_CELL_TOO_LONG', `${label} exceeds Excel's cell-length limit.`);
  }
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return text;
}

function safeString(value, maxLength, label) {
  const text = cleanText(value, label).trim();
  if (text.length > maxLength) {
    throw new ExcelExportError('EXCEL_VALUE_TOO_LONG', `${label} is too long.`);
  }
  return text;
}

function validateDate(value, label) {
  const text = typeof value === 'string' ? value : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ExcelExportError('EXCEL_DATE_INVALID', `${label} is invalid.`);
  }
  return text;
}

function validateInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, label }) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw new ExcelExportError('EXCEL_NUMBER_INVALID', `${label} is invalid.`);
  }
  return numeric;
}

function normaliseColour(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : '#3B82F6';
}

function validateLocation(value, label) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExcelExportError('EXCEL_LOCATION_INVALID', `${label} is invalid.`);
  }
  return {
    name: safeString(value.name ?? '', 500, `${label} name`),
    address: safeString(value.address ?? '', 2000, `${label} address`),
  };
}

function validateExcelExportPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ExcelExportError('EXCEL_REQUEST_INVALID', 'Invalid Excel export request.');
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new ExcelExportError('EXCEL_REQUEST_TOO_LARGE', 'The Excel export request is too large.');
  }

  const title = safeString(payload.title, 120, 'Document title');
  const eventId = validateInteger(payload.eventId, { min: 1, label: 'Event identifier' });
  const eventName = safeString(payload.eventName, 240, 'Event name');
  const eventStartDate = validateDate(payload.eventStartDate, 'Event start date');
  const eventEndDate = validateDate(payload.eventEndDate, 'Event end date');
  if (!title || !eventName || eventStartDate > eventEndDate) {
    throw new ExcelExportError('EXCEL_EVENT_INVALID', 'The Excel title or event details are invalid.');
  }

  if (!Array.isArray(payload.people) || payload.people.length > MAX_PEOPLE) {
    throw new ExcelExportError('EXCEL_PEOPLE_INVALID', 'The Excel export contains too many people.');
  }
  const personIds = new Set();
  const people = payload.people.map((person) => {
    if (!person || typeof person !== 'object' || Array.isArray(person)) {
      throw new ExcelExportError('EXCEL_PERSON_INVALID', 'The Excel export contains an invalid person.');
    }
    const id = validateInteger(person.id, { min: 1, label: 'Person identifier' });
    if (personIds.has(id)) {
      throw new ExcelExportError('EXCEL_PERSON_DUPLICATE', 'The Excel export contains a duplicate person identifier.');
    }
    personIds.add(id);
    const displayName = safeString(person.displayName, 240, 'Person display name');
    if (!displayName) {
      throw new ExcelExportError('EXCEL_PERSON_NAME_MISSING', 'Every person needs a display name for Excel publishing.');
    }
    return { id, displayName };
  });

  if (!Array.isArray(payload.days) || payload.days.length < 1 || payload.days.length > MAX_DAYS) {
    throw new ExcelExportError('EXCEL_DAYS_INVALID', 'The workbook must contain between 1 and 62 schedule days.');
  }
  let previousDate = '';
  let taskCount = 0;
  const days = payload.days.map((day) => {
    if (!day || typeof day !== 'object' || Array.isArray(day)) {
      throw new ExcelExportError('EXCEL_DAY_INVALID', 'The workbook contains an invalid schedule day.');
    }
    const date = validateDate(day.date, 'Schedule date');
    if (date < eventStartDate || date > eventEndDate || date <= previousDate) {
      throw new ExcelExportError('EXCEL_DAY_ORDER_INVALID', 'Schedule days must be unique, ordered, and inside the event.');
    }
    previousDate = date;
    const alias = safeString(day.alias ?? '', 240, 'Day alias');
    const dayNumber = validateInteger(day.dayNumber, { min: 1, max: 366, label: 'Day number' });
    if (!Array.isArray(day.tasks) || day.tasks.length > MAX_TASKS_PER_DAY) {
      throw new ExcelExportError('EXCEL_TASK_COUNT_INVALID', 'A schedule day contains too many tasks.');
    }
    const tasks = day.tasks.map((task) => {
      if (!task || typeof task !== 'object' || Array.isArray(task)) {
        throw new ExcelExportError('EXCEL_TASK_INVALID', 'The workbook contains an invalid task.');
      }
      const id = validateInteger(task.id, { min: 1, label: 'Task identifier' });
      const startMinutes = task.startMinutes == null
        ? null
        : validateInteger(task.startMinutes, { min: 0, max: 2879, label: 'Task start time' });
      const endMinutes = task.endMinutes == null
        ? null
        : validateInteger(task.endMinutes, { min: 0, max: 2879, label: 'Task end time' });
      const assignedPersonIds = Array.isArray(task.assignedPersonIds)
        ? [...new Set(task.assignedPersonIds.map((value) => validateInteger(value, { min: 1, label: 'Assigned person identifier' })))]
        : [];
      if (assignedPersonIds.some((personId) => !personIds.has(personId))) {
        throw new ExcelExportError('EXCEL_ASSIGNMENT_UNKNOWN_PERSON', 'A task assignment references a person outside this event.');
      }
      return {
        id,
        title: safeString(task.title, 1000, `Task ${id} title`),
        startMinutes,
        endMinutes,
        colour: normaliseColour(task.colour),
        assignedSummary: safeString(task.assignedSummary ?? '', MAX_CELL_TEXT, `Task ${id} assignment summary`),
        additionalInfo: safeString(task.additionalInfo ?? '', MAX_CELL_TEXT, `Task ${id} additional information`),
        assignedPersonIds,
        venue: validateLocation(task.venue, `Task ${id} venue`),
        routeStart: validateLocation(task.routeStart, `Task ${id} route start`),
        routeEnd: validateLocation(task.routeEnd, `Task ${id} route destination`),
      };
    });
    taskCount += tasks.length;
    return { date, alias, dayNumber, tasks };
  });

  if (taskCount * Math.max(people.length, 1) > MAX_ASSIGNMENT_CELLS) {
    throw new ExcelExportError('EXCEL_MATRIX_TOO_LARGE', 'The person-assignment matrix is too large for a reliable workbook export.');
  }

  return {
    title,
    eventId,
    eventName,
    eventStartDate,
    eventEndDate,
    people,
    days,
    generatedAt: new Date().toISOString(),
  };
}

function columnName(index) {
  let value = index;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function uniqueSheetName(alias, dayNumber, usedNames) {
  const suffix = ` (Day ${dayNumber})`;
  let cleanAlias = cleanText(alias || `Day ${dayNumber}`, 'Day alias')
    .replace(INVALID_SHEET_NAME, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim();
  if (!cleanAlias) cleanAlias = 'Schedule';
  const reserve = suffix.length;
  cleanAlias = cleanAlias.slice(0, Math.max(1, 31 - reserve)).trim();
  let base = `${cleanAlias}${suffix}`.slice(0, 31);
  let candidate = base;
  for (let index = 2; usedNames.has(candidate.toLocaleLowerCase()); index += 1) {
    const duplicateSuffix = `~${index}`;
    candidate = `${base.slice(0, 31 - duplicateSuffix.length)}${duplicateSuffix}`;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function formatDayTitle(date, dayNumber) {
  const [year, month, day] = date.split('-').map(Number);
  const formatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return `${formatted} (Day ${dayNumber})`;
}

function toExcelClock(minutes) {
  if (minutes == null) return '';
  const normalised = ((minutes % 1440) + 1440) % 1440;
  return normalised / 1440;
}

function argb(hex) {
  return `FF${hex.replace('#', '').toUpperCase()}`;
}

function contrastColour(hex) {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? 'FF111827' : 'FFFFFFFF';
}

function normaliseHttps(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function hasUrlScheme(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value || '');
}

function mapPoint(location) {
  if (!location) return '';
  const address = location.address || '';
  if (address && !hasUrlScheme(address)) return address;
  if (normaliseHttps(address)) return address;
  return location.name || '';
}

function venueHyperlink(task) {
  if (task.routeStart?.name && task.routeEnd?.name) {
    const origin = mapPoint(task.routeStart);
    const destination = mapPoint(task.routeEnd);
    if (origin && destination) {
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    }
  }
  if (!task.venue) return null;
  const direct = normaliseHttps(task.venue.address);
  if (direct) return direct;
  if (hasUrlScheme(task.venue.address)) return null;
  const query = mapPoint(task.venue);
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function venueLabel(task) {
  if (task.routeStart?.name && task.routeEnd?.name) {
    return `${task.routeStart.name} \u2192 ${task.routeEnd.name}`;
  }
  return task.venue?.name || '';
}

function estimateLines(text, width) {
  if (!text) return 1;
  return String(text).split('\n').reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(width, 1))),
    0,
  );
}

function styleHeaderCell(cell, { align = 'left' } = {}) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF111827' } };
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  };
}

async function buildExcelWorkbookBuffer(payload, options = {}) {
  const validated = options.validated ? payload : validateExcelExportPayload(payload);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => undefined;
  const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Masterplan Optimiser';
  workbook.lastModifiedBy = 'Masterplan Optimiser';
  workbook.created = new Date(validated.generatedAt);
  workbook.modified = new Date(validated.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = false;
  const usedNames = new Set();

  for (let dayIndex = 0; dayIndex < validated.days.length; dayIndex += 1) {
    if (isCancelled()) throw new ExcelExportError('EXCEL_EXPORT_CANCELLED', 'Excel export was cancelled.');
    const day = validated.days[dayIndex];
    onProgress({ stage: 'building', completed: dayIndex, total: validated.days.length });
    const sheetName = uniqueSheetName(day.alias, day.dayNumber, usedNames);
    const worksheet = workbook.addWorksheet(sheetName);
    const boardColumn = 7 + validated.people.length;
    const boardColumnName = columnName(boardColumn);
    worksheet.properties.defaultRowHeight = 18;
    worksheet.views = [{
      state: 'frozen',
      xSplit: 3,
      ySplit: 2,
      topLeftCell: 'D3',
      activeCell: 'D3',
      showGridLines: false,
    }];
    worksheet.pageSetup = {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: false,
      verticalCentered: false,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
      printTitlesRow: '1:2',
    };
    worksheet.pageSetup.printArea = `A1:${boardColumnName}${Math.max(3, day.tasks.length + 2)}`;
    worksheet.columns = [
      { key: 'start', width: 8 },
      { key: 'end', width: 8 },
      { key: 'element', width: 30 },
      { key: 'venue', width: 28 },
      { key: 'assigned', width: 42 },
      { key: 'additional', width: 56 },
      ...validated.people.map((_person, index) => ({ key: `person_${index}`, width: 9 })),
      { key: 'board', width: 18 },
    ];

    worksheet.mergeCells('A1:C1');
    worksheet.mergeCells('D1:F1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = formatDayTitle(day.date, day.dayNumber);
    titleCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FF111827' } };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    titleCell.border = { bottom: { style: 'medium', color: { argb: 'FF6B7280' } } };
    const aliasCell = worksheet.getCell('D1');
    aliasCell.value = day.alias || 'Schedule';
    aliasCell.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FF111827' } };
    aliasCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    aliasCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    aliasCell.border = { bottom: { style: 'medium', color: { argb: 'FF6B7280' } } };
    worksheet.getRow(1).height = 60;

    validated.people.forEach((person, index) => {
      const cell = worksheet.getCell(1, 7 + index);
      cell.value = person.displayName;
      styleHeaderCell(cell, { align: 'center' });
      cell.font = { ...cell.font, size: 9 };
    });
    const boardHeader = worksheet.getCell(1, boardColumn);
    boardHeader.value = 'Board';
    styleHeaderCell(boardHeader, { align: 'center' });

    ['Start', 'End', 'Element', 'Venue', 'Assigned', 'Additional Info'].forEach((label, index) => {
      const cell = worksheet.getCell(2, index + 1);
      cell.value = label;
      styleHeaderCell(cell, { align: index < 2 ? 'center' : 'left' });
    });
    for (let column = 7; column <= boardColumn; column += 1) {
      styleHeaderCell(worksheet.getCell(2, column), { align: 'center' });
    }
    worksheet.getRow(2).height = 24;

    day.tasks.forEach((task, taskIndex) => {
      const rowNumber = taskIndex + 3;
      const row = worksheet.getRow(rowNumber);
      const fillArgb = argb(task.colour);
      const fontArgb = contrastColour(task.colour);
      const assigned = new Set(task.assignedPersonIds);
      row.getCell(1).value = toExcelClock(task.startMinutes);
      row.getCell(2).value = toExcelClock(task.endMinutes);
      row.getCell(1).numFmt = 'hh:mm';
      row.getCell(2).numFmt = 'hh:mm';
      row.getCell(3).value = task.title;
      const venue = venueLabel(task);
      const hyperlink = venueHyperlink(task);
      row.getCell(4).value = hyperlink && venue ? { text: venue, hyperlink, tooltip: venue } : venue;
      row.getCell(5).value = task.assignedSummary;
      row.getCell(6).value = task.additionalInfo;
      validated.people.forEach((person, index) => {
        row.getCell(7 + index).value = assigned.has(person.id) ? 'x' : null;
      });
      row.getCell(boardColumn).value = null;

      for (let column = 1; column < boardColumn; column += 1) {
        const cell = row.getCell(column);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
        cell.font = {
          name: 'Arial',
          size: 10,
          color: { argb: fontArgb },
          underline: column === 4 && Boolean(hyperlink && venue),
        };
        cell.alignment = {
          horizontal: column <= 2 || column >= 7 ? 'center' : 'left',
          vertical: 'middle',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin', color: { argb: '66FFFFFF' } },
          bottom: { style: 'thin', color: { argb: '669CA3AF' } },
          left: { style: 'thin', color: { argb: '669CA3AF' } },
          right: { style: 'thin', color: { argb: '669CA3AF' } },
        };
      }
      const boardCell = row.getCell(boardColumn);
      boardCell.font = { name: 'Arial', size: 10, color: { argb: 'FF111827' } };
      boardCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      boardCell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
      const lines = Math.max(
        estimateLines(task.title, 30),
        estimateLines(venue, 28),
        estimateLines(task.assignedSummary, 42),
        estimateLines(task.additionalInfo, 56),
      );
      row.height = Math.min(153, Math.max(22, 10 + lines * 12));
    });

    onProgress({ stage: 'building', completed: dayIndex + 1, total: validated.days.length });
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (isCancelled()) throw new ExcelExportError('EXCEL_EXPORT_CANCELLED', 'Excel export was cancelled.');
  onProgress({ stage: 'serialising', completed: 0, total: 1 });
  const bytes = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  const buffer = Buffer.from(bytes);
  if (buffer.length < XLSX_SIGNATURE.length || !buffer.subarray(0, 4).equals(XLSX_SIGNATURE)) {
    buffer.fill(0);
    throw new ExcelExportError('EXCEL_DOCUMENT_INVALID', 'ExcelJS returned an invalid workbook.');
  }
  onProgress({ stage: 'serialising', completed: 1, total: 1 });
  return buffer;
}

function excelTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-') + `_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
}

function nextExcelPath(outputDirectory, title, date = new Date()) {
  const directory = path.resolve(outputDirectory);
  const stem = `${sanitisePdfTitle(title)}_${excelTimestamp(date)}`;
  for (let suffix = 1; suffix <= 9999; suffix += 1) {
    const fileName = `${stem}${suffix === 1 ? '' : `_${suffix}`}.xlsx`;
    const candidate = path.join(directory, fileName);
    if (path.dirname(candidate) !== directory) throw new ExcelExportError('EXCEL_OUTPUT_UNSAFE', 'Unsafe Excel output path.');
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new ExcelExportError('EXCEL_FILENAME_UNAVAILABLE', 'Could not allocate a unique Excel filename.');
}

function writeExcelBufferAtomically(outputDirectory, title, workbook, date = new Date()) {
  if (!Buffer.isBuffer(workbook) || workbook.length < 4 || !workbook.subarray(0, 4).equals(XLSX_SIGNATURE)) {
    throw new ExcelExportError('EXCEL_DOCUMENT_INVALID', 'The generated Excel workbook is invalid.');
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = nextExcelPath(outputDirectory, title, date);
    const temporary = path.join(
      path.dirname(candidate),
      `.${path.basename(candidate)}.${process.pid}.${Date.now()}.${attempt}.tmp`,
    );
    let descriptor = null;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, workbook);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.linkSync(temporary, candidate);
      fs.unlinkSync(temporary);
      return candidate;
    } catch (error) {
      if (descriptor !== null) fs.closeSync(descriptor);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new ExcelExportError('EXCEL_FILENAME_UNAVAILABLE', 'Could not allocate a unique Excel filename.');
}

module.exports = {
  ExcelExportError,
  MAX_ASSIGNMENT_CELLS,
  MAX_CELL_TEXT,
  MAX_DAYS,
  MAX_PEOPLE,
  MAX_TASKS_PER_DAY,
  buildExcelWorkbookBuffer,
  cleanText,
  columnName,
  contrastColour,
  excelTimestamp,
  nextExcelPath,
  uniqueSheetName,
  validateExcelExportPayload,
  venueHyperlink,
  writeExcelBufferAtomically,
};
