#!/usr/bin/env node
// Prints a Markdown summary of the last Playwright run (test-results/results.json):
// totals, then every failed or flaky test with its first error line.
//
//   npm run test:e2e:report
import { existsSync, readFileSync } from 'node:fs'

const file = process.argv[2] || 'test-results/results.json'
if (!existsSync(file)) {
  console.log(`## Playwright results\n\nNo results file at \`${file}\`. The suite did not run or crashed before reporting.`)
  process.exit(0)
}

const report = JSON.parse(readFileSync(file, 'utf8'))
const rows = []
const walk = (suite, trail) => {
  const path = suite.title ? [...trail, suite.title] : trail
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const last = test.results?.[test.results.length - 1]
      const message = (last?.error?.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]
      rows.push({ title: [...path, spec.title].join(' › '), status: test.status, message })
    }
  }
  for (const child of suite.suites || []) walk(child, path)
}
for (const suite of report.suites || []) walk(suite, [])

const count = (status) => rows.filter((row) => row.status === status).length
const failed = rows.filter((row) => row.status === 'unexpected')
const flaky = rows.filter((row) => row.status === 'flaky')

console.log('## Playwright results\n')
console.log(`${rows.length} tests: ${count('expected')} passed, ${failed.length} failed, ${flaky.length} flaky, ${count('skipped')} skipped.\n`)
for (const [heading, list] of [['Failed', failed], ['Flaky (passed on retry)', flaky]]) {
  if (!list.length) continue
  console.log(`### ${heading}\n`)
  for (const row of list) console.log(`- **${row.title}**${row.message ? `: ${row.message}` : ''}`)
  console.log('')
}
