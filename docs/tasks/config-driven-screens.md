# Task Note: Config-Driven Risk Screens

## Links

- Issue: none yet (phase 3, step 3 of the carrier isolation and admin roles proposal)
- Pull request:

## Summary

A carrier lays out its own risk screen in its carrier pack: sections or tabs,
a column grid, a widget per field, and rules for when a field is shown,
required, and valid. The quote wizard renders it and the API enforces the
same rules, because both run the shared `@lattice-policy/rules` package.

## Important Files

- `packages/rules/src/expression.ts`: the rule expression language.
- `packages/rules/src/screen-rules.ts`: `evaluateScreen` (visibility,
  required, errors) and the names rules can read (`buildScreenContext`).
- `server/src/lib/product-screen.ts`: builds a screen from
  `fields/<code>.json` and `screens/<code>.yaml`, reports problems, and turns
  rule failures into quote errors.
- `server/src/lib/products.ts`: `loadRiskScreen` (reserves a core product's
  built-in fields).
- `server/src/routes/products.routes.ts`: `GET /products/:code/form` adds
  `screen` when the pack defines one.
- `server/src/services/quote.service.ts`: `createOrRateQuote` rejects a quote
  that breaks the screen rules (`INVALID_QUOTE`, errors with
  `keyword: 'screen'`).
- `server/src/lib/carrier-pack-validator.ts`: validates `screens/`.
- `frontend/src/features/wizard/ConfiguredRiskForm.tsx`: the renderer and the
  review summary. `QuoteWizard.tsx` uses it for the risk step.
- `examples/carrier-pack/screens/condo-unit-owners.yaml`: worked example.

## Behavior Rules

- The browser and the API must reach the same answer for a rule. Rule logic
  lives only in `packages/rules`; do not reimplement it on either side.
- Expressions can read only the values handed to them. No property calls, no
  inherited properties, no globals. Keep it that way when adding functions.
- A missing name is empty, not an error. A rule that fails to parse is
  rejected by the pack check and, if it ever reaches evaluation, is false.
- A hidden field is never required, never reported, and field-pinned
  validations on it do not apply.
- A core product's built-in screen is untouched. A pack screen for a core
  product only adds sections of pack-defined fields.
- A pack product with a fields file but no screens file still gets a screen
  (one section per `ui.group`), so its required fields are enforced by the API.

## Automated Tests

- `packages/rules/src/expression.test.ts`, `screen-rules.test.ts`.
- `server/src/lib/__tests__/product-screen.test.ts`: building, validating,
  loading through the pack, core product extension, and quote checks.
- `frontend/src/features/wizard/__tests__/ConfiguredRiskForm.test.tsx`.
- Full package, server unit, integration, and frontend suites run with no
  pack configured.
- Exercised by hand against a kit stack with the example pack: the form
  endpoint, an API call that breaks three rules (rejected with each rule
  named), and the real wizard in a browser (tabs, a conditional field
  appearing, a blocked step with an error badge on the other tab, the fix,
  the review summary, and rating).

## Validation

```bash
npm run test:packages
npm run typecheck
npm run test:server
npm run test:frontend
npm run test:integration
```

## Follow-Ups Or Risks

- Only the risk step is configurable. Product, insureds, coverages, and
  review steps are still built in.
- Rules read the first risk only; lists of risks arrive with custom tables.
- Screen rules were first enforced only when a quote was created or rated.
  `docs/tasks/pack-rules-all-transactions.md` extends them to every
  transaction.
- Adding fields to a core product's screen was tested through the server and
  pack validator, not in a browser.
- No automated end-to-end test covers a pack screen.
- The wizard still does not show inline errors for core products' dynamic
  forms; that behavior is unchanged.
