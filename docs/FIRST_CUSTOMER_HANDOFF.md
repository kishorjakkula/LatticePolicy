# First Customer Readiness and Handoff

Assessment date: 2026-10-10 (America/New_York). This assessment covers the
current working tree, including local fixes that have not yet been committed
or published. It does not certify an existing hosted production environment.

Follow-up scope (2026-10-11): the owner selected a synthetic pre-customer Docker
pilot and delegated its name and acceptance standards. See
[Acme Mutual Pilot](../deploy/pilot/README.md) and its versioned standards. The
code defects below have fixes and regression coverage in this branch. Pilot
acceptance commands produce source-specific evidence under `.pilot/evidence/`;
they do not replace future customer production gates.

## Decision

| Use | Decision | Conditions |
| --- | --- | --- |
| Demo pitch | Suitable for a controlled demonstration | Synthetic data, rehearsed standard-product journey, known limitations disclosed |
| First customer evaluation | Suitable as a framework evaluation | Agreed scope, dedicated non-production carrier stack, named support owner |
| Production customer handoff | Not ready for approval | Resolve the findings below and complete release and deployment acceptance |

## Code findings

1. `server/src/routes/products.routes.ts:46`: when a policy has a pinned
   custom screen, the form response constructs its entire `fields` array
   from that screen. Core screens only add extra fields, so standard fields
   used by the dynamic editor can disappear on mid-term transactions.
2. The same route falls through to today's screen when the recorded snapshot's
   screen is null. A newly introduced custom screen can therefore change the
   UI/validation of an existing term instead of preserving its original form.
3. `deploy/carrier-stack/stack.sh:261`: upgrade takes the rollback backup
   before stopping application services. Transactions accepted between that
   backup and shutdown are absent from the backup restored on failure. Stop
   all writers before the recovery point, test failure recovery, and document
   the maintenance window. Database/document backup consistency must also be
   verified under concurrent writes.

These findings describe the original defects. The follow-up adds form integration
and browser regressions, deployment failure-ordering tests, and a real Docker
upgrade/rollback drill. The production decision requires the exact deployed
release and operational evidence, even after the pilot passes.

## Release and operational acceptance

GitHub follow-up tasks from this assessment:

- [#360 Preserve standard fields with pinned additive screens](https://github.com/kishorjakkula/LatticePolicy/issues/360)
- [#361 Preserve null screen snapshots](https://github.com/kishorjakkula/LatticePolicy/issues/361)
- [#362 Quiesce writers before upgrade backups](https://github.com/kishorjakkula/LatticePolicy/issues/362)
- [#363 Publish the reviewed customer release](https://github.com/kishorjakkula/LatticePolicy/issues/363)
- [#364 Validate the customer environment and access controls](https://github.com/kishorjakkula/LatticePolicy/issues/364)
- [#365 Validate customer products and integrations](https://github.com/kishorjakkula/LatticePolicy/issues/365)
- [#366 Prove database and document recovery](https://github.com/kishorjakkula/LatticePolicy/issues/366)
- [#367 Verify monitoring and support ownership](https://github.com/kishorjakkula/LatticePolicy/issues/367)
- [#368 Establish workload and capacity evidence](https://github.com/kishorjakkula/LatticePolicy/issues/368)
- [#369 Complete customer UAT and handoff approval](https://github.com/kishorjakkula/LatticePolicy/issues/369)

- Commit/review the local fixes and publish an immutable release image set
  tied to the tested Git SHA. The local `/version` currently reports version
  `0.2.3`, schema 59, and a null build commit; this is insufficient release
  traceability for a customer delivery.
- Use `deploy/carrier-stack/`, one stack per carrier, with tenant RLS on.
  Configure HTTPS, carrier identity, independent secrets, administrator access,
  and the customer's authentication requirements. Disable demo credentials.
- Validate the customer's approved rates, forms, eligibility, underwriting
  rules, and integrations. Repository sample rates and forms are demonstration
  material, not customer product acceptance evidence.
- Prove backup and document restore on the target infrastructure; retain keys
  securely, copy backups off-host, and record measured recovery time and point.
- Verify monitoring, alert routing, incident ownership, and support procedures.
- Run workload tests against the agreed customer volume and concurrency.
  Browser correctness tests do not establish capacity or availability.
- Complete customer UAT for quote, bind, issue, endorsement, cancellation,
  reinstatement, renewal, documents, roles, and customer portal if in scope.

No target HTTPS deployment, customer UAT sign-off, capacity result, or current
infrastructure restore evidence was supplied for this assessment. Those items
are unverified, not assumed to be absent.

## Demo pitch

Suggested positioning: “LatticePolicy is an extensible policy administration
framework with quote-to-issue workflows, explainable rating, policy servicing,
role-based access, and carrier-specific product configuration. We propose a
scoped evaluation of your first product before production rollout.”

Rehearse a 10–15 minute journey:

1. Sign in with a dedicated demonstration user and show policy search.
2. Quote Homeowners with synthetic insured and dwelling data. Show mandatory
   field errors on Next, qualification, coverages, and rating explanation.
3. Bind and issue; open the policy and every packet/worksheet.
4. Show an endorsement and its transaction history.
5. Show the underwriting/admin experience and, only with a properly linked
   customer account, the customer portal.
6. Explain the carrier pack and deployment model, then agree the pilot scope.

Do not claim zero-downtime upgrades, a measured SLA, completed customer
integrations, or universal regulatory readiness from this demonstration.

## Customer delivery contents

Deliver a reviewed source tag and matching image digests, release notes and
known limitations, test evidence, a versioned customer carrier pack, deployment
instructions, a secret-variable inventory without secret values, backup/restore
and rollback runbooks, a UAT checklist, and named support/escalation contacts.

Starting references:

- [Carrier deployment kit](../deploy/carrier-stack/README.md)
- [Product pack contract](PRODUCT_PACK_CONTRACT.md)
- [Carrier pack example](../examples/carrier-pack/README.md)
- [Production runtime configuration](PRODUCTION_RUNTIME_CONFIGURATION.md)
- [Production runbooks](PRODUCTION_RUNBOOKS.md)
- [Test plan](TEST_PLAN.md)

External delivery is pending identification of the customer, agreed product
scope, hosting model, and reviewed release. This document is the handoff plan;
no customer has been contacted and no production deployment was performed.

## Validation evidence

Current working-tree results:

- Full isolated Playwright suite: 133 passed (including opening every document).
- Shared rules package: 26 passed.
- Frontend: 209 passed.
- Server: 529 passed with four workers. An earlier concurrent run had one
  10-second PDF-rendering timeout; the complete server rerun passed.
- PostgreSQL integration suite with `TENANT_RLS_ENFORCED=1`: 125 passed
  across 29 files on a disposable database.
- Build, workspace typecheck, architecture boundary check, and diff check passed.

Dependency audit passed the repository policy with explicit
`extract-zip`/Puppeteer advisory exceptions; it is not a zero-advisory result.
Local API health reports PostgreSQL and Redis reachable. Earlier targeted
document checks confirmed all three reported artifacts return readable content.
