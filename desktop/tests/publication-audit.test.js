'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  auditHistoricalPaths,
  auditPublication,
  auditText,
  forbiddenPathReason,
  verifyScannerFixture,
} = require('../scripts/audit-publication');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const desktopCiPath = path.join(repositoryRoot, '.github', 'workflows', 'desktop-ci.yml');

function write(root, relative, content) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(repositoryRoot, 'LICENSE'), path.join(root, 'LICENSE'));
  fs.mkdirSync(path.join(root, 'web', 'legal-artifacts'), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, 'LICENSE'), path.join(root, 'web', 'legal-artifacts', 'LICENSE'));
  for (const required of ['BRANDING.md', 'CONTRIBUTING.md', 'COPYRIGHT-AND-CONTRIBUTION-PROVENANCE.md']) {
    write(root, required, `# ${required}\n`);
  }
  write(root, 'SECURITY.md', '# Security\n');
  write(root, 'SUPPORTED-VERSIONS.md', '# Supported versions\n');
  write(root, 'THIRD-PARTY-NOTICES.md', '# Third-party notices\n');
  write(root, 'web/legal-artifacts/THIRD-PARTY-NOTICES.md', '# Third-party notices\n');
  write(root, 'desktop/package.json', JSON.stringify({ license: 'AGPL-3.0-only' }));
  write(root, 'desktop/package-lock.json', JSON.stringify({ packages: { '': { license: 'AGPL-3.0-only' } } }));
  write(root, 'web/package.json', JSON.stringify({ license: 'AGPL-3.0-only' }));
  write(root, 'web/package-lock.json', JSON.stringify({ packages: { '': { license: 'AGPL-3.0-only' } } }));
  write(root, 'compute/pyproject.toml', 'license = "AGPL-3.0-only"\n');
  return {
    root,
    files: [
      'LICENSE',
      'BRANDING.md',
      'CONTRIBUTING.md',
      'COPYRIGHT-AND-CONTRIBUTION-PROVENANCE.md',
      'SECURITY.md',
      'SUPPORTED-VERSIONS.md',
      'THIRD-PARTY-NOTICES.md',
      'web/legal-artifacts/LICENSE',
      'web/legal-artifacts/THIRD-PARTY-NOTICES.md',
      'desktop/package.json',
      'desktop/package-lock.json',
      'web/package.json',
      'web/package-lock.json',
      'compute/pyproject.toml',
    ],
  };
}

test('current App tree passes the publication audit', () => {
  assert.deepEqual(auditPublication(repositoryRoot), []);
});

test('publication audit rejects a changed licence or package licence', (t) => {
  const state = fixture(t);
  fs.appendFileSync(path.join(state.root, 'LICENSE'), '\nchanged\n', 'utf8');
  write(state.root, 'desktop/package.json', JSON.stringify({ license: 'MIT' }));
  const failures = auditPublication(state.root, { files: state.files });
  assert.ok(failures.some((failure) => failure.includes('approved GNU AGPL v3 text')));
  assert.ok(failures.some((failure) => failure.includes('desktop/package.json license')));
});

test('publication audit permits only the tracked public PEM path', (t) => {
  const state = fixture(t);
  write(state.root, 'desktop/assets/manifest-public.pem', '-----BEGIN PUBLIC KEY-----\n');
  write(state.root, 'secrets/private.pem', 'not a public release artefact\n');
  const failures = auditPublication(state.root, {
    files: [...state.files, 'desktop/assets/manifest-public.pem', 'secrets/private.pem'],
  });
  assert.ok(failures.some((failure) => failure.includes('secrets/private.pem')));
  assert.ok(!failures.some((failure) => failure.includes('desktop/assets/manifest-public.pem')));
});

test('publication audit rejects secret-shaped values without printing them', (t) => {
  const state = fixture(t);
  write(state.root, 'notes.txt', `SECRET_KEY=${'x'.repeat(24)}\n`);
  const failures = auditPublication(state.root, { files: [...state.files, 'notes.txt'] });
  assert.ok(failures.some((failure) => failure === 'secret-like secret assignment: notes.txt'));
  assert.ok(!failures.some((failure) => failure.includes('x'.repeat(24))));
});

test('history audit rejects private artefacts but permits the public manifest key', () => {
  assert.deepEqual(auditHistoricalPaths(['desktop/assets/manifest-public.pem']), []);
  const failures = auditHistoricalPaths(['old/.env', 'old/private.pem', 'notes/plan.md', 'CODEX_PROGRESS.md']);
  assert.equal(failures.length, 4);
  assert.ok(failures.every((failure) => failure.includes('requires a clean export')));
});

test('scanner rejects archives and sensitive evidence without echoing values', () => {
  assert.equal(forbiddenPathReason('dist/release.zip'), 'forbidden .zip artefact');
  const secret = '-----BEGIN ' + 'PRIVATE KEY-----';
  assert.deepEqual(auditText('src/config.txt', secret), ['secret-like private key: src/config.txt']);
  assert.ok(!auditText('src/config.txt', secret)[0].includes(secret));
  assert.deepEqual(
    auditText('evidence/records/1.json', '{"email":"person@example.org"}'),
    ['evidence contains email address: evidence/records/1.json'],
  );
});

test('shared Phase C scanner corpus distinguishes safe and unsafe inputs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-opt-scanner-corpus-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'fixture.json');
  fs.writeFileSync(target, JSON.stringify({
    format: 'masterplan-security-scanner-fixture-v1',
    safe: [{ id: 'safe', scope: 'evidence', path: 'evidence/records/1.json', content: '{"subject_ref":"sha256:synthetic"}' }],
    unsafe: [
      { id: 'archive', scope: 'artefact', path: 'dist/export.zip', content: '', expected: 'forbidden .zip artefact' },
      { id: 'history', scope: 'history', path: 'notes/private.md', content: '', expected: 'forbidden historical path' },
      { id: 'pii', scope: 'evidence', path: 'evidence/records/2.json', content: '{"email":"person@example.org"}', expected: 'evidence contains email address' },
    ],
  }), 'utf8');
  assert.deepEqual(verifyScannerFixture(target), []);
});

test('Desktop CI audits policy-only changes instead of treating them as irrelevant', () => {
  const workflow = fs.readFileSync(desktopCiPath, 'utf8');
  assert.match(workflow, /Audit publishable App source/);
  assert.match(workflow, /npm run audit:publication/);
  for (const required of [
    'LICENSE$',
    'SECURITY\\.md$',
    'SUPPORTED-VERSIONS\\.md$',
    'THIRD-PARTY-NOTICES\\.md$',
    '\\.github/workflows/(build|desktop-ci)\\.yml$',
  ]) {
    assert.ok(workflow.includes(required), `missing change-detector pattern: ${required}`);
  }
});
