# Task Note: Code Scanning Alerts Remediation

## Links

- Issue:
- Pull request:

## Summary

Resolved all 7 open GitHub code scanning (CodeQL) alerts: two
prototype-pollution risks in JSON-patch application, a polynomial-time
regex used on user-controlled base64 input, an unvalidated dynamic
method dispatch in the frontend mock API, and an insecure-randomness
finding in E2E test fixture data. While fixing the prototype-pollution
finding, found and consolidated a second, byte-identical vulnerable
copy of the same helper function that CodeQL had not flagged.

## Important Files

- `server/src/lib/patch.utils.ts`: canonical `applyJsonPatch` now
  rejects any patch operation whose path contains a `__proto__`,
  `constructor`, or `prototype` segment, and uses
  `Object.prototype.hasOwnProperty.call` instead of the `in` operator
  so inherited properties can't be mistaken for own data.
- `server/src/services/endorsement.service.ts`: previously defined its
  own private, byte-identical duplicate of `applyJsonPatch` (used to
  apply endorsement body-change patches to policy payloads) instead of
  importing the shared one from `patch.utils.ts`. Removed the
  duplicate (and its now-unused local `PatchOp` type) and switched to
  importing the shared, guarded, tested implementation instead.
- `server/src/routes/forms-admin.routes.ts`: `decodeBase64ToBuffer`'s
  round-trip comparison used `/=+$/g` on user-controlled base64 input
  (CodeQL: `js/polynomial-redos`). Replaced with a non-regex
  `stripTrailingBase64Padding` helper that trims trailing `=`
  characters in a simple bounded loop.
- `frontend/src/api/mock.ts`: the quote-list mock sort handler picked
  a sort-key getter via `map[sortBy]` where `sortBy` comes from a URL
  query param, with `Object.prototype` methods available as a fallback
  return value for unrecognized keys like `constructor` (CodeQL:
  `js/unvalidated-dynamic-method-call`). Guarded the lookup with
  `Object.prototype.hasOwnProperty.call(map, sortBy)`.
- `e2e/support/api.ts`: `e2eSuffix()` used `Math.random()` to build
  unique test usernames that flow into an admin user-creation API call
  (CodeQL: `js/insecure-randomness`). Swapped to `crypto.randomBytes`.

## Behavior Rules

- Any JSON-patch `path` segment equal to `__proto__`, `constructor`, or
  `prototype` causes the entire patch operation to be skipped, not
  just that segment — this is intentionally conservative; no legitimate
  policy payload field needs those names.
- `applyJsonPatch` has one canonical implementation in
  `server/src/lib/patch.utils.ts`; do not reintroduce a local copy in a
  service file.

## Automated Tests

- Tests added or updated:
  - `server/src/lib/__tests__/patch.utils.test.ts` — new case asserting
    `__proto__`/`constructor`/`prototype` path segments are ignored and
    do not pollute `Object.prototype` or the target payload.
- Test layer used: unit test on the pure `applyJsonPatch` helper.
- Why this layer is enough: the vulnerable logic is pure data
  transformation with no I/O; a unit test exercising the exact guard
  condition is the smallest layer that proves the behavior.  The
  `forms-admin.routes.ts`, `mock.ts`, and `e2e/support/api.ts` changes
  are behavior-preserving refactors (same output for all valid input,
  only the unsafe code pattern changed) covered by the existing
  passing test/build/typecheck suite; no new test scenarios were
  introduced for those three since there was no new branching
  behavior to assert on.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

`npm run test:integration` / `sh scripts/test-integration.sh` could not
be run in this environment due to a local Docker Desktop storage
corruption issue (`containerd` blob store I/O errors) unrelated to
this change. The consolidated `applyJsonPatch` path is exercised
indirectly by existing endorsement/lifecycle unit and integration
suites elsewhere in the repo; recommend running
`npm run test:integration` in CI or a clean environment before merge.

## Follow-Ups Or Risks

- Consider running Docker Desktop's disk image repair/reset (outside
  the scope of this change) if local integration test runs continue to
  fail with `containerd` I/O errors.
