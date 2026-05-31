# Contributing

Thank you for contributing to LatticePolicy.

## Development Setup

Prerequisites:

- Node.js 20+
- npm
- Docker Desktop

Install dependencies:

```bash
npm install
```

Run the local stack:

```bash
cp .env.example .env
docker compose up -d --build
```

Run checks before opening a pull request:

```bash
npm run build
npm run test
npm run typecheck
```

## Pull Request Guidelines

- Keep pull requests focused on one logical change.
- Include tests or explain why tests are not practical for the change.
- Update docs when changing public behavior, APIs, configuration, or deployment steps.
- Do not commit secrets, local `.env` files, build output, or dependency folders.
- Prefer existing framework extension points before adding new abstractions.

## Code Style

- TypeScript is the default implementation language.
- Keep domain logic explicit and testable.
- Use structured schema validation at service boundaries.
- Preserve tenant isolation in all APIs and data access paths.
- Avoid product- or carrier-specific assumptions in shared framework modules.

## Reporting Bugs

Use the bug report issue template and include:

- Reproduction steps
- Expected behavior
- Actual behavior
- Logs or screenshots when useful
- Environment details

## Feature Requests

For larger features, open a proposal issue first. Describe the use case, tenant/product impact, API changes, and migration needs.
