# Requirements — WP-0009

Source: the post-merge review of PR #394 (2026-10-23), findings M2–M4 and minors m1–m10,
plus an older bind defect found during WP-0008. M1 is fixed separately in WP-0008 (#398).
Knowledge base: P&C README reviewed 2026-10-17 (90 days, current).

## Business goal

Underwriters triage and decide referrals on correct figures, approvals stay usable for the
risk they approved, decisions keep a maker–checker separation, compliance changes are always
reasoned and audited, and the work package records match what actually shipped.

## Scope

- Lines of business: all.
- States / jurisdictions: all (eligibility, and company–product–state writing).
- Transactions: new business referrals and bind; policy-transaction referrals (endorse,
  renew, rewrite); compliance eligibility administration.
- Roles and channels: underwriters, agents, compliance admins; internal web app and API.

## Requirements

| ID | Requirement | Source |
| --- | --- | --- |
| REQ-1 | The referral queue and detail show the premium of the proposal under review: the quote premium for new business, and the full-term premium of the proposed transaction for endorsements, renewals and rewrites. Never a transaction delta, refund or zero. | Review M2 |
| REQ-2 | A referral approval stays valid when other policies bind in the same book: the proposal fingerprint covers whether aggregation limits are configured and exceeded, and why, but not book-wide totals. Bind re-checks aggregation itself. | Review M3 |
| REQ-3 | WP-0004's records are corrected: Gate C recorded as approved by the merger of #392 and #394, stage statuses reflect the reviews that actually happened (the Phase 2 review is the post-merge review), and 05/06/07 describe Phase 2 honestly. | Review M4 |
| REQ-4 | Changing a compliance eligibility status through the single-record API requires a reason and writes an audit entry, as the bulk change does. | Review m1 |
| REQ-5 | Rating and bind refuse an underwriting company that does not write the quote's product in its state (400 `UNDERWRITING_COMPANY_NOT_ELIGIBLE`). | Review m2 |
| REQ-6 | The underwriter who submitted a referral cannot approve it, and a referral shows earlier decisions on the same proposal (for example a previous decline). | Review m4; maker–checker |
| REQ-7 | Referrals opened before proposal binding (migration 069) that can never be approved are withdrawn with a reason, and drop out of the open count. | Review m5 |
| REQ-8 | The phone navigation sheet closes on Escape, moves focus into the sheet when opened and back to the menu button when closed, and its `aria-controls` target always exists. | Review m8; WCAG 2.2 |
| REQ-9 | Referral effective dates are compared as calendar dates on any server time zone, so concurrent first attempts never create duplicate referrals. | Review m9 |
| REQ-10 | A non-text decision reason returns 400 `INVALID_REASON`, never a server error. | Review m10 |
| REQ-11 | Bind refuses an expired quote (status Expired, or past its quote validity), with 409 `QUOTE_EXPIRED`. | Found in WP-0008 review |
| REQ-12 | Issued is recorded by the server when a policy is issued or a policy transaction is applied; clients can no longer send Issued on a quote draft. *Added after Gate A, from the WP-0008 security review; needs approval at Gate B.* | WP-0008 security review (N1) |
| REQ-13 | A re-rate through `POST /quotes` with a quote id refuses Converted and Issued quotes (409 `QUOTE_ALREADY_BOUND`) and locks the quote row. *Added after Gate A.* | WP-0008 security review |
| REQ-14 | A bind refused for a stale rating or expiry writes a structured log line (tenant, quote id, code; no payload), and rating resets are counted, so the release metric can be measured. *Added after Gate A.* | WP-0008 security review (L1) |

## Acceptance criteria

### REQ-1

```gherkin
Scenario: Rewrite referral shows the proposed premium
  Given a cancelled policy with a $1,200 term premium and a rewrite proposal rated at $1,250 that is referred
  Then the referral queue shows $1,250, not the cancellation refund

Scenario: Renewal after an endorsement
  Given a policy endorsed for +$15 whose renewal is referred at $1,300
  Then the queue shows $1,300
```

### REQ-2

```gherkin
Scenario: Approval survives other binds in the book
  Given an approved mileage referral in a book with an aggregation limit configured and not exceeded
  When another policy binds in the same product and state
  And the agent retries the referred bind
  Then the approval is used and no new referral is opened

Scenario: Aggregation newly exceeded
  Given an approved referral
  When the book now exceeds its aggregation limit
  Then bind refuses or refers on aggregation, as it does today
```

### REQ-3

```gherkin
Scenario: Records match what shipped
  When WP-0004's status is shown
  Then Gate C shows approved with the merge dates of #392 and #394, and 07-code-review.md has a Phase 2 entry with file:line findings
```

### REQ-4

```gherkin
Scenario: Single-record status change needs a reason
  When a compliance admin PATCHes an eligibility record's status without a reason
  Then the response is 400 REASON_REQUIRED and nothing changes

Scenario: Change is audited
  When the change includes a reason
  Then one audit entry records actor, reason and before/after
```

### REQ-5

```gherkin
Scenario: Company that does not write the product
  Given company A writes only Homeowners in TX
  When a Personal Auto CA quote names company A and is rated or bound
  Then the response is 400 UNDERWRITING_COMPANY_NOT_ELIGIBLE
```

### REQ-6

```gherkin
Scenario: No self-approval
  Given a referral submitted by underwriter U
  When U approves it
  Then the response is 403 SELF_APPROVAL_NOT_ALLOWED; another underwriter can approve

Scenario: Earlier decision shown
  Given a declined referral for a proposal
  When the same proposal is referred again
  Then the new referral shows "Previously declined on <date> by <name>: <reason>"
```

### REQ-7

```gherkin
Scenario: Legacy referral withdrawn
  Given an Open referral without proposal evidence
  When the release runs
  Then it is Withdrawn with reason "Superseded by proposal-bound referrals" and the open count excludes it
```

### REQ-8

```gherkin
Scenario: Phone sheet keyboard behaviour
  Given a 390px viewport
  When the menu opens
  Then focus moves into the sheet, Escape closes it, and focus returns to the menu button
```

### REQ-9

```gherkin
Scenario: Server east of UTC
  Given the server time zone is Asia/Kolkata
  When two first bind attempts for the same proposal run at once
  Then exactly one referral exists
```

### REQ-10

```gherkin
Scenario: Non-text reason
  When a decision is sent with reason 42
  Then the response is 400 INVALID_REASON
```

### REQ-11

```gherkin
Scenario: Expired quote
  Given a quote marked Expired by the stale-quote job
  When the agent binds it
  Then the response is 409 QUOTE_EXPIRED and nothing is created
```

### REQ-12

```gherkin
Scenario: Server records Issued
  When an endorsement is applied through the wizard
  Then the transaction's quote is Issued without the client sending a status
  And a draft save with status "Issued" is refused with 400 INVALID_STATUS
```

### REQ-13

```gherkin
Scenario: No re-rate of an issued quote
  Given an Issued policy-transaction quote
  When POST /quotes is sent with its quote id
  Then the response is 409 QUOTE_ALREADY_BOUND and the quote is unchanged
```

### REQ-14

```gherkin
Scenario: Refusal is observable
  When bind refuses with QUOTE_RERATE_REQUIRED
  Then one log line records tenant, quote id and code, with no payload
```

## Business rules

- Maker–checker: a person may not approve their own referral (carrier underwriting
  governance; standard authority practice in the P&C knowledge base).
- Every compliance eligibility change carries a reason and an audit entry (existing rule
  for bulk changes, WP-0004 REQ-10).
- A company may write only the products and states configured for it (underwriting company
  administration).

## Regulatory and compliance notes

- No rate, form or notice change.
- Writing a product in a state through a company not licensed or configured for it is a
  regulatory risk; REQ-5 closes it on the server.
- Retention of insured personal data in referral snapshots (review m6) needs a carrier
  retention and erasure policy decision. It is out of scope here (see questions).

## Out of scope and assumptions

- Out of scope:
  - m6, personal-data retention in proposal snapshots: needs a policy decision.
  - m7, assigning referrals to other underwriters: a product decision.
  - N1 from WP-0008: having the server record Issued.
  - The in-memory fallback.
- Assumption: WP-0008 (#398) merges first; this branch is stacked on it.

## Questions and answers

| # | Question | Recommended default | Answer |
| --- | --- | --- | --- |
| 1 | Can an admin override self-approval in an emergency? | No; another underwriter must approve | |
| 2 | Legacy Open referrals: withdraw automatically, or list them for underwriters to close? | Withdraw automatically at release with a reason, and list them in the release notes | |
| 3 | Expired quote at bind: refuse, or re-rate automatically? | Refuse with QUOTE_EXPIRED; the agent re-rates | |
| 4 | Bring m6 (snapshot PII retention) and m7 (assign to others) into this package? | No; separate decisions and work packages | |
