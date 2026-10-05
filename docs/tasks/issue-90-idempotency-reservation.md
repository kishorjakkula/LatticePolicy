# Task Note: Idempotency Reservation And Locking

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/90
- Pull request:

## Summary

Hardened `Idempotency-Key` handling so concurrent duplicate requests cannot
both execute the protected operation. The prior implementation only checked
for an existing record before running the handler and saved the response
afterward, which left a race window where two concurrent requests with the
same key could both pass the check and both execute. This change adds a
reservation step (`processing` status) that is claimed atomically before the
handler runs, with `completed`/`failed` finalization afterward.

## Important Files

- `server/src/lib/idempotency.ts`: reservation/finalization state machine for
  both the in-memory fallback store and the database-backed store.
- `server/migrations/035_idempotency_reservation.sql`: adds a `status` column
  (`processing`/`completed`/`failed`) to `idempotency_keys` and relaxes
  `status_code`/`response_body` to nullable while a reservation is in flight.
- `server/src/lib/__tests__/idempotency.test.ts`: concurrency, conflict,
  failed-retry, and connection-close coverage.
- `docs/API.md`: documents the `IDEMPOTENCY_KEY_PROCESSING` response and
  retry expectations for API clients.

## Behavior Rules

- A request reserves its key by winning `INSERT ... ON CONFLICT DO NOTHING`
  (DB) or a synchronous check-and-set (in-memory fallback, safe because
  Node's event loop cannot interleave between the check and the set when
  there is no `await` in between).
- Losing the reservation with a matching request hash while the winner is
  still `processing` returns `409 IDEMPOTENCY_KEY_PROCESSING` with a
  `Retry-After` header; the handler is not re-executed.
- Losing the reservation with a mismatched request hash returns
  `409 IDEMPOTENCY_KEY_CONFLICT`, regardless of the existing record's status.
- A `completed` record replays the stored response.
- A `failed` record (non-2xx response, or the response never finished/closed)
  can be reclaimed by a matching retry, which re-executes the handler. The DB
  path reclaims under the row lock taken by `SELECT ... FOR UPDATE` so only
  one concurrent retry can win the reclaim.
- The database path always represents ownership transitions inside a single
  tenant-scoped transaction so `INSERT ... ON CONFLICT` and the fallback
  `SELECT ... FOR UPDATE` participate in the same lock scope.

## Automated Tests

- Tests added or updated:
  - `server/src/lib/__tests__/idempotency.test.ts` (new): concurrent
    duplicate blocked while processing, conflict on mismatched body, failed
    attempt reclaimed by a matching retry, reservation released when the
    connection closes without a response, and tenant isolation of keys.
  - Existing coverage in
    `server/src/__tests__/quote-policy-fallback.test.ts` (replay + conflict)
    continues to pass unchanged.
- Test layer used: server unit tests against the middleware directly, using a
  minimal fake `Request`/`Response` to control timing between two
  "concurrent" calls without a real database.
- Why this layer is enough: the reservation state machine is exercised
  directly, including the timing-sensitive concurrent case that is hard to
  assert deterministically through a full HTTP round trip. The DB-backed
  `reserveDb`/`finalizeDb` path uses the same `withTenantTx`/row-locking
  primitives already covered by integration tests elsewhere in the codebase;
  a live-Postgres concurrency test is called out below as a follow-up.

## Validation

```bash
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 20
npm run build
npm run test
npm run typecheck
```

## Follow-Ups Or Risks

- `npm run test:integration` requires `DATABASE_URL`, which was not available
  in this environment. The DB-backed reservation path (`reserveDb`/
  `finalizeDb`) should get a Postgres-backed concurrency test — e.g. firing
  two real concurrent connections at the same key/body and asserting only one
  executes — as a follow-up once run against a live database.
- `IDEMPOTENCY_KEY_PROCESSING` and `IDEMPOTENCY_KEY_CONFLICT` should be added
  to the OpenAPI error response schema (`server/src/openapi.ts`) alongside
  the existing `traceId` documentation follow-up noted in
  `docs/tasks/pilot-foundation-state-idempotency.md`.
