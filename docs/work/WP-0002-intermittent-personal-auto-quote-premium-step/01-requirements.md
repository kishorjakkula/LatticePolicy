# Requirements — WP-0002

Knowledge used: `docs/knowledge/pc-insurance/README.md` (reviewed 2026-10-17,
current), research primer (rating, forms and filings), requirements checklist.

## Business goal

A quote and policy must carry only the coverages of the product being written.
Agents and underwriters must see, rate, bind and issue exactly the coverages the
carrier filed for that product. Today a personal auto quote can intermittently
pick up the homeowners coverage set, be rated with it and be bound with it.

### What was observed (local staging, 2026-10-18)

| Quote | When / by | Product and risk | Coverages saved | Outcome |
| --- | --- | --- | --- | --- |
| `31105c6a…` | 15:24 UTC, admin (smoke test) | personal-auto, CA, `autoVehicle` | A, B, C, D, E, F, END_WB, END_PPRC, END_ORD, END_ERC | Rated $529.70; Premium step listed homeowners endorsements |
| `5be36d0d…` | 03:16 UTC, agent1 (browser test) | personal-auto, CA, `autoVehicle` | same homeowners set | Rated $529.70 and **bound** (1 personal auto policy now has homeowners coverages) |

68 other personal auto quotes are correct (BI, PD, COMP, COLL). Both bad quotes
come from automated browser runs while other specs ran in parallel; the step that
applies coverage defaults appears to use another product's coverage list. The API
accepted, rated and bound coverage codes that personal auto does not define.

## Scope

- Lines of business: all products (personal auto observed; the defect class
  applies to any product: homeowners, commercial auto, cyber, professional liability, carrier-pack products).
- States / jurisdictions: all.
- Transactions: new business (rate, bind, issue) and policy changes that carry
  coverages (endorsement, renewal, rewrite); cancellation and reinstatement keep
  the policy's coverages.
- Roles and channels: agents and underwriters in the quote wizard; API clients.

## Requirements

| ID | Requirement | Source |
| --- | --- | --- |
| REQ-1 | The quote wizard only offers, defaults and sends coverages defined for the selected product (and its pinned product version). | Product decision; filed coverage forms |
| REQ-2 | Changing the product in the wizard clears coverages (and risk details) that belong to the previous product. | Product decision |
| REQ-3 | The API refuses to rate, bind, issue, endorse, renew or rewrite when a payload contains a coverage code the product (version) does not define, with an error naming the codes. | Rates and forms must match filings (not excessive/inadequate; filed forms only) |
| REQ-4 | The Premium step and quote documents show only the product's coverages. | Product decision |
| REQ-5 | Existing quotes and policies with coverages outside their product are found and reported to an administrator; no data is changed automatically. | Data integrity; carrier decides corrections |
| REQ-6 | The intermittent smoke failure no longer occurs: the quote wizard smoke test passes reliably when run repeatedly and in parallel with other specs. | Regression |

## Acceptance criteria

### REQ-1 / REQ-2

```gherkin
Scenario: Defaults come from the selected product only
  Given an agent starts a quote and selects Personal Auto
  When they apply default coverages
  Then only BI, PD, COMP and COLL (the personal auto coverages) are offered and selected

Scenario: Switching product clears the old product's coverages
  Given an agent has selected Homeowners and applied its coverages
  When they change the product to Personal Auto
  Then no homeowners coverage remains on the quote
  And personal auto coverages can be applied
```

### REQ-3

```gherkin
Scenario: Rating rejects coverages the product does not define
  Given a personal auto quote payload that includes END_WB
  When it is submitted for rating
  Then rating is refused with an error naming END_WB
  And no premium is saved

Scenario: Binding re-checks coverages
  Given a saved quote whose coverages include a code the product does not define
  When an agent binds it
  Then binding is refused with an error naming the codes
```

### REQ-4

```gherkin
Scenario: Premium step shows the product's coverages
  Given a rated personal auto quote
  Then the Premium step lists BI - Bodily Injury Liability and no homeowners coverage
```

### REQ-5

```gherkin
Scenario: Administrators see affected records
  Given quotes or policies whose coverages are not defined by their product
  When an administrator runs the coverage integrity report
  Then each record is listed with its product, the unexpected codes and its status
  And nothing is changed
```

### REQ-6

```gherkin
Scenario: The smoke test is reliable
  When the quote wizard smoke test runs 10 times, in parallel with the other smoke specs
  Then it passes every time
```

## Business rules

- Coverage codes are defined per product and product version (`products/<code>/coverage.yaml`, carrier packs, product snapshots).
- Optional coverages and endorsements are allowed only if the product defines them.
- A policy keeps its pinned product version's coverage definitions for mid-term transactions.

## Regulatory and compliance notes

- Premium must come from the carrier's filed rates and forms for the product
  (rates not excessive, inadequate or unfairly discriminatory; forms filed by
  state). Rating or binding coverages a product does not define means charging
  for, or documenting, coverage that was never filed for that product. Source:
  knowledge base, "Rating" and "Forms and documents".
- Correcting already-bound policies may require endorsements or notices to the
  insured; whether and how to correct real policies is a carrier decision
  (needs confirmation per carrier).

## Out of scope and assumptions

- No change to coverage definitions, rates or forms themselves.
- Correcting existing records is out of scope (report only, REQ-5).
- Assumption: the two affected records on local staging are test data.

## Questions and answers

| # | Question | Recommended default | Answer |
| --- | --- | --- | --- |
| 1 | When the API receives a coverage code the product does not define, should it refuse the request or silently drop the code? | Refuse with a clear error naming the codes (never change what the user sent silently) | |
| 2 | Should the check apply to policy changes (endorsement, renewal, rewrite) as well as new business? | Yes, all transactions that carry coverages | |
| 3 | For existing records with foreign coverages: report only, or also offer a correction? | Report only in this package; corrections are a carrier decision | |
| 4 | When an agent changes the product mid-quote after entering data, should the wizard ask before clearing coverages and risk details? | Yes: confirm, then clear | |
| 5 | The bound local-staging policy from the test run: leave as test data or remove? | Leave it (test data); it will appear in the integrity report | |
