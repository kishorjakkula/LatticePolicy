#!/usr/bin/env node
// Lists knowledge files due for review. --markdown prints an issue body for the
// knowledge-refresh workflow; --fail exits non-zero when anything is due.
import { knowledgeReport, repoRoot } from './lib.mjs'

const report = knowledgeReport(repoRoot())
if (process.argv.includes('--markdown')) {
  const lines = [
    'The knowledge files below are past their review date. The knowledge curator',
    '(`agents/knowledge-curator.md`) researches what changed since `last_reviewed`',
    'using the allowed sources in `docs/knowledge/README.md`, updates each file with',
    'sourced facts and a new review date, and opens a pull request for a person to review.',
    '',
    '| File | Last reviewed | Due |',
    '| --- | --- | --- |',
    ...report.due.map((entry) => `| \`${entry.file}\` | ${entry.lastReviewed} | ${entry.dueOn} |`),
  ]
  if (report.missing.length) lines.push('', 'Missing review metadata:', ...report.missing.map((file) => `- \`${file}\``))
  lines.push('', 'Prompt for any AI tool:', '', '```text', 'You are the Knowledge Curator agent for LatticePolicy. Follow agents/knowledge-curator.md and refresh the files listed in this issue.', '```')
  console.log(lines.join('\n'))
} else {
  console.log(`Knowledge files: ${report.current.length} current, ${report.due.length} due, ${report.missing.length} missing metadata`)
  for (const entry of report.due) console.log(`  due     ${entry.file} (last reviewed ${entry.lastReviewed}, due ${entry.dueOn})`)
  for (const file of report.missing) console.log(`  missing ${file}`)
}
if (process.argv.includes('--fail') && (report.due.length || report.missing.length)) process.exitCode = 1
