/** Run the production Excel job manager against the configured Desktop database read-only. */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ExcelJS = require('exceljs');
const { createExcelExportManager } = require('../excel-export-service');
const { validateExcelExportPayload } = require('../excel-export');
const { writePdfExportSettings } = require('../pdf-export');

function resolveDatabase() {
  if (process.env.MP_DESKTOP_DB_PATH) return path.resolve(process.env.MP_DESKTOP_DB_PATH);
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'masterplan-optimizer-desktop', 'data', 'masterplan.db');
  }
  throw new Error('Set MP_DESKTOP_DB_PATH to the Desktop database to test.');
}

function resolvePython(projectRoot) {
  const candidates = [
    process.env.MP_PYTHON,
    process.platform === 'win32'
      ? path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'backend', 'venv', 'bin', 'python'),
  ].filter(Boolean);
  return candidates.find((candidate) => path.isAbsolute(candidate) && fs.existsSync(candidate)) ||
    (process.platform === 'win32' ? 'python.exe' : 'python3');
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Command failed').trim());
  return result.stdout.trim();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function waitForCompletion(manager, jobId, ownerId) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = manager.status(jobId, ownerId);
    if (status.state === 'completed') return status;
    if (status.state === 'failed' || status.state === 'cancelled') {
      throw new Error(`${status.error?.code || 'EXCEL_EXPORT_FAILED'}: ${status.error?.message || status.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The current-data Excel regression exceeded five minutes.');
}

async function verifyWorkbook(file, payload) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  if (workbook.worksheets.length !== payload.days.length) {
    throw new Error('Workbook day count does not match the read-only source payload.');
  }
  const personColumnById = new Map(payload.people.map((person, index) => [person.id, 7 + index]));
  payload.days.forEach((day, dayIndex) => {
    const sheet = workbook.worksheets[dayIndex];
    if (sheet.getCell('D1').value !== day.alias) {
      throw new Error(`Workbook alias header does not match the read-only source payload on day ${dayIndex + 1}.`);
    }
    if (sheet.getCell(1, 7 + payload.people.length).value !== 'Board') {
      throw new Error(`Workbook Board header does not match the read-only source payload on day ${dayIndex + 1}.`);
    }
    day.tasks.forEach((task, taskIndex) => {
      const row = taskIndex + 3;
      if (sheet.getCell(row, 3).value !== task.title) {
        throw new Error('Workbook task ordering does not match the read-only source payload.');
      }
      const expected = new Set(task.assignedPersonIds);
      for (const [personId, column] of personColumnById) {
        const actual = sheet.getCell(row, column).value === 'x';
        if (actual !== expected.has(personId)) {
          throw new Error('Workbook assignment matrix does not match the read-only source payload.');
        }
      }
    });
  });
}

async function main() {
  const desktopRoot = path.resolve(__dirname, '..');
  const projectRoot = path.resolve(desktopRoot, '..');
  const database = resolveDatabase();
  if (!fs.existsSync(database)) throw new Error('The configured Desktop database does not exist.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-current-excel-'));
  const payloadPath = path.join(temporary, 'payload.json');
  const started = Date.now();
  try {
    const output = run(
      resolvePython(projectRoot),
      [
        path.join(desktopRoot, 'scripts', 'build-current-excel-payload.py'),
        '--database',
        database,
        '--output',
        payloadPath,
        ...(process.env.MP_EVENT_ID ? ['--event-id', process.env.MP_EVENT_ID] : []),
      ],
      { cwd: projectRoot },
    );
    const counts = JSON.parse(output.split(/\r?\n/).at(-1));
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const validatedPayload = validateExcelExportPayload(payload);
    writePdfExportSettings(temporary, temporary);
    const manager = createExcelExportManager({ getUserDataDirectory: () => temporary });
    const ownerId = 91;
    const job = manager.start(payload, ownerId);
    const status = await waitForCompletion(manager, job.jobId, ownerId);
    await verifyWorkbook(status.result.path, validatedPayload);
    const receipt = {
      days: counts.days,
      tasks: counts.tasks,
      people: counts.people,
      assignments: counts.assignments,
      elapsed_ms: Date.now() - started,
      payload_sha256: counts.payload_sha256,
      xlsx_sha256: sha256(status.result.path),
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    manager.shutdown();
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
