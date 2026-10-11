# Task Note: Custom Tables (Lookup Tables And Lists On A Risk)

## Links

- Issue: none yet (phase 3, step 4, first part)
- Pull request:

## Summary

Carriers add their own tables. This change delivers two of the three kinds:
lookup and reference tables kept in the carrier pack, and lists of items
under a risk (scheduled items, locations, drivers). Standalone business
tables with their own screens are not part of it.

## Important Files

- `packages/rules/src/expression.ts`: `count`, `sum`, and `lookup`.
- `packages/rules/src/screen-rules.ts`: `list` fields, per-item checks, and
  `each` validations.
- `server/src/lib/carrier-tables.ts`: reads and validates `tables/<name>.yaml`.
- `server/src/lib/product-screen.ts`: `optionsFrom`, list columns, per-item
  rules, lookup table checks, `tablesUsedByScreen`.
- `server/src/lib/rating-table.ts`: `fromTable` factors, `perItem` coverage
  pricing, `tablesUsedByRates`.
- `server/src/lib/product-snapshot.ts`: a snapshot carries the tables its
  product reads, so tables are pinned per term with the rest.
- `server/src/routes/products.routes.ts`: sends the tables a screen's rules
  read.
- `frontend/src/features/wizard/ConfiguredRiskForm.tsx`: `ListTable` grid,
  option labels, tables passed to the rules.
- `examples/carrier-pack/`: `tables/`, a `scheduledItems` list, a `SCHEDULED`
  coverage priced per item.

## Behavior Rules

- A rule reads a table only through `lookup()`. Tables are not reachable as
  names in an expression.
- `lookup()` returns empty for an unknown table, row, or column. The pack
  check rejects a rule that names a table the pack does not have.
- A list is stored in the policy payload under its risk, never in a separate
  table, so it follows policy versioning, endorsement, and renewal.
- Problems inside a list are keyed `<list>.<index>.<column>` (or
  `<list>.<index>` for a whole item) and reported by the API at
  `/risks/0/<list>/<index>/<column>`.
- A snapshot includes only the tables its product reads, so changing an
  unrelated table does not create a new version of every product.
- Only tables read by a screen's rules are sent to the browser.

## Automated Tests

- `packages/rules`: `expression.test.ts`, `screen-rules.test.ts`.
- `server/src/lib/__tests__/carrier-tables.test.ts`, `rating-table.test.ts`
  (hand-computed per-item premiums), `product-screen.test.ts`.
- `frontend/src/features/wizard/__tests__/ConfiguredRiskForm.test.tsx`.
- Full package, unit, integration, and frontend suites.
- Exercised by hand in a browser on a kit stack: option labels from a table,
  the grid appearing when its coverage is selected, a blocked step for an
  empty required list, a per-item rule and a state limit from a lookup table,
  the fix, the review summary, and rating (per-item premium matched a hand
  calculation).

## Validation

```bash
npm run test:packages
npm run test:server
npm run test:frontend
npm run test:integration
```

## Follow-Ups Or Risks

- Standalone business tables (own storage, API, screen, permissions) are not
  built.
- A table has one key column; composite keys are not supported.
- Tables are static rows in the pack. Effective-dated rows are handled by
  pack versions and per-term pinning, not within a table.
- A list has one level; a list inside a list is not supported.
- More than one risk per policy is still not supported; a list is items
  under the single risk.
- The coverage editor does not know a coverage is priced per item; selecting
  `SCHEDULED` reveals the grid on the risk step through a screen rule.
