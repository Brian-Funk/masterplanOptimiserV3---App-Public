/** Run the production PDF job against the configured Desktop database read-only. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveDatabase() {
  if (process.env.MP_DESKTOP_DB_PATH) return path.resolve(process.env.MP_DESKTOP_DB_PATH);
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(
      process.env.APPDATA,
      'masterplan-optimizer-desktop',
      'data',
      'masterplan.db',
    );
  }
  throw new Error('Set MP_DESKTOP_DB_PATH to the Desktop database to test.');
}

function resolvePython(projectRoot) {
  const configured = process.env.MP_PYTHON;
  const candidates = [
    configured,
    process.platform === 'win32'
      ? path.join(projectRoot, 'backend', 'venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'backend', 'venv', 'bin', 'python'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3';
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

function main() {
  const desktopRoot = path.resolve(__dirname, '..');
  const projectRoot = path.resolve(desktopRoot, '..');
  const database = resolveDatabase();
  if (!fs.existsSync(database)) throw new Error('The configured Desktop database does not exist.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-current-pdf-'));
  const payload = path.join(temporary, 'payload.json');
  const pdf = path.join(temporary, 'result.pdf');
  const started = Date.now();
  try {
    const buildOutput = run(
      resolvePython(projectRoot),
      [
        path.join(desktopRoot, 'scripts', 'build-current-pdf-payload.py'),
        '--database',
        database,
        '--output',
        payload,
      ],
      { cwd: projectRoot },
    );
    const counts = JSON.parse(buildOutput.split(/\r?\n/).at(-1));
    const npmCli = process.env.npm_execpath;
    const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const npmArguments = npmCli ? [npmCli, 'run', 'test:electron-pdf'] : ['run', 'test:electron-pdf'];
    run(npmCommand, npmArguments, {
      cwd: desktopRoot,
      env: {
        ...process.env,
        MP_PDF_INTEGRATION_PAYLOAD: payload,
        MP_PDF_INTEGRATION_OUTPUT: pdf,
      },
    });
    const receipt = {
      days: counts.days,
      tasks: counts.tasks,
      elapsed_ms: Date.now() - started,
      payload_sha256: counts.payload_sha256,
      pdf_sha256: sha256(pdf),
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
