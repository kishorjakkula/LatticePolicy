# Task Note: Structured Contract Errors For Compliance Admin Routes

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/215
- Pull request:

## Summary

Migrated `server/src/routes/compliance-admin.routes.ts` (eligibility CRUD and
OFAC screen review/disposition) to the standardized error contract documented
in `docs/tasks/issue-85-91-105-api-contract-validation.md`: every error
response is now `{ code, message, traceId }` (plus `details` when the error
carries any), produced by the shared global error handler in `server/src/app.ts`
instead of ad-hoc `res.status(x).json({ code, message })` calls scattered
through the route file.

## Important Files

- `server/src/routes/compliance-admin.routes.ts`: replaced all 13 ad-hoc
  `res.status(...).json(...)` error responses with `throw new
  BadRequestError(...)` / `ForbiddenError(...)` / `NotFoundError(...)` from
  `server/src/errors/domain.errors.ts`. Removed the `try/catch` blocks that
  existed only to reformat unexpected DB errors into a custom 500 shape —
  Express 5 (already the pinned version, see `server/package.json`)
  automatically forwards a rejected promise from an `async` route handler to
  the global error middleware, so no `express-async-errors`-style wrapper or
  explicit `next(err)` plumbing was needed.
- `server/src/__tests__/compliance-admin.integration.test.ts`: added three
  tests asserting the standardized error shape (403 forbidden, 400 invalid
  input, 404 not found), each checking `code`, `message`, and that `traceId`
  is a non-empty string.

## Behavior Rules

- `ForbiddenError`'s message is always the fixed string `'Forbidden'`
  (its constructor only accepts a `code`, not a custom message) — this is an
  intentional, pre-existing convention in `domain.errors.ts`, not something
  introduced here. Before this change, this route family returned the more
  specific `'Compliance manage permission required'` message on 403s; that
  specific text is now gone in favor of contract consistency with every other
  route family already using `ForbiddenError`. The distinguishing `code`
  field (`FORBIDDEN`) is unchanged.
- Genuinely unexpected errors (e.g. a DB failure) previously got a custom 500
  code and the raw `err.message` (e.g. `ELIGIBILITY_LIST_FAILED`). They now
  fall through to the global handler's generic `{ code: 'INTERNAL_ERROR',
  message: 'An unexpected error occurred', traceId }` — the same contract
  every other unexpected error already gets. This is a deliberate trade-off:
  consistency of the envelope over route-specific 500 messages, matching how
  other already-migrated route families behave.
- Every response in this file now includes a real `traceId` (previously none
  did) — `pino-http` (already a dependency) assigns `req.id` per request, and
  the global handler reads it via `res.getHeader('x-request-id') ||
  (req as any).id`.

## Automated Tests

- Tests added or updated:
  - `server/src/__tests__/compliance-admin.integration.test.ts` — 3 new
    cases: 403 with contract shape, 400 with contract shape, 404 with
    contract shape. The pre-existing 403 test was strengthened in place to
    also assert the body shape rather than just the status code.
- Test layer used: DB-backed integration tests (this route family requires a
  real tenant-scoped DB path for every handler).
- Why this layer is enough: the change is entirely about HTTP error response
  shape; the existing suite already exercises the underlying business logic
  (eligibility enforcement, OFAC disposition precedent) end to end, so no new
  business-logic test was needed — only the response-contract assertions.

## Validation

```bash
npm run build
npm run test --workspace=server
npm run typecheck
```

All three pass locally (250 server unit tests unaffected). Could **not** run
`npm run test:integration` / `sh scripts/test-integration.sh` in this
environment — Docker's local image/content store is corrupted
(`containerd` blob-store I/O errors on every `docker run`), a pre-existing
host issue unrelated to this change. Please confirm the new integration
tests pass in CI (real Postgres service container) before merge.

## Follow-Ups Or Risks

- Other route families still return ad-hoc error shapes without `traceId`
  (see the file-by-file count taken during this issue's investigation:
  `forms-admin.routes.ts` ~88, `agency-onboarding.routes.ts` ~78,
  `admin.routes.ts` ~41, `customers.routes.ts` ~33, `transactions.routes.ts`
  ~24, and others). Each is a similarly-scoped follow-up issue.
- `transactions.routes.ts` has a route (`GET /policies/:id/timeline`) that
  locally catches a 404 and responds `{ code: 'POLICY_NOT_FOUND' }` with no
  `message` and no `traceId`, bypassing the global handler entirely — a
  smaller inconsistency spotted while researching this issue, out of scope
  here since it's a different route family, but worth its own fix.
