# Reinsurance Treaty And Facultative Placement Model

This document describes the reinsurance data model, service interface, and
explicit scope boundaries added by issue #61. It is intended as the reference
future reinsurance-adjacent work reads before extending this area — ACORD/GRLC
canonical data mapping (#60), bordereaux generation and validation (#62),
exposure management and aggregation views (#63), and large commercial
placement/subscription workflow (#64).

## Scope Boundary

LatticePolicy models *what reinsurance arrangement applies to a policy
transaction* and *what retained/ceded split results* — enough for a
downstream reinsurance accounting or bordereaux system to consume. It does
**not** perform reinsurance accounting settlement: no cash ledger, no
statement-of-account generation, no claims-side ceded-loss tracking. Adding
settlement behavior is explicitly out of scope unless a future issue adds it
deliberately.

## Schema

All tables live in `server/migrations/043_reinsurance_treaty_facultative.sql`,
are tenant-scoped with row-level security (`tenant_id = current_setting('app.tenant_id', true)`),
and follow this repo's existing conventions (`uuid_generate_v4()` primary
keys, `jsonb` metadata columns, `CHECK` constraints for enum-like text
columns).

- **`reinsurance_programs`**: optional top-level grouping for a treaty year or
  program (e.g. "2026 Property Treaty Program"). A treaty's `program_id` is
  nullable — treaties can exist without a parent program.
- **`reinsurance_treaties`**: a treaty, with `treaty_type` (`QUOTA_SHARE`,
  `SURPLUS`, `EXCESS_OF_LOSS`, `FACULTATIVE_OBLIGATORY`), `status`, an
  effective/expiration window, and applicability filters — `product_codes`
  and `state_codes` text arrays (`NULL` or empty means "applies to all").
  `version`/`superseded_by` exist for future effective-dated term versioning
  but are not yet driven by any service logic (see Follow-Ups).
- **`reinsurance_treaty_layers`**: one or more layers under a treaty
  (`layer_number`, `retention_amount`, `limit_amount`, `ceded_percent`,
  `retained_percent`, optional `premium_rate`). A quota share treaty
  typically has one layer; an excess-of-loss program may have several.
- **`reinsurance_facultative_certificates`**: a policy-specific facultative
  placement (`policy_id` required), with its own effective window and
  ceded/retained split.
- **`reinsurance_market_participants`**: reinsurer shares. Each row belongs to
  exactly one of `layer_id` **or** `facultative_certificate_id` (enforced by a
  `CHECK` constraint), supporting syndicated placement across multiple
  reinsurers on both treaty layers and facultative certificates.
- **`policy_reinsurance_placements`**: the computed, persisted output —  one
  row per matched treaty layer, or one row for a facultative override, per
  policy transaction. Stores `retained_percent`/`ceded_percent` and, when the
  transaction's premium is known, `retained_premium`/`ceded_premium`. `basis`
  is a JSON snapshot of the full match (treaty/layer name, participants) for
  audit without needing to re-join at read time.

## Service Interface

`server/src/services/reinsurance.service.ts` is the stable interface other
work should call rather than re-deriving treaty matching logic:

```ts
lookupPlacementMatches(db, query: PlacementLookupQuery, policyId: string): Promise<PlacementMatch[]>
```

Resolves applicable placement(s) for a `{ tenantId, productCode, stateCode,
asOfDate }` query and a policy ID, without persisting anything. Returns
`PlacementMatch[]` — either a list of `FACULTATIVE` matches (if any active
certificate covers the policy as of that date) or a list of `TREATY` matches,
one per matching Active layer across every applicable treaty.

```ts
computePlacementForTransaction(db, tenantId, policyId, transactionId): Promise<PlacementMatch[]>
```

Calls `lookupPlacementMatches` using the transaction's own effective date and
the policy's product/state, then replaces any prior `policy_reinsurance_placements`
rows for that transaction with the newly computed set (idempotent per
transaction — re-running does not accumulate duplicates). Computes ceded/retained
premium when a `policy_versions` row exists for the transaction.

```ts
validateParticipantShares(participants): { valid, totalPercent, error? }
```

Pure function: rejects any non-positive or >100% individual share, and
rejects a total that exceeds 100%. Under-placement (total < 100%, a
not-fully-subscribed layer) is allowed.

```ts
treatyApplies(treaty, query): boolean
```

Pure function: the applicability predicate (status, date window, product/state
filters) used internally by `lookupPlacementMatches`, exported so other
callers (e.g. a future bordereaux job deciding which treaties are even
relevant to scan) can reuse the exact same matching rule instead of
re-implementing it.

## Facultative Precedence

When a policy has an Active facultative certificate covering the as-of date,
it is used **exclusively** — matching treaty layers are not also returned.
This matches standard reinsurance practice: a facultative placement is a
risk-specific override of the standard treaty program, not an addition to it.

## Layer Stacking

This first slice does **not** model excess-of-loss attachment-point stacking
order (e.g. "layer 2 attaches where layer 1's limit exhausts, net of
recoveries"). When multiple treaty layers match, each is reported
independently in `basis`/the returned array; a downstream process (bordereaux
generation, exposure aggregation) is expected to interpret stacking order
using `layer_number` and `retention_amount`/`limit_amount` if it needs to.
Encoding real attachment-point math correctly requires domain input this
issue didn't have — treat it as a deliberate gap, not an oversight.

## Automatic Lifecycle Wiring

`computePlacementForTransaction` is called automatically, via the
non-throwing `computePlacementForTransactionSafely` wrapper, from:

- `quote-bind.service.ts` — after bind, before the quote is marked Converted.
- `endorsement.service.ts` — at the end of `executeEndorsement`.
- `lifecycle.service.ts` — at the end of `renewPolicy` and `rewritePolicy`.

Reinsurance placement is a secondary concern relative to the policy
transaction it's attached to: `computePlacementForTransactionSafely` catches
any error from the compute path, logs it via the standard `logger`, and
resolves to `[]` rather than letting a reinsurance-subsystem failure block or
roll back a bind/endorsement/renewal/rewrite. A policy with no applicable
treaty or facultative arrangement is represented the same way it always has
been — zero `policy_reinsurance_placements` rows for that transaction — not a
special "Unplaced" row; consumers (bordereaux, exposure aggregation) already
treat absence of a placement row as Unplaced/Direct.

The on-demand admin compute API
(`POST /api/v1/admin/reinsurance/policies/:policyId/transactions/:transactionId/compute`)
is unchanged and still useful for backfilling placements on policies bound
before this wiring existed, or for recomputing after a treaty edit.

Cancellation, reinstatement, and non-renewal transactions do not recompute
placement — they don't change the underlying product/state/effective-date
inputs `computePlacementForTransaction` matches on, so there is nothing new
to compute; the existing placement from the policy's prior transaction
remains the applicable one.

## API

All routes are tenant-scoped and RBAC-gated (`admin.reinsurance.read` /
`admin.reinsurance.manage`), mounted at `/api/v1/admin/reinsurance`:

- `GET /treaties`, `POST /treaties`, `PATCH /treaties/:id`
- `GET /facultative?policyId=`, `POST /facultative`
- `POST /policies/:policyId/transactions/:transactionId/compute`
- `GET /policies/:policyId/placements`

## Follow-Ups Or Known Gaps

- Treaty term versioning (`version`/`superseded_by` columns) exists in the
  schema but no service logic creates a new version or supersedes a prior
  one yet — updates currently mutate the treaty row in place via `PATCH`.
- No admin UI exists yet for editing layers/participants after treaty
  creation, or for editing facultative certificate participants — only
  initial creation is wired in the frontend (`ReinsurancePage.tsx`).
- No OFAC-style "import" mechanism for reinsurer/market reference data;
  reinsurer names are free text per participant row.
- Layer stacking/attachment math (see above) is intentionally not modeled.
