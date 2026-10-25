---
title: Configuration-first Businessowners product pack
status: accepted
last_reviewed: 2026-10-23
review_every_days: 90
---

# ADR 0004: Configuration-first Businessowners Product

Work package: WP-0010. Requirements and design approved by Kishor Kumar Jakkula
with "Approved" at Gates A and B. Merge/deployment/business sign-off not granted.

## Context

BOP needs a coherent package, property and liability terms, income periods,
carrier/agency dependencies and repeatable synthetic demo data. The platform
already has registry-discovered products, table rating, validation, lifecycle,
forms and tenant-scoped reference data, but some request contracts still list
fixed product/risk types. The table rater reads the first risk only.

## Decision

Use a core `businessowners` pack with rate-table pricing and an explicit BOP
location risk type. Reuse existing application flows; reject multiple premises
in phase one. Extend shared representation only where needed for distinct
package terms and authoritative server validation, preserving old products.
Version-pin terms and documents. Keep aggregate/included benefits separate
from additional premium. Seed demo dependencies only by an explicit, repeatable,
tenant-scoped operation; never as normal production startup or blanket migration.

## Alternatives

A dedicated BOP service/rater/UI duplicates platform responsibilities. Reusing
a dwelling or cyber risk would hide domain differences and produce misleading
contracts. Neither is selected.

## Consequences

No new runtime service/dependency; targeted schema/UI/config/tests are required.
Rates/forms/appetite are synthetic demo choices, not carrier-approved filings.
Multi-location, production filings and new standalone products remain separate.
Do not mark this ADR accepted until the user approves Gate B.
