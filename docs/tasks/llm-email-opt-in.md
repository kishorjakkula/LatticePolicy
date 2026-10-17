# Task Note: Default-Disabled LLM Release Email

## Summary

Release governance must work in test deployments without SMTP. Email is an
optional side effect, enabled only by literal `LLM_EMAIL_ENABLED=true` on both
API and dispatcher. No commit or shared issue-state changes were requested.

## Important Files

- `server/src/services/llm-release.service.ts`: conditional contact/HTTPS checks,
  notification writes, registration audit detail, and current email flag in list.
- `server/src/services/llm-release-email.service.ts`: shared exact opt-in check
  and terminal delivery-time suppression before SMTP access.
- `frontend/src/api/llm-releases.api.ts` and admin release page/tests: disabled
  email state without a required contact form; review remains available.
- Root and carrier Compose files, carrier env template: default false; shared
  carrier environment propagates the flag to API and dispatcher.
- `docs/LLM_RELEASE_GOVERNANCE.md`: configuration and lifecycle guarantees.

## Behavior Rules

- Disabled registration creates no email intents/outbox rows; its candidate
  audit records disabled email. SMTP/contact/HTTPS review URL are not needed.
- Delivery rechecks the flag and suppresses existing queued notifications with
  a durable reason, without mail transport or further retries. Outbox dispatch
  completion is not evidence of email delivery; notification stays Suppressed.
- Re-enabling never revives suppressed mail or backfills existing releases.
- Enabled contact validation, current-role checks, TLS, retry handling, tenant
  isolation, maker/checker and signed approval behavior remain unchanged.

## Automated Tests And Validation

- Service unit suites: unset/false/nonliteral opt-in, no registration queues,
  disabled audit, authority and contact/HTTPS guards, terminal suppression,
  enabled TLS and retry behavior.
- PostgreSQL release integration suite: no-setup registration/idempotence,
  full approval in both modes, dispatcher completion without SMTP retries,
  existing tenant/RBAC/revocation coverage.
- Frontend release component suite: disabled state, contact visibility, review
  availability, and enabled contact setup.
- Commands: focused workspace Vitest tests, focused server integration suite
  against disposable PostgreSQL, root `npm run typecheck`, `git diff --check`.

## Follow-Ups Or Risks

Flag changes require runtime configuration rollout. Already in-flight SMTP
cannot be recalled. SMTP at-least-once semantics and existing receipt revocation
limitations remain as documented in the governance guide.
