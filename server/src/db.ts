import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Pool, type PoolClient } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'
import { logger } from './logger.js'
import { assertDeploymentConfig, getPinnedTenantId, isTenantRlsEnforced } from './config.js'
import { BadRequestError, ForbiddenError } from './errors/domain.errors.js'

let pool: Pool | null = null

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations')

export type DrizzleDB = NodePgDatabase<any>

export function createDrizzleDb(client: Pool | PoolClient): DrizzleDB {
  return drizzle({ client, schema } as any) as unknown as DrizzleDB
}

/**
 * Backward-compatibility helper: wraps a DrizzleDB into the old raw QueryFn
 * interface `(text, params?) => Promise<{ rows, rowCount }>`.
 *
 * Routes that still use hand-written SQL strings can call this during the
 * migration period.  The DrizzleDB passed in was created from a PoolClient
 * inside withTenantTx, so the tenant RLS setting is already active on that
 * connection.
 */
export function toRawQuery(db: DrizzleDB): (text: string, params?: any[]) => Promise<any> {
  const rawClient = (db as any).__pgClient
  if (rawClient && typeof rawClient.query === 'function') {
    return (text: string, params?: any[]) => rawClient.query(text, params)
  }

  // drizzle-orm/node-postgres stores the underlying PoolClient on session.client
  const client = (db as any).session?.client
  if (client && typeof client.query === 'function' && client.constructor?.name === 'Client') {
    return (text: string, params?: any[]) => client.query(text, params)
  }
  // No transaction-bound client: refuse rather than fall back to the shared
  // pool, which would run the query outside any tenant scope.
  throw new Error('toRawQuery requires a tenant-scoped transaction (use withTenantTx)')
}

export function getDb(): Pool | null {
  return pool
}

export async function closeDb() {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}

export async function initDb() {
  assertDeploymentConfig()
  const url = process.env.DATABASE_URL
  if (!url) {
    logger.warn('DATABASE_URL not set; running in in-memory mode')
    return
  }
  pool = new Pool({ connectionString: url })
  await ensureMigrationTable()
  await runMigrations()
  await assertTenantRlsRoleUsable()
  const schema = await getSchemaStatus()
  if (schema.schemaAhead) {
    // Allowed on purpose: redeploying the previous image is the documented
    // fast rollback path. Make it visible so it is never a silent state.
    logger.warn(
      { appliedVersion: schema.appliedVersion, releaseVersion: schema.releaseVersion },
      'Database schema is newer than this release; running as an application-only rollback'
    )
  }
}

/** Non-owner role tenant transactions switch into so RLS policies apply (migration 058). */
export const TENANT_RLS_ROLE = 'lattice_tenant_rls'

/**
 * Fail at startup, not on the first request, when enforcement is requested
 * but the connection cannot switch into the restricted role.
 */
async function assertTenantRlsRoleUsable() {
  if (!pool || !isTenantRlsEnforced()) return
  const result = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
            COALESCE((SELECT pg_has_role(current_user, oid, 'MEMBER') FROM pg_roles WHERE rolname = $1), false) AS can_assume`,
    [TENANT_RLS_ROLE]
  )
  const row = result.rows[0] || {}
  if (!row.role_exists || !row.can_assume) {
    throw new Error(
      `TENANT_RLS_ENFORCED is on but the database user cannot use role ${TENANT_RLS_ROLE}; ` +
      `create the role and grant it to the application user (see docs/MULTITENANCY.md)`
    )
  }
}

/**
 * Fails closed on a missing tenant id and, when this stack is pinned to one
 * carrier (CARRIER_TENANT_ID), on any other tenant id. Request-edge checks in
 * tenancy.ts/auth.ts give callers a clean response first; this is the backstop
 * for every other path (jobs, workers, config loaders).
 */
export function assertTenantServed(tenantId: string): void {
  const requested = String(tenantId || '').trim()
  if (!requested) throw new BadRequestError('TENANT_REQUIRED', 'Tenant context is required')
  const pinned = getPinnedTenantId()
  if (pinned && requested !== pinned) throw new ForbiddenError('TENANT_NOT_SERVED')
}

export async function withTenantTx<T>(tenantId: string, fn: (db: DrizzleDB) => Promise<T>): Promise<T> {
  assertTenantServed(tenantId)
  if (!pool) throw new Error('DB not initialized')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // SET LOCAL lasts for this transaction only, so the pooled connection
    // returns to the owner role on COMMIT/ROLLBACK.
    if (isTenantRlsEnforced()) await client.query(`SET LOCAL ROLE ${TENANT_RLS_ROLE}`)
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
    const db = createDrizzleDb(client)
    ;(db as any).__pgClient = client
    const result = await fn(db)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

async function ensureMigrationTable() {
  if (!pool) return
  await pool.query(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  tenant_id text NOT NULL DEFAULT 'system',
  version int NOT NULL,
  name text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, version)
)`)
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS name text')
}

export type SchemaStatus = {
  /** Highest migration version recorded in this database, or null in in-memory mode. */
  appliedVersion: number | null
  /** Highest migration version shipped with this build. */
  releaseVersion: number | null
  /**
   * True when the database has migrations this build does not know about,
   * which is what an application-only rollback onto a newer schema looks like.
   */
  schemaAhead: boolean
}

function latestMigrationFileVersion(): number | null {
  if (!fs.existsSync(MIGRATIONS_DIR)) return null
  const versions = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => /^\d+_.+\.sql$/i.test(file))
    .map(file => parseInt(file.split('_')[0], 10))
    .filter(version => !Number.isNaN(version))
  return versions.length ? Math.max(...versions) : null
}

export async function getSchemaStatus(): Promise<SchemaStatus> {
  const releaseVersion = latestMigrationFileVersion()
  if (!pool) return { appliedVersion: null, releaseVersion, schemaAhead: false }
  const result = await pool.query('SELECT MAX(version)::int AS version FROM schema_migrations WHERE tenant_id = $1', ['system'])
  const appliedVersion = result.rows[0]?.version ?? null
  const schemaAhead = appliedVersion != null && releaseVersion != null && appliedVersion > releaseVersion
  return { appliedVersion, releaseVersion, schemaAhead }
}

const MIGRATION_LOCK_ID = 734_284_921

export async function runMigrations() {
  if (!pool) return
  if (!fs.existsSync(MIGRATIONS_DIR)) return

  const client = await pool.connect()
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])

  try {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => /^\d+_.+\.sql$/i.test(file))
      .sort()

    for (const file of files) {
      const version = parseInt(file.split('_')[0], 10)
      if (Number.isNaN(version)) continue

      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE tenant_id = $1 AND version = $2',
        ['system', version]
      )
      if (((applied.rowCount ?? 0) > 0)) continue

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      const transactionalSql = sql
        .replace(/^\s*BEGIN\s*;?/i, '')
        .replace(/COMMIT\s*;?\s*$/i, '')
      await client.query('BEGIN')
      try {
        await client.query({ text: transactionalSql, simple: true } as any)
        await client.query(
          'INSERT INTO schema_migrations (tenant_id, version, name) VALUES ($1,$2,$3)',
          ['system', version, file]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]) } finally { client.release() }
  }
}
