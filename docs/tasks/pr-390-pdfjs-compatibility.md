# PR 390: PDF.js Compatibility

Delivery track: quick - repair the existing pilot's PDF parser cleanup for a
development dependency update; no application behavior changes.

## Cause And Fix

PDF.js 6 no longer exposes `destroy()` on the resolved PDF document proxy.
The pilot's carrier-branding and endorsement assertions parsed the documents
successfully but failed during cleanup. Keep the loading task returned by
`getDocument()` and destroy that task in `finally`, including when loading or
an assertion fails. All existing text, layout and embedded-image assertions
remain intact.

The root manifest/lockfile now declare the same supported Node range planned
for PR 388: `^22.22.2 || ^24.15.0 || >=26.0.0`. This satisfies PDF.js 6's
minimum and avoids publishing the old, incompatible 22.12 support claim.
PR 388 aligns runtime selection/setup documentation with this range.

## Verification

The existing two pilot tests are the regression cases. Their updated cleanup
must pass on PDF.js 6; do not remove the PDF-content assertions or retry away
the deterministic error. An isolated, synthetic real-PDF parser check is also
run locally without connecting to the demo or pilot database. Fresh remote
pilot results are required before merge readiness is declared.

Local verification on Node 22.23.3: workspace typecheck passed; a real synthetic
PDF parsed with the expected text and embedded image, then task cleanup passed.
An invalid PDF also rejected and cleaned up without masking the loading error.
`git diff --check` passed. The pilot database was not used for these checks.
