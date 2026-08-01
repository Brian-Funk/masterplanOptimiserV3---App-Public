# Security policy

## Supported versions

Only the latest signed Desktop release receives security fixes. Development
branches, locally built packages, and unsigned workflow runs are not production
releases. See [SUPPORTED-VERSIONS.md](SUPPORTED-VERSIONS.md).

## Reporting a vulnerability

Do not open a public issue containing exploit details, personal data,
credentials, calendar identifiers, server addresses, encryption material, or
recovery data. Use GitHub's private vulnerability reporting for this repository.
If that feature is unavailable, contact the maintainer privately before sharing
technical details.

Include the affected release, operating system and architecture, reproducible
impact, and the least sensitive evidence needed to investigate. Never send a
Desktop database, `encryption.key`, OAuth token, publish secret, original event
data, packaged-manifest private key, or signing identity.

## Desktop and release boundary

Masterplan Optimiser Desktop runs its backend and frontend on loopback and uses
a per-launch token for local API access. Packaged resources are covered by a
signed integrity manifest and startup fails closed if protected resources are
missing, modified, unsigned, incomplete, or unexpected.

Official release packages must be verified against the keyless Cosign-signed
`checksums.txt` published by the tagged release workflow. A checksum obtained
from the same unverified download location is not, by itself, proof of
authenticity.

See [docs/security.md](docs/security.md) for the application threat boundary and
[docs/deployment.md](docs/deployment.md) for the release-verification procedure.
