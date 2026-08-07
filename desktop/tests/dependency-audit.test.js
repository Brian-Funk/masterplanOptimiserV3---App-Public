const assert = require('node:assert/strict');
const test = require('node:test');

const { validateAuditReport } = require('../scripts/audit-dependencies');

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
  assert.deepEqual(validateAuditReport(report({}, 0)), { clean: true });
});

test('dependency audit rejects every advisory without an exception path', () => {
  assert.throws(
    () => validateAuditReport(report({
      'brace-expansion': { via: [{ source: 1 }] },
    }, 1)),
    /brace-expansion/,
  );
});
