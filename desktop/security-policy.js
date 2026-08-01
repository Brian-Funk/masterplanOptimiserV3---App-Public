/**
 * Build the Content Security Policy used by the packaged desktop renderer.
 *
 * The packaged Next.js frontend still needs inline bootstrap scripts, but it
 * must not allow eval. Fonts are loaded from the bundled app assets instead of
 * remote Google stylesheets.
 */
function buildDesktopContentSecurityPolicy(backendOrigins = ['http://127.0.0.1:8000', 'http://localhost:8000']) {
  const connectOrigins = backendOrigins.join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${connectOrigins} https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com`,
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = {
  buildDesktopContentSecurityPolicy,
};
