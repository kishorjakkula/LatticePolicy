# Issue 331: Module Boundary Checks

## Summary

CI now builds a deterministic graph of relative TypeScript and TSX imports. It fails with an actionable path when it finds an import cycle or when a policy-critical leaf capability imports its orchestrator.

## Enforced Boundaries

- lifecycle support must not import the lifecycle orchestrator;
- customer matching must not import the customer router;
- onboarding normalization must not import the onboarding router; and
- quote risk defaults must not import `QuoteWizard`.

The graph checker lives in `scripts/check-module-boundaries.mjs`, uses only Node.js standard-library APIs, and resolves source `.ts`/`.tsx` files from relative `.js` imports used by the ESM build.

## Verification

Run `npm run check:architecture`. Its tests characterize valid, cyclic, and forbidden-boundary graphs before the repository itself is checked. The command runs in the standard CI validation job before build and test steps.
