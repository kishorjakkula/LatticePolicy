# Task Note: Notification Notice Framework

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/48
- Pull request:

## Summary

Added the first tenant-aware notification and notice framework. Policy
transaction services can now record notification intents and enqueue local or
provider-backed delivery through the existing async outbox.

## Important Files

- `server/migrations/034_notification_framework.sql`: notification templates
  and durable notification intent tables with tenant RLS.
- `server/src/services/notification.service.ts`: template lookup, merge-field
  rendering, recipient resolution, intent persistence, and outbox enqueue.
- `server/src/services/lifecycle.service.ts`: issue, cancellation, and
  non-renewal notification hooks.
- `docs/NOTIFICATIONS.md`: adapter boundary, local behavior, merge fields, and
  current transaction hooks.

## Behavior Rules

- Transaction services create `notification_intents`; they do not call email,
  SMS, or vendor APIs directly.
- Matching active `notification_templates` override built-in defaults by tenant,
  product, transaction type, channel, and effective date.
- Intents with customer email addresses are stored as `Queued` and written to
  `async_message_outbox`.
- Intents without deliverable customer email addresses are stored as
  `Suppressed` and do not enqueue an outbox row.
- Provider delivery status, retry, and errors remain the responsibility of the
  async outbox worker or future notification adapter.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/notification.service.test.ts`
  - `server/src/__tests__/policy-lifecycle.integration.test.ts`
- Test layer used: server unit tests plus DB integration assertions.
- Why this layer is enough: unit tests verify template rendering, recipient
  resolution, intent inserts, queued outbox inserts, and suppressed no-recipient
  behavior without needing external providers.

## Validation

```bash
PATH="/Users/srividyajakkula/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run build
PATH="/Users/srividyajakkula/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm test
```

## Follow-Ups Or Risks

- `npm run test:integration` requires `DATABASE_URL`; run it in CI or a local
  Postgres environment to exercise the DB assertions.
- Add admin CRUD APIs for notification templates.
- Add notification hooks for referrals, renewals/reminders, reinstatement, and
  operational alerts.
- Add support for additional channels and provider-specific delivery adapters.
