import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { call, evidence, homeownersPayload, login, pilotRoot, profile } from './pilot-lib.mjs'

assert(profile.synthetic && profile.tenantId === 'acme-pilot', 'Recovery drill is restricted to the synthetic pilot')
const kit = path.join(pilotRoot, 'kit'), stack = path.join(kit, 'stack.sh'), envFile = path.join(kit, 'carrier.env')
const acceptance = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'evidence/acceptance.json')))
const release = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'release.json')))
const compose = ['compose', '-p', `lattice-${profile.tenantId}`, '--env-file', envFile, '-f', path.join(kit, 'docker-compose.yml')]
const run = args => execFileSync('sh', [stack, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const begin = performance.now()
const backup = run(['backup', 'acceptance']).trim()
const restorePoint = new Date().toISOString()
const { token } = await login()
const postBackup = await call('POST', '/api/v1/quotes', { token, data: homeownersPayload('afterbackup') })
// Remove all generated artifacts on this disposable pilot only, then prove
// they are restored byte-for-byte along with the database recovery point.
execFileSync('docker', [...compose, 'run', '--rm', '-T', '--no-deps', 'api', 'node', '-e',
  "const fs=require('fs');for(const n of fs.readdirSync('/data/documents'))fs.rmSync('/data/documents/'+n,{recursive:true,force:true})"], { stdio: 'pipe' })
const recoveryStart = performance.now()
run(['restore', backup]); run(['up'])
const recoverySeconds = (performance.now() - recoveryStart) / 1000
const restored = await login()
await call('GET', `/api/v1/quotes/${postBackup.quoteId}`, { token: restored.token, expected: [404] })
async function verifyDocuments() {
  for (const doc of acceptance.documentHashes) {
    const { bytes } = await call('GET', `/api/v1/policies/${acceptance.policyId}/documents/${doc.documentId}/content`, { token: restored.token, raw: true })
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), doc.hash)
  }
}
await verifyDocuments()
assert(recoverySeconds < profile.recoveryTimeMinutes * 60)
const dataLossSeconds = (Date.now() - Date.parse(restorePoint)) / 1000
assert(dataLossSeconds < profile.recoveryPointMinutes * 60)
const next = `pilot-next-${release.sha.slice(0, 12)}`, bad = `pilot-failure-${release.sha.slice(0, 12)}`
for (const image of ['latticepolicy-pilot-api', 'latticepolicy-pilot-ui']) {
  execFileSync('docker', ['tag', `${image}:${release.tag}`, `${image}:${next}`])
}
run(['upgrade', next])
await verifyDocuments()
run(['rollback', '--keep-data'])
const build = path.join(pilotRoot, 'failure-image')
fs.mkdirSync(build, { recursive: true })
fs.writeFileSync(path.join(build, 'Dockerfile'), `FROM latticepolicy-pilot-api:${release.tag}\nCOPY migrate.js /app/server/dist/migrate.js\n`)
fs.writeFileSync(path.join(build, 'migrate.js'), "console.error('Intentional isolated pilot migration failure'); process.exit(1)\n")
execFileSync('docker', ['build', '-t', `latticepolicy-pilot-api:${bad}`, build], { stdio: 'pipe' })
execFileSync('docker', ['tag', `latticepolicy-pilot-ui:${release.tag}`, `latticepolicy-pilot-ui:${bad}`])
const accepted = await call('POST', '/api/v1/quotes', { token: restored.token, data: homeownersPayload('beforefailedmigration') })
const failure = spawnSync('sh', [stack, 'upgrade', bad], { encoding: 'utf8' })
assert.notEqual(failure.status, 0, 'Injected failure must fail the upgrade')
assert.match(fs.readFileSync(envFile, 'utf8'), new RegExp(`LATTICE_VERSION=${release.tag}`))
await call('GET', `/api/v1/quotes/${accepted.quoteId}`, { token: restored.token })
await verifyDocuments()
const monitor = () => spawnSync(process.execPath, ['scripts/pilot-monitor.mjs', '--once'], { encoding: 'utf8' })
assert.equal(monitor().status, 0, 'Pilot monitor must initially be healthy')
execFileSync('docker', [...compose, 'stop', 'worker'], { stdio: 'pipe' })
try {
  assert.notEqual(monitor().status, 0, 'Stopped worker must trigger an alert')
  const alert = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'evidence/monitoring.json')))
  assert(alert.failures.includes('worker stopped'))
} finally { execFileSync('docker', [...compose, 'up', '-d', 'worker'], { stdio: 'pipe' }) }
assert.equal(monitor().status, 0, 'Monitor must report recovery')
evidence('recovery', { sha: release.sha, restorePoint, backup: path.basename(backup),
  recoverySeconds, measuredRecoveryPointAgeSeconds: dataLossSeconds,
  restoredDocumentCount: acceptance.documentHashes.length, successfulUpgrade: true,
  applicationOnlyRollback: true, failedMigrationRollback: true, acceptedTransactionRetained: true, alertAndRecoveryVerified: true,
  durationSeconds: (performance.now() - begin) / 1000,
  limitation: 'Local Docker synthetic drill; remote backups and infrastructure outage recovery are not certified.' })
console.log('Pilot restore, upgrade, application rollback and failed-migration rollback passed.')
