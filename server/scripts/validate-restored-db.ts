import pg from 'pg'
import fs from 'node:fs'

const restoreUrl = String(process.env.RESTORE_DATABASE_URL || '').trim()
const productionUrl = String(process.env.DATABASE_URL || '').trim()
const metadataPath = String(process.env.RESTORE_METADATA_FILE || 'restore-metadata.json')
if (!restoreUrl) throw new Error('RESTORE_DATABASE_URL is required')
if (productionUrl && restoreUrl === productionUrl) throw new Error('Refusing to validate the active DATABASE_URL')
if (!fs.existsSync(metadataPath)) throw new Error(`Restore metadata not found: ${metadataPath}`)
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
const restorePoint = new Date(String(metadata.restorePoint || ''))
if (Number.isNaN(restorePoint.getTime())) throw new Error('Restore metadata must include a valid restorePoint timestamp')

const startedAt = Date.now()
const pool = new pg.Pool({ connectionString: restoreUrl, max: 2 })
try {
  const migrations = await pool.query('SELECT max(version)::int AS version FROM schema_migrations WHERE tenant_id=$1', ['system'])
  const tenants = await pool.query('SELECT count(*)::int AS count FROM tenants')
  const policies = await pool.query('SELECT count(*)::int AS count FROM policies')
  if (!migrations.rows[0]?.version) throw new Error('Restored database has no applied schema migrations')
  if (Number(tenants.rows[0]?.count || 0) < 1) throw new Error('Restored database has no tenants')
  console.log(JSON.stringify({ status: 'ok', restorePoint: restorePoint.toISOString(),
    recoveryPointAgeMinutes: Math.round((Date.now() - restorePoint.getTime()) / 60000), migrationVersion: migrations.rows[0].version,
    tenantCount: tenants.rows[0].count, policyCount: policies.rows[0].count,
    durationMs: Date.now() - startedAt, validatedAt: new Date().toISOString() }))
} finally {
  await pool.end()
}
