const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveDesktopRuntimeConfig } = require('../runtime-config');
const { buildDesktopBackendEnv } = require('../user-data-paths');

test('runtime configuration supports distinct temporary loopback ports', () => {
  const config = resolveDesktopRuntimeConfig({
    API_URL: 'http://localhost:18123',
    FRONTEND_URL: 'http://127.0.0.1:18124',
  });
  assert.equal(config.backendUrl, 'http://127.0.0.1:18123');
  assert.equal(config.frontendUrl, 'http://127.0.0.1:18124');
  assert.deepEqual(config.backendUrlPatterns, [
    'http://127.0.0.1:18123/*',
    'http://localhost:18123/*',
  ]);

  const env = buildDesktopBackendEnv({}, {
    databaseUrl: 'sqlite:///test.db',
    encryptionKeyPath: 'key',
    userDataDir: 'user-data',
    dataDir: 'data',
  }, 'token', config);
  assert.equal(env.API_HOST, '127.0.0.1');
  assert.equal(env.API_PORT, '18123');
  assert.equal(env.OPTIMIZER_URL, 'http://127.0.0.1:18123/compute');
  assert.deepEqual(JSON.parse(env.CORS_ORIGINS), [
    'http://127.0.0.1:18124',
    'http://localhost:18124',
  ]);
});

test('runtime configuration rejects non-loopback or ambiguous origins', () => {
  for (const API_URL of [
    'https://127.0.0.1:8000',
    'http://0.0.0.0:8000',
    'http://user:pass@127.0.0.1:8000',
    'http://127.0.0.1:8000/api',
    'not a url',
  ]) {
    assert.throws(() => resolveDesktopRuntimeConfig({ API_URL }), /Backend URL/);
  }
  assert.throws(() => resolveDesktopRuntimeConfig({
    API_URL: 'http://127.0.0.1:4000',
    FRONTEND_URL: 'http://localhost:4000',
  }), /must be different/);
});
