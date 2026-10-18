# LatticePolicy Agent Guide

This file is the first-stop guide for AI coding agents working in this
repository. Read it before editing code, then open the linked docs for the
area you are changing.

## Project Orientation

- For the private document/LLM work (merged in #378), read
  `docs/ACTIVE_WORK_HANDOFF.md` first. It records decisions, verification and
  remaining carrier-environment work; confirm these against the current checkout.
- Start with `docs/PROJECT_CONTEXT.md` for the domain, architecture, major
  modules, security model, and common commands.
- Use `docs/TEST_PLAN.md` to choose the right automated test layer.
- Use `docs/AI_CONTRIBUTOR_PROCESS.md` for the required AI-readable handoff
  and documentation process.
- For local setup, use `docs/DEVELOPER_SETUP.md`.
- Before moving code between modules or adding a shared package, read
  `docs/MODULES.md` (target modules, decisions, and how shared packages build).
- If you are working an issue linked from a roadmap epic (#69-#76 or any
  later epic), or asked to audit/close one, use `docs/EPIC_WORKFLOW.md`.
  Closing an issue or epic is a shared-state action a maintainer should
  perform or explicitly authorize; propose the close with evidence rather
  than assuming you're allowed to do it.

- For broker submission intake (AI drafting with human approval), read
  `docs/SUBMISSION_INTAKE.md`.

- For frontend controls, follow `docs/UI_CONTROL_STANDARDS.md`; use the shared
  `RadioGroup` for all radio choices and include new screens in the UI audit.

## Repository Shape

- `frontend/`: React, Vite, React Query, Zustand, route guards, and UI flows.
- `server/`: Express TypeScript API, auth, tenancy, RBAC, lifecycle, rating,
  persistence, migrations, and background worker startup.
- `services/document-processor/`: separately deployed private OCR/LLM service.
  Read `docs/PRIVATE_DOCUMENT_PROCESSING.md` before changing inference,
  extraction profiles, or the service boundary.
  For candidate readiness emails, technical-admin approval, or activation,
  also read `docs/LLM_RELEASE_GOVERNANCE.md`.
- `services/document-learning/`: operator-run approved datasets, profile learning,
  held-out evaluation and optional offline weight training. Read
  `docs/DOCUMENT_LEARNING.md`; raw submissions never become training data
  automatically, and test email defaults off.
- `packages/types/`: shared TypeScript types and Zod schemas.
- `packages/rules/`: shared runtime package (rule expressions, screen rules)
  imported by both server and frontend. See `docs/MODULES.md`.
- `products/`: product coverage and rate YAML files.
- `tenants/`: tenant configuration and overrides.
- `contracts/`: JSON schemas and sample seed data.
- `deploy/carrier-stack/`: per-carrier stack deployment kit.
- `examples/carrier-pack/`: example carrier pack (carrier-owned products, fields, overrides).
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
- Carrier-private inference must not fall back to external AI. Never turn
  uploads/reviewer corrections into training examples automatically; profile
  publication requires reviewed synthetic or explicitly consented data.
- Only a currently assigned carrier technical admin may authorize LLM
  validation/production; a training identity cannot approve its own release.
  Never disable signed activation in a carrier validation/production stack.
- AI governance audit logs (`submission_events`, `llm_release_audit`) are
  append-only and hash-chained; never add UPDATE/DELETE paths. Record who acted
  as `ai`/`automation`/`system`/`user`; the AI and automation never perform a
  person's confirmation or approval. See `docs/LLM_RELEASE_GOVERNANCE.md`.
