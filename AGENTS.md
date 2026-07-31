# LatticePolicy Agent Guide

This file is the first-stop guide for AI coding agents working in this
repository. Read it before editing code, then open the linked docs for the
area you are changing.

## Project Orientation

- Start with `docs/PROJECT_CONTEXT.md` for the domain, architecture, major
  modules, security model, and common commands.
- Use `docs/TEST_PLAN.md` to choose the right automated test layer.
- Use `docs/AI_CONTRIBUTOR_PROCESS.md` for the required AI-readable handoff
  and documentation process.
- For local setup, use `docs/DEVELOPER_SETUP.md`.

## Repository Shape

- `frontend/`: React, Vite, React Query, Zustand, route guards, and UI flows.
- `server/`: Express TypeScript API, auth, tenancy, RBAC, lifecycle, rating,
  persistence, migrations, and background worker startup.
- `packages/types/`: shared TypeScript types and Zod schemas.
- `products/`: product coverage and rate YAML files.
- `tenants/`: tenant configuration and overrides.
- `contracts/`: JSON schemas and sample seed data.
- `docs/tasks/`: AI-readable task notes for non-trivial changes.

## Required Process

1. Read the issue and the relevant project docs before editing.
2. Search with `rg` and inspect the existing local pattern in the touched area.
3. Keep changes focused to the task.
4. Add or update automated tests for every behavior change.
5. Add or update AI-readable Markdown context:
   - update existing docs when architecture, setup, API, data, security, or
     workflow behavior changes;
   - add a task note under `docs/tasks/` for non-trivial feature, bug, security,
     migration, or workflow changes.
6. Run the relevant checks and record them in the PR.

## Commands

```bash
npm install
npm run build
npm run test
npm run typecheck
npm run test:e2e
docker compose up -d --build
```

The root npm workspace lockfile is the source of truth. Prefer running install
and workspace scripts from the repository root.

## Safety Rules

- Preserve tenant isolation and backend authorization checks.
- Customer portal APIs must return customer-safe projections only.
- Do not commit secrets, `.env`, build output, local logs, or `node_modules`.
- Do not remove or rewrite unrelated user changes.
- Keep demo credentials documented as local/demo-only.
