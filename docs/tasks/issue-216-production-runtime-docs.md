# Task Note: Production Runtime Guardrail Documentation

## Links

- Issue: #216
- Pull request:

## Summary

Added one operator-facing reference for API production runtime guardrails and
linked it from contributor setup, cloud deployment, and the README. Corrected
stale deployment references to unsupported registration and domain-allowlist
settings so the documentation matches runtime behavior.

## Important Files

- `docs/PRODUCTION_RUNTIME_CONFIGURATION.md`: managed deployment boundary,
  required settings, safety checks, verification, and troubleshooting.
- `docs/DEVELOPER_SETUP.md`: explicit separation between local/demo and managed
  operation.
- `docs/CLOUD_DEPLOYMENT.md`: link to the authoritative contract and corrected
  invite-only deployment examples.

## Validation

- Previewed the changed Markdown structure and links.
- Ran repository type checking to ensure documentation-only changes did not
  disturb the workspace.

## Follow-Ups Or Risks

- Keep the runtime guide synchronized with `server/src/config.ts` when managed
  environment checks change.
