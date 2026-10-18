# Lessons — WP-0001

## What went well

- The flow ran end to end on its first real change, across three pull requests
  (#382, #383 and this closeout) with all four gates recorded from the product
  owner's own words.
- Independent review earned its place: the first reviewer session found 5 major
  and 11 minor defects in tooling that had passing tests, including an unedited
  pull request template slipping through the PR check and a way to restart a
  stopped package. A second session verified the fixes and found 5 more minors.
- Returns behaved as designed: a post-merge security finding sent the package
  back to the developer and reopened the merge gate automatically.
- The product owner changed the process mid-flight (requirements approval asked
  by default with waivers, automatic code review, a UI/UX designer agent) and the
  contracts, tooling and generated files absorbed it in one change.

## Returns and late defects

| Stage returned to | Why | Caught by | Could it have been caught earlier? |
| --- | --- | --- | --- |
| Developer | 5 major / 11 minor tooling defects | Code reviewer (independent session) | Partly: the developer's own tests checked the happy path; adversarial cases (template text, bypass sequences) were missing. |
| Developer | 5 minor defects after fixes, mostly from the mid-flight renumbering | Code reviewer (second session) | Yes: a consistency check over stage numbers in `WORKFLOW.md`. |
| Developer | CodeQL alert 36 (comment stripping) after merge | CodeQL on the merged revision | Yes: the developer can run the same security scan, or a scan-style self-check, before handing off. |
| — | Intermittent personal auto smoke failure (pre-existing) | End-to-end stage | Not this change's defect; found because the end-to-end stage ran the smoke suite. |
| — | Evidence screenshot lost when the rerun cleared `test-results/` | End-to-end stage | Yes: copy failure evidence before rerunning. |

## Changes to agents or knowledge

Applied in this closeout pull request:

- `agents/developer.md`: write adversarial tests for any parser or check (template
  text, comments, boundaries, bypass sequences), and treat CodeQL/security
  scan alerts on the pull request as defects to fix before Gate C.
- `agents/e2e-test.md`: copy failure screenshots, traces and logs into the work
  package before rerunning a failed test.
- `agents/software-architect.md`: when stages or files are renumbered, list every
  document that cites the numbers and update them together.

Follow-up work package proposed (not started): intermittent personal auto
Premium step showing homeowners coverages (major track: rating and coverages).
