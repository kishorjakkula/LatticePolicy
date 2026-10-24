# Unit and integration tests — WP-0008

## Tests added

- **`server/src/__tests__/rated-quote-guard.integration.test.ts`** (real PostgreSQL, 20 cases):
  - an unchanged autosave and a billing-only change keep the rating and bind;
  - a risk change resets the rating, and bind returns 409 with nothing written;
  - a risky change rated again is referred;
  - a payload changed directly in storage is refused before any referral is created;
  - ratings from before this package: accepted as they stand, and reset on their first change;
  - client statuses refused (400 `INVALID_STATUS`, including a non-string value); "Draft" never reopens a bound quote; the "Issued" audit save works, after which the quote cannot be bound;
  - tenant isolation;
  - product pin: a swapped value is ignored, and an autosave without it keeps the stored one;
  - an older Expired quote with a rating is reset;
  - create accepts only Draft, and an unrated draft is refused at bind;
  - a draft save racing a bind (3 rounds) never binds changed risk.
- **`frontend/src/features/wizard/__tests__/rerate.test.tsx`** (4): `serverErrorCode` parsing; the `RerateNotice` content, Rate again, the busy state, and Go to Premium.
- **Adjusted:**
  - `coverage-integrity.integration.test.ts` and `carrier-pack-lifecycle.integration.test.ts` now drop the fingerprint when they tamper with a stored quote, so bind still reaches the product-rules re-check those tests cover.
  - Mutation check: with the fix removed, 11 of the original 14 guard cases fail.

## Results

Node 24.21, on the final commit `3e8eb79`:

- `server`: `npx vitest run`: 977 passed.
- `frontend`: `npx vitest run`: 611 passed (wizard: 113).
- Integration on a disposable PostgreSQL:
  - `rated-quote-guard` + `quote-to-bind` + `coverage-integrity`: 30 passed;
  - earlier commit: 6 files, 43 passed;
  - full suite (host run): 312/316 before the tampering tests were adjusted. The 2 environment-only failures are explained in 09.
- CI on #398: DB Integration Tests passed.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| REQ-1 | Guard cases: risk change resets; autosave and billing keep; older Expired reset; legacy first change |
| REQ-2 | Guard cases: client statuses refused; Draft does not reopen a bound quote; Issued audit; create Draft-only |
| REQ-3 | Guard cases: bind 409 after a reset; storage tamper refused before referral; unrated draft refused; race |
| REQ-4 | Guard case: billing-only change keeps the rating and binds with the new plan |
| REQ-5 | `rerate.test.tsx`; Playwright quote-wizard rating and bind flows in CI |
