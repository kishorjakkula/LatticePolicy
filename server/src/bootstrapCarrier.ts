import { closeDb, getDb, initDb } from './db.js'
import { getPinnedTenantId } from './config.js'
import { bootstrapCarrier } from './services/carrier-bootstrap.service.js'

// First-run setup for a carrier stack. Run once after the database is
// reachable:
//
//   CARRIER_TENANT_ID=acme-mutual CARRIER_NAME="Acme Mutual" \
//   CARRIER_ADMIN_USERNAME=admin@acme.example CARRIER_ADMIN_PASSWORD=... \
//   node server/dist/bootstrapCarrier.js
//
// Applies pending migrations, then creates the tenant, its default roles, and
// one carrier administrator. Re-running is safe and never resets a password.

let exitCode = 0
try {
  const tenantId = getPinnedTenantId()
  if (!tenantId) throw new Error('CARRIER_TENANT_ID is required')
  await initDb()
  if (!getDb()) throw new Error('DATABASE_URL is required')
  const result = await bootstrapCarrier({
    tenantId,
    carrierName: process.env.CARRIER_NAME,
    adminUsername: process.env.CARRIER_ADMIN_USERNAME || '',
    adminPassword: process.env.CARRIER_ADMIN_PASSWORD || ''
  })
  console.log(JSON.stringify({ ok: true, ...result }))
} catch (err) {
  exitCode = 1
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
} finally {
  await closeDb()
}
process.exit(exitCode)
