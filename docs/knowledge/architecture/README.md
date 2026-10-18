---
title: LatticePolicy architecture principles
last_reviewed: 2026-10-17
review_every_days: 90
sources: docs/ARCHITECTURE.md, docs/MODULES.md, docs/MULTITENANCY.md, AGENTS.md
---

# Architecture Knowledge

For the software architect, developer and code reviewer. Read with
[`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) and
[`docs/MODULES.md`](../../MODULES.md).

- [Tech radar](tech-radar.md) — what to adopt, trial, hold.
- [Platform currency](platform-currency.md) — versions in use and support status.
- [Architecture decision records](adr/README.md).

## Principles

1. **Tenant isolation everywhere.** Every query runs in `withTenantTx` with
   PostgreSQL row-level security; services re-check roles from the database,
   not from JWT claims. Single-carrier stacks pin `CARRIER_TENANT_ID`.
2. **The server enforces; the browser assists.** Shared logic that both run
   lives in `packages/rules` (expressions, screen rules, validation rules) so
   they agree; the API is always the enforcement point.
3. **Configuration over code.** Products, rates and forms are product packs;
   carriers configure underwriting rules, authority, validation rules, forms and
   branding in admin screens. Hard-coded product behavior is the fallback, not
   the default.
4. **Product version pinning.** A quote and policy keep the product snapshot
   they were written on; mid-term transactions use the pinned definition.
5. **Append-only history.** Policy versions are immutable; governance and AI
   audit logs are append-only and hash-chained.
6. **Humans approve AI.** AI drafts and recommends; a person approves before
   any customer, quote or policy changes. Carrier-private inference never falls
   back to external AI.
7. **Forward-only migrations.** Numbered SQL migrations, never edited after
   release; additive changes first, backfills explicit, RLS on every tenant table.
8. **Small, explicit modules.** Routes are thin; services own logic; shared
   packages have no knowledge of the API or UI.
9. **Everything is tested at the right layer** (`docs/TEST_PLAN.md`) and
   documented for the next agent (task notes in `docs/tasks/`).
