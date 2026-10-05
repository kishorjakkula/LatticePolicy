# Epic Development Workflow

This document defines the repeatable process for planning, tracking, auditing,
and closing roadmap epics in LatticePolicy. `docs/ROADMAP.md` explains what the
epics are; this document explains how they move.

## Why This Exists

As of 2026-08, every phase epic (#70-#76) had made real progress — several were
55-78% complete at the child-issue level — but none had ever been closed, and
several had blocking child issues that were themselves functionally complete
(merged, tested, documented) but never revisited to close them out. Nothing in
the previous process ever looked back at an epic once work started landing
against it. This document exists to close that gap.

## Epic Anatomy

Every epic issue should keep using the existing structure (see any of
#69-#76 for the pattern):

```markdown
## Goal
## Expected Outcome
## Child Tasks
- [ ] #NN Short title
## Acceptance Criteria
```

Rules:

- Child tasks are listed as `- [ ] #NN` so GitHub links them automatically.
  This checklist is a planning snapshot at epic-creation time, not a live
  dashboard — see "Progress Is Not Self-Maintaining" below.
- One child issue may legitimately serve multiple epics (e.g. #58 operational
  admin dashboards is relevant to both platform readiness and production
  operations). Do not duplicate the issue per epic; list it in every epic it
  genuinely belongs to.
- An epic's Acceptance Criteria should be independently checkable — a reviewer
  should be able to look at merged PRs and current repo state and judge
  whether the criteria hold, without needing private context.

## Progress Is Not Self-Maintaining

GitHub does not rewrite an epic's stored Markdown body when a linked child
issue closes. The `- [ ] #NN` checkbox in the epic's body stays exactly as
typed unless a human or agent edits it. This means:

- An epic can look 0% done in its raw body text while actually being 80% done.
- Nobody is automatically notified when an epic's children finish.
- Without a deliberate audit step, epics silently stall at "in progress"
  forever, even after their scope is delivered.

**Do not trust the checkbox rendering alone.** Always verify against actual
issue state (see Audit Procedure).

## Child Issue Completion Convention

When a PR resolves a child issue's full scope, its description should say
`Closes #NN`, which auto-closes the issue on merge.

When a PR only partially resolves a child issue's stated scope — a common and
expected outcome for large backlog items — its description should say
`Progresses #NN` instead, and must explicitly list what remains. Do not use
`Closes` on a partial PR just to make progress numbers look better; an epic's
completion percentage is only meaningful if child-issue state is honest.

A child issue left open with `Progresses` language and a clear remaining-scope
note is a healthy, expected state — it is not a stalled epic, it is
transparent partial delivery. The Audit Procedure below is what turns "still
open" into either "closed" (if the remaining note turns out to already be
satisfied by later work) or "still genuinely open" (if not).

## Audit Procedure

Run this whenever a batch of epic-linked child issues merges, or at minimum
before treating an epic as roadmap-stale. This can be performed by a
maintainer or an AI contributor with repo read access; only the final close
action requires a maintainer or an authorized agent (see Roles below).

1. **Pull real state.** For each epic, list its child issue numbers and query
   their actual current state:
   ```bash
   gh issue list --repo <owner>/<repo> --state all --limit 100 \
     --json number,state,title \
     -q '.[] | select(.number == <NN> or ...) | "\(.number)|\(.state)|\(.title)"'
   ```
   Do not rely on the epic body's checkbox rendering as a substitute for this
   query.
2. **Compute completion.** closed / total child issues. Note which specific
   issues remain open.
3. **For each open child issue, classify it:**
   - *Actually done, never closed* — a merged PR clearly satisfies the issue's
     acceptance criteria, but the PR used `Progresses` (out of caution at PR
     time) or didn't reference the issue at all. Draft a closing comment
     citing the specific PR(s) and which acceptance criteria they satisfy,
     and close the issue.
   - *Genuinely partial* — the merged PR explicitly deferred real scope (check
     its "Follow-Ups Or Risks" section and linked task note under
     `docs/tasks/`). Leave it open. Optionally split the deferred scope into a
     new, narrower issue if it's substantial enough to track separately.
   - *Not started* — no PR has touched it. Leave it open; this is a real
     roadmap gap, not a process failure.
4. **Re-evaluate the epic's Acceptance Criteria** against current repo state,
   not just the child checklist. An epic can have every listed child issue
   closed while still failing its own acceptance criteria if the criteria
   describe an integrated outcome (e.g. "a carrier can complete onboarding
   end-to-end") that no single child issue fully covers. Conversely, an epic
   can sometimes be satisfied before every optional/stretch child issue closes.
5. **Decide the epic's disposition:**
   - **Close it** if every acceptance criterion holds and remaining open
     children (if any) are explicitly re-scoped as follow-up work outside this
     epic's boundary. Post a closing comment summarizing what shipped, with
     links to the PRs, and note any explicitly deferred follow-up issues.
   - **Keep it open, update the checklist** if real gaps remain. Edit the
     epic body to check off closed children (`- [x] #NN`) so the stored text
     matches reality, and add a short "Status" note near the top with the date
     of the last audit and the current completion fraction.
   - **Split it** if the remaining scope has drifted far enough from the
     original Goal that continuing to track it under the same epic would
     confuse readers — open a new, narrower epic for the remaining work and
     close the original with a note pointing to the replacement.

## Roles

- **Any contributor (human or AI)** can perform steps 1-4 of the Audit
  Procedure and propose a disposition — this is analysis, not a mutation.
- **Closing an issue or epic, and editing another author's issue body,** are
  GitHub actions that change shared, visible state. An AI contributor should
  propose the close (a comment with the evidence and a recommended
  disposition) and let a maintainer perform the close, unless the maintainer
  has explicitly pre-authorized closing issues for that session. Some CI/agent
  environments block issue-closing and issue-body-editing at the permission
  layer even when other write actions (opening PRs, pushing branches) are
  allowed — treat that as a signal to hand off the close decision, not a bug
  to route around.
- **Opening or re-scoping a new epic or milestone** is a maintainer decision;
  an AI contributor should recommend it with reasoning, not do it unilaterally.

## Cadence

Run the Audit Procedure:

- After any wave of epic-linked child issues merges (the natural trigger —
  don't wait for a calendar date).
- Before referencing an epic's completion percentage in any roadmap
  communication, so the number quoted is never stale.
- At minimum once per milestone window (see `.github/milestones.yml` /
  `docs/GITHUB_ROADMAP_SETUP.md`) as a backstop, in case no one remembered to
  run it opportunistically.

## Relationship To Other Docs

- `docs/ROADMAP.md` — what the phases and epics are, and their expected
  outcomes. This document is referenced from ROADMAP.md's Execution Model
  section.
- `docs/GITHUB_ROADMAP_SETUP.md` — GitHub labels, milestones, Project board
  fields, and issue triage rules. This document is the process layer on top
  of that structure.
- `docs/tasks/*.md` — per-change AI-readable context, including "Follow-Ups Or
  Risks" sections that the Audit Procedure reads to classify open issues as
  genuinely partial vs. actually done.
