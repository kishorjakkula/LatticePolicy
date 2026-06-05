import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const migrationsDir = path.resolve(__dirname, '../../migrations')

function migrationFiles(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/i.test(file))
    .sort()
}

describe('database migrations', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('applies all migrations to an empty PostgreSQL database', async () => {
    expect(process.env.DATABASE_URL).toBeTruthy()

    await initDb()
    const db = getDb()
    expect(db).toBeTruthy()

    const expected = migrationFiles()
    const applied = await db!.query<{
      version: number
      name: string
    }>(
      `SELECT version, name
         FROM schema_migrations
        WHERE tenant_id = 'system'
        ORDER BY version`,
    )

    expect(applied.rows.map((row) => row.name)).toEqual(expected)

    const tables = await db!.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [
        [
          'schema_migrations',
          'tenants',
          'users',
          'quotes',
          'policies',
          'policy_versions',
          'policy_transactions',
          'customers',
          'rbac_roles',
          'rbac_permissions',
        ],
      ],
    )

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'customers',
      'policies',
      'policy_transactions',
      'policy_versions',
      'quotes',
      'rbac_permissions',
      'rbac_roles',
      'schema_migrations',
      'tenants',
      'users',
    ])
  })
})
