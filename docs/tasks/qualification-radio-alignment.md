# Qualification radio alignment

Qualification answers previously followed each question's natural text width,
so Yes/No controls drifted horizontally between rows. Qualification rows now
use a flexible question column and a fixed answer column, with equal Yes/No
columns. Long questions wrap without moving the controls. Below 760px, answers
appear under each question. Validation errors span the whole row.

Files: `frontend/src/styles.css`, `e2e/qualification-alignment.spec.ts`.

Validation: Playwright checks the five commercial-auto questions at desktop
and mobile widths, verifies radio selection and alignment, and saves screenshots.


## Framework standard

Both qualification and carrier-configured risk forms now use the shared
`RadioGroup` and `styles/radio.css`. The component preserves typed values,
controlled selection, native keyboard interaction, disabled state, and validation
accessibility. Removed the duplicate radio-option styling in the active stylesheet.
The dormant split stylesheets are not imported by the app.

The source audit prohibits raw radio inputs in production features. The screen
browser audit checks shared markup, accessible names, label alignment, and bounds.
Qualification tests cover all five core products at desktop and mobile widths.
See `docs/UI_CONTROL_STANDARDS.md` for contributor requirements.


## Validation results

- Full isolated Playwright suite: 132 passed, including 27 registered internal
  screen/policy audits and all five products' desktop/mobile alignment checks.
- Frontend suite: 208 passed with `--maxWorkers=4`. An earlier concurrent run
  timed out in an unchanged search-column test; the complete rerun passed.
- Typecheck and Docker frontend/server builds passed; `git diff --check` passed.
- Updated the local stack, then reran all five product alignment tests: passed.
