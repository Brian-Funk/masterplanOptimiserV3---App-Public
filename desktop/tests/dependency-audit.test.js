const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  BRACE_ADVISORY,
  validateAuditReport,
  verifyPatchedBraceExpansionTree,
} = require('../scripts/audit-dependencies');

function report(vulnerabilities, totals = Object.keys(vulnerabilities).length) {
  return {
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: totals,
        critical: 0,
        total: totals,
      },
    },
  };
}

test('dependency audit accepts a clean report', () => {
  assert.deepEqual(validateAuditReport(report({}, 0)), { clean: true, tolerated: false });
});

test('dependency audit accepts only the verified brace-expansion advisory chain', () => {
  const advisory = {
    ...BRACE_ADVISORY,
    name: 'brace-expansion',
    severity: 'high',
  };
  const result = validateAuditReport(report({
    'brace-expansion': { via: [advisory] },
    minimatch: { via: ['brace-expansion'] },
    glob: { via: ['minimatch'] },
  }, 3));
  assert.deepEqual(result, { clean: false, tolerated: true });
});

test('dependency audit ignores graph back-edges but still requires an advisory leaf', () => {
  const result = validateAuditReport(report({
    'brace-expansion': { via: [{ ...BRACE_ADVISORY }] },
    minimatch: { via: ['brace-expansion', 'app-builder-lib'] },
    'app-builder-lib': { via: ['minimatch'] },
  }, 3));
  assert.deepEqual(result, { clean: false, tolerated: true });
});

test('dependency audit rejects every unrelated advisory', () => {
  const unrelated = {
    source: 1,
    url: 'https://github.com/advisories/GHSA-unexpected',
  };
  assert.throws(
    () => validateAuditReport(report({
      'brace-expansion': { via: [{ ...BRACE_ADVISORY }] },
      unexpected: { via: [unrelated] },
    }, 2)),
    /unapproved advisory/,
  );
});

test('installed brace-expansion backports enforce bounded expansion', () => {
  const desktopDir = path.resolve(__dirname, '..');
  const verified = verifyPatchedBraceExpansionTree(desktopDir);
  assert.ok(verified.length >= 3);
  assert.ok(verified.some((entry) => entry.endsWith('@1.1.17')));
  assert.ok(verified.some((entry) => entry.endsWith('@2.1.3')));
  assert.ok(verified.some((entry) => entry.endsWith('@5.0.8')));
});
