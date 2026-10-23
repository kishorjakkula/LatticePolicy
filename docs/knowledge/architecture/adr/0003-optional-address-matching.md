---
title: Optional carrier-controlled address matching
last_reviewed: 2026-10-22
review_every_days: 90
sources: WP-0005/02-design.md; Census Geocoding Services API
---

# 0003. Optional Carrier-Controlled Address Matching

- Status: accepted design at WP-0005 Gate B; carrier rollout approval remains separate
- Date: 2026-10-22
- Work package: WP-0005

## Context

US address entry is inconsistent across existing screens. The demo needs a
free matching option, while carrier-private operation must not disclose data
automatically. A geocode match is not postal deliverability or unit validation.

## Decision

Use one complete postal address editor with lossless legacy adapters. Add
a collection wrapper only for contact entities, embedded in their existing
screens; risk, garaging and other non-contact slots remain single-valued.
Preserve all contact addresses and use a primary projection for legacy callers.
Use a server-mediated fixed-host Census adapter, disabled by default and enabled
only for explicitly allowlisted tenants. User initiates each disclosed check
and reviews corrections. No full-address provider response cache or automatic
record update. Existing carrier rules remain authoritative for business stops.

## Consequences

No API key/paid provider provisioned for this option; outbound internet is
needed only for matching. Offline entry still works. Preserve secondary units
without falsely claiming they were checked. Production privacy/retention and
provider fitness require carrier approval. Postal certification needs a
different approved adapter; no external AI or automatic provider fallback.

## Alternatives

Browser-direct geocoder: rejected for control/privacy weaknesses. Licensed
postal validation and self-hosted reference data: future options with separate
cost, license, deployment and accuracy acceptance work.
