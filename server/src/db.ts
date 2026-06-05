import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Pool, type PoolClient } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'
import { logger } from './logger.js'

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
  // Fallback: use the module-level pool (loses the per-request tenant setting,
  // so only safe for read-only or pre-filtered queries).
  return async (text: string, params?: any[]) => {
    if (!pool) throw new Error('DB not initialized')
    return pool.query(text, params)
  }
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
  const url = process.env.DATABASE_URL
  if (!url) {
    logger.warn('DATABASE_URL not set; running in in-memory mode')
    return
  }
  pool = new Pool({ connectionString: url })
  await ensureMigrationTable()
  await runMigrations()
}

export async function withTenantTx<T>(tenantId: string, fn: (db: DrizzleDB) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('DB not initialized')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
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

async function runMigrations() {
  if (!pool) return
  if (!fs.existsSync(MIGRATIONS_DIR)) return

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => /^\d+_.+\.sql$/i.test(file))
    .sort()

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10)
    if (Number.isNaN(version)) continue

    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE tenant_id = $1 AND version = $2',
      ['system', version]
    )
    if (((applied.rowCount ?? 0) > 0)) continue

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    // simple mode allows multi-statement migration files (BEGIN/DO blocks, etc.)
    const simpleQuery = { text: sql, simple: true } as any
    await pool.query(simpleQuery)
    await pool.query(
      'INSERT INTO schema_migrations (tenant_id, version, name) VALUES ($1,$2,$3)',
      ['system', version, file]
    )
  }
}
