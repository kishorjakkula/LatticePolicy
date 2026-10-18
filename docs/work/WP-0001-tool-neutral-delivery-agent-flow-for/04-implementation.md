# Implementation — WP-0001

- Branch: `latticepolicy/delivery-agents`
- Task note: `docs/tasks/delivery-agents.md`

## Files changed

See `02-design.md` → Components touched. In addition: `.gitignore` ignores
`.claude/worktrees/` (local agent worktrees) while generated `.claude/agents/`
is tracked; `package.json` adds `flow`, `agents:sync`, `delivery:check`,
`knowledge:report`, `test:delivery`.

The P&C knowledge base is seeded from the product owner's sourced research
(`reports/PC insurance domain primer.md`, `reports/PC underwriting process deep
dive.md`), copied into `docs/knowledge/pc-insurance/research/` with review
metadata, and summarized in `docs/knowledge/pc-insurance/README.md`.

## Deviations from the design

- Work package folder names end on a whole word (found while starting this
  package; fixed in `slugify` with a test).
- Product owner changes during the work: requirements approval is asked for by
  default and may be waived in the requester's words (Gates A and B only); the
  orchestrator starts the code reviewer automatically; a UI/UX designer agent
  was added (stage 3, `03-ui-design.md`; later handoff files renumbered). This
  package started before the UI/UX designer existed and keeps its original
  stage list.

## Code review fixes (return from `06-code-review.md`)

All 5 majors and 11 minors addressed: HTML comments stripped and placeholder
reasons rejected in the PR check, work-package reference bounded; `needs-human`
cannot be bypassed and is cleared only by `flow resolve`; returns reopen
approvals of redone work (waivers kept); approvals in `status.json` protected
by CODEOWNERS on `docs/work/`, `agents/`, `docs/delivery/`, `scripts/delivery/`
and documented; main-module check uses real paths; waiver track check before
creating the folder; orchestrator cannot be returned to; docs say "third return";
template instruction lines no longer contain the marker; YAML descriptions
quoted; quoted front-matter values accepted; `$` safe in AGENTS.md replacement;
drift reports orphaned generated files; track keywords match whole words; code
review and security stages refuse open severe findings; WORKFLOW tool table
lists CLAUDE.md and GEMINI.md.

## Checks run

- `npm run test:delivery` — 22 passed
- `npm run agents:sync -- --check` — in sync
- `npm run delivery:check` — passed
- `npm run knowledge:report` — 9 current, 0 due, 0 missing
