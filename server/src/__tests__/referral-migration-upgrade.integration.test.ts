import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { expect, it } from 'vitest'

it('adds referral evidence without reusing existing Agent Studio migration numbers or fabricating legacy evidence', async () => {
  if (process.env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true') throw new Error('Disposable test database required')
  const admin = new Client({ connectionString: process.env.DATABASE_URL })
  const database = 'referral_upgrade_' + randomUUID().replace(/-/g, '')
  const url = new URL(process.env.DATABASE_URL!)
  url.pathname = '/' + database
  let client: Client | undefined
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${database}"`)
    client = new Client({ connectionString: url.toString() })
    await client.connect()
    await client.query('CREATE TABLE schema_migrations (tenant_id text NOT NULL, version int NOT NULL, name text, PRIMARY KEY (tenant_id, version))')
    const directory = fileURLToPath(new URL('../../migrations/', import.meta.url))
    for (const file of readdirSync(directory).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
      const version = Number(file.split('_')[0])
      if (version > 66) continue
      await client.query(readFileSync(directory + file, 'utf8'))
      await client.query('INSERT INTO schema_migrations VALUES ($1,$2,$3)', ['system', version, file])
    }
    // The deployed local database already owns these numbers. No dependency
    // on its private Agent Studio tables is needed by the referral migration.
    await client.query(`INSERT INTO schema_migrations VALUES
      ('system',67,'067_agent_studio.sql'), ('system',68,'068_agent_runs_promotion.sql')`)
    const id = randomUUID()
    await client.query(`INSERT INTO underwriting_referrals (referral_id,tenant_id,transaction_type,status,reasons)
      VALUES ($1,'legacy-carrier','NewBusiness','Approved',ARRAY['Legacy review'])`, [id])
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      'const db = await import("./server/src/db.ts"); try { await db.initDb(); } finally { await db.closeDb(); }',
    ], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 30000,
    })
    expect(result.status, result.stderr).toBe(0)
    const history = await client.query('SELECT version,name FROM schema_migrations WHERE version>=67 ORDER BY version')
    expect(history.rows).toEqual([
      { version: 67, name: '067_agent_studio.sql' },
      { version: 68, name: '068_agent_runs_promotion.sql' },
      { version: 69, name: '069_underwriting_referral_proposals.sql' },
    ])
    const legacy = await client.query('SELECT status,proposal_hash,proposal_snapshot FROM underwriting_referrals WHERE referral_id=$1', [id])
    expect(legacy.rows).toEqual([{ status: 'Approved', proposal_hash: null, proposal_snapshot: null }])
    await expect(client.query(`UPDATE underwriting_referrals SET proposal_hash=$1,
      proposal_snapshot='{"schemaVersion":1,"tenantId":"legacy-carrier"}' WHERE referral_id=$2`, ['a'.repeat(64), id]))
      .rejects.toThrow('immutable')
  } finally {
    await client?.end()
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.end()
  }
}, 60000)
