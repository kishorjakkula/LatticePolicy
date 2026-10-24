import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, TENANT_RLS_ROLE, toRawQuery, withTenantTx } from '../../db.js'
import { ensureTenantRbacDefaults } from '../../rbac.js'
import { assertBusinessownersAuthorization, BUSINESSOWNERS_USER_SOURCE } from '../businessowners-authorization.service.js'

const tenant = `bop-authorization-${randomUUID()}`
const other = `${tenant}-other`
const actorId = randomUUID(), internalId = randomUUID(), companyId = randomUUID(), agencyId = randomUUID(), producerId = randomUUID()
const foreignCompanyId = randomUUID(), foreignAgencyId = randomUUID(), foreignProducerId = randomUUID()
const date = '2026-10-23'
const payload = () => ({ productCode: 'businessowners', state: 'OH', effectiveDate: date,
  underwritingCompanyId: companyId, agency: { agencyId }, producer: { producerId } })
type Query = ReturnType<typeof toRawQuery>
const rollback = new Error('rollback synthetic dependency mutation')

// Each negative case changes only this suite's tenant, then rolls back even on success.
async function changed(sql: string, code: string, params: any[] = [tenant]) {
  await expect(withTenantTx(tenant, async db => {
    const q = toRawQuery(db)
    await q(sql, params)
    await expect(assertBusinessownersAuthorization(q, tenant, payload(), actorId)).rejects.toMatchObject({ code })
    throw rollback
  })).rejects.toBe(rollback)
}

describe('BOP authorization under real tenant RLS', () => {
  beforeAll(async () => {
    if (process.env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true' ||
        process.env.TENANT_RLS_ENFORCED !== 'true' ||
        new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid').pathname !== '/lattice_policy_integration') {
      throw new Error('Fresh disposable lattice_policy_integration with enforced tenant RLS required')
    }
    await initDb()
    for (const id of [tenant, other]) {
      await getDb()!.query('INSERT INTO tenants(tenant_id,name) VALUES($1,$1)', [id])
      await ensureTenantRbacDefaults(id)
    }
    await withTenantTx(tenant, async db => {
      const q = toRawQuery(db)
      for (const [id, role] of [[actorId, 'agent'], [internalId, 'underwriter']]) {
        await q("INSERT INTO users(user_id,tenant_id,username,password_hash) VALUES($1,$2,$3,'synthetic-not-a-login')", [id, tenant, `synthetic-${id}`])
        await q('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [id, role])
      }
      await q(`INSERT INTO underwriting_companies(company_id,tenant_id,name,product_code,country_code,state_code)
        VALUES($1,$2,'Synthetic BOP insurer','businessowners','US','OH')`, [companyId, tenant])
      await q(`INSERT INTO product_state_eligibility(tenant_id,product_code,state_code,effective_date,expiration_date)
        VALUES($1,'businessowners','OH','2026-01-01','2027-01-01')`, [tenant])
      await q(`INSERT INTO agencies(agency_id,tenant_id,agency_key,agency_code,legal_name,status,effective_from,effective_to)
        VALUES($1,$2,'synthetic-agency','BOP-TEST','Synthetic agency','ACTIVE','2026-01-01','2027-01-01')`, [agencyId, tenant])
      await q(`INSERT INTO producers(producer_id,tenant_id,producer_key,first_name,last_name,status)
        VALUES($1,$2,'synthetic-producer','Synthetic','Producer','ACTIVE')`, [producerId, tenant])
      await q(`INSERT INTO agency_producer_affiliations(tenant_id,agency_id,producer_id,effective_from,effective_to)
        VALUES($1,$2,$3,'2026-01-01','2027-01-01')`, [tenant, agencyId, producerId])
      for (const [type, id] of [['AGENCY', agencyId], ['PRODUCER', producerId]]) {
        await q(`INSERT INTO onboarding_appointments(tenant_id,entity_type,entity_id,carrier_code,state,product_code,
          appointment_status,appointment_effective_date,termination_date)
          VALUES($1,$2,$3,$1,'OH','businessowners','ACTIVE','2026-01-01','2027-01-01')`, [tenant, type, id])
      }
      await q(`INSERT INTO onboarding_external_identifiers(tenant_id,entity_type,entity_id,source_system,external_id,id_type)
        VALUES($1,'PRODUCER',$2,$3,$4,'USER_ID')`, [tenant, producerId, BUSINESSOWNERS_USER_SOURCE, actorId])
    })
    await withTenantTx(other, async db => {
      const q = toRawQuery(db)
      await q(`INSERT INTO underwriting_companies(company_id,tenant_id,name,product_code,country_code,state_code)
        VALUES($1,$2,'Other tenant synthetic insurer','businessowners','US','OH')`, [foreignCompanyId, other])
      await q(`INSERT INTO agencies(agency_id,tenant_id,agency_key,agency_code,legal_name,status)
        VALUES($1,$2,'foreign-agency','FOREIGN-BOP','Other tenant synthetic agency','ACTIVE')`, [foreignAgencyId, other])
      await q(`INSERT INTO producers(producer_id,tenant_id,producer_key,first_name,last_name,status)
        VALUES($1,$2,'foreign-producer','Other','Producer','ACTIVE')`, [foreignProducerId, other])
    })
  })
  afterAll(async () => {
    // No policy, issued document or append-only audit records are created here.
    if (getDb()) await getDb()!.query('DELETE FROM tenants WHERE tenant_id=ANY($1::text[])', [[tenant, other]])
    await closeDb()
  })

  it('authorizes an associated agent using the restricted tenant role', async () => {
    await withTenantTx(tenant, async db => {
      const q = toRawQuery(db)
      expect((await q('SELECT current_user AS role')).rows[0].role).toBe(TENANT_RLS_ROLE)
      await expect(assertBusinessownersAuthorization(q, tenant, payload(), actorId)).resolves.toBeUndefined()
      await expect(assertBusinessownersAuthorization(q, tenant, payload(), internalId)).resolves.toBeUndefined()
    })
  })

  it.each([
    ["UPDATE product_state_eligibility SET status='SUSPENDED' WHERE tenant_id=$1", 'STATE_NOT_ELIGIBLE'],
    ["DELETE FROM product_state_eligibility WHERE tenant_id=$1", 'STATE_NOT_ELIGIBLE'],
    ["UPDATE product_state_eligibility SET effective_date='2026-10-24' WHERE tenant_id=$1", 'STATE_NOT_ELIGIBLE'],
    ["UPDATE product_state_eligibility SET expiration_date='2026-10-23' WHERE tenant_id=$1", 'STATE_NOT_ELIGIBLE'],
    ["UPDATE underwriting_companies SET active=false WHERE tenant_id=$1", 'BOP_COMPANY_NOT_ELIGIBLE'],
    ["UPDATE underwriting_companies SET state_code='CA' WHERE tenant_id=$1", 'BOP_COMPANY_NOT_ELIGIBLE'],
    ["UPDATE underwriting_companies SET country_code='CA' WHERE tenant_id=$1", 'BOP_COMPANY_NOT_ELIGIBLE'],
    ["UPDATE underwriting_companies SET product_code='homeowners' WHERE tenant_id=$1", 'BOP_COMPANY_NOT_ELIGIBLE'],
    ["UPDATE agencies SET status='SUSPENDED' WHERE tenant_id=$1", 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ["UPDATE agencies SET effective_from='2026-10-24' WHERE tenant_id=$1", 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ["UPDATE agencies SET effective_to='2026-10-23' WHERE tenant_id=$1", 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ["UPDATE producers SET status='RESTRICTED' WHERE tenant_id=$1", 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ["DELETE FROM agency_producer_affiliations WHERE tenant_id=$1", 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ["UPDATE agency_producer_affiliations SET effective_from='2026-10-24' WHERE tenant_id=$1", 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ["UPDATE agency_producer_affiliations SET effective_to='2026-10-23' WHERE tenant_id=$1", 'BOP_DISTRIBUTION_NOT_AUTHORIZED'],
    ["UPDATE onboarding_appointments SET appointment_status='PENDING' WHERE tenant_id=$1", 'BOP_APPOINTMENT_REQUIRED'],
    ["UPDATE onboarding_appointments SET appointment_effective_date=NULL WHERE tenant_id=$1", 'BOP_APPOINTMENT_REQUIRED'],
    ["UPDATE onboarding_appointments SET appointment_effective_date='2026-10-24' WHERE tenant_id=$1", 'BOP_APPOINTMENT_REQUIRED'],
    ["UPDATE onboarding_appointments SET termination_date='2026-10-23' WHERE tenant_id=$1", 'BOP_APPOINTMENT_REQUIRED'],
    ["UPDATE onboarding_appointments SET carrier_code='another-carrier' WHERE tenant_id=$1", 'BOP_APPOINTMENT_REQUIRED'],
    ["UPDATE onboarding_appointments SET state='CA' WHERE tenant_id=$1", 'BOP_APPOINTMENT_REQUIRED'],
    ["UPDATE onboarding_appointments SET product_code='homeowners' WHERE tenant_id=$1", 'BOP_APPOINTMENT_REQUIRED'],
    ["DELETE FROM onboarding_appointments WHERE tenant_id=$1 AND entity_type='AGENCY'", 'BOP_APPOINTMENT_REQUIRED'],
    ["DELETE FROM onboarding_appointments WHERE tenant_id=$1 AND entity_type='PRODUCER'", 'BOP_APPOINTMENT_REQUIRED'],
    ["UPDATE onboarding_external_identifiers SET active_flag=false WHERE tenant_id=$1", 'BOP_PRODUCER_IDENTITY_REQUIRED'],
    ["UPDATE onboarding_external_identifiers SET external_id='somebody-else' WHERE tenant_id=$1", 'BOP_PRODUCER_IDENTITY_REQUIRED'],
    ["UPDATE onboarding_external_identifiers SET source_system='untrusted-source' WHERE tenant_id=$1", 'BOP_PRODUCER_IDENTITY_REQUIRED'],
    ["UPDATE users SET disabled=true WHERE tenant_id=$1", 'BOP_ACTOR_NOT_AUTHORIZED'],
    ["DELETE FROM user_roles WHERE user_id IN (SELECT user_id FROM users WHERE tenant_id=$1)", 'BOP_ACTOR_NOT_AUTHORIZED'],
    ["UPDATE rbac_roles SET active=false WHERE tenant_id=$1", 'BOP_ACTOR_NOT_AUTHORIZED'],
    ["DELETE FROM rbac_role_permissions WHERE tenant_id=$1 AND permission_code='page.wizard.view'", 'BOP_ACTOR_NOT_AUTHORIZED'],
  ])('fails closed after %s', changed)

  it('denies cross-tenant actors and selections despite tenant-scoped query execution', async () => {
    await withTenantTx(other, async db => {
      await expect(assertBusinessownersAuthorization(toRawQuery(db), other, payload(), actorId))
        .rejects.toMatchObject({ code: 'BOP_ACTOR_NOT_AUTHORIZED' })
    })
    await withTenantTx(tenant, async db => {
      const q = toRawQuery(db)
      for (const patch of [
        { underwritingCompanyId: foreignCompanyId }, { agency: { agencyId: foreignAgencyId } }, { producer: { producerId: foreignProducerId } },
      ]) await expect(assertBusinessownersAuthorization(q, tenant, { ...payload(), ...patch }, actorId)).rejects.toMatchObject({ statusCode: expect.any(Number) })
    })
  })

  it.each(['customer', 'llm_release_automation'])('denies a current underwriter with an additional %s role', async role => {
    await expect(withTenantTx(tenant, async db => {
      const q = toRawQuery(db)
      await q('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [internalId, role])
      await expect(assertBusinessownersAuthorization(q, tenant, payload(), internalId))
        .rejects.toMatchObject({ code: 'BOP_ACTOR_NOT_AUTHORIZED' })
      throw rollback
    })).rejects.toBe(rollback)
  })

  it('holds dependency share locks through the transaction that writes the quote/policy', async () => {
    await withTenantTx(tenant, async db => {
      const q: Query = toRawQuery(db)
      await assertBusinessownersAuthorization(q, tenant, payload(), actorId)
      const locks = await q(`SELECT c.relname FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
        WHERE l.pid=pg_backend_pid() AND l.mode='RowShareLock' AND l.granted`)
      const names = locks.rows.map((row: any) => row.relname)
      for (const name of ['users', 'user_roles', 'rbac_roles', 'rbac_role_permissions', 'underwriting_companies',
        'product_state_eligibility', 'agencies', 'producers', 'agency_producer_affiliations',
        'onboarding_appointments', 'onboarding_external_identifiers']) expect(names).toContain(name)
    })
  })

  it('blocks concurrent appointment revocation until the guarded write transaction ends', async () => {
    await withTenantTx(tenant, async db => {
      await assertBusinessownersAuthorization(toRawQuery(db), tenant, payload(), actorId)
      await expect(withTenantTx(tenant, async secondDb => {
        const q = toRawQuery(secondDb)
        await q("SET LOCAL lock_timeout='150ms'")
        await q("UPDATE onboarding_appointments SET appointment_status='TERMINATED' WHERE tenant_id=$1", [tenant])
      })).rejects.toMatchObject({ code: '55P03' })
    })
  })

  it('blocks concurrent customer-role addition through the authenticated user FK lock', async () => {
    await withTenantTx(tenant, async db => {
      await assertBusinessownersAuthorization(toRawQuery(db), tenant, payload(), actorId)
      await expect(withTenantTx(tenant, async secondDb => {
        const q = toRawQuery(secondDb)
        await q("SET LOCAL lock_timeout='150ms'")
        await q("INSERT INTO user_roles(user_id,role_code) VALUES($1,'customer')", [actorId])
      })).rejects.toMatchObject({ code: '55P03' })
    })
  })
})
