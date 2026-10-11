import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { call, pilotRoot, profile } from './pilot-lib.mjs'

const read = name => JSON.parse(fs.readFileSync(path.join(pilotRoot, name), 'utf8'))
const release = read('release.json'), acceptance = read('evidence/acceptance.json'), recovery = read('evidence/recovery.json')
const browser = read('evidence/playwright.json'), monitoring = read('evidence/monitoring.json')
assert.equal(acceptance.sha, release.sha); assert.equal(recovery.sha, release.sha)
assert.equal((await call('GET', '/version')).commit, release.sha)
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), release.sha)
assert.equal(browser.stats.unexpected, 0); assert(browser.stats.expected >= 2)
assert.equal(browser.stats.skipped, 0); assert.equal(monitoring.state, 'healthy')
assert(Date.parse(browser.stats.startTime) >= Date.parse(release.builtAt), 'Browser evidence predates this image manifest')
assert(Date.parse(acceptance.recordedAt) >= Date.parse(release.builtAt), 'API evidence predates this image manifest')
assert(acceptance.errorRate <= profile.maxErrorRate && recovery.failedMigrationRollback && recovery.alertAndRecoveryVerified)
for (const kind of ['search', 'rating', 'document']) assert(acceptance.workload[kind].p95Ms <= profile[`${kind}P95Ms`])
const destination = path.join(pilotRoot, 'handoff')
fs.mkdirSync(destination, { recursive: true })
fs.writeFileSync(path.join(destination, 'source.tar.gz'), execFileSync('git', ['archive', '--format=tar.gz', release.sha], { maxBuffer: 30 * 1024 * 1024 }))
for (const [source, name] of [
  ['.pilot/release.json', 'release.json'], ['deploy/pilot/standards.json', 'standards.json'],
  ['deploy/pilot/README.md', 'RUNBOOK.md'], ['docs/FIRST_CUSTOMER_HANDOFF.md', 'PRODUCTION-GATES.md'],
  ['.pilot/evidence/acceptance.json', 'acceptance.json'], ['.pilot/evidence/recovery.json', 'recovery.json'],
  ['.pilot/evidence/monitoring.json', 'monitoring.json'], ['.pilot/evidence/playwright.json', 'playwright.json'],
]) fs.copyFileSync(source, path.join(destination, name))
const rows = Object.entries(acceptance.workload).map(([k, v]) => `<tr><td>${k}</td><td>${v.count}</td><td>${v.p95Ms.toFixed(0)} ms</td><td>${profile[`${k}P95Ms`]} ms</td></tr>`).join('')
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Acme Mutual Pilot results</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#17243b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd4df;text-align:left;padding:12px}.passed{color:#187343}</style></head><body><h1>Acme Mutual Pilot</h1><p class="passed">Automated local pilot acceptance passed</p><p>Synthetic Homeowners/TX carrier · 10 concurrent workers · ${acceptance.requests} workload requests · ${(acceptance.errorRate * 100).toFixed(1)}% errors</p><table><thead><tr><th>Operation</th><th>Successful requests</th><th>Measured p95</th><th>Pilot target</th></tr></thead><tbody>${rows}</tbody></table><h2>Recovery and functionality</h2><p>Recovery: ${recovery.recoverySeconds.toFixed(1)} seconds, target ${profile.recoveryTimeMinutes} minutes. Database and ${recovery.restoredDocumentCount} document hashes verified. Successful upgrade, failed-migration rollback, accepted-transaction retention, worker alert and recovery passed.</p><p>Browser scenarios: ${browser.stats.expected} passed, ${browser.stats.unexpected} failed. API checks: ${acceptance.checks.length} passed.</p><p>Source commit: <code>${release.sha}</code></p><p>Generated ${new Date().toISOString()}. This proves the local synthetic pilot. HTTPS, remote disaster recovery, customer approval, production capacity and SLA remain separate acceptance gates.</p><p><a href="acceptance.json">API/workload evidence</a> · <a href="recovery.json">Recovery evidence</a> · <a href="release.json">Image manifest</a></p></body></html>`
fs.writeFileSync(path.join(destination, 'index.html'), html)
fs.writeFileSync(path.join(destination, 'README.md'), `# Acme Mutual Pilot handoff\n\nLocal pilot acceptance for commit ${release.sha}.\n\nIncludes source archive, local image identities, synthetic standards, redacted evidence and runbooks. Credentials, secrets and database backups are excluded. Production gates remain in PRODUCTION-GATES.md.\n`)
const envFile = path.join(pilotRoot, 'kit/carrier.env'), composeFile = path.join(pilotRoot, 'kit/docker-compose.yml')
const container = execFileSync('docker', ['compose', '-p', `lattice-${profile.tenantId}`, '--env-file', envFile, '-f', composeFile, 'ps', '-q', 'frontend'], { encoding: 'utf8' }).trim()
execFileSync('docker', ['exec', container, 'mkdir', '-p', '/usr/share/nginx/html/pilot-results'])
// Serve only a fixed allowlist of synthetic evidence; never copy the pilot root.
for (const name of ['index.html', 'acceptance.json', 'recovery.json', 'release.json']) execFileSync('docker', ['cp', path.join(destination, name), `${container}:/usr/share/nginx/html/pilot-results/${name}`])
console.log(`Handoff: .pilot/handoff · Results: ${profile.uiUrl}/pilot-results/`)
