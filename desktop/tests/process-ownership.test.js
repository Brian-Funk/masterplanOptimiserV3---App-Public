const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  createOwnedProcessRegistry,
  terminateProcessTree,
} = require('../process-ownership');

function fakeProcess(pid) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.exitCode = null;
  proc.killed = false;
  proc.killCalls = [];
  proc.kill = (signal) => proc.killCalls.push(signal);
  return proc;
}

test('Windows termination targets only the validated owned PID tree', () => {
  const calls = [];
  const proc = fakeProcess(4312);
  assert.equal(terminateProcessTree(proc, {
    platform: 'win32',
    execFileSync: (...args) => calls.push(args),
  }), true);

  assert.deepEqual(calls, [[
    'taskkill.exe',
    ['/F', '/PID', '4312', '/T'],
    { timeout: 5000, windowsHide: true },
  ]]);
  assert.equal(JSON.stringify(calls).includes('/IM'), false);
});

test('registry terminates registered children and forgets exited children', () => {
  const calls = [];
  const registry = createOwnedProcessRegistry({
    platform: 'win32',
    execFileSync: (...args) => calls.push(args),
  });
  const backend = registry.register('backend', fakeProcess(111));
  const frontend = registry.register('frontend', fakeProcess(222));

  backend.emit('exit', 0);
  assert.deepEqual(registry.labels(), ['frontend']);
  assert.deepEqual(registry.terminateAll(), [{ label: 'frontend', terminated: true }]);
  assert.deepEqual(calls[0][1], ['/F', '/PID', '222', '/T']);
  assert.equal(registry.get('backend'), undefined);
  assert.equal(registry.get('frontend'), undefined);
  assert.equal(frontend.killCalls.length, 0);
});

test('invalid PIDs are rejected before any command executes', () => {
  let called = false;
  assert.throws(() => terminateProcessTree(fakeProcess('7 & taskkill /IM electron.exe'), {
    platform: 'win32',
    execFileSync: () => { called = true; },
  }), /Invalid owned process identifier/);
  assert.equal(called, false);
});
