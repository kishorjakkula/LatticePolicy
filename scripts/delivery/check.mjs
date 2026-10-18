#!/usr/bin/env node
// Delivery checks for CI: work packages are consistent, and (with --pr) the
// pull request description names a work package with its gates approved.
import { listPackages, packageProblems, pullRequestProblems, repoRoot, workDir } from './lib.mjs'
import path from 'node:path'

const root = repoRoot()
const problems = []
for (const name of listPackages(root)) problems.push(...packageProblems(root, path.join(workDir(root), name)))
if (process.argv.includes('--pr')) problems.push(...pullRequestProblems(root, process.env.PR_BODY || '', process.env.PR_AUTHOR || ''))
if (problems.length) {
  console.error(`Delivery check failed:\n- ${problems.join('\n- ')}`)
  process.exitCode = 1
} else console.log(`Delivery check passed (${listPackages(root).length} work package(s)).`)
