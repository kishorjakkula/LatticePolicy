#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const allowedAdvisories = new Set([
  // React Router RSC Mode CSRF advisory. LatticePolicy uses React Router as a
  // Vite client-side SPA router and does not enable React Router RSC/framework
  // server actions. Track this in docs/OPEN_SOURCE_READINESS.md until a patched
  // non-regressing react-router-dom release is available.
  'GHSA-qwww-vcr4-c8h2',
])

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})

let report
try {
  report = JSON.parse(result.stdout || '{}')
} catch (error) {
  console.error('Unable to parse npm audit JSON output.')
  if (result.stdout) console.error(result.stdout)
  if (result.stderr) console.error(result.stderr)
  process.exit(1)
}

const vulnerabilities = report.vulnerabilities || {}
const allowedNames = new Set()

for (const vulnerability of Object.values(vulnerabilities)) {
  const advisories = (vulnerability.via || []).filter((item) => typeof item === 'object')
  const advisoryIds = advisories.map((item) => String(item.url || '').split('/').pop()).filter(Boolean)
  if (advisoryIds.length > 0 && advisoryIds.every((id) => allowedAdvisories.has(id))) {
    allowedNames.add(vulnerability.name)
  }
}

let changed = true
while (changed) {
  changed = false
  for (const vulnerability of Object.values(vulnerabilities)) {
    if (allowedNames.has(vulnerability.name)) continue
    const viaNames = (vulnerability.via || []).filter((item) => typeof item === 'string')
    if (viaNames.length > 0 && viaNames.every((name) => allowedNames.has(name))) {
      allowedNames.add(vulnerability.name)
      changed = true
    }
  }
}

const failures = []
const allowed = []

for (const vulnerability of Object.values(vulnerabilities)) {
  const advisories = (vulnerability.via || []).filter((item) => typeof item === 'object')
  const advisoryIds = advisories.map((item) => String(item.url || '').split('/').pop()).filter(Boolean)
  if (allowedNames.has(vulnerability.name)) {
    allowed.push(`${vulnerability.name}: ${advisoryIds.join(', ') || 'allowed transitive advisory'}`)
  } else {
    failures.push({
      name: vulnerability.name,
      severity: vulnerability.severity,
      advisoryIds,
      range: vulnerability.range,
    })
  }
}

if (allowed.length) {
  console.log('Allowed npm audit advisories:')
  for (const item of allowed) console.log(`- ${item}`)
}

if (failures.length) {
  console.error('Unapproved npm audit vulnerabilities found:')
  for (const failure of failures) {
    const ids = failure.advisoryIds.length ? failure.advisoryIds.join(', ') : 'no advisory id'
    console.error(`- ${failure.name} (${failure.severity}, ${failure.range}): ${ids}`)
  }
  process.exit(1)
}

console.log('npm audit completed with no unapproved vulnerabilities.')
