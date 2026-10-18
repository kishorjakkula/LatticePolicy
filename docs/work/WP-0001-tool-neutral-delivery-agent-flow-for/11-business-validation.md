# Business validation — WP-0001

Run on `main` (4b4c068) on 2026-10-18, in a throwaway copy of the delivery
files so no test work packages were committed. Gate D is recorded only when the
business owner signs off.

| Criterion | Role | Steps | Expected | Actual | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- |
| REQ-1–3: agents run in order with handoffs | Requester | `flow start "Show the agent name on the quote list"` | Work package created, business analyst prompt names its contract | Started WP-0001 on the standard track; prompt "You are the Business Analyst agent … agents/business-analyst.md" | command output | Pass |
| REQ-1–3: a stage cannot complete with placeholders | Agent | `flow complete … business-analyst` on the template | Refused | "01-requirements.md still has 12 … placeholder(s)" (the template's 12 placeholders) | command output | Pass |
| Human control: stop at the requirements gate and ask | Orchestrator | Complete the business analyst stage | Waits at Gate A and tells the agent to ask the approver | "waiting for human approval at Gate A … Ask the approver" | command output | Pass |
| Human control: agents cannot skip a gate | Agent | `flow complete … software-architect` before approval | Refused | "Nothing to complete: next is human approval at Gate A" | command output | Pass |
| Human control: PR blocked without requirements approval | Pull request | PR check with `Work package: WP-0001` | Fails | "Gate A must be approved (or waived by the requester) before merge" | command output | Pass |
| Requirements approval can be waived in the request | Requester | `flow start … --waive A --note "No need to ask me to approve the requirements"` | Gate A shows waived with the words | "A \| waived \| Requester (2026-10-18) \| No need to ask me to approve the requirements" | command output | Pass |
| Merge approval can never be waived | Requester | `flow waive WP-0002 C …` | Refused | "Gate C cannot be waived; only A and B can" | command output | Pass |
| REQ-4: same instructions for every AI tool | Contributor | `npm run agents:sync -- --check` on the `main` checkout | In sync | "Agent files are in sync with agents/." | `10-e2e-results.md` | Pass |
| REQ-5: knowledge has review dates and refresh | Curator | `npm run knowledge:report` on the `main` checkout | All files have metadata | "10 current, 0 due, 0 missing metadata"; monthly `knowledge-refresh.yml` present | `10-e2e-results.md` | Pass |
| Unedited PR template is rejected | Pull request | PR check with the unedited template | Fails | "must contain \"Work package: WP-NNNN\" or \"Delivery track: quick — <reason>\"" | command output | Pass |
| Code review is automatic and independent | Orchestrator | WP-0001 itself | Reviewer runs as a separate session without requester action | Three independent reviewer sessions ran on WP-0001 (16 + 5 findings fixed; post-merge fix clean) | `06-code-review.md` | Pass |
| UI/UX designer added | Requester | Read `agents/ui-designer.md`, `docs/knowledge/ux/README.md` | Stage 3 with design system, WCAG 2.2 AA, insurance UX | Present, in tracks standard and major, generated for every tool | repository | Pass |
| Documentation in the codebase | Requester | Open `docs/delivery/delivery-agents.html` and `docs/delivery/WORKFLOW.md` | Overview page and workflow on `main` | Present on `main` | repository | Pass |

## Open items (not blocking)

- Intermittent personal auto smoke failure found by the end-to-end stage
  (`10-e2e-results.md`): pre-existing, unrelated to this change; proposed as its
  own work package.
- Recommendation from security review: enable "Do not allow bypassing the above
  settings" on `main` branch protection (a repository setting for the owner).

## Recommendation

All acceptance criteria pass. Ready for the business owner's sign-off at Gate D.
