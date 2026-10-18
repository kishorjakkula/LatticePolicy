# Requirements — WP-0001

## Business goal

The product owner wants every coding request to pass through the same
specialist agents, whichever AI assistant writes the code, so quality no longer
depends on how each session is prompted. Contributors, the product owner and
future carriers' reviewers benefit from consistent requirements, design, tests
and validation evidence.

## Scope

- Lines of business: not applicable (engineering process).
- States / jurisdictions: not applicable.
- Transactions: not applicable.
- Roles and channels: product owner (requester and approver), code owner,
  contributors using Claude, Codex, Copilot, Cursor, Gemini or similar.

## Requirements

| ID | Requirement | Source (filed rule, guideline, law, product decision) |
| --- | --- | --- |
| REQ-1 | A business analyst agent with P&C knowledge reviews each request and asks questions before design. | Product owner request, 2026-10-17 |
| REQ-2 | A software architect agent with LatticePolicy and current architecture knowledge reviews and asks questions. | Product owner request |
| REQ-3 | Developer, unit test, automation test, deployment (CI/CD), post-deploy end-to-end and business validation agents follow in order. | Product owner request |
| REQ-4 | The flow works irrespective of the AI tool used. | Product owner request |
| REQ-5 | Agent knowledge is updated regularly. | Product owner request |
| REQ-6 | Improvements over the proposal are suggested and, once accepted, built. | Product owner: "as per the standards you can decide which suits us … and implement" |

## Acceptance criteria

### REQ-1, REQ-2, REQ-3

```gherkin
Scenario: The agents run in a fixed order with handoffs
  Given a coding request
  When the flow is started
  Then a work package is created with one handoff file per agent
  And the next agent's prompt names its contract and inputs
  And a stage cannot complete while its handoff has placeholders
```

### REQ-4

```gherkin
Scenario: Any assistant gets the same instructions
  Given the contracts in agents/
  When the adapters are generated
  Then AGENTS.md, CLAUDE.md, GEMINI.md, Claude sub-agents, Copilot prompts and Cursor rules carry the same flow
  And CI fails when a generated file drifts from the contracts
```

### REQ-5

```gherkin
Scenario: Stale knowledge is flagged for a reviewed refresh
  Given knowledge files with last_reviewed dates
  When a file passes its review interval
  Then the monthly workflow opens an issue for the knowledge curator
  And updates reach agents only through a reviewed pull request
```

### Human control

```gherkin
Scenario: Agents cannot approve their own work
  Given a work package waiting at a gate
  Then no further stage can complete until a named person's approval is recorded
  And a pull request fails the delivery check unless Gate A (and B on major) is approved
```

## Business rules

- Agents never approve gates, merge pull requests or deploy to production.
- After two returns to the same stage the package stops for a person.

## Regulatory and compliance notes

Not applicable to policyholder data. The flow strengthens compliance work by
adding a security and compliance stage before merge.

## Out of scope and assumptions

- No hosted orchestration service; files in the repository are the state.
- Automatic merging and production deployment are out of scope by design.

## Questions and answers

| # | Question | Recommended default | Answer |
| --- | --- | --- | --- |
| 1 | May agents branch, commit and open PRs between gates? | Yes; stop at gates | Delegated to the team's judgment; adopted as recommended |
| 2 | Who approves gates? | Product owner A, B, D; code owner C | Adopted |
| 3 | Staging environment? | Persistent when configured, otherwise local stack from main | Adopted |
| 4 | Knowledge refresh cadence and sources? | Monthly, primary sources | Adopted |
| 5 | Must the reviewer use a different model? | Separate session required, different model recommended | Adopted |
