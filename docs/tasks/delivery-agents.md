# Task Note: Tool-neutral delivery agents

## Links

- Work package: `docs/work/WP-0001-tool-neutral-delivery-agent-flow-for/`
- Decision: `docs/knowledge/architecture/adr/0001-delivery-agents.md`

## Summary

Every coding request now follows a fixed flow of specialist agents — orchestrator,
business analyst, software architect, UI/UX designer, test designer, developer, unit test, code
reviewer, security and compliance, automation test, deployment, end-to-end test,
business validation, knowledge curator — with four human gates. It works with any
AI assistant because the agents are Markdown contracts in `agents/`, handoffs are
files in `docs/work/<WP>/`, and each tool's instruction files are generated from
the contracts.

## Important Files

- `agents/*.md`: canonical contracts. Edit these, then `npm run agents:sync`.
- `docs/delivery/WORKFLOW.md`: stages, tracks, gates, decisions, PR rule.
- `docs/delivery/templates/`: handoff templates with `TODO(agent)` placeholders.
- `docs/knowledge/`: P&C and architecture knowledge with `last_reviewed` metadata.
- `scripts/delivery/`: `flow.mjs` (CLI), `sync-agents.mjs`, `check.mjs`,
  `knowledge-report.mjs`, `lib.mjs`, tests.
- Generated (do not edit): `AGENTS.md` delivery section, `CLAUDE.md`, `GEMINI.md`,
  `.claude/agents/`, `.github/copilot-instructions.md`, `.github/prompts/`,
  `.cursor/rules/delivery-flow.mdc`.

## Behavior Rules

- Agents never approve a gate, merge, or deploy to production; approvals record a
  named person and their words.
- A stage cannot complete while its handoff has placeholders, or out of order;
  code review and security cannot complete with open severe findings.
- Gates A and B are asked for by default and can be waived only in the
  requester's own words; C and D never.
- Returning to a stage reruns it and later stages and reopens their approvals.
- A third return to one stage stops the package; a person resolves it.
- The orchestrator starts the code reviewer itself in a separate session.
- Pull requests carry `Work package: WP-NNNN` or `Delivery track: quick — <reason>`;
  the `delivery-checks` workflow enforces it (bots exempt).
- Knowledge changes reach agents only through reviewed pull requests.

## Automated Tests

- Tests added: `scripts/delivery/delivery.test.mjs` (22), including regressions
  for every finding of the WP-0001 independent code review.
- Test layer used: Node unit tests on temporary repositories.
- Why this layer is enough: the flow is file-based tooling; no application runtime changes.

## Validation

```bash
npm run test:delivery
npm run agents:sync -- --check
npm run delivery:check
npm run knowledge:report
```

## Follow-ups

- WP-0001 continues from the code reviewer in a separate session, then Gate C (PR approval).
- Work the first knowledge refresh issue when it opens.
