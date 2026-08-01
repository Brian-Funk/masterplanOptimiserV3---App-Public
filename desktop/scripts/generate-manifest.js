/**
 * electron-builder afterPack hook
 * Generates a signed hash manifest of the complete packaged application,
 * backend, and frontend resource trees.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  MANIFEST_FORMAT,
  PROTECTED_ROOTS,
  buildManifestFileMap,
  publicKeysMatch,
} = require('../integrity');

function assertInside(parentDir, targetPath) {
  const relative = path.relative(parentDir, targetPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return;
  }
  throw new Error(`Refusing to write outside expected directory: ${targetPath}`);
}

function requirePath(sourcePath, description) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`${description} not found: ${sourcePath}`);
  }
}

function copyDirectory(sourcePath, targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function copyPackagedFrontend(context, resourcesDir) {
  const projectDir =
    context.projectDir ||
    context.packager?.projectDir ||
    context.packager?.info?.projectDir ||
    process.cwd();
  const webDir = path.resolve(projectDir, '..', 'web');
  const standaloneDir = path.join(webDir, '.next', 'standalone');
  const staticDir = path.join(webDir, '.next', 'static');
  const publicDir = path.join(webDir, 'public');
  const frontendDir = path.join(resourcesDir, 'frontend');

  requirePath(standaloneDir, 'Next.js standalone output');
  requirePath(path.join(standaloneDir, 'server.js'), 'Next.js standalone server');
  requirePath(staticDir, 'Next.js static output');
  assertInside(resourcesDir, frontendDir);

  console.log(`[manifest] Copying frontend bundle from ${standaloneDir}`);
  copyDirectory(standaloneDir, frontendDir);

  const packagedStaticDir = path.join(frontendDir, '.next', 'static');
  assertInside(frontendDir, packagedStaticDir);
  copyDirectory(staticDir, packagedStaticDir);

  if (fs.existsSync(publicDir)) {
    const packagedPublicDir = path.join(frontendDir, 'public');
    assertInside(frontendDir, packagedPublicDir);
    copyDirectory(publicDir, packagedPublicDir);
  }
}

function assertPackagedFrontend(resourcesDir) {
  const required = [
    path.join(resourcesDir, 'frontend', 'server.js'),
    path.join(resourcesDir, 'frontend', 'node_modules', 'next', 'package.json'),
    path.join(resourcesDir, 'frontend', 'node_modules', 'react', 'package.json'),
    path.join(resourcesDir, 'frontend', 'node_modules', 'react-dom', 'package.json'),
    path.join(resourcesDir, 'frontend', '.next', 'static'),
  ];

  const missing = required.filter((entry) => !fs.existsSync(entry));
  if (missing.length > 0) {
    throw new Error(
      `Packaged frontend is incomplete. Missing:\n${missing
        .map((entry) => `  ${entry}`)
        .join('\n')}`,
    );
  }
}

function resolveResourcesDir(context) {
  if (context.electronPlatformName !== 'darwin') {
    return path.join(context.appOutDir, 'resources');
  }

  const productFilename = context.packager?.appInfo?.productFilename;
  if (!productFilename) {
    throw new Error('Packaged macOS product filename is unavailable');
  }
  return path.join(
    context.appOutDir,
    `${productFilename}.app`,
    'Contents',
    'Resources',
  );
}

function materializeProtectedSymlinks(resourcesDir) {
  const activeDirectories = new Set();

  const visit = (entryPath) => {
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      let resolvedPath;
      try {
        resolvedPath = fs.realpathSync(entryPath);
      } catch (error) {
        throw new Error(
          `Could not resolve protected symbolic link ${path.relative(resourcesDir, entryPath)}: ${error.message}`,
        );
      }

      const relativeTarget = path.relative(resourcesDir, resolvedPath);
      if (
        !relativeTarget ||
        relativeTarget === '..' ||
        relativeTarget.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeTarget)
      ) {
        throw new Error(
          `Protected symbolic link escapes packaged resources: ${path.relative(resourcesDir, entryPath)}`,
        );
      }

      const targetStat = fs.statSync(resolvedPath);
      if (targetStat.isDirectory()) {
        const relativeEntry = path.relative(resolvedPath, entryPath);
        if (
          !relativeEntry ||
          (!relativeEntry.startsWith(`..${path.sep}`) &&
            relativeEntry !== '..' &&
            !path.isAbsolute(relativeEntry))
        ) {
          throw new Error(
            `Protected symbolic link creates a directory cycle: ${path.relative(resourcesDir, entryPath)}`,
          );
        }

        const sourceKey = path.resolve(resolvedPath);
        const destinationKey = path.resolve(entryPath);
        if (activeDirectories.has(sourceKey) || activeDirectories.has(destinationKey)) {
          throw new Error(
            `Protected symbolic link creates a directory cycle: ${path.relative(resourcesDir, entryPath)}`,
          );
        }

        fs.unlinkSync(entryPath);
        fs.cpSync(resolvedPath, entryPath, {
          recursive: true,
          dereference: false,
          preserveTimestamps: true,
        });
        console.log(
          `[manifest] Materialized protected directory symbolic link ${path.relative(resourcesDir, entryPath)}`,
        );

        activeDirectories.add(sourceKey);
        activeDirectories.add(destinationKey);
        try {
          visit(entryPath);
        } finally {
          activeDirectories.delete(sourceKey);
          activeDirectories.delete(destinationKey);
        }
        return;
      }

      if (!targetStat.isFile()) {
        throw new Error(
          `Protected symbolic link must resolve to a regular file or directory: ${path.relative(resourcesDir, entryPath)}`,
        );
      }

      const contents = fs.readFileSync(resolvedPath);
      fs.unlinkSync(entryPath);
      fs.writeFileSync(entryPath, contents, { mode: targetStat.mode & 0o777 });
      console.log(
        `[manifest] Materialized protected symbolic link ${path.relative(resourcesDir, entryPath)}`,
      );
      return;
    }

    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(entryPath).sort()) {
        visit(path.join(entryPath, entry));
      }
    }
  };

  for (const root of PROTECTED_ROOTS) {
    const rootPath = path.join(resourcesDir, root);
    requirePath(rootPath, `Required protected resource ${root}`);
    visit(rootPath);
  }
}

module.exports = async function afterPack(context) {
  const projectDir =
    context.projectDir ||
    context.packager?.projectDir ||
    context.packager?.info?.projectDir ||
    process.cwd();
  const resourcesDir = resolveResourcesDir(context);
  if (!fs.existsSync(resourcesDir)) {
    throw new Error(`Packaged resources directory not found: ${resourcesDir}`);
  }

  copyPackagedFrontend(context, resourcesDir);
  assertPackagedFrontend(resourcesDir);
  materializeProtectedSymlinks(resourcesDir);

  const version = context.packager.appInfo.version;
  const fileMap = buildManifestFileMap(resourcesDir);

  const manifest = JSON.stringify(
    {
      format: MANIFEST_FORMAT,
      version,
      timestamp: new Date().toISOString(),
      protectedRoots: PROTECTED_ROOTS,
      files: fileMap,
    },
    null,
    2,
  );

  const privateKeyPem = process.env.MANIFEST_SIGNING_KEY;
  if (!privateKeyPem) {
    throw new Error('MANIFEST_SIGNING_KEY is required for every packaged build');
  }
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('MANIFEST_SIGNING_KEY must contain an Ed25519 private key');
  }

  const publicKeyPath = path.join(projectDir, 'assets', 'manifest-public.pem');
  requirePath(publicKeyPath, 'Tracked manifest public key');
  if (!publicKeysMatch(privateKey, fs.readFileSync(publicKeyPath, 'utf8'))) {
    throw new Error('MANIFEST_SIGNING_KEY does not match assets/manifest-public.pem');
  }

  const signature = crypto
    .sign(null, Buffer.from(manifest, 'utf8'), privateKey)
    .toString('base64');
  console.log(`[manifest] Signed manifest with Ed25519 (${Object.keys(fileMap).length} files)`);

  const wrapper = JSON.stringify(
    {
      signed: true,
      manifest,
      signature,
    },
    null,
    2,
  );

  const outPath = path.join(resourcesDir, 'manifest.signed.json');
  fs.writeFileSync(outPath, wrapper, 'utf-8');
  console.log(`[manifest] Wrote ${outPath}`);
};
