# Security Policy

## Reporting a vulnerability

Please email **security@jellypod.ai**. Do **not** open a public GitHub issue for security
vulnerabilities — give us a chance to fix it first.

Include what you found, how to reproduce it, and the impact you believe it has. We'll acknowledge
your report and keep you updated as we work on a fix.

## Scope notes

- The web studio (`apps/web`) is designed as a **local tool**: it proxies your own API keys from
  `.env.local` and writes to your local disk. It is not hardened for public deployment, and
  deploying it publicly as-is is out of scope as a vulnerability (but reports about making it
  safer are welcome).
- API keys never belong in the repo. If you find one committed, report it immediately.
