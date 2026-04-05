# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Tarmak, please report it responsibly:

**Email:** security@tarmak.dev

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

You will receive an acknowledgment within 48 hours. We aim to release a fix within 7 days of confirmation.

**Do not** open a public GitHub issue for security vulnerabilities.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Security model

Tarmak is designed to be self-hosted. The security model assumes:

- **Authentication** — Better Auth with scrypt password hashing, configurable session expiry
- **Authorization** — three-tier role system (Owner, Member, Viewer) enforced on all API endpoints
- **Transport** — HSTS headers included; deploy behind a reverse proxy with TLS in production
- **Database** — SQLite with Drizzle ORM (parameterized queries, no raw string interpolation)
- **CORS** — configurable via `TARMAK_ALLOWED_ORIGINS`; defaults to localhost in development
- **Rate limiting** — per-IP rate limiting on authentication endpoints
- **API keys** — prefixed (`ok_`), hashed before storage, only the prefix is stored in plaintext

## Hardening for production

- Set `TARMAK_ALLOWED_ORIGINS` to your domain(s)
- Set `TARMAK_CSP` to a Content Security Policy matching your deployment
- Deploy behind a reverse proxy (nginx, Caddy) with TLS termination
- Restrict file permissions on the SQLite database file
- Use Docker with a non-root user (the default image runs as non-root)
