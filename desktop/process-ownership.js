const childProcess = require('child_process');

function normalisePid(value) {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid owned process identifier: ${value}`);
  }
  return pid;
}

function terminateProcessTree(proc, options = {}) {
  if (!proc || proc.exitCode !== null || proc.killed) return false;

  const pid = normalisePid(proc.pid);
  const platform = options.platform || process.platform;
  const runFile = options.execFileSync || childProcess.execFileSync;

  try {
    if (platform === 'win32') {
      runFile('taskkill.exe', ['/F', '/PID', String(pid), '/T'], {
        timeout: 5000,
        windowsHide: true,
      });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      return false;
    }
  }
  return true;
}

function createOwnedProcessRegistry(options = {}) {
  const owned = new Map();

  function register(label, proc) {
    if (typeof label !== 'string' || !label.trim()) {
      throw new Error('Owned process label is required');
    }
    normalisePid(proc?.pid);
    owned.set(label, proc);
    proc.once?.('exit', () => {
      if (owned.get(label) === proc) owned.delete(label);
    });
    return proc;
  }

  function terminate(label) {
    const proc = owned.get(label);
    owned.delete(label);
    return terminateProcessTree(proc, options);
  }

  function terminateAll() {
    const labels = [...owned.keys()];
    return labels.map((label) => ({ label, terminated: terminate(label) }));
  }

  return {
    register,
    terminate,
    terminateAll,
    get: (label) => owned.get(label),
    labels: () => [...owned.keys()],
  };
}

module.exports = {
  createOwnedProcessRegistry,
  normalisePid,
  terminateProcessTree,
};
