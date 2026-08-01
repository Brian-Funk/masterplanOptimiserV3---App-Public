const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_FORMAT = 1;
const PROTECTED_ROOTS = ['app.asar', 'backend', 'frontend'];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function toManifestPath(value) {
  return value.split(path.sep).join('/');
}

function collectRegularFiles(resourcesDir, relativePath, results) {
  const absolutePath = path.join(resourcesDir, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Protected resource must not be a symbolic link: ${relativePath}`);
  }
  if (stat.isFile()) {
    results[toManifestPath(relativePath)] = sha256(absolutePath);
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error(`Unsupported protected resource type: ${relativePath}`);
  }
  for (const entry of fs.readdirSync(absolutePath).sort()) {
    collectRegularFiles(resourcesDir, path.join(relativePath, entry), results);
  }
}

function withRawAsarFilesystem(operation) {
  const hadNoAsar = Object.prototype.hasOwnProperty.call(process, 'noAsar');
  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    return operation();
  } finally {
    if (hadNoAsar) process.noAsar = previousNoAsar;
    else delete process.noAsar;
  }
}

function buildManifestFileMap(resourcesDir) {
  return withRawAsarFilesystem(() => {
    const results = {};
    for (const root of PROTECTED_ROOTS) {
      const absolutePath = path.join(resourcesDir, root);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Required protected resource not found: ${root}`);
      }
      collectRegularFiles(resourcesDir, root, results);
    }
    return results;
  });
}

function publicKeysMatch(first, second) {
  const exportOptions = { type: 'spki', format: 'der' };
  const asPublicKey = (value) => value?.type === 'public' ? value : crypto.createPublicKey(value);
  return asPublicKey(first).export(exportOptions)
    .equals(asPublicKey(second).export(exportOptions));
}

function verifySignedManifest({ resourcesDir, publicKeyPath, manifestPath }) {
  const fileResults = [];
  try {
    const wrapper = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (wrapper.signed !== true || typeof wrapper.manifest !== 'string' || !wrapper.signature) {
      throw new Error('Manifest is not signed');
    }

    const manifest = JSON.parse(wrapper.manifest);
    if (
      manifest.format !== MANIFEST_FORMAT ||
      JSON.stringify(manifest.protectedRoots) !== JSON.stringify(PROTECTED_ROOTS) ||
      !manifest.files ||
      typeof manifest.files !== 'object' ||
      Array.isArray(manifest.files)
    ) {
      throw new Error('Manifest structure is invalid');
    }

    const signatureOk = crypto.verify(
      null,
      Buffer.from(wrapper.manifest, 'utf8'),
      crypto.createPublicKey(fs.readFileSync(publicKeyPath, 'utf8')),
      Buffer.from(wrapper.signature, 'base64'),
    );
    if (!signatureOk) {
      return { valid: false, signatureOk: false, error: 'Manifest signature verification failed', files: [] };
    }

    const actualFiles = buildManifestFileMap(resourcesDir);
    const expectedPaths = new Set(Object.keys(manifest.files));
    const actualPaths = new Set(Object.keys(actualFiles));
    for (const relativePath of [...new Set([...expectedPaths, ...actualPaths])].sort()) {
      let status = 'ok';
      if (!actualPaths.has(relativePath)) status = 'missing';
      else if (!expectedPaths.has(relativePath)) status = 'unexpected';
      else if (!/^[a-f0-9]{64}$/.test(manifest.files[relativePath])) status = 'invalid-hash';
      else if (actualFiles[relativePath] !== manifest.files[relativePath]) status = 'modified';
      fileResults.push({ path: relativePath, status });
    }

    const valid = fileResults.length > 0 && fileResults.every((entry) => entry.status === 'ok');
    return {
      valid,
      signatureOk: true,
      error: valid ? undefined : 'Protected resources do not match the signed manifest',
      files: fileResults,
    };
  } catch (error) {
    return { valid: false, signatureOk: false, error: error.message, files: fileResults };
  }
}

module.exports = {
  MANIFEST_FORMAT,
  PROTECTED_ROOTS,
  buildManifestFileMap,
  publicKeysMatch,
  sha256,
  verifySignedManifest,
};
