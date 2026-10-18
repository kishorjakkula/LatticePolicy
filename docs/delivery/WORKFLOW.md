# LatticePolicy Delivery Workflow

How every coding request moves from idea to validated release, whichever AI
assistant (or person) does the work. The agents are role contracts in
[`agents/`](../../agents/README.md); their handoffs are files in a work package
under `docs/work/`. Any tool, or a person, can pick up a package from its files.

Start a request in any AI tool with:

```text
Start the LatticePolicy delivery flow for: <your request>
```

or from a terminal:

```bash
npm run flow -- start "Add mortgagee change endorsement for HO-3"
npm run flow -- next WP-0002          # prompt for the next agent, for any AI tool
npm run flow -- status WP-0002
```

## Stages

```mermaid
flowchart TD
  R([Request]) --> O[Orchestrator: size and route]
  O --> BA[1 Business analyst]
  BA -->|questions| R
  BA --> GA{{Gate A: requirements}}
  GA --> SA[2 Software architect]
  SA --> TD[3 Test designer]
  TD --> GB{{Gate B: design and tests, major track}}
  GB --> DEV[4 Developer]
  DEV <--> UT[5 Unit test]
  UT --> CR[6 Code reviewer]
  CR -.->|changes| DEV
  CR --> SEC[7 Security and compliance]
  SEC -.->|findings| DEV
  SEC --> AT[8 Automation test]
  AT -.->|failures| DEV
  AT --> GC{{Gate C: pull request approved and merged}}
  GC --> DEP[9 Deployment: staging]
  DEP --> E2E[10 End-to-end test]
  E2E -.->|defects| DEV
  E2E --> BV[11 Business validation]
  BV --> GD{{Gate D: business sign-off}}
  GD --> PROD[Deployment: production]
  PROD --> KC[12 Knowledge curator]
```

| Stage | Agent | Output in the work package |
| --- | --- | --- |
| 0 | Orchestrator | `status.json`, `status.md` |
| 1 | Business analyst | `01-requirements.md` |
| 2 | Software architect | `02-design.md` |
| 3 | Test designer | `03-test-design.md` |
| 4 | Developer | code, `docs/tasks/` note, `04-implementation.md` |
| 5 | Unit test | tests, `05-unit-tests.md` |
| 6 | Code reviewer | `06-code-review.md` |
| 7 | Security and compliance | `07-security-compliance.md` |
| 8 | Automation test | `e2e/` specs, `08-automation-tests.md` |
| 9 | Deployment | `09-release.md` |
| 10 | End-to-end test | `10-e2e-results.md` |
| 11 | Business validation | `11-business-validation.md` |
| 12 | Knowledge curator | `12-lessons.md` |

`traceability.md` links each requirement to its design, code, tests, release
and validation evidence; each agent fills its column.

## Tracks

The orchestrator chooses a track and says why; the requester can override it.

| Track | Use for | Stages | Human gates |
| --- | --- | --- | --- |
| `quick` | Copy or typo fixes, a small bug with an obvious cause, test-only or docs-only changes | 0, 4, 5, 6, 9 | C |
| `standard` | A feature or behavior change inside one area | all (architect writes a short design) | A, C, D |
| `major` | New product line, migrations, security, tenancy, authentication, rating, filed forms, customer data, AI, or cross-module change | all, with an ADR for lasting decisions | A, B, C, D |

Anything touching tenant isolation, authentication, rating, filed forms,
customer data, migrations or AI data boundaries is **major**, whatever its size.

## Gates

| Gate | Approves | Evidence | Approver |
| --- | --- | --- | --- |
| A | Requirements | `01-requirements.md`, answered questions | Product owner |
| B | Design and test plan (major) | `02-design.md`, `03-test-design.md` | Product owner or lead engineer |
| C | Merge | Pull request, review, security findings, green CI | Code owner (GitHub branch protection) |
| D | Production release | `10-e2e-results.md`, `11-business-validation.md`, `09-release.md` | Business owner (carrier business user for carrier-specific work) |

Approvals are recorded with the approver's name and their words:
`npm run flow -- approve WP-0002 A --by "<name>" --note "<what they said>"`.
An agent never records an approval nobody gave, and never approves its own work.

## Decisions (October 2026)

These were decided for LatticePolicy when the workflow was adopted and can be
revised here:

1. **Agent autonomy.** Agents may create branches, commit and open pull requests
   between gates. They stop at every gate, never merge a pull request and never
   deploy to production.
2. **Approvers.** The product owner approves Gates A, B and D; the code owner
   approves Gate C through GitHub. Carrier-specific work adds a carrier business
   user at Gate D.
3. **Staging.** Use a persistent staging environment when one is configured
   (`E2E_BASE_URL`, `E2E_API_BASE_URL`); until then the local Docker stack built
   from `main` is staging. Tests never use a pilot or demo database.
4. **Knowledge refresh.** Monthly. The `knowledge-refresh` workflow opens an issue
   for files past their review date; the knowledge curator proposes sourced
   updates in a pull request that a person reviews. Security advisories are
   handled when they appear.
5. **Reviewer independence.** The code reviewer always runs in a separate session
   from the developer. A different model or tool is recommended, not required.
6. **Tracks** as defined above.

## Returns and loops

When an agent finds a problem in earlier work it returns the package to that
stage with a reason (`npm run flow -- return WP-0002 developer --reason "…"`).
After **two** returns to the same stage the package becomes `needs-human` and
the orchestrator stops to ask.

## Pull requests

Every pull request states its work package in the description:

```text
Work package: WP-0002
```

or, for a quick change without a package:

```text
Delivery track: quick — <one-line reason>
```

The `delivery-checks` workflow fails a pull request without one, or whose work
package is missing a required gate (A, and B on the major track). Automated
dependency updates are exempt.

## Knowledge

Agents rely on [`docs/knowledge/`](../knowledge/README.md): P&C insurance,
architecture, and the project docs. Every knowledge file states its sources and
`last_reviewed` date; agents treat stale time-sensitive facts as needing
confirmation. `npm run knowledge:report` lists files due for review.

## Tool support

`npm run agents:sync` generates each tool's files from `agents/`:

| Tool | Generated files |
| --- | --- |
| Codex, Jules, Aider, and agents that read `AGENTS.md` | delivery section of `AGENTS.md` |
| Claude Code | `.claude/agents/<agent>.md` (one sub-agent per role) |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/prompts/<agent>.prompt.md` |
| Cursor | `.cursor/rules/delivery-flow.mdc` |

CI runs `npm run agents:sync -- --check` and fails when they drift.
