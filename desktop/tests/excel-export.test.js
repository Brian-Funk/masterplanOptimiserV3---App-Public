'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const {
  buildExcelWorkbookBuffer,
  cleanText,
  excelTimestamp,
  nextExcelPath,
  uniqueSheetName,
  validateExcelExportPayload,
  venueHyperlink,
  writeExcelBufferAtomically,
} = require('../excel-export');

function payload() {
  return {
    title: 'Zurich Operations',
    eventId: 7,
    eventName: 'Synthetic Session',
    eventStartDate: '2032-04-21',
    eventEndDate: '2032-04-22',
    people: [
      { id: 1, displayName: 'Ada Lovelace' },
      { id: 2, displayName: 'Alan Turing' },
    ],
    days: [
      {
        date: '2032-04-21',
        alias: 'Build',
        dayNumber: 1,
        tasks: [
          {
            id: 11,
            title: 'Opening briefing',
            startMinutes: 540,
            endMinutes: 600,
            colour: '#D9EAD3',
            assignedSummary: 'Lead: Ada Lovelace',
            additionalInfo: 'Notes: Bring printed copies',
            assignedPersonIds: [1],
            venue: { name: 'Main Hall', address: 'ETH Zurich, Switzerland' },
          },
          {
            id: 12,
            title: 'Transfer',
            startMinutes: 1380,
            endMinutes: 1470,
            colour: '#2563EB',
            assignedSummary: 'Travellers: Ada Lovelace, Alan Turing',
            additionalInfo: '',
            assignedPersonIds: [1, 2, 2],
            routeStart: { name: 'Main Hall', address: 'ETH Zurich, Switzerland' },
            routeEnd: { name: 'Systems Lab', address: 'Stanford, California' },
          },
        ],
      },
      {
        date: '2032-04-22',
        alias: 'A very long alias with forbidden / characters : and more text',
        dayNumber: 2,
        tasks: [],
      },
    ],
  };
}

test('workbook matches the reference day-table contract', async () => {
  const buffer = await buildExcelWorkbookBuffer(payload());
  assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.worksheets[0].name, 'Build (Day 1)');
  assert.match(workbook.worksheets[1].name, /\(Day 2\)$/);
  assert.ok(workbook.worksheets.every((sheet) => !/address|overview|driver|culture|charge/i.test(sheet.name)));

  const sheet = workbook.worksheets[0];
  assert.ok(sheet.getCell('A1').isMerged);
  assert.equal(sheet.getCell('A2').value, 'Start');
  assert.equal(sheet.getCell('D1').value, 'Build');
  assert.ok(sheet.getCell('D1').isMerged);
  assert.equal(sheet.getCell('F2').value, 'Additional Info');
  assert.equal(sheet.getCell('G1').value, 'Ada Lovelace');
  assert.equal(sheet.getCell('H1').value, 'Alan Turing');
  assert.equal(sheet.getCell('I1').value, 'Board');
  assert.equal(sheet.getCell('G3').value, 'x');
  assert.equal(sheet.getCell('H3').value, null);
  assert.equal(sheet.getCell('G4').value, 'x');
  assert.equal(sheet.getCell('H4').value, 'x');
  assert.equal(sheet.getCell('I3').value, null);
  assert.equal(sheet.getCell('I4').value, null);
  assert.equal(sheet.getCell('C3').fill.fgColor.argb, 'FFD9EAD3');
  assert.equal(sheet.getCell('C4').fill.fgColor.argb, 'FF2563EB');
  assert.equal(sheet.getCell('D3').value.text, 'Main Hall');
  assert.match(sheet.getCell('D3').value.hyperlink, /^https:\/\/www\.google\.com\/maps\/search/);
  assert.equal(sheet.getCell('D4').value.text, 'Main Hall \u2192 Systems Lab');
  assert.match(sheet.getCell('D4').value.hyperlink, /^https:\/\/www\.google\.com\/maps\/dir/);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].xSplit, 3);
  assert.equal(sheet.views[0].ySplit, 2);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.printTitlesRow, '1:2');
});

test('validation rejects unsafe references and excessive assignment matrices', () => {
  const unknown = payload();
  unknown.days[0].tasks[0].assignedPersonIds = [99];
  assert.throws(() => validateExcelExportPayload(unknown), /outside this event/);

  const duplicate = payload();
  duplicate.people.push({ id: 1, displayName: 'Duplicate' });
  assert.throws(() => validateExcelExportPayload(duplicate), /duplicate person/);

  const oversized = payload();
  oversized.people = Array.from({ length: 1000 }, (_, index) => ({
    id: index + 1,
    displayName: `Synthetic person ${index + 1}`,
  }));
  oversized.days = [{
    date: '2032-04-21',
    alias: 'Build',
    dayNumber: 1,
    tasks: Array.from({ length: 1001 }, (_, index) => ({
      ...oversized.days[0].tasks[0],
      id: index + 1,
      assignedPersonIds: [],
    })),
  }];
  assert.throws(() => validateExcelExportPayload(oversized), /matrix is too large/);
});

test('cell text and venue links are safe', () => {
  assert.equal(cleanText('=HYPERLINK("https://evil.invalid")'), "'=HYPERLINK(\"https://evil.invalid\")");
  assert.equal(cleanText('  =1+1').trim(), "'  =1+1");
  assert.equal(venueHyperlink({ venue: { name: 'Hall', address: 'javascript:alert(1)' } }),
    null);
  assert.equal(venueHyperlink({ venue: { name: 'Hall', address: 'http://unsafe.invalid' } }),
    null);
  assert.equal(venueHyperlink({ venue: { name: 'Hall', address: 'https://maps.example.invalid/hall' } }),
    'https://maps.example.invalid/hall');
});

test('sheet names preserve the day suffix and remain unique', () => {
  const used = new Set();
  const first = uniqueSheetName('A/B:C?D*E[F] with a long suffix', 12, used);
  const second = uniqueSheetName('A/B:C?D*E[F] with a long suffix', 12, used);
  assert.ok(first.length <= 31);
  assert.match(first, /\(Day 12\)$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /[\\/*?:[\]]/);
});

test('atomic writing never overwrites an existing workbook', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-excel-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const buffer = await buildExcelWorkbookBuffer(payload());
  const date = new Date(2032, 3, 21, 12, 34);
  assert.equal(excelTimestamp(date), '2032-04-21_12-34');
  const first = writeExcelBufferAtomically(directory, 'Plan', buffer, date);
  const second = writeExcelBufferAtomically(directory, 'Plan', buffer, date);
  assert.notEqual(first, second);
  assert.equal(path.extname(first), '.xlsx');
  assert.equal(path.basename(nextExcelPath(directory, 'Plan', date)), 'Plan_2032-04-21_12-34_3.xlsx');
  assert.equal(fs.readFileSync(first).subarray(0, 4).toString('hex'), '504b0304');
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false);
});

test('duplicate imported task identifiers do not suppress schedule rows', async () => {
  const input = payload();
  input.days[1].tasks.push({ ...input.days[0].tasks[0] });
  const buffer = await buildExcelWorkbookBuffer(input);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets[0].rowCount, 4);
  assert.equal(workbook.worksheets[1].getCell('C3').value, 'Opening briefing');
});

test('cancellation is observed between workbook days', async () => {
  let cancelled = false;
  await assert.rejects(
    buildExcelWorkbookBuffer(payload(), {
      onProgress: ({ stage, completed }) => {
        if (stage === 'building' && completed === 1) cancelled = true;
      },
      isCancelled: () => cancelled,
    }),
    /cancelled/,
  );
});
