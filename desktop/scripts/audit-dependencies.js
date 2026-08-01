/**
 * Runs npm audit while failing closed for every finding except one verified
 * registry-metadata lag affecting patched brace-expansion backports.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BRACE_ADVISORY = Object.freeze({
  source: 1124334,
  url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
});
const PATCHED_BRACE_VERSIONS = new Set(['1.1.17', '2.1.3', '5.0.8']);

function collectAdvisoryLeaves(report, vulnerabilityName, active = new Set()) {
  if (active.has(vulnerabilityName)) {
    return [];
  }

  const vulnerability = report.vulnerabilities?.[vulnerabilityName];
  if (!vulnerability || !Array.isArray(vulnerability.via)) {
    throw new Error(`npm audit referenced missing vulnerability ${vulnerabilityName}`);
  }

  const nextActive = new Set(active);
  nextActive.add(vulnerabilityName);
  const leaves = [];
  for (const source of vulnerability.via) {
    if (typeof source === 'string') {
      leaves.push(...collectAdvisoryLeaves(report, source, nextActive));
    } else if (source && typeof source === 'object') {
      leaves.push(source);
    } else {
      throw new Error(`npm audit returned an invalid source for ${vulnerabilityName}`);
    }
  }
  return leaves;
}

function validateAuditReport(report) {
  const vulnerabilities = report?.vulnerabilities;
  const totals = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || !totals || typeof totals.total !== 'number') {
    throw new Error('npm audit returned an unsupported report shape');
  }

  if (totals.total === 0 && Object.keys(vulnerabilities).length === 0) {
    return { clean: true, tolerated: false };
  }

  if (!vulnerabilities['brace-expansion']) {
    throw new Error('npm audit reported findings outside the verified brace-expansion chain');
  }

  for (const name of Object.keys(vulnerabilities)) {
    const leaves = collectAdvisoryLeaves(report, name);
    if (leaves.length === 0) {
      throw new Error(`npm audit returned no advisory source for ${name}`);
    }
    const unexpected = leaves.find(
      (leaf) => leaf.source !== BRACE_ADVISORY.source || leaf.url !== BRACE_ADVISORY.url,
    );
    if (unexpected) {
      throw new Error(`npm audit reported an unapproved advisory through ${name}`);
    }
  }

  return { clean: false, tolerated: true };
}

function verifyPatchedBraceExpansionTree(projectDir) {
  const lockPath = path.join(projectDir, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const installations = Object.entries(lock.packages || {}).filter(([packagePath]) =>
    packagePath === 'node_modules/brace-expansion' ||
    packagePath.endsWith('/node_modules/brace-expansion'),
  );
  if (installations.length === 0) {
    throw new Error('No brace-expansion installation was found in package-lock.json');
  }

  const verified = [];
  for (const [packagePath, metadata] of installations) {
    if (!PATCHED_BRACE_VERSIONS.has(metadata.version)) {
      throw new Error(`Unverified brace-expansion version ${metadata.version} at ${packagePath}`);
    }

    const installationPath = path.join(projectDir, ...packagePath.split('/'));
    const installedMetadata = JSON.parse(
      fs.readFileSync(path.join(installationPath, 'package.json'), 'utf8'),
    );
    if (installedMetadata.version !== metadata.version) {
      throw new Error(`Installed brace-expansion version differs from the lockfile at ${packagePath}`);
    }

    const implementation = require(installationPath);
    const expand = typeof implementation === 'function' ? implementation : implementation.expand;
    if (typeof expand !== 'function') {
      throw new Error(`brace-expansion has no callable implementation at ${packagePath}`);
    }

    const output = expand('{a,b}'.repeat(20), { maxLength: 1000 });
    const outputLength = Array.isArray(output)
      ? output.reduce((total, value) => total + value.length, 0)
      : Number.POSITIVE_INFINITY;
    if (outputLength > 1000) {
      throw new Error(`brace-expansion does not enforce maxLength at ${packagePath}`);
    }
    verified.push(`${packagePath}@${metadata.version}`);
  }
  return verified;
}

function runNpmAudit(projectDir) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmExecPath ? [npmExecPath, 'audit', '--json'] : ['audit', '--json'];
  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not parse npm audit output: ${error.message}`);
  }
  return { report, result };
}

function main() {
  const projectDir = path.resolve(__dirname, '..');
  const { report, result } = runNpmAudit(projectDir);
  const decision = validateAuditReport(report);
  if (decision.clean) {
    console.log('npm audit found 0 vulnerabilities.');
    return;
  }

  const verified = verifyPatchedBraceExpansionTree(projectDir);
  console.warn(
    `npm audit advisory metadata has not recognised patched brace-expansion backports; ` +
    `${verified.length} installed copies passed the bounded-expansion regression.`,
  );
  for (const entry of verified) console.warn(`Verified: ${entry}`);
  if (result.stderr.trim()) console.warn(result.stderr.trim());
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  BRACE_ADVISORY,
  collectAdvisoryLeaves,
  validateAuditReport,
  verifyPatchedBraceExpansionTree,
};
