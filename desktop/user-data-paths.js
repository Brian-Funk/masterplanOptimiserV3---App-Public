const fs = require('fs');
const path = require('path');

const DATA_DIR_NAME = 'data';
const DATABASE_FILE_NAME = 'masterplan.db';
const ENCRYPTION_KEY_FILE_NAME = 'encryption.key';
const SQLITE_COMPANION_SUFFIXES = ['-journal', '-shm', '-wal'];

/**
 * Convert a filesystem database path into the absolute SQLite URL used by SQLAlchemy.
 */
function buildSqliteDatabaseUrl(databasePath) {
  return `sqlite:///${path.resolve(databasePath).replace(/\\/g, '/')}`;
}

/**
 * Resolve persistent desktop data paths from Electron's stable user-data directory.
 */
function resolveDesktopDataPaths(userDataDir) {
  const dataDir = path.join(userDataDir, DATA_DIR_NAME);
  const databasePath = path.join(dataDir, DATABASE_FILE_NAME);
  const encryptionKeyPath = path.join(dataDir, ENCRYPTION_KEY_FILE_NAME);

  return {
    userDataDir,
    dataDir,
    databasePath,
    databaseUrl: buildSqliteDatabaseUrl(databasePath),
    encryptionKeyPath,
  };
}

/**
 * Apply owner-only POSIX permissions to existing desktop database material.
 * Windows relies on the access controls of Electron's per-user data directory.
 */
function hardenDesktopDataPermissions(paths, platform = process.platform) {
  if (platform === 'win32') return;

  fs.chmodSync(paths.dataDir, 0o700);
  const protectedFiles = [
    paths.databasePath,
    paths.encryptionKeyPath,
    ...SQLITE_COMPANION_SUFFIXES.map((suffix) => `${paths.databasePath}${suffix}`),
  ];
  for (const filePath of protectedFiles) {
    if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
  }
}

/**
 * Resolve every supported desktop storage category used by deletion evidence.
 * The result contains paths and policy metadata only, never file contents.
 */
function resolveDesktopStorageInventory({ userDataDir, downloadsDir, tempDir }) {
  const paths = resolveDesktopDataPaths(userDataDir);
  return [
    {
      id: 'desktop_database',
      path: paths.databasePath,
      controller: 'application',
      eventDeletionCoverage: 'Event-scoped rows are deleted with SQLite secure deletion enabled.',
    },
    {
      id: 'desktop_encryption_key',
      path: paths.encryptionKeyPath,
      controller: 'application',
      eventDeletionCoverage: 'Shared across the desktop database and retained while any database data remains.',
    },
    {
      id: 'electron_user_data',
      path: paths.userDataDir,
      controller: 'application-and-operator',
      eventDeletionCoverage: 'Runtime browser state is not represented as an event export and requires whole-profile cleanup when applicable.',
    },
    {
      id: 'user_exports_and_diagnostics',
      path: downloadsDir,
      controller: 'operator',
      eventDeletionCoverage: 'User-created exports, setup files and log dumps must be located and deleted by the operator.',
    },
    {
      id: 'operator_backups_and_cloud_copies',
      path: null,
      controller: 'operator',
      eventDeletionCoverage: 'All controller-selected backup media and synchronised folders must be covered by the deletion attestation.',
    },
    {
      id: 'synthetic_test_temporary_data',
      path: tempDir,
      controller: 'application',
      eventDeletionCoverage: 'Packaged-smoke and test fixtures contain synthetic data and are removed in finally/cleanup handlers.',
    },
  ];
}

/**
 * Prepare the user-data directory without creating or overwriting persistent files.
 */
function prepareDesktopUserData({ userDataDir, logger = console }) {
  const paths = resolveDesktopDataPaths(userDataDir);
  fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  hardenDesktopDataPermissions(paths);

  const databaseExists = fs.existsSync(paths.databasePath);
  const encryptionKeyExists = fs.existsSync(paths.encryptionKeyPath);

  logger?.log?.(`[User Data] Active desktop data directory: ${paths.dataDir}`);
  logger?.log?.(`[User Data] Active desktop database path: ${paths.databasePath}`);
  logger?.log?.(
    databaseExists
      ? '[User Data] Existing desktop database found and will be reused.'
      : '[User Data] No existing desktop database found. A new one will be created by the backend.',
  );

  return {
    ...paths,
    databaseExists,
    encryptionKeyExists,
  };
}

/**
 * Build backend environment variables that keep persistent data outside the app bundle.
 */
function buildDesktopBackendEnv(baseEnv, paths, desktopAuthToken, runtimeConfig) {
  const runtime = runtimeConfig || {
    backendPort: 8000,
    backendUrl: 'http://127.0.0.1:8000',
    frontendOrigins: new Set(['http://127.0.0.1:3000', 'http://localhost:3000']),
  };
  return {
    ...baseEnv,
    ENVIRONMENT: 'desktop',
    DESKTOP_AUTH_TOKEN: desktopAuthToken,
    DATABASE_URL: paths.databaseUrl,
    ENCRYPTION_KEY_PATH: paths.encryptionKeyPath,
    MASTERPLAN_USER_DATA_DIR: paths.userDataDir,
    MASTERPLAN_DATA_DIR: paths.dataDir,
    API_HOST: '127.0.0.1',
    API_PORT: String(runtime.backendPort),
    CORS_ORIGINS: JSON.stringify([...runtime.frontendOrigins]),
    OPTIMIZER_URL: `${runtime.backendUrl}/compute`,
  };
}

/**
 * Refresh the source-tree backend environment file for development only.
 * Packaged backends receive their complete configuration through the spawned
 * process environment and must never write inside signed application resources.
 */
function prepareBackendEnvironmentFile({ backendPath, isDev, logger = console }) {
  const envDesktopPath = path.join(backendPath, '.env.desktop');
  const envPath = path.join(backendPath, '.env');

  if (!isDev || !fs.existsSync(envDesktopPath)) {
    return { copied: false, envDesktopPath, envPath };
  }

  fs.copyFileSync(envDesktopPath, envPath);
  logger?.log?.('Using desktop environment configuration');
  return { copied: true, envDesktopPath, envPath };
}

module.exports = {
  buildDesktopBackendEnv,
  buildSqliteDatabaseUrl,
  hardenDesktopDataPermissions,
  prepareBackendEnvironmentFile,
  prepareDesktopUserData,
  resolveDesktopDataPaths,
  resolveDesktopStorageInventory,
};
