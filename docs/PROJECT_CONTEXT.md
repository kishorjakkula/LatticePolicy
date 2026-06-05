# LatticePolicy Project Context

This file is a quick orientation note for future local work on LatticePolicy.

## Purpose

LatticePolicy is an open-source starter framework for property and casualty insurance policy administration systems. It supports multi-tenant quote, underwriting, rating, bind, issue, endorsement, cancellation, reinstatement, renewal, administration, and customer portal workflows.

The main architectural idea is one shared policy platform with access-based experiences. Internal operations users, agents, underwriters, actuaries, administrators, and customer portal users share the same underlying domain model, but see different routes, API projections, and data based on tenant, role, permissions, and customer-policy links.

## Repository Shape

- `frontend/`: React 19, Vite, React Query, Zustand operations and customer portal UI.
- `server/`: Express TypeScript API, auth, tenancy, RBAC, policy lifecycle, quote/rating, forms, customers, onboarding, AI insights, and persistence.
- `packages/types/`: shared TypeScript types and Zod schemas.
- `products/`: product pack YAML for personal auto, homeowners, cyber, commercial auto, and professional liability.
- `tenants/sample-carrier/`: sample tenant configuration and field metadata.
- `contracts/`: JSON schemas and sample relational seed data.
- `docs/`: architecture, setup, API, domain, deployment, multitenancy, and data model documentation.
- `server/migrations/`: ordered SQL migrations applied on API startup when `DATABASE_URL` is configured.

## Runtime Stack

- Root workspace uses npm workspaces: `packages/*`, `frontend`, and `server`.
- Server: Node.js 20+, Express, TypeScript ESM, Drizzle ORM, PostgreSQL, Redis, pino logging, JWT auth, Sentry optional.
- Frontend: React, Vite, React Router, React Query, Zustand, react-hook-form, Zod, jsPDF.
- Docker Compose runs PostgreSQL on `localhost:65432`, Redis on `localhost:6379`, API on `localhost:3300`, and UI on `localhost:5173`.

Useful commands:

```bash
npm install
npm run dev:server
npm run dev:frontend
npm run build
npm run test
npm run typecheck
docker compose up -d --build
docker compose down
```

Local demo tenant is `sample-carrier`. Demo users include `admin`, `uw1`, and `agent1`, all with password `password`. The API also supports a `customer1` fallback login in in-memory mode.

## Backend Map

Server entry points:

- `server/src/index.ts`: initializes DB, cache, published rating model cache, async worker, and starts Express.
- `server/src/app.ts`: builds the Express app, auth middleware, tenancy middleware, health endpoint, auth endpoints, admin-only API docs, and `/api/v1` route mounting.
- `server/src/routes/index.ts`: composes the API route modules.

Important backend concepts:

- `auth.ts`: JWT auth, login, MFA challenge/setup, role and permission guards.
- `tenancy.ts`: resolves tenant from `X-Tenant`, query, or auth claims and provides `req.tx`.
- `db.ts`: PostgreSQL pool, migration runner, tenant-scoped transactions, Drizzle wrapper, raw SQL bridge.
- `schema.ts`: Drizzle table definitions for tenants, users, policies, transactions, versions, ratings, risks, coverages, forms, documents, RBAC, customers, AI, rating workbench, timeline, and onboarding.
- `persistence.ts`: policy projection, transaction, version, rating, risk, and coverage persistence helpers.
- `store.ts`: in-memory MVP fallback store when Postgres is unavailable.

Route areas:

- Quotes: `server/src/routes/quotes.routes.ts`, `server/src/services/quote.service.ts`, `quote-bind.service.ts`.
- Policies and lifecycle: `policies.routes.ts`, `transactions.routes.ts`, `policy.service.ts`, `lifecycle.service.ts`, `endorsement.service.ts`.
- Rating: `rating-workbench.routes.ts`, `rating.service.ts`, `ratingModelRegistry.ts`.
- Underwriting: `uw.routes.ts`, `uw.service.ts`.
- Admin: `admin.routes.ts`, `forms-admin.routes.ts`, `customers.routes.ts`, `agency-onboarding.routes.ts`.
- Portal: `customer-portal.routes.ts`, `customerPortal.ts`.
- Reference/config/products/forms/AI: `reference.routes.ts`, `config.routes.ts`, `products.routes.ts`, `forms.routes.ts`, `ai.routes.ts`.

Persistence style is mixed: newer areas use Drizzle, while some routes still use raw SQL through `toRawQuery` during migration. New code should prefer existing local patterns in the touched module.

## Frontend Map

Frontend entry points:

- `frontend/src/main.tsx`: React root, Sentry, QueryClient, providers.
- `frontend/src/App.tsx`: lazy route tree, top navigation, permission-gated menus, global search, tenant date preference application.
- `frontend/src/api/request.ts`: API base request helper, tenant and auth headers, unauthorized handling, blob requests.
- `frontend/src/api/client.ts`: barrel API surface.
- `frontend/src/store/auth.store.ts`: persisted Zustand auth state.
- `frontend/src/auth/permissions.ts`: frontend role defaults and permission checks.

Major feature areas:

- `features/wizard/QuoteWizard.tsx`: quote creation and transaction workflows.
- `features/search/SearchPage.tsx`: global policy/quote/customer search experience.
- `features/policies/PolicyViewPage.tsx`: policy detail, versions, timeline, actions.
- `features/customerPortal/CustomerPortalPage.tsx`: customer-safe portal.
- `features/dashboard/DashboardPage.tsx`: dashboard and AI insights.
- `features/uw/UwQueue.tsx`: underwriting referrals.
- `features/rating/RatingWorkbenchPage.tsx`: actuarial workbook import/version/publish.
- `features/admin/*`: users, tenant settings, security, customers, forms, onboarding, underwriting companies.

Frontend API modules live in `frontend/src/api/*.api.ts`, with React Query hooks in `frontend/src/api/hooks/*.hooks.ts`.

## Domain Model

Core domain entities:

- Tenant
- User, role, permission
- Customer and customer-policy links
- Party and policy party assignments
- Quote
- Policy
- Policy transaction
- Policy version
- Risk unit
- Coverage and coverage selection
- Rating and calc trace
- Forms and documents
- Ledger events and async message outbox
- Rating models and published model registry

Important lifecycle flows:

- Quote -> rate -> underwriting decision -> bind -> policy projection and initial version.
- Issue, endorse, cancel, reinstate, rewrite, renew, and non-renew transactions.
- Effective-dated timelines support out-of-sequence endorsements and retro adjustment concepts.
- Customer portal APIs must return customer-safe projections only and enforce linked-customer scope.

## Security And Tenancy

- Tenant isolation is required for API work. Requests under `/api/v1` require tenant context.
- Frontend sends `X-Tenant` from local storage, defaulting to `sample-carrier`.
- Auth JWT includes tenant, roles, permissions, and optional customer link fields.
- Backend guards are authoritative; frontend permission gating is only UX.
- Customer portal access depends on `users.customer_id`, `customers`, and `policy_customer_links`.
- API docs (`/api-docs`, `/openapi.json`) are admin-only.
- MFA is tenant configurable through tenant security settings.

## Product And Rating Extension Points

- Product coverage and rate files are in `products/<product>/coverage.yaml` and `rates.yaml`.
- Product config is loaded through `server/src/lib/products.ts`.
- Tenant overrides are loaded from `tenants/<tenant>/overrides`.
- Rating checks tenant/product/state published workbook models first, then falls back to legacy/product YAML rating logic.
- Rating calc traces are important for explainability and audit.

## Working Guidance

- Prefer `rg` for searching.
- Read the relevant route, service, frontend API hook, and component together before editing behavior.
- Keep changes scoped; avoid unrelated refactors.
- For backend behavior changes, check both DB-backed and in-memory fallback paths when the module supports both.
- For frontend changes, preserve permission gating and API hook patterns.
- For policy/customer/portal changes, verify tenant, role, and linked-customer scope.
- For schema changes, add an ordered SQL migration and update Drizzle schema when needed.
- For risky changes, run targeted tests plus `npm run typecheck`; broader changes should also run `npm run build` and `npm run test`.

## Key Docs

- `README.md`: overview and quick start.
- `docs/ARCHITECTURE.md`: architecture, lifecycle, customer portal, cache, logging, async outbox, AI, rating workbench.
- `docs/DEVELOPER_SETUP.md`: local setup and commands.
- `docs/API.md`: MVP endpoint conventions.
- `docs/DOMAIN.md`: core domain summary.
- `docs/MULTITENANCY.md`: tenant strategy.
- `docs/DATA_MODEL_ERD.md`: relational PAS data model.
- `docs/PAS_RELATIONAL_MVP.md`: relational MVP implementation blueprint.
- `docs/VERTICAL_SLICE_SCOPE.md`: quote -> bind -> policy view scope.
