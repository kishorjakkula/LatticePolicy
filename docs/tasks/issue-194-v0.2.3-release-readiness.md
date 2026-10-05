# Issue 194 - v0.2.3 Release Readiness

## Summary

Prepared the `v0.2.3` patch release after the `v0.2.2` GHCR publish workflow
failed on the API container image scan. The application dependency audit was
clean, but Trivy reported CVE-2026-45447 in Alpine OpenSSL runtime packages from
the Node base image.

## Changes

- Bumped root and workspace package metadata from `0.2.2` to `0.2.3`.
- Updated the API Dockerfile to upgrade Alpine `libcrypto3` and `libssl3` in
  both build and runtime stages.
- Added `0.2.3` release notes to `CHANGELOG.md`.
- Updated the open-source readiness verification pointer to this task note.

## Validation

- `npm ci`
- `npm run security:audit`
- `npm run build`

## Notes

Local Docker validation was not re-run in this workspace because Docker Desktop
storage was returning host-level input/output errors during the previous
release check. GitHub PR checks are the release gate for container scan, DB
integration, and Playwright E2E smoke validation.
