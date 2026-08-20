const fs = require('node:fs');
const path = require('node:path');

const webRoot = path.resolve(__dirname, '..');
const nextRoot = path.join(webRoot, '.next');
const devCache = path.join(nextRoot, 'dev');

if (path.dirname(devCache) !== nextRoot || path.basename(devCache) !== 'dev') {
  throw new Error('Refusing to clean an unexpected frontend cache path.');
}

try {
  fs.rmSync(devCache, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown';
  throw new Error(
    `The previous frontend development cache is still in use (${code}). Close the old Desktop process and retry.`,
  );
}
