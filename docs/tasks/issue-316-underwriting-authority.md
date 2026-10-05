# Issue 316: Underwriting Authority and Governed Overrides

## Outcome

LatticePolicy now evaluates effective-dated underwriting authority before new
business bind, endorsement, renewal, and rewrite transactions. Grants can be
assigned to a user, role, or producer and scoped by product, state, transaction
type, maximum premium, and maximum requested coverage limit.

When configured authority is exceeded, the transaction opens an underwriting
referral with stable `AUTHORITY_*` reason codes. Approval requires the explicit
`uw.authority.override` permission and a non-empty reason. Successful processing
links the referral to the resulting policy, transaction, and policy version.

## Data and API

- Migration `053_underwriting_authority.sql` adds effective-dated grants and an
  append-only grant audit table, both protected by tenant RLS.
- `GET/POST /v1/uw/authority-grants` lists and creates grants.
- `PATCH /v1/uw/authority-grants/{grantId}` expires or deactivates a grant.
- `uw.authority.read`, `uw.authority.manage`, and `uw.authority.override`
  separate visibility, administration, and exception approval.

## Compatibility

Tenants without authority configuration retain existing transaction behavior.
Authority enforcement starts for a product/state/effective-date combination
when at least one active grant applies to that configuration window.

## Verification

- Unit tests cover transaction matching and premium/limit evaluation.
- Integration tests cover blocked authority, explicit override permission and
  reason requirements, and referral linkage after a successful bind.
- Repository type checking, build, and test suites are run before merge.
