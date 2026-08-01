'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APPROVED_LICENSE_SHA256 = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';
const SPDX_LICENSE = 'AGPL-3.0-only';
const COMPUTE_LICENSE = 'AGPL-3.0-only';
const REQUIRED_PUBLIC_FILES = [
  'BRANDING.md',
  'CONTRIBUTING.md',
  'COPYRIGHT-AND-CONTRIBUTION-PROVENANCE.md',
  'LICENSE',
  'SECURITY.md',
  'SUPPORTED-VERSIONS.md',
  'THIRD-PARTY-NOTICES.md',
];
const FORBIDDEN_NAMES = new Set([
  '.codex-cloudflare-prod.ps1',
  '.env',
  'encryption.key',
  'manifest-private.pem',
  'root_bootstrap_token',
  'secret_key',
  'smtp_token',
  'vapid_private_key',
  'codex_progress.md',
  'codex_handoff.md',
  'final_validation_report.md',
  'gdpr_technical_report.md',
  'migration_report.md',
  'optimisation-debug.txt',
  'security_report.md',
]);
const FORBIDDEN_PATH_PREFIXES = ['.agents/', '.codex/', '.codex-temp/', 'notes/'];
const FORBIDDEN_SUFFIXES = new Set([
  '.7z',
  '.age',
  '.bak',
  '.db',
  '.dump',
  '.gz',
  '.p12',
  '.pem',
  '.pfx',
  '.rar',
  '.sqlite',
  '.sqlite3',
  '.tar',
  '.tgz',
  '.zip',
]);
const ALLOWED_PUBLIC_KEY_PATHS = new Set(['desktop/assets/manifest-public.pem']);
const APPROVED_PLACEHOLDER_ASSIGNMENTS = new Map([
  ['backend/.env.example', new Set(['65a96c8e22615ee2bd42095bb76e82bb4c3c26c50610648be42ee3ac41dab2b0'])],
  ['backend/.env.web', new Set(['6f4cce99b62fb0824516a391e147c359a65f87f6ae104054d8990f913d85a2f1'])],
]);
const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/],
  ['age identity', /AGE-SECRET-KEY-1[0-9A-Z]+/],
  ['GitHub token', /(?:github_pat_|ghp_)[A-Za-z0-9_]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['service token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];
const SECRET_ASSIGNMENT_PATTERN = /^(?:CLOUDFLARE_API_TOKEN|SMTP_TOKEN|ROOT_BOOTSTRAP_TOKEN|SECRET_KEY)=[^\s#]{16,}$/gm;
const EVIDENCE_PATH_PARTS = new Set(['attestations', 'evidence', 'records', 'trust']);
const EVIDENCE_PERSONAL_DATA_PATTERNS = [
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['forbidden evidence field', /["'](?:email|full_name|ip_address|location|name|passkey_id|private_key|session_id)["']\s*:/i],
];
const TEXT_LIMIT = 5 * 1024 * 1024;

function normalizeRelative(relative) {
  return relative.replaceAll('\\', '/').replace(/^\.\//, '');
}

function listPublicationFiles(root) {
  const output = execFileSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  return output.split('\0').filter(Boolean).map(normalizeRelative);
}

function listHistoryPaths(root) {
  const output = execFileSync(
    'git',
    ['-C', root, 'log', '--all', '--format=', '--name-only'],
    { encoding: 'utf8' },
  );
  return output.split(/\r?\n/).filter(Boolean).map(normalizeRelative);
}

function forbiddenPathReason(relative) {
  const normalized = normalizeRelative(relative);
  const basename = path.posix.basename(normalized).toLowerCase();
  const suffix = path.posix.extname(normalized).toLowerCase();
  if (FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.toLowerCase().startsWith(prefix))) {
    return 'internal path';
  }
  if (FORBIDDEN_NAMES.has(basename)) {
    return 'forbidden name';
  }
  if (FORBIDDEN_SUFFIXES.has(suffix) && !ALLOWED_PUBLIC_KEY_PATHS.has(normalized)) {
    return `forbidden ${suffix} artefact`;
  }
  return null;
}

function normalizedLicenseSha256(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function auditText(relative, content) {
  const normalized = normalizeRelative(relative);
  const failures = [];
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      failures.push(`secret-like ${label}: ${normalized}`);
      break;
    }
  }
  const parts = normalized.split('/');
  const isEvidenceJson = parts.some((part) => EVIDENCE_PATH_PARTS.has(part)) && /\.jsonl?$/i.test(normalized);
  if (isEvidenceJson) {
    for (const [label, pattern] of EVIDENCE_PERSONAL_DATA_PATTERNS) {
      if (pattern.test(content)) {
        failures.push(`evidence contains ${label}: ${normalized}`);
        break;
      }
    }
  }
  for (const match of content.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    const digest = crypto.createHash('sha256').update(match[0]).digest('hex');
    const approved = APPROVED_PLACEHOLDER_ASSIGNMENTS.get(normalized);
    if (!approved?.has(digest)) {
      failures.push(`secret-like secret assignment: ${normalized}`);
      break;
    }
  }
  return failures;
}

function verifyScannerFixture(filePath) {
  const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (fixture.format !== 'masterplan-security-scanner-fixture-v1') {
    return ['unsupported scanner fixture format'];
  }
  const failures = [];
  for (const item of fixture.safe ?? []) {
    const observed = [];
    const reason = forbiddenPathReason(item.path);
    if (reason) observed.push(`${reason}: ${item.path}`);
    observed.push(...auditText(item.path, item.content ?? ''));
    if (observed.length) failures.push(`safe fixture ${item.id} was rejected: ${observed[0]}`);
  }
  for (const item of fixture.unsafe ?? []) {
    const observed = [];
    const reason = forbiddenPathReason(item.path);
    if (item.scope === 'history') {
      if (reason) observed.push(`forbidden historical path requires a clean export: ${item.path}`);
    } else {
      if (reason) observed.push(`${reason}: ${item.path}`);
      observed.push(...auditText(item.path, item.content ?? ''));
    }
    if (!observed.some((finding) => finding.includes(item.expected))) {
      failures.push(`unsafe fixture ${item.id} did not produce ${item.expected}`);
    }
  }
  return failures;
}

function readJson(root, relative, failures) {
  const target = path.join(root, ...relative.split('/'));
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    failures.push(`invalid or missing JSON metadata: ${relative} (${error.message})`);
    return null;
  }
}

function auditLicenseMetadata(root, failures) {
  const desktopPackage = readJson(root, 'desktop/package.json', failures);
  const desktopLock = readJson(root, 'desktop/package-lock.json', failures);
  const webPackage = readJson(root, 'web/package.json', failures);
  const webLock = readJson(root, 'web/package-lock.json', failures);

  if (desktopPackage && desktopPackage.license !== SPDX_LICENSE) {
    failures.push(`desktop/package.json license must be ${SPDX_LICENSE}`);
  }
  if (desktopLock && desktopLock.packages?.['']?.license !== SPDX_LICENSE) {
    failures.push(`desktop/package-lock.json root license must be ${SPDX_LICENSE}`);
  }
  if (webPackage && webPackage.license !== SPDX_LICENSE) {
    failures.push(`web/package.json license must be ${SPDX_LICENSE}`);
  }
  if (webLock && webLock.packages?.['']?.license !== SPDX_LICENSE) {
    failures.push(`web/package-lock.json root license must be ${SPDX_LICENSE}`);
  }

  const computePath = path.join(root, 'compute', 'pyproject.toml');
  try {
    const compute = fs.readFileSync(computePath, 'utf8');
    const expected = `license = "${COMPUTE_LICENSE}"`;
    if (!compute.split(/\r?\n/).includes(expected)) {
      failures.push(`compute/pyproject.toml license must be ${COMPUTE_LICENSE}`);
    }
  } catch (error) {
    failures.push(`invalid or missing project metadata: compute/pyproject.toml (${error.message})`);
  }
}

function auditPublication(root, options = {}) {
  const failures = [];
  const files = options.files ?? listPublicationFiles(root);
  const uniqueFiles = [...new Set(files.map(normalizeRelative))].sort();

  for (const relative of uniqueFiles) {
    if (path.posix.isAbsolute(relative) || relative === '..' || relative.startsWith('../')) {
      failures.push(`path escapes repository root: ${relative}`);
      continue;
    }
    const target = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      continue;
    }
    const forbidden = forbiddenPathReason(relative);
    if (forbidden) {
      failures.push(`${forbidden}: ${relative}`);
      continue;
    }
    const stat = fs.statSync(target);
    if (stat.size > TEXT_LIMIT) {
      continue;
    }
    const buffer = fs.readFileSync(target);
    if (buffer.includes(0)) {
      continue;
    }
    const content = buffer.toString('utf8');
    failures.push(...auditText(relative, content));
  }

  for (const required of REQUIRED_PUBLIC_FILES) {
    const target = path.join(root, required);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      failures.push(`required public file is missing: ${required}`);
    }
  }

  const licensePath = path.join(root, 'LICENSE');
  if (fs.existsSync(licensePath) && fs.statSync(licensePath).isFile()) {
    const digest = normalizedLicenseSha256(licensePath);
    if (digest !== APPROVED_LICENSE_SHA256) {
      failures.push('LICENSE does not match the approved GNU AGPL v3 text');
    }
  }
  for (const relative of ['web/legal-artifacts/LICENSE']) {
    const target = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(target) || normalizedLicenseSha256(target) !== APPROVED_LICENSE_SHA256) {
      failures.push(`${relative} must be an exact copy of LICENSE`);
    }
  }
  const noticeCopy = path.join(root, 'web', 'legal-artifacts', 'THIRD-PARTY-NOTICES.md');
  const rootNotice = path.join(root, 'THIRD-PARTY-NOTICES.md');
  if (!fs.existsSync(noticeCopy) || !fs.existsSync(rootNotice) || fs.readFileSync(noticeCopy).compare(fs.readFileSync(rootNotice)) !== 0) {
    failures.push('web/legal-artifacts/THIRD-PARTY-NOTICES.md must exactly match the root notice');
  }
  auditLicenseMetadata(root, failures);
  return failures;
}

function auditHistoricalPaths(paths) {
  const failures = [];
  for (const relative of [...new Set(paths.map(normalizeRelative))].sort()) {
    const reason = forbiddenPathReason(relative);
    if (reason) {
      failures.push(`forbidden historical path requires a clean export: ${relative}`);
    }
  }
  return failures;
}

function main() {
  const args = process.argv.slice(2);
  const fixtureIndex = args.indexOf('--fixture');
  const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;
  const known = new Set(['--history', '--fixture', fixturePath]);
  const unknown = args.filter((argument) => !known.has(argument));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(', ')}`);
  }
  if (fixtureIndex >= 0 && !fixturePath) throw new Error('--fixture requires a path');
  if (fixturePath) {
    const failures = verifyScannerFixture(path.resolve(fixturePath));
    if (failures.length > 0) {
      failures.forEach((failure) => console.error(`ERROR: ${failure}`));
      process.exitCode = 1;
      return;
    }
    console.log('Security scanner fixture corpus verified.');
    return;
  }
  const root = path.resolve(__dirname, '..', '..');
  const failures = auditPublication(root);
  if (args.includes('--history')) {
    failures.push(...auditHistoricalPaths(listHistoryPaths(root)));
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`ERROR: ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    args.includes('--history')
      ? 'Publication audit passed for the current App tree and history.'
      : 'Publication audit passed for the current App tree.',
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  APPROVED_LICENSE_SHA256,
  auditHistoricalPaths,
  auditPublication,
  auditText,
  forbiddenPathReason,
  listHistoryPaths,
  listPublicationFiles,
  normalizedLicenseSha256,
  verifyScannerFixture,
};
