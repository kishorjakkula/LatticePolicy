# Businessowners Policy (BOP) Demo Pack

Work package: WP-0010. Version 1.0.0. Original synthetic demonstration only:
not filed rates, proprietary policy wording, an insurance offer or a contract.
Ohio/US, one business premises, twelve months. Carrier eligibility, agency and
producer authority, underwriting and lifecycle gates remain mandatory.

## Package Contract

`coverage.yaml` defines the authoritative `packageRules`, each coverage's fixed
`packageTerms`, bounds/options and liability multipliers. The parent framework
validates/derives those terms and pins them in snapshots; browser metadata alone
does not grant coverage. `fields` is the all-tenant explicit field catalog;
sample-carrier metadata mirrors it. The only risk default is the type
`businessownersLocation`: financial, occupancy, loss and protection facts are
never silently defaulted. `locationAddress` is a structured postal address,
not an email/mobile field or a free-text replacement.

Required: BPP, combined business income/extra expense, business liability and
included medical expenses. Building is required for owners; any selected
building coverage requires explicit `buildingInterest: true`. A tenant may have
building interest but is not forced to buy building coverage. Building/BPP use
replacement-cost demo valuation, limits 100,000-5,000,000 / 10,000-1,000,000,
default limits 500,000 / 100,000, and deductibles 1,000 / 2,500 / 5,000.

Income/extra expense shares a fixed 100,000 dollar limit: up to twelve months
restoration and a 72-hour income waiting period. This is not unrestricted
actual-loss-sustained coverage. Liability is occurrence based: 500,000 /
1,000,000 / 2,000,000; both aggregates are 2x occurrence, personal/advertising
injury is 1x occurrence, rented-premises damage is an included 100,000 sublimit.
Medical expenses are included at 5,000 per person, never charged a second time.

Equipment breakdown offers 25,000 / 50,000 / 100,000; water backup offers 5,000 /
10,000 / 25,000. Both optional extensions have a fixed 1,000 deductible.
Flood, earthquake, professional liability, commercial auto, workers compensation
and cyber are not included.

## Synthetic Pricing Assumptions

All amounts USD. No default/fallback coverage price. Term 12 and state OH must
match explicit required factors. Minimum premium 500; demo fee/tax 0. Zero demo
tax is an illustrative assumption, not a tax exemption determination.

Property premiums (building, BPP and income) multiply the following factors:

| Factor | Values |
| --- | --- |
| Business class | office 1.00, retail 1.15, service 1.10 |
| Construction | masonry 1.00, frame 1.10, noncombustible 0.90 |
| Protection class | 1-4: 1.00; 5-8: 1.10; 9-10: 1.25 |
| Prior loss count | 0: 1.00; 1: 1.10; 2+: 1.25 |
| Building/BPP deductible | 1,000: 1.00; 2,500: 0.90; 5,000: 0.80 |

All factor lookups are required and have no safe default. Liability, medical
and optional extensions use `applyFactors: false`: property-only factors never
inflate liability. Income has no property deductible factor. Class/loss changes
in this bounded v1 pricing adjust property, not liability. Underwriting referral
or decline is independent of whether a factor can be priced.

Baseline office/masonry/class 3/no losses: building 500,000 x 2/1,000 = 1,000;
BPP 100,000 x 3/1,000 = 300; income = 100; liability 1,000,000 = 400; medical = 0.
Owner total **1,800**, tenant without building **800**. Liability 500,000 costs
300; 2,000,000 costs 600. Equipment prices 50/90/160 and water 25/45/90 match
their offered limits in order; choosing both smallest adds 75, both largest 250.

Owner alternative golden totals, changing one baseline fact at a time:
retail 2,010; service/frame/protection 5-8/one loss 1,940; noncombustible 1,660;
protection 9-10 or two-plus losses 2,150. Raising both property deductibles to
2,500 produces 1,670; to 5,000 produces 1,540. Premiums round to cents per
coverage before summing/minimum/fee/tax, following the existing rate-table rater.

## Integration Boundaries

The pack declares target lifecycle capabilities; that is not evidence of
completed lifecycle qualification or production availability. Parent-owned
backend validation must enforce missing/invalid risk facts, address, term,
single-premises, eligibility, package bounds/deductibles and tamper resistance.
Configured underwriting must refer prior losses, roof age >20, protection 9/10;
decline vacancy >30 days/hazardous manufacturing; enforce sales <=5,000,000 and
employees <=50. No underwriting approval is supplied by this pack.

Original plain-text quote/binder/declarations sources are in `documents/`.
Parent-owned forms catalog setup, binary templates and rendering qualification
remain separate. Nothing here seeds live data, activates a product, bypasses
human intake approval or changes previously issued records.

## Required before any real use

This pack is a synthetic demonstration. Before a carrier offers BOP, carrier
and legal teams must confirm and configure, for each state:

- admission or surplus-lines status, and filed rates, rules and forms in place
  of these synthetic ones;
- producer licensing and appointment requirements, including a distribution
  legal review of carrier distribution requirements (company, agency, producer
  and appointment checks run at quote, bind, direct endorsement, renewal and rewrite);
- the terrorism (TRIA) offer and disclosure at quote and renewal, and the
  insured's acceptance or rejection;
- mandatory state endorsements and amendatory forms;
- cancellation and non-renewal notice periods, reasons and delivery rules.
