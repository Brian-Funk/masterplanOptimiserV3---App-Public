/** @type {import('next').NextConfig} */
const path = require('node:path');
const { resolveSourceIdentity } = require('./source-identity.cjs');

const sourceIdentity = resolveSourceIdentity({
  repositoryRoot: path.resolve(__dirname, '..'),
});

const nextConfig = {
  output: 'standalone', // For easier Electron bundling
  allowedDevOrigins: ['127.0.0.1'],
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
    NEXT_PUBLIC_SOURCE_REPOSITORY_URL: sourceIdentity.repositoryUrl,
    NEXT_PUBLIC_SOURCE_REVISION: sourceIdentity.revision,
    NEXT_PUBLIC_SOURCE_URL: sourceIdentity.sourceUrl,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
              "img-src 'self' data: blob:",
              "connect-src 'self' http://127.0.0.1:8000 http://localhost:8000 https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
}

module.exports = nextConfig
