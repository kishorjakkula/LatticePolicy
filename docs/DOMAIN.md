Domain Model (Personal Auto, Homeowners)

Core Entities
- Account: customer container (contacts, billing preference).
- Insured: named insured(s) associated with account.
- Policy: policy number, product, term (effective/expiration), status.
- PolicyVersion: effective-dated snapshot per transaction; holds risk, coverages, premium.
- Transaction: Quote, Bind/Issue, Endorse, Cancel, Reinstate, Renew.
- RiskItem: AutoVehicle | Dwelling with attributes used by rating.
- Coverage/CoveragePart: coverage code, limits/deductibles, selection, state applicability.
- UWAnswer: question/answer pairs for underwriting and rating.
- PremiumBreakdown: base premium, surcharges, fees, taxes; by coverage and totals.

Effective Dating
- Each transaction produces a PolicyVersion with `effective_date` and `processed_date`.
- Endorsements compute pro-rata premiums over impacted periods.

Personal Auto Risk (minimal MVP)
- Vehicle: year, make, model, symbol, VIN (optional), garaging ZIP, usage, annual miles.
- Drivers: age, license state, violations (simple count for MVP), assignment.
- Coverages: BI, PD, PIP/MedPay, UM/UIM, Comp, Collision, Towing, Rental.

Homeowners Risk (minimal MVP)
- Dwelling: address, construction type, protection class, year built, square footage, roof age.
- Coverages: A (Dwelling), B (Other Structures), C (Personal Property), D (Loss of Use), E/F (Liability/MedPay), deductibles, endorsements (e.g., water backup).

Rating Overview
- Inputs: risk attributes + coverages + territory/state + UW answers.
- Engine: rules (eligibility, relativities) + rate tables (base, factors), then taxes/fees.
- Output: premium per coverage and totals; store along with calculation trace for audit.

