import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { expect, it } from 'vitest'

it('upgrades an existing branding database without skipping intake migrations', async () => {
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  const database = 'intake_upgrade_' + randomUUID().replace(/-/g, '')
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = '/' + database
  let client: Client | undefined
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${database}"`)
    client = new Client({ connectionString: url.toString() })
    await client.connect()
    await client.query('CREATE TABLE schema_migrations (tenant_id text NOT NULL, version int NOT NULL, name text, PRIMARY KEY (tenant_id, version))')
    const migrations = fileURLToPath(new URL('../../migrations/', import.meta.url))
    // Construct the previously merged schema, including branding version 060.
    for (const file of readdirSync(migrations).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
      const version = Number(file.split('_')[0])
      if (version > 60) continue
      await client.query(readFileSync(migrations + file, 'utf8'))
      await client.query('INSERT INTO schema_migrations VALUES ($1,$2,$3)', ['system', version, file])
    }
    expect((await client.query("SELECT to_regclass('submission_fields') AS relation")).rows[0].relation).toBeNull()
    // Use the real migration runner in a separate process, with its own pool.
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      'const db = await import("./server/src/db.ts"); try { await db.initDb(); } finally { await db.closeDb(); }',
    ], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8', timeout: 30000,
    })
    expect(result.status, result.stderr).toBe(0)
    const applied = await client.query("SELECT name FROM schema_migrations WHERE tenant_id='system' AND version >= 60 ORDER BY version")
    expect(applied.rows.map(row => row.name)).toEqual(['060_tenant_branding.sql', '061_submission_intake.sql', '062_submission_confidence_score.sql'])
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='tenants' AND column_name='branding') OR (table_name='submission_fields' AND column_name='confidence_score'))")
    expect(columns.rows).toHaveLength(2)
  } finally {
    await client?.end()
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.end()
  }
}, 60000)
