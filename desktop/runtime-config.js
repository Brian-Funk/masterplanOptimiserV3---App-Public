const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

function parseLoopbackServiceUrl(rawValue, defaultPort, label) {
  const value = rawValue || `http://127.0.0.1:${defaultPort}`;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }

  const port = Number(parsed.port || 80);
  if (
    parsed.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(`${label} URL must be an HTTP loopback origin with a valid port`);
  }

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    origins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
  };
}

function resolveDesktopRuntimeConfig(env = process.env) {
  const backend = parseLoopbackServiceUrl(env.API_URL, 8000, 'Backend');
  const frontend = parseLoopbackServiceUrl(env.FRONTEND_URL, 3000, 'Frontend');
  if (backend.port === frontend.port) {
    throw new Error('Backend and frontend ports must be different');
  }

  return {
    backendUrl: backend.url,
    frontendUrl: frontend.url,
    backendPort: backend.port,
    frontendPort: frontend.port,
    backendOrigins: new Set(backend.origins),
    frontendOrigins: new Set(frontend.origins),
    backendUrlPatterns: backend.origins.map((origin) => `${origin}/*`),
    frontendUrlPatterns: frontend.origins.map((origin) => `${origin}/*`),
  };
}

module.exports = {
  parseLoopbackServiceUrl,
  resolveDesktopRuntimeConfig,
};
