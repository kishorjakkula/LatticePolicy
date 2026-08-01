# Notification And Notice Framework

LatticePolicy records notification intent separately from delivery provider
execution. Policy transaction services create tenant-scoped
`notification_intents`; queued intents are also written to
`async_message_outbox` with `source_table = notification_intents`.

## Runtime Boundary

- `notification_templates`: optional tenant/product/transaction-specific
  templates. If none match, the server uses built-in templates for issue,
  cancellation, and non-renewal notices.
- `notification_intents`: durable notification records for support, audit, and
  retry tracking.
- `async_message_outbox`: provider-neutral delivery queue. Local development
  can emit to stdout through the existing async worker. Production deployments
  can point the worker at a webhook/vendor adapter.

The framework does not embed AWS SES, SMTP, SMS, or vendor-specific code in
policy transaction services. Those integrations belong behind the async outbox
delivery adapter.

## Current Transaction Hooks

- Issue: creates `POLICY_ISSUED`.
- Cancellation: creates `POLICY_CANCELLED`.
- Non-renewal: creates `POLICY_NON_RENEWAL`.

If a customer email cannot be resolved from the policy payload, the intent is
persisted as `Suppressed` and no outbox delivery row is created.

## Merge Fields

Templates can use `{{field}}` placeholders. Supported top-level fields include:

- `policyNumber`
- `productCode`
- `transactionNumber`
- `transactionType`
- `effectiveDate`
- `expirationDate`
- `noticeDate`
- `reason`
- `premiumImpact`
- `recipient.name`
- `recipient.email`

## Local Development

With `ASYNC_PUSH_ENABLED=true` and no `ASYNC_PUSH_WEBHOOK_URL`, the existing
async worker logs outbox envelopes to stdout and marks them sent. With a
webhook URL configured, it posts the envelope and applies retry/backoff on
failure.
