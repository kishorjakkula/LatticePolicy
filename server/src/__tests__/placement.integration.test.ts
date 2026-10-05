import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import {
  createPlacement,
  getPlacement,
  addMarketParticipant,
  addSubjectivity,
  resolveSubjectivity,
  transitionPlacementStatus,
} from '../services/placement.service.js'

const TENANT_ID = 'sample-carrier'

describe('large commercial placement workflow', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('creates a placement, adds market participants and subjectivities, and converts through to bind order', async () => {
    await initDb()
    const db = getDb()
    expect(db).toBeTruthy()

    await db!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [TENANT_ID, 'Sample Carrier', 'en-US', 'USD']
    )

    const placement = await withTenantTx(TENANT_ID, (innerDb) =>
      createPlacement(innerDb, TENANT_ID, {
        productCode: 'commercial-property',
        insuredName: 'Acme Manufacturing Co',
        effectiveDate: '2026-09-01',
        facilityReference: 'FAC-2026-001',
        terms: ['War exclusion applies', 'Warranted sprinklered'],
        createdBy: '11111111-1111-4111-a111-111111111111',
      })
    )
    expect(placement.status).toBe('Submission')
    expect(placement.statusHistory).toHaveLength(1)

    // Lead + following markets subscribing shares that sum to 100%.
    await withTenantTx(TENANT_ID, (innerDb) =>
      addMarketParticipant(innerDb, TENANT_ID, placement.placementId, {
        marketName: 'Lead Re',
        role: 'Lead',
        subscriptionPercent: 60,
        securityStatus: 'Confirmed',
      })
    )
    await withTenantTx(TENANT_ID, (innerDb) =>
      addMarketParticipant(innerDb, TENANT_ID, placement.placementId, {
        marketName: 'Following Market',
        role: 'Following',
        subscriptionPercent: 40,
      })
    )

    // A third participant would push total subscription over 100% and must be rejected.
    await expect(
      withTenantTx(TENANT_ID, (innerDb) =>
        addMarketParticipant(innerDb, TENANT_ID, placement.placementId, {
          marketName: 'Oversubscribed Market',
          subscriptionPercent: 10,
        })
      )
    ).rejects.toMatchObject({ code: 'PLACEMENT_OVERSUBSCRIBED' })

    const subjectivity = await withTenantTx(TENANT_ID, (innerDb) =>
      addSubjectivity(innerDb, TENANT_ID, placement.placementId, {
        description: 'Provide updated loss run report',
        dueDate: '2026-08-25',
      })
    )
    expect(subjectivity.status).toBe('Open')

    // Cannot skip ahead to BindOrder from Submission.
    await expect(
      withTenantTx(TENANT_ID, (innerDb) =>
        transitionPlacementStatus(innerDb, TENANT_ID, placement.placementId, { toStatus: 'BindOrder' })
      )
    ).rejects.toMatchObject({ code: 'INVALID_PLACEMENT_TRANSITION' })

    await withTenantTx(TENANT_ID, (innerDb) =>
      transitionPlacementStatus(innerDb, TENANT_ID, placement.placementId, { toStatus: 'Indication' })
    )
    await withTenantTx(TENANT_ID, (innerDb) =>
      transitionPlacementStatus(innerDb, TENANT_ID, placement.placementId, { toStatus: 'Quoted' })
    )

    // The subjectivity is resolved before the bind order is placed.
    const resolved = await withTenantTx(TENANT_ID, (innerDb) =>
      resolveSubjectivity(innerDb, TENANT_ID, placement.placementId, subjectivity.subjectivityId, {
        status: 'Satisfied',
        resolvedBy: '44444444-4444-4444-a444-444444444444',
      })
    )
    expect(resolved.status).toBe('Satisfied')
    expect(resolved.resolvedAt).toBeTruthy()

    const bindOrdered = await withTenantTx(TENANT_ID, (innerDb) =>
      transitionPlacementStatus(innerDb, TENANT_ID, placement.placementId, { toStatus: 'BindOrder' })
    )
    expect(bindOrdered.status).toBe('BindOrder')
    expect(bindOrdered.statusHistory).toHaveLength(4) // Submission entry + 3 transitions

    const full = await withTenantTx(TENANT_ID, (innerDb) => getPlacement(innerDb, TENANT_ID, placement.placementId))
    expect(full.participants).toHaveLength(2)
    expect(full.subjectivities).toHaveLength(1)
    expect(full.subjectivities[0].status).toBe('Satisfied')
  })

  it('rejects a transition once a placement has been Declined', async () => {
    await initDb()
    const placement = await withTenantTx(TENANT_ID, (innerDb) =>
      createPlacement(innerDb, TENANT_ID, { insuredName: 'Withdrawn Risk LLC', createdBy: '22222222-2222-4222-a222-222222222222' })
    )
    await withTenantTx(TENANT_ID, (innerDb) =>
      transitionPlacementStatus(innerDb, TENANT_ID, placement.placementId, { toStatus: 'Declined', reason: 'Capacity unavailable' })
    )
    await expect(
      withTenantTx(TENANT_ID, (innerDb) =>
        transitionPlacementStatus(innerDb, TENANT_ID, placement.placementId, { toStatus: 'Indication' })
      )
    ).rejects.toMatchObject({ code: 'INVALID_PLACEMENT_TRANSITION' })
  })

  it('does not leak placements across tenants', async () => {
    await initDb()
    const otherTenant = 'other-tenant-placement'
    const db = getDb()
    await db!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [otherTenant, 'Other Tenant', 'en-US', 'USD']
    )
    const placement = await withTenantTx(otherTenant, (innerDb) =>
      createPlacement(innerDb, otherTenant, { insuredName: 'Other Tenant Risk', createdBy: '33333333-3333-4333-a333-333333333333' })
    )
    await expect(
      withTenantTx(TENANT_ID, (innerDb) => getPlacement(innerDb, TENANT_ID, placement.placementId))
    ).rejects.toMatchObject({ code: 'PLACEMENT_NOT_FOUND' })
  })
})
