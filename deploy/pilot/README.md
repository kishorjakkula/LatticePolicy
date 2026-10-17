# Acme Mutual Pilot

This is a fictitious carrier for a local, pre-customer acceptance exercise.
It runs a separate six-service Docker stack with a dedicated database, Redis,
document volume, carrier pack, generated secrets, and tenant RLS. Nothing uses
the existing demo database. The versioned standards are in `standards.json`.

## Product and underwriting company setup standard

For every carrier setup, configure both the enabled product list and the
underwriting company/product rows under Administration → Underwriting Companies
(`/admin/uw-company`). Set **Active** only for configurations the carrier is
offering; deactivate other product rows rather than deleting their history.
Product enablement and underwriting company activation are separate controls.
The wizard lists active company configurations; administrators can still view
and maintain inactive rows for later product expansion.

For this pilot, keep Homeowners/US configurations applicable to TX or ALL active
and deactivate Personal Auto, Commercial Auto, Cyber, and Professional Liability.
`pilot:up`, `pilot:check`, and `pilot:browser` apply this through the existing
authorized admin API after reference-data seeding. The browser regression checks
that inactive product rows remain in administration and that the wizard offers
only the Homeowners company and product. Re-enabling a product later requires
both product enablement and an appropriate active underwriting configuration.

## Run

From a clean, committed repository checkout with Node 22 and Docker:

```bash
npm run pilot:up
npm run pilot:check
npm run pilot:browser
npm run pilot:drill
npm run pilot:monitor -- --once
```

UI: http://localhost:5180. API: http://localhost:3310. Both bind to loopback.
Local credentials are generated in `.pilot/credentials.json`, mode 0600; never
commit or distribute that file. The image manifest in `.pilot/release.json`
records the exact source SHA and local image IDs. This is a local pilot image
set, not a published semantic production release.

`pilot:check` seeds synthetic reference data, accepts Homeowners in TX,
compares the 370.08 reference premium, exercises lifecycle and document APIs,
checks tenant and agent authorization, and runs ten concurrent workers for
60 seconds. Seven out of ten operations are searches, two are rated quotes,
and one is a document read. Each worker waits three seconds between operations.
This is a bounded pilot workload, not a maximum-throughput benchmark. The
browser suite proves button-triggered validation and both screen pinning fixes
against an actual mounted pack changed during the test.

`pilot:drill` **replaces the synthetic pilot database and document files**.
It refuses to run for another tenant. It verifies a restore by removing files
and writing after the recovery point, then verifies byte hashes, successful
upgrade, application-only rollback, and a forced migration failure with an
accepted transaction retained. Do not adapt it to real customer data.

## Monitoring and backups

```bash
npm run pilot:monitor
```

Keep this process running during supervised pilot sessions. It checks every
30 seconds, pauses all writers to take a database/document backup every 15
minutes, and retains local backups for seven days. Alerts and recovery events
are emitted to the operator's terminal and `.pilot/evidence/alerts.jsonl`.
The acceptance drill deliberately stops a worker and verifies that the local
alert channel reports it and later reports recovery.

Backups are outside Docker's data volumes under `.pilot/kit/backups`; they
protect against volume replacement in this exercise. They are on the same
machine, so they do not protect against losing the host. A production operator
must add remote backup storage and independently secure the original keys.

The operator and business approver for this pilot are the repository maintainer.
Acceptance is automated against the owner-selected synthetic standards. It does
not imply an external customer's business approval or approved insurance rates.
MFA/SSO and external billing/notification integrations are outside this local
pilot's scope. The dispatcher uses its local log transport.

## Evidence and handoff

Evidence lives under `.pilot/evidence/` and the browser report under
`.pilot/playwright-report/`. Archive the source commit, release manifest,
standards, redacted test evidence, and runbooks. Exclude credentials, carrier.env,
raw database dumps, and logs that may contain sensitive data from a customer
handoff. `scripts/pilot-handoff.mjs` builds that package and checks the acceptance
evidence matches the running release before doing so.

For an incident: stop acceptance traffic, inspect `stack.sh status` and
`docker compose ... logs --tail=100`, fix the affected service, then rerun the
monitor. Use `stack.sh restore <prefix>` followed by `stack.sh up` only when
replacement of pilot data is intended. `rollback --keep-data` requires migration
compatibility; regular rollback loses writes after the selected recovery point.

Stop the stack with `sh .pilot/kit/stack.sh down`. This preserves its volumes.
HTTP and `DEPLOYMENT_ENV=local` are intentional for this loopback-only pilot.
Production requires HTTPS, managed secrets/configuration, remote recovery
evidence, customer UAT, and the release gates in `docs/FIRST_CUSTOMER_HANDOFF.md`.

### Pilot carrier identity

Tenant administration → **Carrier branding** edits the carrier display name,
logo, color and printed footer. Setup supplies the replaceable Acme Mutual Pilot
monogram only when branding has not been configured. Saved choices, including
removing a logo, survive later setup and deploys. Login and screen headers share
these settings; all browser PDF generators and new policy packets/worksheets
use carrier identity rather than framework branding.

Issued documents retain their branding snapshots. To convert the older
**synthetic pilot** examples once, run `npm run pilot:rebrand-documents` after
upgrade. It stores verified branded copies and retains original artifact paths
and hashes in revision metadata. It refuses other carriers and is never run
automatically by setup. Customer-issued production documents must retain their
historical originals.
