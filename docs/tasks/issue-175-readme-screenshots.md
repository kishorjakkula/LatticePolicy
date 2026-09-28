# Task Note: README Workflow Screenshots

## Links

- Issue: #175
- Pull request:

## Summary

Added a concise README product tour with five screenshots covering sign-in,
policy search, policy lifecycle detail, role-based security administration,
and the customer portal.

## Capture Method

- Built and started the current Docker Compose application.
- Created policies and a portal user through the existing E2E API helpers.
- Captured the rendered Chromium UI at a 1440 by 900 viewport.
- Used only the local `sample-carrier` tenant and synthetic demo records.

## Validation

- Verified each PNG visually for readable content, stable framing, and absence
  of real customer or secret data.
- Verified every README image path resolves from the repository root.
- Ran the capture flow successfully against the Docker Compose stack.

## Maintenance

Recapture these images when a change materially alters the application shell
or one of the documented workflows. Keep filenames stable so external README
links continue to work.
