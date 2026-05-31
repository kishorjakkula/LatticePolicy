Vertical Slice Scope (Quote → Bind → Policy View)

Objectives
- Persist new business quotes and resulting policies using the relational schema (`DATA_MODEL_ERD.md`).
- Expose REST APIs powering quote creation, binding, and policy retrieval for the React front-end.
- Wire frontline UI to execute the flow end-to-end: start a quote, rate/UW, bind, view policy.

Backend Responsibilities
- Initialize schema via Postgres migrations (`server/src/db.ts`).
- Endpoints:
  - `POST /v1/quotes` – validate payload, rate, evaluate underwriting, upsert quote.
  - `POST /v1/quotes/{id}/bind` – enforce UW rules, create policy + initial transaction, attach risk units, coverages, rating summary.
  - `GET /v1/policies/{id}` – lightweight projection with term/status/premium summary.
  - `GET /v1/policies/{id}/full` – hydrated payload (risk, coverage, rating, metadata) for detail view.
  - `GET /v1/policies/{id}/versions` – transaction timeline.
- Seed coverage definitions, forms, and field metadata for PA/HO; expose config via `/v1/products/:code/config` and `/form`.
- RBAC guards via auth middleware + `policy_role_assignments`.

Frontend Responsibilities
- Quote wizard collects insured, risk, and coverage details; calls `api.createQuote`.
- Bind step submits UW override reason if needed; uses `api.bindQuote` and redirects to policy view.
- Policy view fetches summary + full payload, renders versions timeline, supports simple actions (endorsement/cancel placeholders allowed for now).
- Search page queries `/v1/policies` for existing policies; supports pagination/filtering.

Out of Scope (Future Iterations)
- Billing and payments integration.
- Document generation service.
- Advanced endorsement/renewal workflows.
- Full audit ledger replay UI.

Dependencies
- Postgres 13+ (Docker compose recipe provided).
- Redis/elasticsearch not required for MVP.
- Front-end `.env` updated to point to API (`VITE_API_BASE_URL=http://localhost:3000`, `VITE_USE_MOCK=0`).

Validation
- Automated smoke script (`server/scripts/smoke.ts`) to hit quote→bind→policy endpoints.
- Manual UI walkthrough documented in README updates.
