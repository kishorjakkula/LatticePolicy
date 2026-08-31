#!/usr/bin/env node
// Validates contracts/import-templates/*.json: each file must parse as JSON
// and declare entityType, status, and a non-empty sampleRows array. Run via
// `node scripts/check-import-templates.mjs`.
import fs from 'node:fs'
import path from 'node:path'

const dir = 'contracts/import-templates'
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))

if (files.length === 0) {
  console.error(`No template files found in ${dir}`)
  process.exit(1)
}

let ok = true
for (const file of files) {
  const filePath = path.join(dir, file)
  let content
  try {
    content = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    console.error(`${file}: invalid JSON - ${err.message}`)
    ok = false
    continue
  }
  let fileOk = true
  if (typeof content.entityType !== 'string' || !content.entityType) {
    console.error(`${file}: missing string field "entityType"`)
    fileOk = false
  }
  if (typeof content.status !== 'string' || !content.status) {
    console.error(`${file}: missing string field "status"`)
    fileOk = false
  }
  if (!Array.isArray(content.sampleRows) || content.sampleRows.length === 0) {
    console.error(`${file}: "sampleRows" must be a non-empty array`)
    fileOk = false
  }
  if (fileOk) console.log(`${file}: OK (${content.sampleRows.length} sample rows)`)
  else ok = false
}

process.exit(ok ? 0 : 1)
