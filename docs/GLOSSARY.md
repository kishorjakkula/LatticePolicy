# Insurance And Platform Glossary

This glossary defines terms as LatticePolicy actually uses them, so a
contributor who is new to policy administration systems (or new to this
codebase specifically) can read the rest of the docs without guessing. It
is not a general insurance-industry dictionary; where a term has a broader
industry meaning, the definition below describes the scope LatticePolicy
implements today. See `docs/DOMAIN.md` for the underlying entity model and
`docs/ARCHITECTURE.md` for how these concepts fit together.

## Platform Terms

**Tenant** — A carrier, MGA, or organization boundary. Every request runs
inside a resolved tenant context, every persisted row carries a `tenant_id`,
and row-level security enforces that one tenant's data is never visible to
another. See `docs/MULTITENANCY.md`.

**Product pack** — A self-contained definition of an insurance product
(coverages, rating inputs, rate tables, forms, and state eligibility) under
`products/`. Carriers extend LatticePolicy by adding new product packs
rather than modifying framework code. See `docs/PRODUCT_PACK_CONTRACT.md`.

**RBAC / permission** — Role-based access control. A user's role (admin,
underwriter, agent, actuary, customer, and others) determines which
permissions they hold, which in turn determine which frontend routes render
and which backend APIs accept their requests. Both layers enforce the same
rule independently — the frontend never gates access on its own.

**Customer portal** — The restricted, customer-facing experience over the
same policy platform used internally. A customer's access is scoped through
the relationship between `users.customer_id`, `customers`, and
`policy_customer_links`, and portal endpoints return reduced data rather
than the full operational record.

**Portal-safe projection** — A response shape returned by a customer-facing
endpoint that intentionally omits internal-only fields (underwriting
rationale, rating traces, admin metadata, other customers' data). The same
underlying policy record can have both an internal projection and a
portal-safe projection; the two are never the same response.

## Policy Lifecycle Terms

**Quote** — A priced, not-yet-bound proposal for coverage, built from risk
data, coverage selections, and underwriting answers.

**Bind / Issue** — The transaction that converts an accepted quote into an
in-force policy, generating the policy record, its first `PolicyVersion`,
and any forms/documents required for that product and state.

**Endorsement** — A mid-term change to an in-force policy (adding a vehicle,
changing a limit, correcting an address). Endorsements can be effective on
the transaction's processed date or on an earlier business date
("out-of-sequence"), and the platform recalculates the affected coverage
periods and premium impact accordingly.

**Cancellation** — Ending a policy before its scheduled expiration, with an
effective date that may be in the past (out-of-sequence), present, or future
relative to when the transaction is processed.

**Reinstatement** — Restoring a previously cancelled policy to in-force
status, typically alongside a payment or correction of the condition that
caused cancellation.

**Renewal / Non-renewal** — Renewal issues a new policy term continuing
coverage past the current expiration date; non-renewal is the carrier's
decision to end the relationship at term expiration instead.

**Rewrite** — Replacing an existing policy with a new one (e.g. for a
product or rating-plan change) rather than expressing the change as an
endorsement, while preserving a link back to the original policy for audit.

**Transaction** — Any lifecycle event that changes policy state: quote,
bind/issue, endorsement, cancellation, reinstatement, renewal, non-renewal,
or rewrite. Every transaction is recorded immutably; current and historical
policy state are both derived from the transaction/version history, never
overwritten in place.

**Effective date vs. processed date** — The effective date is the business
date a change applies to the policy (e.g. "coverage starts March 1"). The
processed date is the system date the transaction was actually entered.
They are frequently different, and the platform's timeline model tracks
both explicitly so "as-of" queries return the state that was true on a given
business date.

**Underwriting referral** — A hold placed on a quote or transaction when
rating or underwriting rules require human review before it can proceed
(e.g. before bind). A referral carries assignment, status, and decision
history, and a referred transaction cannot bind without an approved
decision.

**Rating** — Computing premium from risk attributes, coverage selections,
and rate tables/rules for a product, producing a premium breakdown and a
calculation trace kept for audit.

## Reinsurance And Exposure Terms

**Exposure** — The aggregate insured risk a carrier or reinsurer is exposed
to, viewable by dimensions such as product, state, ZIP, class/industry, or
policy limits, as of a given effective date.

**Treaty** — A standing reinsurance agreement (quota share, surplus, or
excess-of-loss) that automatically applies to policies matching its
product/state/effective-date criteria, without needing a placement decision
per policy.

**Facultative (certificate)** — A reinsurance placement negotiated for one
specific policy, overriding whatever treaty terms would otherwise apply.
LatticePolicy checks for a facultative certificate before falling back to
treaty-layer matching.

**Retained / ceded** — The split of a policy's risk (and premium) between
what the carrier keeps (retained) and what is passed to reinsurers (ceded)
under an applicable treaty or facultative arrangement. LatticePolicy
computes and stores this split; it does not perform reinsurance accounting
settlement. See `docs/REINSURANCE_MODEL.md`.

**Bordereaux** — A periodic report (risk, premium, transaction, cancellation,
correction, or claims-reference) summarizing policy activity for a carrier,
MGA, or reinsurer recipient, generated from persisted policy/transaction/
exposure data. See `docs/tasks/issue-62-bordereaux-framework.md`.
