# Implementation - WP-0006

- Branch: `latticepolicy/restore-platform-logo`, from merged main 7265c31.
- Task note: `docs/tasks/restore-platform-logo.md`.

## Files changed

CarrierBrand now uses the existing bundled SVG plus visible carrier name when
no carrier image exists, shared by login and every app header. Scoped styling
preserves proportions and a light artwork background for the dark wordmark.
Carrier-supplied logos remain primary. The effect includes logo changes so the
browser icon updates on logo-only edits/removal. Default favicon reuses the
existing lattice mark; the initial HTML title identifies LatticePolicy.

Tests: carrierBranding.test.tsx and e2e/branding.spec.ts. The latter covers
real image loading, desktop/mobile light/dark, accessible identity, portal and
custom carrier override. No server, identity/auth logic, data/configuration,
document generation, carrier logo asset, dependency or migration change.

## Deviations from the design

No separate redesign. This restores a missing existing asset. No carrier
identity is overwritten and no framework logo is inserted into policy output.

## Checks run

Focused branding/settings/login components: 12 passed across 4 files.
Root typecheck and frontend Docker production build passed. Broader unit and
isolated browser checks recorded by the unit-test handoff as they complete.
