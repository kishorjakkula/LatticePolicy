# Design — WP-0002

## Root cause

1. **Wizard race (REQ-1, REQ-4, REQ-6).** `QuoteWizard.tsx` loads the product
   configuration (`loadConfig`, `api.getProductConfig`, then `getProductForm`)
   whenever `q.productCode` changes, and stores whatever response arrives last.
   Nothing discards a response for a product that is no longer selected. When the
   product changes quickly (the e2e helper tries underwriting companies one after
   another, and choosing a company can select a product), an older product's
   response can land after the current one. The wizard then holds the homeowners
   configuration while the quote says personal auto, `GenericCoverageEditor` lists
   homeowners coverages, and "Apply Default Coverages" applies the whole
   homeowners set (A–F, END_WB, END_PPRC, END_ORD, END_ERC — exactly what the bad
   quotes contain, in file order).
2. **No server check (REQ-3).** `productRuleViolations` checks carrier-pack screen
   rules but never checks coverage codes against the product, so rate, bind,
   endorsement, renewal and rewrite accept any code. One bad quote was bound.
3. **A test fixture sends an undefined code.** `e2e/support/products.ts` posts
   homeowners quotes with `DWELLING`, which homeowners never defined (it appears
   only in an intake sample document). Those records date from 2026-10-11, before
   intake existed.

Evidence on local staging: personal auto quotes with homeowners codes on
2026-10-10 and 2026-10-18 (4 quotes, 1 policy); one homeowners quote with cyber
codes (2026-10-11); `DWELLING` on one homeowners quote and policy (fixture).

## Options considered

1. **Fix the wizard only.** Stops the observed path, but any API client, import,
   intake or future screen could still store undefined coverages. Rejected.
2. **Server check only.** Prevents bad data, but agents would still see the wrong
   coverages and hit an error at rating. Rejected on its own.
3. **Both, plus a read-only integrity report.** Chosen: the wizard cannot hold a
   stale product configuration, the server refuses undefined coverages, and
   administrators can find existing bad records (approved answer 3: report only).

## Components touched

### Frontend (`frontend/src/features/wizard/QuoteWizard.tsx`)

- `loadConfig(code)`: tag each request with the product code it was made for
  (a ref holding the latest requested code) and ignore any response whose code is
  no longer the selected product. Apply the same guard to the product form
  (risk fields, screen, tables).
- On product change, clear `cfg` before fetching so the coverage step shows
  "Loading product config…" instead of the previous product's coverages.
- `CoverageSelector` renders only when the loaded configuration belongs to the
  selected product.
- Product change after data was entered asks for confirmation in the page (no
  `window.confirm`), then clears coverages and risk details (approved answer 4;
  layout from the UI/UX design).

### Server

- `server/src/services/product-rules.service.ts`: new
  `coverageViolations(tenantId, payload, previous?)` returning
  `{ path: '/coverages/<i>/code', keyword: 'coverage', message }` for every code
  the product does not define. The definition comes from the payload's pinned
  product snapshot (`requireLoadedSnapshot(...).definition.config.coverages`) or,
  unpinned, the current `loadProductConfig(code).coverages`.
  `productRuleViolations` includes these, so every existing call site enforces it:
  new quotes (`quote.service.ts` → `INVALID_QUOTE`), bind, endorsement, renewal,
  rewrite, and cancellation or reinstatement when they change risk data
  (`PRODUCT_RULES_NOT_MET`). Messages name the codes, e.g.
  "Coverage END_WB is not offered by Personal Auto".
- **Policy changes on existing policies** (endorsement, renewal, rewrite): refuse
  only codes the change *introduces* compared with the policy's current payload;
  undefined codes already on the policy are carried, not blocked, and appear in the
  integrity report. This keeps servicing of existing policies possible and
  matches approved answer 3 (existing records are reported, not changed). New
  business (rate, bind, issue) refuses every undefined code.
- **Issue**: `lifecycle.service.ts issuePolicy` checks coverage codes only
  (not the full screen rules, which bind already enforced), so a bound policy
  with undefined coverages cannot be issued.
- **Integrity report (REQ-5)**: `GET /api/v1/admin/coverage-integrity`
  (permission `admin.dashboard.read`, read-only, tenant transaction). Lists quotes
  and the latest version of each policy whose coverage codes are not defined by
  their product version, with product, record number, status, unexpected codes and
  date. Limit 500, newest first.

### Tests and fixtures

- `e2e/support/products.ts`: homeowners fixture uses coverage `A` (dwelling)
  instead of `DWELLING`.
- Server and frontend fixtures that send undefined codes are corrected when the
  new check finds them (the developer lists each one).

## Data and migrations

None. No migration (migration numbers 067 and 068 are in use by uncommitted work
in another local worktree; this change avoids a collision). Existing records are
not modified.

## API contract

- Rating, binding, issuing and policy changes may now return
  `422 INVALID_QUOTE` / `422 PRODUCT_RULES_NOT_MET` with
  `errors: [{ path: "/coverages/2/code", keyword: "coverage", message: "Coverage END_WB is not offered by Personal Auto" }]`.
- New `GET /api/v1/admin/coverage-integrity` →
  `{ items: [{ kind: "quote"|"policy", id, number, productCode, status, unexpectedCodes: [], createdAt }], total }`.

## Security, tenancy and audit

The report runs inside `withTenantTx` (RLS) and requires `admin.dashboard.read`;
it returns record numbers and codes only, no customer details. The new check
tightens validation; it adds no new write paths.

## Performance, operations and configuration

The coverage check is an in-memory set lookup per request. The report scans
quotes and latest policy versions with a JSONB array expansion, bounded to 500
rows; acceptable for an admin page.

## Requirement mapping

| Requirement | Design element |
| --- | --- |
| REQ-1 | Stale-response guard in `loadConfig`/product form; `CoverageSelector` product match |
| REQ-2 | Clear coverages and risks on product change, with in-page confirmation |
| REQ-3 | `coverageViolations` in `productRuleViolations`; issue check; introduced-only rule for policy changes |
| REQ-4 | Wizard guard plus server refusal (premium is only computed for valid coverages) |
| REQ-5 | `GET /admin/coverage-integrity` and its admin screen |
| REQ-6 | Race removed; smoke test repeated 10 times in parallel; fixture fixed |

## ADR

None: this applies existing principles (server enforces, product pinning).
