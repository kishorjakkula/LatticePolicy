import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { evidence, pilotRoot, profile } from './pilot-lib.mjs'

const kit = path.join(pilotRoot, 'kit'), envFile = path.join(kit, 'carrier.env')
const compose = ['compose', '-p', `lattice-${profile.tenantId}`, '--env-file', envFile, '-f', path.join(kit, 'docker-compose.yml')]
const alertFile = path.join(pilotRoot, 'evidence/alerts.jsonl')
let previous = null
async function inspect() {
  const failures = []
  try {
    const r = await fetch(`${profile.apiUrl}/health`, { signal: AbortSignal.timeout(5000) })
    const h = await r.json()
    if (!r.ok || !h.db || !h.cache) failures.push('API/database/cache unhealthy')
  } catch { failures.push('API unreachable') }
  try {
    const running = execFileSync('docker', [...compose, 'ps', '--status', 'running', '--services'], { encoding: 'utf8' }).trim().split('\n')
    for (const service of ['api', 'worker', 'dispatcher', 'frontend', 'db', 'cache']) if (!running.includes(service)) failures.push(`${service} stopped`)
  } catch { failures.push('Docker service inventory unavailable') }
  const backups = path.join(kit, 'backups')
  const dumps = fs.existsSync(backups) ? fs.readdirSync(backups).filter(n => n.endsWith('.dump') && fs.existsSync(path.join(backups, n.replace(/\.dump$/, '.documents.tgz')))) : []
  const newest = Math.max(0, ...dumps.map(n => fs.statSync(path.join(backups, n)).mtimeMs))
  if (Date.now() - newest > profile.backupIntervalMinutes * 60000) failures.push('Backup pair missing or stale')
  const state = failures.length ? 'alert' : 'healthy'
  const report = { state, failures, checkedAt: new Date().toISOString(), localAlertChannel: alertFile }
  evidence('monitoring', report)
  const signature = JSON.stringify(failures)
  if (signature !== previous) {
    fs.appendFileSync(alertFile, JSON.stringify(report) + '\n')
    console.log(`${report.checkedAt} ${state}: ${failures.join('; ') || 'all pilot services and backups healthy'}`)
    previous = signature
  }
  return failures.length === 0
}
if (process.argv.includes('--once')) process.exitCode = await inspect() ? 0 : 1
else {
  // The pilot backup schedule is local; alerts are routed to the supervised
  // operator's terminal and JSONL file, not to an unconfigured external service.
  let lastBackup = 0
  for (;;) {
    if (Date.now() - lastBackup >= profile.backupIntervalMinutes * 60000) {
      try {
        execFileSync('sh', [path.join(kit, 'stack.sh'), 'backup', 'scheduled'], { stdio: 'pipe' })
        lastBackup = Date.now()
        const dir = path.join(kit, 'backups')
        for (const name of fs.readdirSync(dir)) if (Date.now() - fs.statSync(path.join(dir, name)).mtimeMs > profile.backupRetentionDays * 86400000) fs.unlinkSync(path.join(dir, name))
      } catch {
        fs.mkdirSync(path.dirname(alertFile), { recursive: true })
        fs.appendFileSync(alertFile, JSON.stringify({ state: 'alert', failures: ['Scheduled backup failed'], checkedAt: new Date().toISOString() }) + '\n')
      }
    }
    await inspect()
    await new Promise(r => setTimeout(r, 30000))
  }
}
