/**
 * Validates the Next.js standalone output before electron-builder packages it.
 * This prevents installers that contain server.js but miss the runtime modules.
 */

const fs = require('fs');
const path = require('path');

const webDir = path.join(__dirname, '..', '..', 'web');
const standaloneDir = path.join(webDir, '.next', 'standalone');

const requiredPaths = [
  path.join(standaloneDir, 'server.js'),
  path.join(standaloneDir, 'node_modules', 'next', 'package.json'),
  path.join(standaloneDir, 'node_modules', 'react', 'package.json'),
  path.join(standaloneDir, 'node_modules', 'react-dom', 'package.json'),
  path.join(webDir, '.next', 'static'),
];

const missing = requiredPaths.filter((entry) => !fs.existsSync(entry));

if (missing.length > 0) {
  console.error('Frontend bundle is incomplete. Run npm --prefix ../web run build before packaging.');
  for (const entry of missing) {
    console.error(`Missing: ${entry}`);
  }
  process.exit(1);
}

console.log('Frontend bundle verified.');
