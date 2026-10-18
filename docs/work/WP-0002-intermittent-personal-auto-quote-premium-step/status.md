<!-- Generated from status.json by scripts/delivery/flow.mjs. Do not edit by hand. -->
# WP-0002: Intermittent: personal auto quote Premium step shows homeowners coverages (END_WB, END_PPRC, END_ORD, END_ERC) instead o

- Track: **major** — coverages and premium shown to users (rating area is always major)
- State: **in-progress**
- Next: human approval at Gate C

| Stage | Output | Status | Returns |
| --- | --- | --- | --- |
| Orchestrator | `status.json` | done | 0 |
| Business Analyst | `01-requirements.md` | done | 0 |
| Software Architect | `02-design.md` | done | 0 |
| UI/UX Designer | `03-ui-design.md` | done | 0 |
| Test Designer | `04-test-design.md` | done | 0 |
| Developer | `05-implementation.md` | done | 2 |
| Unit Test | `06-unit-tests.md` | done | 0 |
| Code Reviewer | `07-code-review.md` | done | 0 |
| Security and Compliance | `08-security-compliance.md` | done | 0 |
| Automation Test | `09-automation-tests.md` | done | 0 |
| Deployment | `10-release.md` | pending | 0 |
| End-to-End Test | `11-e2e-results.md` | pending | 0 |
| Business Validation | `12-business-validation.md` | pending | 0 |
| Knowledge Curator | `13-lessons.md` | pending | 0 |

## Gates

| Gate | Status | Approved by | Note |
| --- | --- | --- | --- |
| A | approved | Kishor Kumar Jakkula (product owner) (2026-10-18) | Approved (all five recommended answers accepted) |
| B | approved | Kishor Kumar Jakkula (product owner) (2026-10-18) | Approve |
| C | pending |  |  |
| D | pending |  |  |

## History

- 2026-10-18T15:33:56.499Z — started on the major track (coverages and premium shown to users (rating area is always major))
- 2026-10-18T15:35:10.890Z — Business Analyst completed
- 2026-10-18T15:36:59.178Z — Gate A approved by Kishor Kumar Jakkula (product owner): "Approved (all five recommended answers accepted)"
- 2026-10-18T15:40:06.876Z — Software Architect completed
- 2026-10-18T15:40:45.024Z — UI/UX Designer completed
- 2026-10-18T15:41:02.981Z — Test Designer completed
- 2026-10-18T15:42:30.441Z — Gate B approved by Kishor Kumar Jakkula (product owner): "Approve"
- 2026-10-18T15:51:11.948Z — Developer completed
- 2026-10-18T15:51:12.076Z — Unit Test completed
- 2026-10-18T15:59:16.267Z — returned to Developer: Code review: 1 blocker (homeowners auto-defaults use previous product config), 3 majors, 7 minors (07-code-review.md)
- 2026-10-18T16:04:48.306Z — Developer completed
- 2026-10-18T16:04:48.432Z — Unit Test completed
- 2026-10-18T16:33:01.509Z — returned to Developer: Re-review: policyId on POST /quotes not tied to a policy transaction of the same product (major); frontend tests never render the config wiring; 5 minors (07-code-review.md rows 25-29)
- 2026-10-18T16:33:01.638Z — Developer completed
- 2026-10-18T16:33:01.763Z — Unit Test completed
- 2026-10-18T16:40:41.055Z — Code Reviewer completed
- 2026-10-18T16:45:45.331Z — Security and Compliance completed
- 2026-10-18T16:45:45.481Z — Automation Test completed
