# Issue 258: Referral Assignment And Comments

## Summary

The underwriting referral queue now exposes the existing assignment and comment APIs through a referral review dialog. Underwriters with decision permission can assign a referral by user UUID, while any user who can read the queue can review and add comments.

## Issue

- https://github.com/kishorjakkula/LatticePolicy/issues/258

## Files Changed

- `frontend/src/features/uw/UwQueue.tsx`
- `frontend/src/features/uw/__tests__/UwQueue.test.tsx`

## Behavior Rules

- Every referral row has a Review action that opens its assignment and comment history.
- Assignment requires `uw.referrals.decide`; the server remains authoritative for permission enforcement.
- New comments and assignment changes appear in the open dialog as soon as the API succeeds.
- Blank assignee IDs and comments cannot be submitted.

## Tests And Validation

- Component tests cover assigning a referral, displaying existing comments, and adding a comment.
- Run `npm run test --workspace=frontend`.
- Run `npm run typecheck`.

## Follow-Ups

- A future tenant-safe user picker could replace direct user-ID entry if the API exposes assignable underwriting users without requiring admin user-list permission.
