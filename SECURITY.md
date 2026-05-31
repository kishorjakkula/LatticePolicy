# Security Policy

## Supported Versions

The project is pre-1.0. Security fixes are applied to the main branch unless a release branch is explicitly maintained.

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

Email the maintainers or use the repository's private vulnerability reporting feature if it is enabled. Include:

- Affected component
- Steps to reproduce
- Impact assessment
- Suggested mitigation, if known

Maintainers should acknowledge reports within 5 business days and coordinate disclosure after a fix or mitigation is available.

## Security Expectations

- Never commit secrets, credentials, certificates, or production `.env` files.
- Keep tenant isolation checks in API and data access changes.
- Treat policy, claims, customer, and rating data as sensitive.
- Use strong local secrets when testing authentication or token flows.
