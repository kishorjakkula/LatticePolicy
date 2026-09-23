# Task Note: Timezone-Independent Date Coercion

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/261
- Pull request: pending

## Summary

Human-readable date strings without a timezone now preserve their parsed local
calendar date instead of being converted to UTC and potentially shifting one
day backward. Explicit UTC/offset timestamps and `Date` objects retain their
existing UTC semantics.

## Important Files

- `server/src/lib/date.utils.ts`: distinguishes timezone-free calendar input
  from timestamp input for both `coerceDateOnly` and `asDateOnly`.
- `server/src/lib/__tests__/date.utils.test.ts`: covers human dates and an
  explicit offset crossing a UTC date boundary.

## Behavior Rules

- Exact `YYYY-MM-DD` values pass through unchanged.
- Timezone-free strings such as `July 4, 2026` produce the same date in every
  process timezone.
- Explicit `Z`, numeric offsets, `UTC`, and `GMT` are converted using UTC.
- `Date` instances continue to use UTC through `toISOString()`.

## Automated Tests

- The server date utility suite runs under UTC, a negative offset timezone,
  and a positive offset timezone to catch calendar-day drift.

## Validation

```bash
TZ=UTC npm run test --workspace=server
TZ=America/Los_Angeles npm run test --workspace=server
TZ=Pacific/Auckland npm run test --workspace=server
npm run typecheck
```

## Follow-Ups Or Risks

- JavaScript's parser still determines which non-ISO human date formats are
  accepted. Callers should prefer `YYYY-MM-DD` for contracts and persistence.
