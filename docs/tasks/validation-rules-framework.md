# Validation rules framework

## Request

"Develop a framework for the validations like screen level required fields and
warnings, rating level required fields and warnings, bind level and issue level
and each transaction level. If we give as common it will be applicable for all
the transactions."

## Decisions

- One dimension for **level** (screen, rate, bind, issue) and one for
  **transaction** (seven types or `common`). Each transaction uses the levels it
  has; policy changes are processed at `issue`.
- Severity error (hard stop) or warning (soft stop; acknowledgement required at
  bind and issue, recorded with the person and rule version).
- Rules are data (migration `066_validation_rules.sql`), scoped by product,
  state and effective dates; evaluation lives in `@lattice-policy/rules` so the
  wizard and API agree.
- Levels are explicit (no hidden cascade from screen to rate).
- Additive: existing built-in validations are unchanged; a tenant with no rules
  behaves exactly as before.

## Changes

- `packages/rules`: `validation-rules.ts` (types, scoping, evaluation, rule
  definition checks, `[*]` paths), `today()`/`daysBetween()` in expressions.
- Server: migration 066, `validation-rules.service.ts`, `validation-rules.routes.ts`,
  `lib/validation-gate.ts`; gates in rate (`POST /quotes`), bind
  (`quote-bind.service.ts`), issue and every transaction route.
- Frontend: Administration > Validation Rules (coverage grid, filters, editor,
  history), wizard screen checks, rate/bind/issue stops and acknowledgement dialog.
- Docs: `docs/VALIDATION_RULES.md`.

## Verification

- `packages/rules` tests (38), server unit (666), server integration on fresh
  PostgreSQL with RLS (167, including `validation-rules.integration.test.ts`),
  frontend unit (262), Playwright `e2e/validation-rules.spec.ts` (wizard screen
  block, bind/issue acknowledgements, admin editor) run 3x against the local stack.
