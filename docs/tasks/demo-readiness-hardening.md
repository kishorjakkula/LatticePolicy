# Demo Readiness Hardening

## Objective

Prepare the authenticated UI for private client demonstrations without exposing
local-only credentials or routes that the current persona cannot successfully
use.

## Changes

- Demo credentials and prefilled passwords are shown only when
  `VITE_SHOW_DEMO_CREDENTIALS=true`; development builds retain the existing
  convenience by default, while production builds default to hidden.
- Customer Portal navigation and routing require a linked `customerId` or
  `customerKey` in addition to portal permissions.
- The top-navigation API Docs link was removed because putting JWTs in query
  strings leaks credentials into browser history and infrastructure logs.
- The compact navigation breakpoint is 900px so tablet and narrow presentation
  windows use the hamburger menu before the shell overflows.
- Vulnerable transitive packages are constrained to patched releases, and the
  development-only React Query tools are pinned to the latest advisory-free
  compatible release.

## Demo Tenant Preparation

Before a demonstration, sign in as an administrator and run the existing
reference-data seed action under Administration > Security. It provisions the
sample underwriting companies, agency, forms, and notification templates needed
by the quote workflow. Use a separately linked customer login to demonstrate
the customer portal.

Never use real customer PII in the demo tenant. Reset or recreate the tenant's
sample data between client sessions when the walkthrough changes records.

## Verification

- Frontend route-guard tests cover linked and unlinked portal identities.
- Login tests confirm client configurations do not render or prefill demo
  credentials.
- Frontend typecheck, test, and production build validate the resulting UI.
