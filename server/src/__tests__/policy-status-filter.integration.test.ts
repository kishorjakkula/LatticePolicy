import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, type DrizzleDB } from '../db.js'
import { matchesPolicyStatusFilter, type PolicyStatusFilter } from '../lib/policy.utils.js'
import { listPolicies } from '../services/policy.service.js'

const tenantId = 'sample-carrier'
const productCode = 'personal-auto'

// Fixed, unambiguous terms relative to "now" so the assertions do not depend on
// when the suite runs.
const CURRENT_TERM = { effectiveDate: '2020-01-01', expirationDate: '2999-01-01' }
const FUTURE_TERM = { effectiveDate: '2998-01-01', expirationDate: '2999-01-01' }
const EXPIRED_TERM = { effectiveDate: '2000-01-01', expirationDate: '2001-01-01' }

type Seed = {
  policyNumber: string
  status: string
  effectiveDate: string
  expirationDate: string
}

// `policies.status` is the `policy_status_enum` from migration 001_init.sql:
// ('Quote','Draft','Bound','Issued','Cancelled','Expired'). There is no 'Rated'
// member, so the Rated filter cannot be exercised against real rows here — the
// unit suite covers its clause shape instead.
const seeds: Seed[] = [
  { policyNumber: 'PSF-DRAFT-CURRENT', status: 'Draft', ...CURRENT_TERM },
  { policyNumber: 'PSF-DRAFT-EXPIRED', status: 'Draft', ...EXPIRED_TERM },
  { policyNumber: 'PSF-QUOTE-CURRENT', status: 'Quote', ...CURRENT_TERM },
  { policyNumber: 'PSF-QUOTE-EXPIRED', status: 'Quote', ...EXPIRED_TERM },
  { policyNumber: 'PSF-BOUND-CURRENT', status: 'Bound', ...CURRENT_TERM },
  { policyNumber: 'PSF-BOUND-EXPIRED', status: 'Bound', ...EXPIRED_TERM },
  { policyNumber: 'PSF-ISSUED-INFORCE', status: 'Issued', ...CURRENT_TERM },
  { policyNumber: 'PSF-ISSUED-FUTURE', status: 'Issued', ...FUTURE_TERM },
  { policyNumber: 'PSF-ISSUED-EXPIRED', status: 'Issued', ...EXPIRED_TERM },
  { policyNumber: 'PSF-CANCELLED-CURRENT', status: 'Cancelled', ...CURRENT_TERM },
  { policyNumber: 'PSF-CANCELLED-EXPIRED', status: 'Cancelled', ...EXPIRED_TERM },
]

const FILTERS: PolicyStatusFilter[] = [
  'Draft',
  'Rated',
  'Bind',
  'Issued',
  'Inforced',
  'Expired',
  'Cancelled',
]

async function ensureTenant() {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, 'Sample Carrier', 'en-US', 'USD'],
  )
}

async function seedPolicies() {
  const db = getDb()
  await db!.query(`DELETE FROM policies WHERE tenant_id=$1 AND policy_number LIKE 'PSF-%'`, [
    tenantId,
  ])
  for (const seed of seeds) {
    await db!.query(
      `INSERT INTO policies
         (tenant_id, policy_number, status, product_code,
          term_effective_date, term_expiration_date)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        tenantId,
        seed.policyNumber,
        seed.status,
        productCode,
        seed.effectiveDate,
        seed.expirationDate,
      ],
    )
  }
}

async function listSeeded(status: PolicyStatusFilter) {
  const db = getDb() as unknown as DrizzleDB
  const result = await listPolicies(db, tenantId, { status, q: 'psf-', pageSize: 100 })
  return result.items
}

describe('policy status filter (database path)', () => {
  beforeAll(async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant()
    await seedPolicies()
  })

  afterAll(async () => {
    const db = getDb()
    if (db) {
      await db.query(`DELETE FROM policies WHERE tenant_id=$1 AND policy_number LIKE 'PSF-%'`, [
        tenantId,
      ])
    }
    await closeDb()
  })

  it('excludes expired terms from the Draft filter', async () => {
    const numbers = (await listSeeded('Draft')).map((item) => item.policyNumber)

    expect(numbers).toContain('PSF-DRAFT-CURRENT')
    expect(numbers).toContain('PSF-QUOTE-CURRENT')
    expect(numbers).not.toContain('PSF-DRAFT-EXPIRED')
    expect(numbers).not.toContain('PSF-QUOTE-EXPIRED')
  })

  it('excludes expired terms from the Bind filter', async () => {
    const numbers = (await listSeeded('Bind')).map((item) => item.policyNumber)

    expect(numbers).toContain('PSF-BOUND-CURRENT')
    expect(numbers).not.toContain('PSF-BOUND-EXPIRED')
  })

  it('still reports expired rows under the Expired filter', async () => {
    const numbers = (await listSeeded('Expired')).map((item) => item.policyNumber)

    expect(numbers).toEqual(
      expect.arrayContaining([
        'PSF-DRAFT-EXPIRED',
        'PSF-QUOTE-EXPIRED',
        'PSF-BOUND-EXPIRED',
        'PSF-ISSUED-EXPIRED',
      ]),
    )
    // Cancelled wins over Expired.
    expect(numbers).not.toContain('PSF-CANCELLED-EXPIRED')
  })

  it('never returns a row labelled with a status other than the requested filter', async () => {
    for (const status of FILTERS) {
      const items = await listSeeded(status)
      for (const item of items) {
        expect(item.status, `${item.policyNumber} returned for filter "${status}"`).toBe(status)
      }
    }
  })

  it('agrees with the in-memory fallback matcher for every seeded policy', async () => {
    for (const status of FILTERS) {
      const fromDb = (await listSeeded(status)).map((item) => item.policyNumber).sort()
      const fromMemory = seeds
        .filter((seed) =>
          matchesPolicyStatusFilter(status, seed.status, seed.effectiveDate, seed.expirationDate),
        )
        .map((seed) => seed.policyNumber)
        .sort()

      expect(fromDb, `filter "${status}" disagreed across paths`).toEqual(fromMemory)
    }
  })
})
