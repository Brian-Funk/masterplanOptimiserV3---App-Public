const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'build.yml');

function normalizeWorkflow(content) {
  return content.replace(/\r\n?/g, '\n');
}

function releaseWorkflow() {
  return normalizeWorkflow(fs.readFileSync(workflowPath, 'utf8'));
}

test('release workflow assertions are independent of checkout line endings', () => {
  assert.equal(normalizeWorkflow('first\r\nsecond\rthird\n'), 'first\nsecond\nthird\n');
});

test('tagged and recovered releases require a signed green public commit and synced version', () => {
  const workflow = releaseWorkflow();
  const globalPermissions = workflow.match(/permissions:\n([\s\S]*?)\njobs:/)?.[1] ?? '';
  const releaseJob = workflow.split('\n  release:')[1] ?? '';

  assert.doesNotMatch(globalPermissions, /id-token:/);
  assert.match(releaseJob, /permissions:\n\s+contents: write\n\s+id-token: write/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /desktop-ci-result/);
  assert.match(workflow, /npm --prefix desktop run audit:publication:history/);
  assert.match(workflow, /sort_by\(\.id\) \| last/);
  assert.match(workflow, /\.status \/\/ "missing"/);
  assert.doesNotMatch(workflow, /sort_by\(\.started_at\)/);
  assert.match(workflow, /\.private == false and \.visibility == "public"/);
  assert.doesNotMatch(workflow, /\.private == false &&/);
  assert.match(workflow, /GITHUB_REF" == refs\/heads\/main/);
  assert.match(workflow, /git merge-base --is-ancestor "\$tag_commit" origin\/main/);
  assert.match(workflow, /\.verification\.verified == true/);
  assert.match(workflow, /commits\/\$\{tag_commit\}\/check-runs/);
  assert.match(workflow, /desktop\/package\.json/);
  assert.match(workflow, /web\/package\.json/);
  assert.match(workflow, /compute\/pyproject\.toml/);
});

test('release artefacts are bound to a keyless signed checksum manifest', () => {
  const workflow = releaseWorkflow();

  assert.match(
    workflow,
    /sigstore\/cosign-installer@[a-f0-9]{40}\s+# v3/,
  );
  assert.match(
    workflow,
    /cosign sign-blob --yes --bundle checksums\.txt\.bundle checksums\.txt/,
  );
  assert.match(workflow, /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(workflow, /identity="https:\/\/github\.com\/\$\{GITHUB_WORKFLOW_REF\}"/);
  assert.match(workflow, /sha256sum -c checksums\.txt/);
  assert.match(workflow, /Verify anonymous public release/);
});

test('release fails when any expected platform artefact is absent', () => {
  const workflow = releaseWorkflow();

  assert.match(workflow, /Masterplan-Optimiser-\$\{version\}\.exe/);
  assert.match(workflow, /Masterplan-Optimiser-\$\{version\}-arm64\.dmg/);
  assert.match(workflow, /Masterplan-Optimiser-\$\{version\}\.AppImage/);
  assert.match(workflow, /Missing expected release artefact/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.match(workflow, /fail_on_unmatched_files:\s*true/);
});
