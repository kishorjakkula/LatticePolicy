# Issue 263: Stale Quote Cleanup Job

## Summary

Adds the `stale_quote_cleanup` built-in job. It expires inactive `Draft` and
`Rated` quotes for one tenant and supports dry-run reporting.

## Behavior

- Inactivity uses `COALESCE(updated_at, created_at)`.
- The default threshold is 90 days; `staleAfterDays` overrides it.
- `dryRun: true` reports candidates without modifying them.
- Converted, already-expired, fresh, and other-tenant quotes are untouched.
- Expiration updates `status_history`, `updated_at`, and `updated_by` for audit.
- Repeated execution is idempotent because only `Draft` and `Rated` rows match.

## Main Files

- `server/src/jobs/handlers/staleQuoteCleanup.ts`
- `server/src/jobs/registerBuiltinJobs.ts`
- `server/migrations/048_stale_quote_cleanup_job.sql`
- `server/src/__tests__/stale-quote-cleanup.integration.test.ts`

## Validation

```bash
npm run test --workspace=server
npm run test:integration
npm run typecheck
npm run build
npm run security:audit
```
