# Homeowners JSON → Relational Mapping

This note captures how the Homeowners sample payload in the user request is materialized into the relational schema and how to replay it via SQL.

- **Source script:** `contracts/sample-data/ho_policy_seed.sql`
- **Tenant:** `sample-carrier`
- **Policy:** `HO-25-19341-00011` (external id `POL-HO-9001`)

## Entity Mapping
- `policies`, `policy_parties`, `policy_role_assignments` store the policy shell, named insureds, producer, underwriter, and mortgagee derived from `policy.parties`.
- `risk_units` with facet tables (`risk_unit_dwelling`, `risk_unit_other_structure`, `risk_unit_liability`) and `coverage` rows represent `policy.risk` and `policy.coverages`.
- `policy_transactions`, `policy_versions`, `policy_version_changes`, and `ratings` capture each item in the JSON `transactions` array plus the related rating details.
- `policy_forms` and `documents` reflect the top-level `forms` and `documents` arrays, preserving original identifiers in metadata.
- `notes` add operational commentary for each transaction to make the timeline auditable once imported.
- `ledger_events` record status/progression milestones (issue, endorsement, cancel, reinstate, rewrite, renew) for downstream auditing/analytics.

## Loading Instructions
Run the migration `server/migrations/001_init.sql` first so the schema exists. Then execute the seed script against the target database:

```bash
psql postgresql://lattice_policy:yourStrongPassword@localhost:55432/lattice_policy -f contracts/sample-data/ho_policy_seed.sql
```

The script is idempotent — repeated runs reuse deterministic UUIDs and `ON CONFLICT DO NOTHING` safeguards. It sets `app.tenant_id` internally so the tenant context is handled automatically.

## UI Walkthrough
- Open the frontend and navigate to **Search → Policy**; select the seeded Homeowners policy (`HO-25-19341-00011`).
- The policy view now includes an **Activity Timeline** showing transactions with associated notes, rating details, forms, documents, and ledger events sourced from the new endpoint `/v1/policies/{id}/timeline`.
