const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildPdfPrintOptions,
  calculatePdfReadyTimeout,
  clearPdfExportSettings,
  describePdfExportDirectory,
  localTimestamp,
  nextPdfPath,
  sanitisePdfTitle,
  validatePdfExportPayload,
  writePdfExportSettings,
} = require('../pdf-export');

test('PDF printing uses A4 portrait with backgrounds and native page numbering', () => {
  const options = buildPdfPrintOptions();
  assert.equal(options.landscape, false);
  assert.equal(options.pageSize, 'A4');
  assert.equal(options.printBackground, true);
  assert.equal(options.preferCSSPageSize, true);
  assert.equal(options.displayHeaderFooter, true);
  assert.match(options.footerTemplate, /pageNumber/);
  assert.match(options.footerTemplate, /totalPages/);
});

test('PDF readiness is workload-aware and remains bounded', () => {
  assert.equal(calculatePdfReadyTimeout({ days: [{ tasks: [] }] }), 30000);
  assert.equal(
    calculatePdfReadyTimeout({ days: [{ tasks: Array.from({ length: 333 }) }] }),
    146550,
  );
  assert.equal(
    calculatePdfReadyTimeout({ days: [{ tasks: Array.from({ length: 2000 }) }] }),
    180000,
  );
});

function withTemporaryDirectories(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-pdf-test-'));
  const userData = path.join(root, 'user-data');
  const output = path.join(root, 'output');
  fs.mkdirSync(userData);
  fs.mkdirSync(output);
  try {
    callback({ root, userData, output });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('PDF folder state remains in Electron user data and can be cleared', () => {
  withTemporaryDirectories(({ userData, output }) => {
    assert.equal(describePdfExportDirectory(userData).available, false);
    assert.equal(writePdfExportSettings(userData, output), path.resolve(output));
    assert.deepEqual(describePdfExportDirectory(userData), {
      outputDirectory: path.resolve(output),
      available: true,
    });
    clearPdfExportSettings(userData);
    assert.deepEqual(describePdfExportDirectory(userData), {
      outputDirectory: null,
      available: false,
    });
  });
});

test('PDF filenames use local minute timestamps, safe titles, and collision suffixes', () => {
  withTemporaryDirectories(({ output }) => {
    const date = new Date(2032, 3, 21, 14, 7, 59);
    assert.equal(localTimestamp(date), '2032_04_21_14_07');
    const first = nextPdfPath(output, 'Plan: North / Hall', date);
    assert.equal(path.basename(first), 'Plan_ North _ Hall_2032_04_21_14_07.pdf');
    fs.writeFileSync(first, 'existing');
    assert.equal(
      path.basename(nextPdfPath(output, 'Plan: North / Hall', date)),
      'Plan_ North _ Hall_2032_04_21_14_07_2.pdf',
    );
  });
});

test('PDF title sanitation handles device names, unicode, and trailing characters', () => {
  assert.equal(sanitisePdfTitle('CON'), 'Optimised Schedule');
  assert.equal(sanitisePdfTitle('  Zürich Einsatzplan...  '), 'Zürich Einsatzplan');
  assert.equal(sanitisePdfTitle('../escape'), '__escape');
});

test('structured PDF payload accepts ordered days and rejects invalid dates or oversized sets', () => {
  const validated = validatePdfExportPayload({
    title: 'Field Plan',
    eventId: 42,
    eventName: 'Synthetic Assembly',
    eventLocation: 'Test Hall',
    eventStartDate: '2032-04-21',
    eventEndDate: '2032-04-24',
    days: [
      { date: '2032-04-21', dayLabel: 'Wednesday', tasks: [{ id: 1, name: 'Build' }] },
      { date: '2032-04-22', dayLabel: 'Thursday', tasks: [{ id: 2, name: 'Open' }] },
    ],
  });
  assert.equal(validated.days.length, 2);
  assert.equal(validated.title, 'Field Plan');
  assert.throws(
    () => validatePdfExportPayload({ title: 'Plan', eventId: 1, eventName: 'Event', eventStartDate: '2032-04-21', eventEndDate: '2032-04-24', days: [{ date: '../x', tasks: [] }] }),
    /date or tasks/,
  );
  assert.throws(
    () => validatePdfExportPayload({ title: 'Plan', eventId: 1, eventName: 'Event', eventStartDate: '2032-04-21', eventEndDate: '2032-04-24', days: [] }),
    /between 1 and 62/,
  );
});
