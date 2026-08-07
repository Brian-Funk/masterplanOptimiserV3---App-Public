/** Run npm audit and fail closed for every reported advisory. */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function validateAuditReport(report) {
  const vulnerabilities = report?.vulnerabilities;
  const totals = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || !totals || typeof totals.total !== 'number') {
    throw new Error('npm audit returned an unsupported report shape');
  }

  if (totals.total === 0 && Object.keys(vulnerabilities).length === 0) {
    return { clean: true };
  }
  const names = Object.keys(vulnerabilities).sort().join(', ');
  throw new Error(`npm audit reported ${totals.total} vulnerability finding(s): ${names}`);
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
  validateAuditReport(report);
  if (result.status !== 0) {
    throw new Error(`npm audit exited with status ${result.status}`);
  }
  console.log('npm audit found 0 vulnerabilities.');
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
  validateAuditReport,
};
