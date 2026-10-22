# Proposed Design Extension: Referral Proposal Binding

Status: approved at human Gate B by Kishor Jakkula on 2026-10-21, with the
message "approved." This supersedes the original "no migrations" assumption.
Implementation and verification are in progress; this is not merge approval.

## Blocking Finding

Independent reviewer Boyle identified that current reason/date checks cannot
distinguish two materially different proposals producing the same authority
reason. For example, an unconsumed approval for one limit could authorize a
much higher limit. The ordinary-to-authority escalation fix does not close
this remaining case. Merge remains blocked even if existing suites pass.

## Proposed Implementation

- Add tenant-protected immutable proposal evidence to underwriting referrals:
  a versioned canonical proposal hash and the business review snapshot needed
  to show exactly what was reviewed. Do not store credentials, file buffers or
  model inputs unrelated to the policy decision, or log proposal contents.
- Derive the hash on the server from tenant/resource identity, transaction
  type/date, normalized proposed policy data, risks/coverages/limits, rated
  premium, relevant underwriting/authority evaluation and base policy version.
  Client-supplied hashes or override flags are never trusted.
- New-business bind, endorsement, renewal and rewrite all supply this context.
  Only an unconsumed approval for the exact evaluated proposal may unblock a
  retry. Changed exposure, premium, coverage, effective date or base version
  opens a new review without altering the earlier decision or evidence.
- Preserve the rollback-first referral retention boundary: rejected policy
  writes are rolled back before the work item is committed separately.
  Serialize matching retries without nested policy/FK lock deadlocks.
- Referral detail shows the immutable proposed facts beside relevant current
  policy facts. Approval/reason is a human action through existing permissions;
  authority referrals still require `uw.authority.override`.
- Migration is additive. Legacy rows have unknown proposal evidence, not a
  fabricated backfill. They cannot silently authorize a newly fingerprinted
  proposal; a fresh explicit review is required. Preserve their history.
- Keep tenant RLS and append-only AI logs unchanged. Proposal evidence must
  not be editable through ordinary referral mutation endpoints.

## Required Verification

- Canonical hash stability under key reordering, but changes for every material
  proposal input; test no secret/document bytes enter evidence or logs.
- Real HTTP rejection -> committed review -> approval -> unchanged retry works
  for all four flows; policy state remains unchanged before approval.
- Raise an already-referred limit/exposure while retaining the same reason:
  old approval cannot authorize it. Repeat for risk, premium, coverage and base
  version changes, and for consumed/legacy approvals.
- Concurrent matching/changed proposals, tenant isolation, permission and
  authority denial, rollback on errors, immutable evidence and UI fact display.
- Fresh migrations, full unit/integration/browser suites and independent
  review. Gate C and production/business approval remain human actions.

## Approval Record

Kishor Jakkula approved this database/design extension on 2026-10-21 with
"approved." The workflow records that decision in `status.json`. Final
verification and independent review are recorded separately; design approval
is not permission to merge or release.
