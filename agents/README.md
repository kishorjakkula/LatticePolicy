# LatticePolicy Delivery Agents

These files are the **canonical role contracts** for the delivery flow in
[`docs/delivery/WORKFLOW.md`](../docs/delivery/WORKFLOW.md). They are written
for any AI coding assistant (Claude, Codex, Copilot, Cursor, Gemini, Aider…) and
for people. Nothing here depends on one vendor.

- Edit only the files in this folder. `npm run agents:sync` generates the copies
  each tool looks for (`.claude/agents/`, `.github/prompts/`,
  `.github/copilot-instructions.md`, `.cursor/rules/`, the delivery section of
  `AGENTS.md`). CI fails when the copies are out of date.
- Each file starts with a small header that the flow tooling reads: `id`,
  `stage`, `tracks`, `writes`, and `gate_after` (the human approval that follows).

| Stage | Agent | Writes |
| --- | --- | --- |
| 0 | [Orchestrator](orchestrator.md) | `status.json`, `status.md` |
| 1 | [Business analyst](business-analyst.md) | `01-requirements.md` |
| 2 | [Software architect](software-architect.md) | `02-design.md` |
| 3 | [UI/UX designer](ui-designer.md) | `03-ui-design.md` |
| 4 | [Test designer](test-designer.md) | `04-test-design.md` |
| 5 | [Developer](developer.md) | code, task note, `05-implementation.md` |
| 6 | [Unit test](unit-test.md) | tests, `06-unit-tests.md` |
| 7 | [Code reviewer](code-reviewer.md) | `07-code-review.md` |
| 8 | [Security and compliance](security-compliance.md) | `08-security-compliance.md` |
| 9 | [Automation test](automation-test.md) | `e2e/` specs, `09-automation-tests.md` |
| 10 | [Deployment](deployment.md) | `10-release.md` |
| 11 | [End-to-end test](e2e-test.md) | `11-e2e-results.md` |
| 12 | [Business validation](business-validation.md) | `12-business-validation.md` |
| 13 | [Knowledge curator](knowledge-curator.md) | `13-lessons.md`, knowledge PRs |
