import pg from 'pg'
import { decryptSensitiveValue, hashSensitiveValue } from '../src/lib/customer-crypto.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
if (!process.env.CUSTOMER_DATA_KEY) throw new Error('CUSTOMER_DATA_KEY is required to decrypt existing values')
if (!process.env.PII_LOOKUP_KEY) throw new Error('PII_LOOKUP_KEY is required to generate keyed lookup hashes')

type Target = { table: string; id: string; encrypted: string; hash: string }

const targets: Target[] = [
  { table: 'customer_person_details', id: 'customer_id', encrypted: 'dob_encrypted', hash: 'dob_hash' },
  { table: 'customer_person_details', id: 'customer_id', encrypted: 'ssn_encrypted', hash: 'ssn_hash' },
  { table: 'customer_company_details', id: 'customer_id', encrypted: 'fein_encrypted', hash: 'fein_hash' },
  { table: 'agencies', id: 'agency_id', encrypted: 'fein_encrypted', hash: 'fein_hash' },
  { table: 'producers', id: 'producer_id', encrypted: 'dob_encrypted', hash: 'dob_hash' },
]

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
const client = await pool.connect()
let updated = 0
try {
  await client.query('BEGIN')
  for (const target of targets) {
    const rows = await client.query(
      `SELECT tenant_id, ${target.id} AS id, ${target.encrypted} AS encrypted FROM ${target.table} WHERE ${target.encrypted} IS NOT NULL FOR UPDATE`,
    )
    for (const row of rows.rows) {
      const plaintext = decryptSensitiveValue(row.encrypted)
      if (!plaintext) throw new Error(`Unable to decrypt ${target.table}.${target.encrypted} for ${row.id}`)
      await client.query(
        `UPDATE ${target.table} SET ${target.hash}=$1 WHERE tenant_id=$2 AND ${target.id}=$3`,
        [hashSensitiveValue(plaintext), row.tenant_id, row.id],
      )
      updated += 1
    }
  }
  await client.query('COMMIT')
  console.log(JSON.stringify({ status: 'ok', updated }))
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
