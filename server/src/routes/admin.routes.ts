import { Router } from 'express'
import { requirePermission } from '../auth.js'
import { createUser, deleteUser, listByTenant, updateUser } from '../users.js'
import { withTenantTx, getDb, toRawQuery } from '../db.js'
import { v4 as uuidv4 } from '../uuid.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { formsAdminRoutes } from '../formsAdmin.js'
import { customerAdminRoutes } from '../customers.js'
import { onboardingAdminRoutes } from '../agencyOnboarding.js'
import {
  createMemoryUnderwritingCompany,
  deleteMemoryUnderwritingCompany,
  hasMemoryUnderwritingCompanyConflict,
  listMemoryUnderwritingCompanies,
  normalizeCompanyCountryCode,
  normalizeCompanyName,
  normalizeCompanyProductCode,
  normalizeCompanyStateCode,
  updateMemoryUnderwritingCompany
} from '../uwCompaniesStore.js'
import {
  defaultTenantDatePreferences,
  defaultTenantPolicyNumberFormats,
  getMemoryTenantDatePreferences,
  getMemoryTenantPolicyNumberFormats,
  normalizePolicyNumberFormatsByProduct,
  normalizeTenantDatePreferences,
  setMemoryTenantDatePreferences,
  setMemoryTenantPolicyNumberFormats,
  tenantDatePreferencesFromRow,
  tenantPolicyNumberFormatsFromRow
} from '../tenantPreferences.js'
import {
  defaultTenantMfaRequired,
  getMemoryTenantMfaRequired,
  normalizeTenantMfaRequired,
  setMemoryTenantMfaRequired,
  tenantMfaRequiredFromRow
} from '../tenantSecurity.js'
import {
  defaultTenantAiMlConfig,
  getMemoryTenantAiMlConfig,
  normalizeTenantAiMlConfig,
  setMemoryTenantAiMlConfig,
  tenantAiMlConfigFromRow
} from '../tenantAi.js'
import {
  createRole,
  deleteRole as deleteSecurityRole,
  ensureTenantRbacDefaults,
  listPermissionCatalog,
  listSecurityRelationshipMap,
  listRolesWithPermissions,
  updateRole,
  validateRoleCodesForTenant
} from '../rbac.js'
import { generatePolicyNumber } from '../policyNumbers.js'
import { buildCacheKey, cacheDeleteKey, cacheDeletePrefix } from '../cache.js'

export const adminRoutes = Router()
const DUPLICATE_UW_COMPANY_MESSAGE =
  'Duplicate combination not allowed for this company, product, country, and state/province'
const memoryTenantNames = new Map<string, string>()

adminRoutes.use(requirePermission('menu.admin.view'))
adminRoutes.use('/forms', requirePermission('admin.forms.read'), formsAdminRoutes)
adminRoutes.use('/customers', requirePermission('admin.customers.read'), customerAdminRoutes)
adminRoutes.use('/onboarding', requirePermission('admin.onboarding.read'), onboardingAdminRoutes)

adminRoutes.get('/users', requirePermission('admin.users.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    await ensureTenantRbacDefaults(tenantId)
    return res.json(await listByTenant(tenantId))
  } catch (e:any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.post('/users', requirePermission('admin.users.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const { username, password, roles, customerRef } = req.body || {}
  if (!username || !password || !Array.isArray(roles)) return res.status(400).json({ code: 'INVALID_INPUT' })
  try {
    await ensureTenantRbacDefaults(tenantId)
    const roleValidation = await validateRoleCodesForTenant(tenantId, roles)
    if (roleValidation.missingRoleCodes.length) {
      return res.status(400).json({
        code: 'INVALID_ROLE',
        message: `Unknown or inactive role(s): ${roleValidation.missingRoleCodes.join(', ')}`
      })
    }
    const user = await createUser({ username, password, tenantId, roles: roleValidation.validRoleCodes, customerRef })
    return res.status(201).json(user)
  } catch (e: any) {
    if (String(e?.message) === 'USERNAME_EXISTS') return res.status(409).json({ code: 'USERNAME_EXISTS' })
    if (String(e?.message) === 'CUSTOMER_NOT_FOUND') return res.status(400).json({ code: 'CUSTOMER_NOT_FOUND', message: 'Linked customer not found' })
    if (String(e?.message) === 'CUSTOMER_LINK_REQUIRED') return res.status(400).json({ code: 'CUSTOMER_LINK_REQUIRED', message: 'Customer role requires a linked customer' })
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.patch('/users/:id', requirePermission('admin.users.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const { id } = req.params
  const body = req.body || {}
  const { password, roles, disabled } = body
  try {
    await ensureTenantRbacDefaults(tenantId)
    let validatedRoles: string[] | undefined = undefined
    if (Array.isArray(roles)) {
      const roleValidation = await validateRoleCodesForTenant(tenantId, roles)
      if (roleValidation.missingRoleCodes.length) {
        return res.status(400).json({
          code: 'INVALID_ROLE',
          message: `Unknown or inactive role(s): ${roleValidation.missingRoleCodes.join(', ')}`
        })
      }
      validatedRoles = roleValidation.validRoleCodes
    }
    const patch: any = { password, roles: validatedRoles, disabled }
    if (Object.prototype.hasOwnProperty.call(body, 'customerRef')) patch.customerRef = body.customerRef
    const user = await updateUser(tenantId, id, patch)
    return res.json(user)
  } catch (e: any) {
    if (String(e?.message) === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (String(e?.message) === 'CUSTOMER_NOT_FOUND') return res.status(400).json({ code: 'CUSTOMER_NOT_FOUND', message: 'Linked customer not found' })
    if (String(e?.message) === 'CUSTOMER_LINK_REQUIRED') return res.status(400).json({ code: 'CUSTOMER_LINK_REQUIRED', message: 'Customer role requires a linked customer' })
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.delete('/users/:id', requirePermission('admin.users.manage'), (req, res) => {
  const tenantId = req.tenant!.tenantId
  deleteUser(tenantId, req.params.id)
    .then(() => res.status(204).end())
    .catch((e:any) => {
      if (String(e?.message) === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
      return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
    })
})

adminRoutes.get('/security/permissions', requirePermission('admin.security.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    await ensureTenantRbacDefaults(tenantId)
    const permissions = await listPermissionCatalog(tenantId)
    return res.json(permissions)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.get('/security/roles', requirePermission(['admin.security.read', 'admin.users.read', 'admin.users.manage']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    await ensureTenantRbacDefaults(tenantId)
    const roles = await listRolesWithPermissions(tenantId)
    return res.json(roles)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.get('/security/relationships', requirePermission(['admin.security.read', 'admin.users.read']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    await ensureTenantRbacDefaults(tenantId)
    const mapping = await listSecurityRelationshipMap(tenantId)
    return res.json(mapping)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.post('/security/roles', requirePermission('admin.security.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    await ensureTenantRbacDefaults(tenantId)
    const role = await createRole(
      tenantId,
      {
        roleCode: req.body?.roleCode,
        roleName: req.body?.roleName,
        description: req.body?.description,
        active: req.body?.active,
        permissionCodes: req.body?.permissionCodes
      },
      req.user?.username || req.user?.id || 'system'
    )
    return res.status(201).json(role)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'INVALID_INPUT') return res.status(400).json({ code: 'INVALID_INPUT' })
    if (msg === 'ROLE_EXISTS') return res.status(409).json({ code: 'ROLE_EXISTS' })
    if (msg.startsWith('INVALID_PERMISSIONS:')) {
      return res.status(400).json({ code: 'INVALID_PERMISSIONS', message: msg.replace('INVALID_PERMISSIONS:', '') })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: msg })
  }
})

adminRoutes.patch('/security/roles/:roleCode', requirePermission('admin.security.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    await ensureTenantRbacDefaults(tenantId)
    const role = await updateRole(
      tenantId,
      req.params.roleCode,
      {
        roleName: req.body?.roleName,
        description: req.body?.description,
        active: req.body?.active,
        permissionCodes: req.body?.permissionCodes
      },
      req.user?.username || req.user?.id || 'system'
    )
    return res.json(role)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'INVALID_INPUT') return res.status(400).json({ code: 'INVALID_INPUT' })
    if (msg === 'ROLE_NOT_FOUND') return res.status(404).json({ code: 'ROLE_NOT_FOUND' })
    if (msg === 'SYSTEM_ROLE_IMMUTABLE') {
      return res.status(400).json({ code: 'SYSTEM_ROLE_IMMUTABLE', message: 'System roles cannot be disabled' })
    }
    if (msg.startsWith('INVALID_PERMISSIONS:')) {
      return res.status(400).json({ code: 'INVALID_PERMISSIONS', message: msg.replace('INVALID_PERMISSIONS:', '') })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: msg })
  }
})

adminRoutes.delete('/security/roles/:roleCode', requirePermission('admin.security.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    await ensureTenantRbacDefaults(tenantId)
    await deleteSecurityRole(tenantId, req.params.roleCode)
    return res.status(204).end()
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'INVALID_INPUT') return res.status(400).json({ code: 'INVALID_INPUT' })
    if (msg === 'ROLE_NOT_FOUND') return res.status(404).json({ code: 'ROLE_NOT_FOUND' })
    if (msg === 'SYSTEM_ROLE_IMMUTABLE') {
      return res.status(400).json({ code: 'SYSTEM_ROLE_IMMUTABLE', message: 'System roles cannot be deleted' })
    }
    if (msg === 'ROLE_IN_USE') {
      return res.status(409).json({ code: 'ROLE_IN_USE', message: 'Role is assigned to users and cannot be deleted' })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: msg })
  }
})

adminRoutes.patch('/security/users/:id/roles', requirePermission(['admin.security.manage', 'admin.users.manage']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const userId = req.params.id
  const requestedRoles = Array.isArray(req.body?.roleCodes) ? req.body.roleCodes : []
  try {
    await ensureTenantRbacDefaults(tenantId)
    const roleValidation = await validateRoleCodesForTenant(tenantId, requestedRoles)
    if (roleValidation.missingRoleCodes.length) {
      return res.status(400).json({
        code: 'INVALID_ROLE',
        message: `Unknown or inactive role(s): ${roleValidation.missingRoleCodes.join(', ')}`
      })
    }
    const user = await updateUser(tenantId, userId, { roles: roleValidation.validRoleCodes })
    return res.json(user)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'DB_ERROR', message: msg })
  }
})

// Tenant admin: get/update tenant name for current tenant
adminRoutes.get('/tenant', requirePermission('admin.tenant.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) {
    const prefs = getMemoryTenantDatePreferences(tenantId)
    const policyNumberFormatsByProduct = getMemoryTenantPolicyNumberFormats(tenantId)
    const mfaRequired = getMemoryTenantMfaRequired(tenantId)
    const aiMlConfig = getMemoryTenantAiMlConfig(tenantId)
    const savedName = memoryTenantNames.get(tenantId) || tenantId
    return res.json({
      tenantId,
      name: savedName,
      defaultCountry: prefs.defaultCountry,
      dateFormatsByCountry: prefs.dateFormatsByCountry,
      policyNumberFormatsByProduct,
      mfaRequired,
      aiMlConfig
    })
  }
  try {
    const r = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        'SELECT tenant_id, name, default_country_code, date_formats_by_country, policy_number_formats_by_product, mfa_required, ai_ml_config FROM tenants WHERE tenant_id=$1',
        [tenantId]
      )
    })
    if (r.rowCount === 0) {
      const defaults = defaultTenantDatePreferences()
      const policyNumberFormatsByProduct = defaultTenantPolicyNumberFormats()
      const mfaRequired = defaultTenantMfaRequired()
      const aiMlConfig = defaultTenantAiMlConfig()
      return res.json({
        tenantId,
        name: tenantId,
        defaultCountry: defaults.defaultCountry,
        dateFormatsByCountry: defaults.dateFormatsByCountry,
        policyNumberFormatsByProduct,
        mfaRequired,
        aiMlConfig
      })
    }
    const row = r.rows[0]
    const prefs = tenantDatePreferencesFromRow(row)
    const policyNumberFormatsByProduct = tenantPolicyNumberFormatsFromRow(row)
    const mfaRequired = tenantMfaRequiredFromRow(row)
    const aiMlConfig = tenantAiMlConfigFromRow(row)
    return res.json({
      tenantId: row.tenant_id,
      name: row.name,
      defaultCountry: prefs.defaultCountry,
      dateFormatsByCountry: prefs.dateFormatsByCountry,
      policyNumberFormatsByProduct,
      mfaRequired,
      aiMlConfig
    })
  } catch (e:any) { return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) }) }
})

adminRoutes.patch('/tenant', requirePermission('admin.tenant.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const nameProvided = req.body?.name != null
  const name = nameProvided ? String(req.body?.name || '').trim() : ''
  if (nameProvided && !name) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'name required' })
  }
  const preferencesProvided =
    req.body?.defaultCountry != null ||
    req.body?.dateFormatsByCountry != null ||
    req.body?.policyNumberFormatsByProduct != null ||
    req.body?.mfaRequired != null ||
    req.body?.aiMlConfig != null
  if (!nameProvided && !preferencesProvided) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'Provide at least one tenant setting to update' })
  }
  const db = getDb()
  if (!db) {
    const currentName = memoryTenantNames.get(tenantId) || tenantId
    const nextName = nameProvided ? name : currentName
    if (nameProvided) {
      memoryTenantNames.set(tenantId, nextName)
    }
    const currentPrefs = getMemoryTenantDatePreferences(tenantId)
    const currentPolicyNumberFormats = getMemoryTenantPolicyNumberFormats(tenantId)
    const currentMfaRequired = getMemoryTenantMfaRequired(tenantId)
    const currentAiMlConfig = getMemoryTenantAiMlConfig(tenantId)
    const nextPrefs = normalizeTenantDatePreferences(
      {
        defaultCountry: req.body?.defaultCountry ?? currentPrefs.defaultCountry,
        dateFormatsByCountry: req.body?.dateFormatsByCountry ?? currentPrefs.dateFormatsByCountry
      },
      currentPrefs
    )
    const nextPolicyNumberFormats = normalizePolicyNumberFormatsByProduct(
      req.body?.policyNumberFormatsByProduct ?? currentPolicyNumberFormats,
      currentPolicyNumberFormats
    )
    const saved = setMemoryTenantDatePreferences(tenantId, nextPrefs)
    const savedPolicyNumberFormats = setMemoryTenantPolicyNumberFormats(tenantId, nextPolicyNumberFormats)
    const savedMfaRequired = setMemoryTenantMfaRequired(
      tenantId,
      req.body?.mfaRequired ?? currentMfaRequired
    )
    const savedAiMlConfig = setMemoryTenantAiMlConfig(
      tenantId,
      req.body?.aiMlConfig ?? currentAiMlConfig
    )
    await cacheDeleteKey(buildCacheKey(['tenant-preferences', tenantId]))
    return res.json({
      tenantId,
      name: nextName,
      defaultCountry: saved.defaultCountry,
      dateFormatsByCountry: saved.dateFormatsByCountry,
      policyNumberFormatsByProduct: savedPolicyNumberFormats,
      mfaRequired: savedMfaRequired,
      aiMlConfig: savedAiMlConfig
    })
  }
  try {
    let responsePayload: {
      tenantId: string
      name: string
      defaultCountry: string
      dateFormatsByCountry: Record<string, string>
      policyNumberFormatsByProduct: Record<string, string>
      mfaRequired: boolean
      aiMlConfig: any
    } | null = null
    await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const existingResult = await q(
        'SELECT tenant_id, name, default_country_code, date_formats_by_country, policy_number_formats_by_product, mfa_required, ai_ml_config FROM tenants WHERE tenant_id=$1',
        [tenantId]
      )
      const existingRow = (existingResult as any).rows?.[0] || null
      const existingPrefs = existingRow ? tenantDatePreferencesFromRow(existingRow) : defaultTenantDatePreferences()
      const existingPolicyNumberFormats = existingRow
        ? tenantPolicyNumberFormatsFromRow(existingRow)
        : defaultTenantPolicyNumberFormats()
      const existingMfaRequired = existingRow
        ? tenantMfaRequiredFromRow(existingRow)
        : defaultTenantMfaRequired()
      const existingAiMlConfig = existingRow
        ? tenantAiMlConfigFromRow(existingRow)
        : defaultTenantAiMlConfig()
      const nextPrefs = normalizeTenantDatePreferences(
        {
          defaultCountry: req.body?.defaultCountry ?? existingPrefs.defaultCountry,
          dateFormatsByCountry: req.body?.dateFormatsByCountry ?? existingPrefs.dateFormatsByCountry
        },
        existingPrefs
      )
      const nextPolicyNumberFormats = normalizePolicyNumberFormatsByProduct(
        req.body?.policyNumberFormatsByProduct ?? existingPolicyNumberFormats,
        existingPolicyNumberFormats
      )
      const nextMfaRequired = normalizeTenantMfaRequired(
        req.body?.mfaRequired,
        existingMfaRequired
      )
      const nextAiMlConfig = normalizeTenantAiMlConfig(
        req.body?.aiMlConfig,
        existingAiMlConfig
      )
      const nextName = nameProvided ? name : (existingRow?.name || tenantId)
      if (existingRow) {
        await q(
          `UPDATE tenants
           SET name=$2, default_country_code=$3, date_formats_by_country=$4, policy_number_formats_by_product=$5, mfa_required=$6, ai_ml_config=$7
           WHERE tenant_id=$1`,
          [
            tenantId,
            nextName,
            nextPrefs.defaultCountry,
            JSON.stringify(nextPrefs.dateFormatsByCountry),
            JSON.stringify(nextPolicyNumberFormats),
            nextMfaRequired,
            JSON.stringify(nextAiMlConfig)
          ]
        )
      } else {
        await q(
          `INSERT INTO tenants (tenant_id, name, default_country_code, date_formats_by_country, policy_number_formats_by_product, mfa_required, ai_ml_config)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            tenantId,
            nextName,
            nextPrefs.defaultCountry,
            JSON.stringify(nextPrefs.dateFormatsByCountry),
            JSON.stringify(nextPolicyNumberFormats),
            nextMfaRequired,
            JSON.stringify(nextAiMlConfig)
          ]
        )
      }
      responsePayload = {
        tenantId,
        name: nextName,
        defaultCountry: nextPrefs.defaultCountry,
        dateFormatsByCountry: nextPrefs.dateFormatsByCountry,
        policyNumberFormatsByProduct: nextPolicyNumberFormats,
        mfaRequired: nextMfaRequired,
        aiMlConfig: nextAiMlConfig
      }
    })
    await cacheDeleteKey(buildCacheKey(['tenant-preferences', tenantId]))
    return res.json(responsePayload)
  } catch (e:any) { return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) }) }
})

adminRoutes.get('/underwriting-companies', requirePermission('admin.uw_company.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const productCode = normalizeCompanyProductCode(req.query.productCode)
  const country = req.query.country ? normalizeCompanyCountryCode(req.query.country) : ''
  const state = req.query.state ? normalizeCompanyStateCode(req.query.state) : ''
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true'
  const db = getDb()
  if (db) {
    try {
      const rows = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        const clauses = ['tenant_id=$1']
        const params: any[] = [tenantId]
        let idx = 2
        if (!includeInactive) {
          clauses.push('active = true')
        }
        if (productCode) {
          clauses.push(`product_code = $${idx}`)
          params.push(productCode)
          idx++
        }
        if (country) {
          clauses.push(`country_code = $${idx}`)
          params.push(country)
          idx++
        }
        if (state) {
          clauses.push(`(state_code = $${idx} OR state_code = 'ALL')`)
          params.push(state)
          idx++
        }
        const sql = `SELECT company_id, name, product_code, country_code, state_code, active, created_at, updated_at
                     FROM underwriting_companies
                     WHERE ${clauses.join(' AND ')}
                     ORDER BY name ASC`
        return q(sql, params)
      })
      return res.json((rows as any).rows.map((row: any) => mapUnderwritingCompanyRow(row)))
    } catch (e: any) {
      return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
    }
  }
  const items = listMemoryUnderwritingCompanies(tenantId, { productCode, country, state, includeInactive })
  return res.json(items.map((item) => ({
    companyId: item.companyId,
    name: item.name,
    productCode: item.productCode,
    country: item.country,
    state: item.state,
    active: item.active,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  })))
})

adminRoutes.post('/underwriting-companies', requirePermission('admin.uw_company.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const name = normalizeCompanyName(req.body?.name)
  const productCode = normalizeCompanyProductCode(req.body?.productCode)
  const country = normalizeCompanyCountryCode(req.body?.country)
  const state = normalizeCompanyStateCode(req.body?.state)
  const active = req.body?.active !== false
  if (!name || !productCode || !state) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'name, productCode, country, and state are required' })
  }
  const db = getDb()
  if (db) {
    try {
      const inserted = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        const duplicate = await hasDbUnderwritingCompanyConflict(q, {
          tenantId,
          name,
          productCode,
          country,
          state
        })
        if (duplicate) return null
        const result = await q(
          `INSERT INTO underwriting_companies (tenant_id, name, product_code, country_code, state_code, active, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           RETURNING company_id, name, product_code, country_code, state_code, active, created_at, updated_at`,
          [tenantId, name, productCode, country, state, active]
        )
        return (result as any).rows[0]
      })
      if (!inserted) {
        return res.status(409).json({ code: 'DUPLICATE', message: DUPLICATE_UW_COMPANY_MESSAGE })
      }
      await cacheDeletePrefix(buildCacheKey(['uw-companies', tenantId]))
      return res.status(201).json(mapUnderwritingCompanyRow(inserted))
    } catch (e: any) {
      if (e?.code === '23505') {
        return res.status(409).json({ code: 'DUPLICATE', message: DUPLICATE_UW_COMPANY_MESSAGE })
      }
      return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
    }
  }
  if (hasMemoryUnderwritingCompanyConflict(tenantId, { name, productCode, country, state })) {
    return res.status(409).json({ code: 'DUPLICATE', message: DUPLICATE_UW_COMPANY_MESSAGE })
  }
  const created = createMemoryUnderwritingCompany(tenantId, { name, productCode, country, state, active })
  await cacheDeletePrefix(buildCacheKey(['uw-companies', tenantId]))
  return res.status(201).json({
    companyId: created.companyId,
    name: created.name,
    productCode: created.productCode,
    country: created.country,
    state: created.state,
    active: created.active,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt
  })
})

adminRoutes.patch('/underwriting-companies/:id', requirePermission('admin.uw_company.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const companyId = req.params.id
  const patch: {
    name?: string
    productCode?: string
    country?: string
    state?: string
    active?: boolean
  } = {}
  if (req.body?.name != null) patch.name = normalizeCompanyName(req.body.name)
  if (req.body?.productCode != null) patch.productCode = normalizeCompanyProductCode(req.body.productCode)
  if (req.body?.country != null) patch.country = normalizeCompanyCountryCode(req.body.country)
  if (req.body?.state != null) patch.state = normalizeCompanyStateCode(req.body.state)
  if (req.body?.active != null) patch.active = Boolean(req.body.active)

  if ((patch.name != null && !patch.name) || (patch.productCode != null && !patch.productCode) || (patch.state != null && !patch.state)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'Invalid underwriting company values' })
  }

  const db = getDb()
  if (db) {
    try {
      const updated = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        const current = await q(
          `SELECT company_id, name, product_code, country_code, state_code, active
           FROM underwriting_companies
           WHERE tenant_id=$1 AND company_id=$2`,
          [tenantId, companyId]
        )
        if (!(current as any).rowCount) return null
        const row = (current as any).rows[0]
        const nextName = patch.name ?? row.name
        const nextProductCode = patch.productCode ?? row.product_code
        const nextCountry = patch.country ?? row.country_code
        const nextState = patch.state ?? row.state_code
        const nextActive = patch.active ?? row.active
        const duplicate = await hasDbUnderwritingCompanyConflict(q, {
          tenantId,
          name: nextName,
          productCode: nextProductCode,
          country: nextCountry,
          state: nextState,
          excludeCompanyId: companyId
        })
        if (duplicate) return { duplicate: true }
        const result = await q(
          `UPDATE underwriting_companies
           SET name=$3, product_code=$4, country_code=$5, state_code=$6, active=$7, updated_at=now()
           WHERE tenant_id=$1 AND company_id=$2
           RETURNING company_id, name, product_code, country_code, state_code, active, created_at, updated_at`,
          [tenantId, companyId, nextName, nextProductCode, nextCountry, nextState, nextActive]
        )
        return (result as any).rows[0] || null
      })
      if (!updated) return res.status(404).json({ code: 'NOT_FOUND' })
      if ((updated as any).duplicate) {
        return res.status(409).json({ code: 'DUPLICATE', message: DUPLICATE_UW_COMPANY_MESSAGE })
      }
      await cacheDeletePrefix(buildCacheKey(['uw-companies', tenantId]))
      return res.json(mapUnderwritingCompanyRow(updated))
    } catch (e: any) {
      if (e?.code === '23505') {
        return res.status(409).json({ code: 'DUPLICATE', message: DUPLICATE_UW_COMPANY_MESSAGE })
      }
      return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
    }
  }

  const current = listMemoryUnderwritingCompanies(tenantId, { includeInactive: true }).find((item) => item.companyId === companyId)
  if (!current) return res.status(404).json({ code: 'NOT_FOUND' })
  const nextName = patch.name ?? current.name
  const nextProductCode = patch.productCode ?? current.productCode
  const nextCountry = patch.country ?? current.country
  const nextState = patch.state ?? current.state
  if (
    hasMemoryUnderwritingCompanyConflict(tenantId, {
      name: nextName,
      productCode: nextProductCode,
      country: nextCountry,
      state: nextState,
      excludeCompanyId: companyId
    })
  ) {
    return res.status(409).json({ code: 'DUPLICATE', message: DUPLICATE_UW_COMPANY_MESSAGE })
  }
  const updated = updateMemoryUnderwritingCompany(tenantId, companyId, patch)
  if (!updated) return res.status(404).json({ code: 'NOT_FOUND' })
  await cacheDeletePrefix(buildCacheKey(['uw-companies', tenantId]))
  return res.json({
    companyId: updated.companyId,
    name: updated.name,
    productCode: updated.productCode,
    country: updated.country,
    state: updated.state,
    active: updated.active,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt
  })
})

adminRoutes.delete('/underwriting-companies/:id', requirePermission('admin.uw_company.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const companyId = req.params.id
  const db = getDb()
  if (db) {
    try {
      const result = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        return q('DELETE FROM underwriting_companies WHERE tenant_id=$1 AND company_id=$2', [tenantId, companyId])
      })
      if (!((result as any).rowCount > 0)) return res.status(404).json({ code: 'NOT_FOUND' })
      await cacheDeletePrefix(buildCacheKey(['uw-companies', tenantId]))
      return res.status(204).end()
    } catch (e: any) {
      return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
    }
  }
  const removed = deleteMemoryUnderwritingCompany(tenantId, companyId)
  if (!removed) return res.status(404).json({ code: 'NOT_FOUND' })
  await cacheDeletePrefix(buildCacheKey(['uw-companies', tenantId]))
  return res.status(204).end()
})

// Seed demo policies for current tenant
adminRoutes.post('/seed', requirePermission('admin.security.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Seeding requires DB' })
  let seedStep = 'start'
  try {
    await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      seedStep = 'load tenant policy number formats'
      const tenantSettingsResult = await q(
        'SELECT policy_number_formats_by_product FROM tenants WHERE tenant_id=$1 LIMIT 1',
        [tenantId]
      )
      const policyNumberFormatsByProduct =
        (tenantSettingsResult as any).rowCount > 0
          ? tenantPolicyNumberFormatsFromRow((tenantSettingsResult as any).rows[0])
          : defaultTenantPolicyNumberFormats()
      const samples: any[] = []
      // Auto policy
      samples.push({
        payload: {
          productCode: 'personal-auto', effectiveDate: '2025-01-01', termMonths: 12, state: 'NY',
          uwAnswers: { driverAge: 30 },
          risks: [{ type: 'autoVehicle', year: 2019, make: 'Honda', model: 'Civic', garagingZip: '10001', usage: 'commute', annualMiles: 12000 }],
          coverages: []
        },
        endorse: null
      })
      // Homeowners with cancel
      samples.push({
        payload: {
          productCode: 'homeowners', effectiveDate: '2025-02-01', termMonths: 12, state: 'CA',
          risks: [{ type: 'dwelling', address: '22 Hill Rd', construction: 'masonry', yearBuilt: 1980, roofAgeYears: 25, squareFeet: 1400 }],
          coverages: []
        },
        cancel: '2025-04-01'
      })
      // Auto with endorse and renew
      samples.push({
        payload: {
          productCode: 'personal-auto', effectiveDate: '2025-05-01', termMonths: 12, state: 'FL',
          uwAnswers: { driverAge: 17 },
          risks: [{ type: 'autoVehicle', year: 2015, make: 'Ford', model: 'Focus', garagingZip: '33101', usage: 'commercial', annualMiles: 40000 }],
          coverages: []
        },
        endorse: { effectiveDate: '2025-09-01', changes: [{ op: 'replace', path: '/uwAnswers/driverAge', value: 20 }] },
        renew: true
      })

      for (const s of samples) {
        seedStep = 'create policy identifiers'
        const policyId = uuidv4()
        const productCode = String(s.payload?.productCode || 'unknown')
        const policyNumber = await generatePolicyNumber({
          policyId,
          productCode,
          formatsByProduct: policyNumberFormatsByProduct,
          isUnique: async (candidate: string) => {
            const existing = await q(
              'SELECT 1 FROM policies WHERE tenant_id=$1 AND policy_number=$2 LIMIT 1',
              [tenantId, candidate]
            )
            return !((existing as any).rowCount > 0)
          }
        })
        const eff = s.payload.effectiveDate
        const months = Number(s.payload.termMonths || 12)
        const exp = new Date(eff + 'T00:00:00Z'); exp.setUTCMonth(exp.getUTCMonth() + months)
        const expStr = exp.toISOString().slice(0,10)
        const premium = rate(tenantId, s.payload)
        const uw = evaluateUW(tenantId, s.payload)
        seedStep = `insert policy ${productCode}`
        await q('INSERT INTO policies (tenant_id, policy_id, policy_number, product_code, status, term_effective_date, term_expiration_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [tenantId, policyId, policyNumber, productCode, 'Issued', eff, expStr])
        const issueVid = uuidv4()
        seedStep = `insert issue version ${productCode}`
        await q('INSERT INTO policy_versions (tenant_id, policy_id, version_id, effective_date, transaction_type, premium_total, premium_fees, premium_taxes, currency, uw_decision, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',
          [tenantId, policyId, issueVid, eff, 'NB', premium.total?.amount || 0, premium.fees?.amount || 0, premium.taxes?.amount || 0, 'USD', uw.decision, JSON.stringify(s.payload)])
        const risk = s.payload.risks?.[0]
        if (s.payload.productCode === 'personal-auto') {
          seedStep = 'insert auto vehicle'
          await q('INSERT INTO auto_vehicles (tenant_id, policy_id, version_id, year, make, model, vin, symbol, garaging_zip, usage, annual_miles, driver_age) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
            [tenantId, policyId, issueVid, risk.year || null, risk.make || null, risk.model || null, risk.vin || null, risk.symbol || null, risk.garagingZip || null, risk.usage || null, risk.annualMiles || null, (s.payload.uwAnswers?.driverAge ?? risk.driverAge) || null])
        } else {
          seedStep = 'insert dwelling'
          await q('INSERT INTO dwellings (tenant_id, policy_id, version_id, address, construction, protection_class, year_built, roof_age_years, square_feet) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)',
            [
              tenantId,
              policyId,
              issueVid,
              risk.address ? JSON.stringify({ line1: risk.address }) : null,
              risk.construction || null,
              risk.protectionClass || null,
              risk.yearBuilt || null,
              risk.roofAgeYears || null,
              risk.squareFeet || null
            ])
        }
        for (const c of (s.payload.coverages || [])) {
          seedStep = 'insert coverage selection'
          await q('INSERT INTO coverage_selections (tenant_id, policy_id, version_id, coverage_code, selected, limit_value, deductible, percent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [tenantId, policyId, issueVid, c.code, !!c.selected, c.limit ?? null, c.deductible ?? null, c.percent ?? null])
        }
        if (s.cancel) {
          const vid = uuidv4()
          seedStep = 'insert cancellation version'
          await q('INSERT INTO policy_versions (tenant_id, policy_id, version_id, effective_date, transaction_type, premium_total, premium_fees, premium_taxes, currency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [tenantId, policyId, vid, s.cancel, 'CANCEL', -100, 0, 0, 'USD'])
          seedStep = 'mark policy cancelled'
          await q('UPDATE policies SET status=$1 WHERE tenant_id=$2 AND policy_id=$3', ['Cancelled', tenantId, policyId])
        }
        if (s.endorse) {
          const newPayload = JSON.parse(JSON.stringify(s.payload))
          // simple replace for driverAge/roof in examples
          if (s.payload.productCode === 'personal-auto') newPayload.uwAnswers.driverAge = s.endorse.changes[0].value
          if (s.payload.productCode === 'homeowners') newPayload.risks[0].roofAgeYears = s.endorse.changes[0].value
          const np = rate(tenantId, newPayload)
          const delta = (np.total?.amount || 0) - (premium.total?.amount || 0)
          const vid = uuidv4()
          seedStep = 'insert endorsement version'
          await q('INSERT INTO policy_versions (tenant_id, policy_id, version_id, effective_date, transaction_type, premium_total, premium_fees, premium_taxes, currency, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
            [tenantId, policyId, vid, s.endorse.effectiveDate, 'ENDORSE', delta, 0, 0, 'USD', JSON.stringify(newPayload)])
        }
        if (s.renew) {
          const nextEff = expStr
          const np = rate(tenantId, { ...s.payload, effectiveDate: nextEff })
          const vid = uuidv4()
          seedStep = 'insert renewal version'
          await q('INSERT INTO policy_versions (tenant_id, policy_id, version_id, effective_date, transaction_type, premium_total, premium_fees, premium_taxes, currency, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
            [tenantId, policyId, vid, nextEff, 'RENEW', np.total?.amount || 0, np.fees?.amount || 0, np.taxes?.amount || 0, 'USD', JSON.stringify({ ...s.payload, effectiveDate: nextEff })])
        }
      }
    })
    return res.json({ ok: true })
  } catch (e:any) {
    return res.status(500).json({ code: 'SEED_FAILED', message: `${seedStep}: ${String(e?.message || e)}` })
  }
})

function mapUnderwritingCompanyRow(row: any) {
  return {
    companyId: row.company_id,
    name: row.name,
    productCode: row.product_code,
    country: row.country_code,
    state: row.state_code,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

async function hasDbUnderwritingCompanyConflict(
  q: (sql: string, params?: any[]) => Promise<any>,
  input: {
    tenantId: string
    name: string
    productCode: string
    country: string
    state: string
    excludeCompanyId?: string
  }
): Promise<boolean> {
  const params: any[] = [input.tenantId, input.name, input.productCode, input.country, input.state]
  let sql = `SELECT 1
             FROM underwriting_companies
             WHERE tenant_id = $1
               AND lower(name) = lower($2)
               AND product_code = $3
               AND country_code = $4
               AND (state_code = $5 OR state_code = 'ALL' OR $5 = 'ALL')`
  if (input.excludeCompanyId) {
    sql += ' AND company_id <> $6'
    params.push(input.excludeCompanyId)
  }
  sql += ' LIMIT 1'
  const result = await q(sql, params)
  return (result as any).rowCount > 0
}
