# Intake Office Archive Limits

## Summary

Bound Word/Excel ZIP expansion before submission intake invokes either Office
parser. Compressed upload size alone did not bound PizZip/ExcelJS inflation;
checking extracted text or declared sizes after parsing was too late.
No issue/PR link supplied. No dependencies or lockfiles changed.

## Files

- `server/src/lib/intake/document-text.ts`: archive gate shared by `.docx` and
  `.xlsx` in every provider mode.
- `server/src/lib/intake/__tests__/office-archive-limits.test.ts`: synthetic
  malicious archives and valid Office parsing regressions.
- `docs/tasks/intake-office-archive-limits.md`: handoff and limits.

## Behavior

- Compressed input: 10 MiB; entries: 1,024 (including directories/empty files);
  central directory metadata: 256 KiB; individual uncompressed entries: 8 MiB;
  total uncompressed content: 32 MiB; per-entry expansion ratio: 200:1.
- Reject encrypted, multi-disk, ZIP64, unsupported-compression, truncated,
  trailing/prefixed, overlapping, CRC/size/header-inconsistent archives, unsafe
  paths, duplicate/case-colliding names, and non-regular/non-directory entries.
- PizZip's structured reader inspects entries without inflating or collapsing
  duplicates. Metadata limits apply before content inflation. Node zlib caps
  actual DEFLATE output at each declared, bounded entry size; exact output size
  and CRC must match. This also bounds actual total output when sizes lie.
- Rebuild a STORE-only archive from verified bytes before Office parsing; the
  original archive is never passed to PizZip's text extraction or ExcelJS.
  No filesystem extraction, network calls, or document-bearing diagnostics.
- Default mode reports rejected archives as unreadable. Strict private mode
  retains its existing generic failure and complete-line/text-limit behavior;
  no silent fallback or truncation is introduced.

## Validation

- `npm run test --workspace=server -- src/lib/intake/__tests__/`: intake tests,
  including synthetic compressed bombs, forged lengths/counts, unsafe headers,
  encrypted containers, boundary sizes/count, and valid STORE/DEFLATE Word/Excel.
  Passed: 3 files, 65 tests.
- `npx tsc -p server/tsconfig.json --noEmit`: passed server TypeScript validation.
- `git diff --check -- server/src/lib/intake/document-text.ts` and the new
  files: passed whitespace validation. New files also checked with
  `git diff --no-index --check /dev/null <file>`.
- Checks ran on the available Node v20.20.2 runtime, below the repository's
  supported Node versions. Supported-runtime CI/full build was not run here.

## Risks / Follow-Ups

- Uses existing direct dependency PizZip's internal `js/zipEntries.js` and
  `js/crc32.js` via a narrow typed adapter. Re-run these tests when upgrading
  PizZip; its public API cannot preserve duplicates or cap inflation.
- Limits deliberately reject unusually large/highly compressible valid Office
  files and ZIP64 containers. Split or replace these inputs, not disable the
  guard. Bounds constrain ZIP expansion, not every possible XML/workbook parser
  amplification; parser process isolation remains defense in depth.
- Shared worktree contains unrelated in-progress changes. No commit made.
