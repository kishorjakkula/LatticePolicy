# Lessons — WP-0002

## What went well

- The flow turned an intermittent smoke failure seen in WP-0001 into a fixed,
  validated defect in one day: requirements, design, fix and staging validation
  for PR #385, with Gates A, B and C from the product owner's own words.
- The fix works at two layers. The wizard ignores late product configuration,
  and the API refuses foreign coverage codes at every transaction. Business
  validation confirmed both on staging (422 at rating and at bind).
- The Coverage Integrity report found the records the defect had already
  created (bound policy PC-987896C3 and two quotes), plus older ones nobody
  knew about: a homeowners draft carrying cyber codes and `DWELLING` fixture
  records.
- Independent review earned its place again: two returns (a homeowners-defaults
  blocker, then `policyId` not tied to a same-product transaction) were fixed
  before merge.

## Returns and late defects

| Stage returned to | Why | Caught by | Could it have been caught earlier? |
| --- | --- | --- | --- |
| Developer | Blocker: homeowners auto-defaults used the previous product's configuration; 3 majors, 7 minors | Code reviewer | Partly: a unit test that switches product while a configuration is loading. |
| Developer | Major: `policyId` on `POST /quotes` not tied to a policy transaction of the same product; frontend tests never rendered the configuration wiring | Code reviewer (re-review) | Yes: adversarial API cases (a policy from another product) in the test design. |
| — (follow-up PR #387) | Changing the Underwriting Company switched product with no confirmation, short of Gate A answer 4 | Business validation on staging | Yes: the UI design covered only the Product select. With one product per company, the company select is the only way to switch, and the dialog could not appear. |
| — | 1 of 10 repeated wizard runs failed on local staging with `429` after issue | End-to-end stage | Environment, not product: local staging applies the per-IP rate limit. The isolated stack passed 10/10. |
| — | Design said `/api/v1/admin/coverage-integrity`; code ships `/api/v1/admin/dashboard/coverage-integrity` | Deployment stage | Yes: the developer records contract deviations in `05-implementation.md`. |
| — | Local staging had been built from the PR worktree, not `main` | Deployment stage | Yes: staging is built from the `main` checkout and its source is recorded. |

## Changes to agents or knowledge

Applied in this closeout pull request (#386):

- `agents/ui-designer.md`: when a confirmation guards a state change, list every
  control that can cause it (product **and** underwriting company) and design
  the guard for each.
- `agents/e2e-test.md`: run repeated or parallel journeys on the isolated stack;
  local staging rate-limits per IP.
- `agents/deployment.md`: build staging from the `main` checkout, record its
  source and revision, and note migrations the shared database carries that
  `main` does not (067/068 from other work this time).
- `agents/developer.md`: record any deviation from a `02-design.md` contract in
  `05-implementation.md`.

Follow-ups:

- PR #387 (quick track) proposes asking before a company change clears data.
  It remains open, pending merge, deployment and staging verification. Business
  validation is partial until the confirmation requirement is verified or the
  business owner explicitly accepts an exception; Gate D remains pending.
- Not started: correcting records with foreign coverages is a carrier decision
  (Gate A answer 3). The earlier abandoned-draft explanation was unsupported:
  the company handler retains the draft ID and subsequent saves update the same
  quote, rather than preserving a separate homeowners draft.
