# Issue 262: Endorsement Document Packets

## Summary

Endorsements now generate policy document packets using explicit criteria that match the actual coverage and payload changes. Generic forms that merely list the Endorse transaction type are intentionally excluded unless they declare change criteria or `alwaysAttachOnEndorsement`.

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/262

## Important Files

- `server/src/services/document-generation.service.ts`: normalized endorsement change sets and conservative criteria matching.
- `server/src/services/endorsement.service.ts`: packet generation and persistence in the endorsement transaction.
- `server/migrations/049_endorsement_form_applicability.sql`: admin applicability criteria storage.
- `server/src/routes/forms-admin.routes.ts`: criteria authoring through the existing applicability API.

## Applicability Contract

Admin form applicability accepts `endorsementChangeCriteria` with:

- `alwaysAttachOnEndorsement`: explicitly attach for every endorsement.
- `match`: `any` (default) or `all` across configured criteria groups.
- `coverageCodes`: coverage codes affected by the endorsement.
- `changeTypes`: `added`, `removed`, or `modified`; when combined with coverage codes, both must describe the same coverage.
- `changedPathPatterns`: JSON-style paths with `*` matching one path segment.

Catalog forms use the same object under `applicability.endorsementChanges`.
Empty or missing criteria never match an endorsement. Existing non-endorsement form selection is unchanged.

## Audit And Persistence

The generated packet metadata records the normalized change set. Selected forms and the packet document are persisted under the endorsement transaction, inside the caller's tenant transaction, so failed endorsements cannot leave partial document records.

## Tests And Validation

- Unit tests cover coverage add/remove/modify detection, path patterns, always-attach behavior, correlated code/type matching, and exclusion of unscoped forms.
- The policy lifecycle DB integration test changes only BI coverage and proves the BI form is persisted while the PD form is excluded.
- `npm run test --workspace=server`
- `npm run test:integration`
- `npm run build`
- `npm run security:audit`

## Follow-Ups

- The current admin API accepts the criteria object, but the Forms Management UI does not yet provide a visual criteria editor.
- Generated packet records still use the repository's metadata URI mechanism; real PDF rendering and durable object storage remain separate document-platform work.
