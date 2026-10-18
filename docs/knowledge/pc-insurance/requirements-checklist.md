---
title: Business analyst requirements checklist
last_reviewed: 2026-10-17
review_every_days: 180
sources: README.md in this folder; LatticePolicy docs
---

# Requirements Checklist

Work through every section that applies. Ask unanswered items as one numbered
batch, each with a recommended default.

## Scope

- Lines of business and products; personal or commercial.
- States and territories; admitted or surplus lines.
- Transactions: new business, endorsement, cancellation, reinstatement,
  renewal, rewrite, non-renewal. Behavior mid-term and at renewal.
- Channels and roles: agent, broker, MGA, underwriter, carrier admin,
  policyholder (customer portal).

## Coverage, rating and forms

- Coverages, limits, deductibles, sublimits affected.
- Rating impact: new variables, relativities, minimum premium, fees, taxes;
  pro rata or short-rate; does it require a rate filing?
- Forms and documents: new or changed forms, endorsement schedule,
  declarations, notices; does it require a form filing? Which states?
- Product version pinning: which policies keep the old behavior?

## Underwriting

- Eligibility, appetite, referral triggers; who may override (authority).
- Outcomes beyond accept/decline: refer, modified terms, subjectivities.
- Data sources (MVR, CLUE, inspections, third-party data) and consent.

## Compliance

- Cancellation and non-renewal reasons and notice periods per state.
- Consumer disclosures, adverse action notices, privacy (GLBA, state privacy).
- Record retention and audit: who did what, when.
- AI: does any AI read or decide anything? Human approval before effect;
  data boundary (carrier-private vs external).

## Data and integrations

- Data model changes, migrations, historical policies.
- Billing, claims, reinsurance, bordereaux, document delivery, notifications.
- ACORD or carrier integration formats.

## Acceptance

- Each requirement testable; Given/When/Then with negative cases.
- How the business owner will validate it, and who signs off (Gate D).
