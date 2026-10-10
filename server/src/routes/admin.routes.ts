import { Router } from 'express'
import { requirePermission } from '../auth.js'
import { createUser, deleteUser, listByTenant, updateUser } from '../users.js'
import { withTenantTx, getDb, toRawQuery } from '../db.js'
import { v4 as uuidv4 } from '../uuid.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { loadTenantOverrides } from '../products.js'
import { formsAdminRoutes, ensureDefaultFormRows } from '../formsAdmin.js'
import { customerAdminRoutes } from '../customers.js'
import { complianceAdminRoutes } from './compliance-admin.routes.js'
import { adminJobsRoutes } from './admin-jobs.routes.js'
import { dataImportRoutes } from './data-import.routes.js'
import { adminDashboardRoutes } from './admin-dashboard.routes.js'
import { exposureRoutes } from './exposure.routes.js'
import { reinsuranceAdminRoutes } from './reinsurance-admin.routes.js'
import { bordereauxRoutes } from './bordereaux.routes.js'
import { onboardingAdminRoutes, loadOnboardingConfig, upsertAgencyEntity } from '../agencyOnboarding.js'
import { notificationTemplatesRoutes } from '../notificationTemplates.js'
import { createNotificationTemplate } from '../services/notification-template-admin.service.js'
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
  defaultTenantLocalAuthEnabled,
  defaultTenantSsoConfig,
  getMemoryTenantLocalAuthEnabled,
  getMemoryTenantSsoConfig,
  normalizeTenantLocalAuthEnabled,
  normalizeTenantSsoConfig,
  setMemoryTenantLocalAuthEnabled,
  setMemoryTenantSsoConfig,
  tenantLocalAuthEnabledFromRow,
  tenantSsoConfigFromRow
} from '../tenantIdentity.js'
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
import { routeParam } from '../lib/utils.js'
import { mountRouter } from '../route-registry.js'

export const adminRoutes = Router()
const DUPLICATE_UW_COMPANY_MESSAGE =
  'Duplicate combination not allowed for this company, product, country, and state/province'
const memoryTenantNames = new Map<string, string>()

adminRoutes.use(requirePermission('menu.admin.view'))
mountRouter(adminRoutes, '/forms', requirePermission('admin.forms.read'), formsAdminRoutes)
mountRouter(adminRoutes, '/customers', requirePermission('admin.customers.read'), customerAdminRoutes)
mountRouter(adminRoutes, '/onboarding', requirePermission('admin.onboarding.read'), onboardingAdminRoutes)
mountRouter(adminRoutes, '/notification-templates', requirePermission('admin.notifications.read'), notificationTemplatesRoutes)
mountRouter(adminRoutes, '/compliance', requirePermission('admin.compliance.read'), complianceAdminRoutes)
mountRouter(adminRoutes, '/jobs', requirePermission('admin.jobs.read'), adminJobsRoutes)
mountRouter(adminRoutes, '/import', requirePermission('admin.import.read'), dataImportRoutes)
mountRouter(adminRoutes, '/dashboard', requirePermission('admin.dashboard.read'), adminDashboardRoutes)
mountRouter(adminRoutes, '/exposure', requirePermission('admin.exposure.read'), exposureRoutes)
mountRouter(adminRoutes, '/reinsurance', reinsuranceAdminRoutes)
mountRouter(adminRoutes, '/bordereaux', bordereauxRoutes)

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
    const user = await createUser({ username, password, tenantId, roles: roleValidation.validRoleCodes, customerRef, enforcePasswordPolicy: true })
    return res.status(201).json(user)
  } catch (e: any) {
    if (String(e?.message) === 'USERNAME_EXISTS') return res.status(409).json({ code: 'USERNAME_EXISTS' })
    if (String(e?.message) === 'CUSTOMER_NOT_FOUND') return res.status(400).json({ code: 'CUSTOMER_NOT_FOUND', message: 'Linked customer not found' })
    if (String(e?.message) === 'CUSTOMER_LINK_REQUIRED') return res.status(400).json({ code: 'CUSTOMER_LINK_REQUIRED', message: 'Customer role requires a linked customer' })
    if (String(e?.message).startsWith('WEAK_PASSWORD')) return res.status(400).json({ code: 'WEAK_PASSWORD', message: String(e.message).replace(/^WEAK_PASSWORD:\s*/, '') })
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.patch('/users/:id', requirePermission('admin.users.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const id = routeParam(req.params.id)
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
    const patch: any = { password, roles: validatedRoles, disabled, enforcePasswordPolicy: true }
    if (Object.prototype.hasOwnProperty.call(body, 'customerRef')) patch.customerRef = body.customerRef
    const user = await updateUser(tenantId, id, patch)
    return res.json(user)
  } catch (e: any) {
    if (String(e?.message) === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (String(e?.message) === 'CUSTOMER_NOT_FOUND') return res.status(400).json({ code: 'CUSTOMER_NOT_FOUND', message: 'Linked customer not found' })
    if (String(e?.message) === 'CUSTOMER_LINK_REQUIRED') return res.status(400).json({ code: 'CUSTOMER_LINK_REQUIRED', message: 'Customer role requires a linked customer' })
    if (String(e?.message).startsWith('WEAK_PASSWORD')) return res.status(400).json({ code: 'WEAK_PASSWORD', message: String(e.message).replace(/^WEAK_PASSWORD:\s*/, '') })
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

adminRoutes.delete('/users/:id', requirePermission('admin.users.manage'), (req, res) => {
  const tenantId = req.tenant!.tenantId
  deleteUser(tenantId, routeParam(req.params.id))
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
      routeParam(req.params.roleCode),
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
    await deleteSecurityRole(tenantId, routeParam(req.params.roleCode))
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
  const userId = routeParam(req.params.id)
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
    const localAuthEnabled = getMemoryTenantLocalAuthEnabled(tenantId)
    const ssoConfig = getMemoryTenantSsoConfig(tenantId)
    const savedName = memoryTenantNames.get(tenantId) || tenantId
    return res.json({
      tenantId,
      name: savedName,
      defaultCountry: prefs.defaultCountry,
      dateFormatsByCountry: prefs.dateFormatsByCountry,
      policyNumberFormatsByProduct,
      mfaRequired,
      aiMlConfig,
      localAuthEnabled,
      ssoConfig
    })
  }
  try {
    const r = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        'SELECT tenant_id, name, default_country_code, date_formats_by_country, policy_number_formats_by_product, mfa_required, ai_ml_config, local_auth_enabled, sso_config FROM tenants WHERE tenant_id=$1',
        [tenantId]
      )
    })
    if (r.rowCount === 0) {
      const defaults = defaultTenantDatePreferences()
      const policyNumberFormatsByProduct = defaultTenantPolicyNumberFormats()
      const mfaRequired = defaultTenantMfaRequired()
      const aiMlConfig = defaultTenantAiMlConfig()
      const localAuthEnabled = defaultTenantLocalAuthEnabled()
      const ssoConfig = defaultTenantSsoConfig()
      return res.json({
        tenantId,
        name: tenantId,
        defaultCountry: defaults.defaultCountry,
        dateFormatsByCountry: defaults.dateFormatsByCountry,
        policyNumberFormatsByProduct,
        mfaRequired,
        aiMlConfig,
        localAuthEnabled,
        ssoConfig
      })
    }
    const row = r.rows[0]
    const prefs = tenantDatePreferencesFromRow(row)
    const policyNumberFormatsByProduct = tenantPolicyNumberFormatsFromRow(row)
    const mfaRequired = tenantMfaRequiredFromRow(row)
    const aiMlConfig = tenantAiMlConfigFromRow(row)
    const localAuthEnabled = tenantLocalAuthEnabledFromRow(row)
    const ssoConfig = tenantSsoConfigFromRow(row)
    return res.json({
      tenantId: row.tenant_id,
      name: row.name,
      defaultCountry: prefs.defaultCountry,
      dateFormatsByCountry: prefs.dateFormatsByCountry,
      policyNumberFormatsByProduct,
      mfaRequired,
      aiMlConfig,
      localAuthEnabled,
      ssoConfig
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
    req.body?.aiMlConfig != null ||
    req.body?.localAuthEnabled != null ||
    req.body?.ssoConfig != null
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
    const currentLocalAuthEnabled = getMemoryTenantLocalAuthEnabled(tenantId)
    const currentSsoConfig = getMemoryTenantSsoConfig(tenantId)
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
    const savedLocalAuthEnabled = setMemoryTenantLocalAuthEnabled(
      tenantId,
      req.body?.localAuthEnabled ?? currentLocalAuthEnabled
    )
    const savedSsoConfig = setMemoryTenantSsoConfig(
      tenantId,
      req.body?.ssoConfig ?? currentSsoConfig
    )
    await cacheDeleteKey(buildCacheKey(['tenant-preferences', tenantId]))
    return res.json({
      tenantId,
      name: nextName,
      defaultCountry: saved.defaultCountry,
      dateFormatsByCountry: saved.dateFormatsByCountry,
      policyNumberFormatsByProduct: savedPolicyNumberFormats,
      mfaRequired: savedMfaRequired,
      aiMlConfig: savedAiMlConfig,
      localAuthEnabled: savedLocalAuthEnabled,
      ssoConfig: savedSsoConfig
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
      localAuthEnabled: boolean
      ssoConfig: any
    } | null = null
    await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const existingResult = await q(
        'SELECT tenant_id, name, default_country_code, date_formats_by_country, policy_number_formats_by_product, mfa_required, ai_ml_config, local_auth_enabled, sso_config FROM tenants WHERE tenant_id=$1',
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
      const existingLocalAuthEnabled = existingRow
        ? tenantLocalAuthEnabledFromRow(existingRow)
        : defaultTenantLocalAuthEnabled()
      const existingSsoConfig = existingRow
        ? tenantSsoConfigFromRow(existingRow)
        : defaultTenantSsoConfig()
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
      const nextLocalAuthEnabled = normalizeTenantLocalAuthEnabled(
        req.body?.localAuthEnabled,
        existingLocalAuthEnabled
      )
      const nextSsoConfig = normalizeTenantSsoConfig(
        req.body?.ssoConfig,
        existingSsoConfig
      )
      const nextName = nameProvided ? name : (existingRow?.name || tenantId)
      if (existingRow) {
        await q(
          `UPDATE tenants
           SET name=$2, default_country_code=$3, date_formats_by_country=$4, policy_number_formats_by_product=$5, mfa_required=$6, ai_ml_config=$7, local_auth_enabled=$8, sso_config=$9
           WHERE tenant_id=$1`,
          [
            tenantId,
            nextName,
            nextPrefs.defaultCountry,
            JSON.stringify(nextPrefs.dateFormatsByCountry),
            JSON.stringify(nextPolicyNumberFormats),
            nextMfaRequired,
            JSON.stringify(nextAiMlConfig),
            nextLocalAuthEnabled,
            JSON.stringify(nextSsoConfig)
          ]
        )
      } else {
        await q(
          `INSERT INTO tenants (tenant_id, name, default_country_code, date_formats_by_country, policy_number_formats_by_product, mfa_required, ai_ml_config, local_auth_enabled, sso_config)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            tenantId,
            nextName,
            nextPrefs.defaultCountry,
            JSON.stringify(nextPrefs.dateFormatsByCountry),
            JSON.stringify(nextPolicyNumberFormats),
            nextMfaRequired,
            JSON.stringify(nextAiMlConfig),
            nextLocalAuthEnabled,
            JSON.stringify(nextSsoConfig)
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
        aiMlConfig: nextAiMlConfig,
        localAuthEnabled: nextLocalAuthEnabled,
        ssoConfig: nextSsoConfig
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
  const companyId = routeParam(req.params.id)
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
  const companyId = routeParam(req.params.id)
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
        const uw = await evaluateUW(tenantId, s.payload)
        seedStep = `insert policy ${productCode}`
        await q('INSERT INTO policies (tenant_id, policy_id, policy_number, product_code, status, term_effective_date, term_expiration_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [tenantId, policyId, policyNumber, productCode, 'Issued', eff, expStr])
        const issueVid = uuidv4()
        seedStep = `insert issue version ${productCode}`
        await q('INSERT INTO policy_versions (tenant_id, policy_id, version_id, effective_date, transaction_type, premium_total, premium_fees, premium_taxes, currency, uw_decision, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',
          [tenantId, policyId, issueVid, eff, 'NB', premium.total?.amount || 0, premium.fees?.amount || 0, premium.taxes?.amount || 0, 'USD', uw.decision, JSON.stringify(s.payload)])
        if (uw.decision === 'Refer') {
          seedStep = 'insert underwriting referral'
          await q(
            `INSERT INTO underwriting_referrals
               (tenant_id, policy_id, version_id, product_code, insured_name, effective_date, transaction_type, status, priority, reasons, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'NewBusiness','Open','Normal',$7,$8)`,
            [
              tenantId,
              policyId,
              issueVid,
              productCode,
              s.payload?.insureds?.primary?.displayName || null,
              eff,
              uw.reasons || [],
              null,
            ]
          )
        }
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

// Seed baseline reference/admin data (underwriting companies, an agency + contact, a forms catalog
// entry, and notification templates) for every product line the tenant has enabled in
// tenants/<id>/config.yaml. Idempotent: safe to re-run — each section checks for an existing row
// on its natural key before creating anything, so it only fills gaps.
const SEED_PRODUCT_LINES: Array<{ code: string; uwCompanyName: string; formNumber: string; formTitle: string }> = [
  { code: 'personal-auto', uwCompanyName: 'Sample Carrier Personal Lines', formNumber: 'PA-DEC', formTitle: 'Personal Auto Declarations' },
  { code: 'homeowners', uwCompanyName: 'Sample Carrier Property', formNumber: 'HO-DEC', formTitle: 'Homeowners Declarations' },
  { code: 'commercial-auto', uwCompanyName: 'Sample Carrier Commercial Lines', formNumber: 'CA-DEC', formTitle: 'Commercial Auto Declarations' },
  { code: 'professional-liability', uwCompanyName: 'Sample Carrier Professional Lines', formNumber: 'PL-DEC', formTitle: 'Professional Liability Declarations' },
  { code: 'cyber', uwCompanyName: 'Sample Carrier Specialty Cyber', formNumber: 'CYB-DEC', formTitle: 'Cyber Liability Declarations' }
]
const SEED_FORM_EDITION_DATE = '2024-01-01'

const SEED_NOTIFICATION_TEMPLATES: Array<{ templateCode: string; eventType: string; subjectTemplate: string; bodyTemplate: string }> = [
  {
    templateCode: 'policy-issued-default',
    eventType: 'POLICY_ISSUED',
    subjectTemplate: 'Policy {{policyNumber}} issued',
    bodyTemplate: 'Policy {{policyNumber}} was issued effective {{effectiveDate}}. Thank you for choosing us.'
  },
  {
    templateCode: 'policy-cancelled-default',
    eventType: 'POLICY_CANCELLED',
    subjectTemplate: 'Policy {{policyNumber}} cancelled',
    bodyTemplate: 'Policy {{policyNumber}} has been cancelled effective {{effectiveDate}}. Reason: {{reason}}.'
  },
  {
    templateCode: 'policy-renewed-default',
    eventType: 'POLICY_RENEWED',
    subjectTemplate: 'Policy {{policyNumber}} renewed',
    bodyTemplate: 'Policy {{policyNumber}} has been renewed for a new term effective {{effectiveDate}}.'
  }
]

adminRoutes.post('/seed-reference-data', requirePermission('admin.security.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = req.user?.username || req.user?.id || 'system'
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Seeding requires DB' })

  const summary = {
    underwritingCompanies: { created: [] as string[], skipped: [] as string[] },
    forms: { created: [] as string[], skipped: [] as string[] },
    notificationTemplates: { created: [] as string[], skipped: [] as string[] },
    agency: { created: false, skipped: false }
  }

  let seedStep = 'start'
  try {
    await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)

      // Product enablement lives in tenants/<id>/config.yaml (file-based), not a DB column, so this
      // seeds every product line the app ships with; disable a line by removing it from
      // SEED_PRODUCT_LINES if a tenant shouldn't get reference data for it.
      for (const line of SEED_PRODUCT_LINES) {
        seedStep = `underwriting company: ${line.code}`
        const existingUw = await q(
          `SELECT 1 FROM underwriting_companies WHERE tenant_id=$1 AND product_code=$2 AND country_code=$3 AND state_code=$4 LIMIT 1`,
          [tenantId, line.code, 'US', 'ALL']
        )
        if ((existingUw as any).rowCount > 0) {
          summary.underwritingCompanies.skipped.push(line.code)
        } else {
          await q(
            `INSERT INTO underwriting_companies (tenant_id, name, product_code, country_code, state_code, active, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,now())`,
            [tenantId, line.uwCompanyName, line.code, 'US', 'ALL', true]
          )
          summary.underwritingCompanies.created.push(line.code)
        }

        seedStep = `form: ${line.formNumber}`
        const existingForm = await q(
          `SELECT form_id FROM forms_admin_forms WHERE tenant_id=$1 AND carrier_code=$2 AND authority=$3 AND form_number=$4 AND edition_date=$5 LIMIT 1`,
          [tenantId, 'SAMPLE', 'ISO', line.formNumber, SEED_FORM_EDITION_DATE]
        )
        if ((existingForm as any).rowCount > 0) {
          summary.forms.skipped.push(line.formNumber)
        } else {
          const inserted = await q(
            `INSERT INTO forms_admin_forms (
                tenant_id, carrier_code, authority, form_number, form_title, edition_date,
                form_type, line_of_business, workflow_status, active, edit_lock, require_approved_jurisdiction,
                metadata, created_by, updated_by, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,now())
             RETURNING form_id`,
            [
              // workflow_status='Approved' + active=true: forms.service.previewForm only attaches
              // forms where both hold (active=true AND workflow_status='Approved'), so a freshly
              // seeded Draft/inactive form silently never attaches to any quote.
              tenantId, 'SAMPLE', 'ISO', line.formNumber, line.formTitle, SEED_FORM_EDITION_DATE,
              'Policy', line.code, 'Approved', true, true, false,
              JSON.stringify({ seedCode: 'seed-reference-data' }), actor, actor
            ]
          )
          const formId = (inserted as any).rows[0].form_id
          await ensureDefaultFormRows(q, tenantId, formId, actor)
          summary.forms.created.push(line.formNumber)
        }
      }

      for (const tmpl of SEED_NOTIFICATION_TEMPLATES) {
        seedStep = `notification template: ${tmpl.templateCode}`
        const existingTemplate = await q(
          `SELECT 1 FROM notification_templates WHERE tenant_id=$1 AND template_code=$2 LIMIT 1`,
          [tenantId, tmpl.templateCode]
        )
        if ((existingTemplate as any).rowCount > 0) {
          summary.notificationTemplates.skipped.push(tmpl.templateCode)
        } else {
          await createNotificationTemplate(db, tenantId, {
            templateCode: tmpl.templateCode,
            eventType: tmpl.eventType,
            channel: 'EMAIL',
            locale: 'en-US',
            subjectTemplate: tmpl.subjectTemplate,
            bodyTemplate: tmpl.bodyTemplate,
            visibility: ['customer'],
            active: true,
            metadata: { seedCode: 'seed-reference-data' }
          }, actor)
          summary.notificationTemplates.created.push(tmpl.templateCode)
        }
      }

      seedStep = 'agency'
      const existingAgency = await q(
        `SELECT agency_id FROM agencies WHERE tenant_id=$1 AND agency_np_number=$2 LIMIT 1`,
        [tenantId, '8675309']
      )
      if ((existingAgency as any).rowCount > 0) {
        summary.agency.skipped = true
      } else {
        const config = await loadOnboardingConfig(q, tenantId)
        await upsertAgencyEntity(q, tenantId, {
          legalName: 'Sample Carrier Agency',
          npn: '8675309',
          feinLast4: '4242',
          agencyType: 'INDEPENDENT',
          status: 'ACTIVE',
          commissionRate: 10,
          contacts: [{
            firstName: 'Jordan',
            lastName: 'Casey',
            email: 'jordan.casey@samplecarrieragency.example',
            phoneNumber: '+1 555 123 4567',
            preferred: true
          }]
        }, {
          actor,
          strategy: 'ALWAYS_CREATE',
          conflictBehavior: 'SKIP',
          canApprove: true,
          config,
          reason: 'SEED_REFERENCE_DATA'
        })
        summary.agency.created = true
      }
    })
    return res.json({ ok: true, summary })
  } catch (e: any) {
    return res.status(500).json({ code: 'SEED_FAILED', message: `${seedStep}: ${String(e?.message || e)}` })
  }
})

// Idempotent conversion of today's hand-coded per-product underwriting
// checks (uw.service.ts's evaluateUwFallback) into real `underwriting_rules`
// rows, so a configured tenant gets the generic rules engine with the exact
// same thresholds/outcomes/reasons the hardcoded code already enforces --
// see evaluateUwRules in uw.service.ts, which this table feeds. A handful
// of today's checks compare two submission fields to each other (e.g.
// commercial-auto's driver/vehicle ratio, professional-liability's
// contract-concentration ratio) or do substring/format matching (e.g.
// personal-auto's "invalid ZIP" and "high-performance symbol" checks)
// rather than comparing one field to a fixed value, so they cannot be
// expressed with this table's single-field-vs-constant rule shape and are
// intentionally left out below -- those specific checks keep running only
// via the hardcoded fallback for a product/tenant that hasn't been
// seeded/configured, and are NOT reproduced once seeding happens for that
// product (seeding is a full handoff to the rules engine, same as a
// published rating workbook fully replaces the hardcoded rater).
const UNDERWRITING_RULE_SEEDS: Array<{
  productCode: string
  fieldPath: string
  operator: string
  comparisonValue: unknown
  outcome: 'Refer' | 'Decline'
  reasonCode: string
  reasonDescription: string
}> = [
  // personal-auto
  { productCode: 'personal-auto', fieldPath: 'uwAnswers.driverAge', operator: 'less_than', comparisonValue: 16, outcome: 'Decline', reasonCode: 'PA-AGE-UNDER-16', reasonDescription: 'Driver age under 16 (decline)' },
  { productCode: 'personal-auto', fieldPath: 'uwAnswers.driverAge', operator: 'less_than', comparisonValue: 18, outcome: 'Refer', reasonCode: 'PA-AGE-UNDER-18', reasonDescription: 'Driver age under 18 (refer)' },
  { productCode: 'personal-auto', fieldPath: 'risks[0].annualMiles', operator: 'greater_than', comparisonValue: 35000, outcome: 'Refer', reasonCode: 'PA-ANNUAL-MILES-35K', reasonDescription: 'Annual miles > 35k (refer)' },
  { productCode: 'personal-auto', fieldPath: 'risks[0].usage', operator: 'in', comparisonValue: ['rideshare', 'commercial'], outcome: 'Refer', reasonCode: 'PA-USAGE-COMMERCIAL', reasonDescription: 'Commercial/rideshare use (refer)' },

  // commercial-auto
  { productCode: 'commercial-auto', fieldPath: 'risks[0].vehicleCount', operator: 'greater_than', comparisonValue: 150, outcome: 'Decline', reasonCode: 'CA-FLEET-150', reasonDescription: 'Fleet size > 150 vehicles (decline)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].vehicleCount', operator: 'greater_than', comparisonValue: 50, outcome: 'Refer', reasonCode: 'CA-FLEET-50', reasonDescription: 'Fleet size > 50 vehicles (refer)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].radiusClass', operator: 'equals', comparisonValue: 'long-haul', outcome: 'Refer', reasonCode: 'CA-RADIUS-LONGHAUL', reasonDescription: 'Long-haul operations (refer)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].vehicleType', operator: 'equals', comparisonValue: 'tractor-trailer', outcome: 'Refer', reasonCode: 'CA-VEHICLE-TRACTOR', reasonDescription: 'Tractor-trailer exposure requires underwriting review (refer)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].vehicleType', operator: 'equals', comparisonValue: 'dump-truck', outcome: 'Refer', reasonCode: 'CA-VEHICLE-HEAVY', reasonDescription: 'Heavy commercial vehicle exposure (refer)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].gvwClass', operator: 'equals', comparisonValue: 'heavy', outcome: 'Refer', reasonCode: 'CA-GVW-HEAVY', reasonDescription: 'Heavy commercial vehicle exposure (refer)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].annualMileage', operator: 'greater_than', comparisonValue: 100000, outcome: 'Refer', reasonCode: 'CA-MILEAGE-100K', reasonDescription: 'Average annual mileage > 100,000 (refer)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].priorLossesCount', operator: 'greater_than_or_equal', comparisonValue: 6, outcome: 'Decline', reasonCode: 'CA-LOSSES-6', reasonDescription: '6+ prior commercial auto losses (decline)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].priorLossesCount', operator: 'greater_than_or_equal', comparisonValue: 3, outcome: 'Refer', reasonCode: 'CA-LOSSES-3', reasonDescription: 'Multiple prior commercial auto losses (refer)' },
  { productCode: 'commercial-auto', fieldPath: 'risks[0].yearsInBusiness', operator: 'less_than', comparisonValue: 1, outcome: 'Refer', reasonCode: 'CA-NEW-VENTURE', reasonDescription: 'New venture < 1 year in business (refer)' },

  // homeowners
  { productCode: 'homeowners', fieldPath: 'risks[0].roofAgeYears', operator: 'greater_than', comparisonValue: 30, outcome: 'Decline', reasonCode: 'HO-ROOF-30', reasonDescription: 'Roof age > 30 (decline)' },
  { productCode: 'homeowners', fieldPath: 'risks[0].roofAgeYears', operator: 'greater_than_or_equal', comparisonValue: 20, outcome: 'Refer', reasonCode: 'HO-ROOF-20-30', reasonDescription: 'Roof age 20-30 (refer)' },
  { productCode: 'homeowners', fieldPath: 'risks[0].protectionClass', operator: 'greater_than_or_equal', comparisonValue: 9, outcome: 'Decline', reasonCode: 'HO-PC-9-10', reasonDescription: 'Protection class 9-10 (decline)' },
  { productCode: 'homeowners', fieldPath: 'risks[0].protectionClass', operator: 'greater_than_or_equal', comparisonValue: 7, outcome: 'Refer', reasonCode: 'HO-PC-7-8', reasonDescription: 'Protection class 7-8 (refer)' },

  // cyber
  { productCode: 'cyber', fieldPath: 'risks[0].priorIncidents', operator: 'greater_than_or_equal', comparisonValue: 3, outcome: 'Decline', reasonCode: 'CYB-INCIDENTS-3', reasonDescription: '3+ prior cyber incidents (decline)' },
  { productCode: 'cyber', fieldPath: 'risks[0].priorIncidents', operator: 'greater_than', comparisonValue: 0, outcome: 'Refer', reasonCode: 'CYB-INCIDENTS-1', reasonDescription: 'Prior cyber incident history (refer)' },
  { productCode: 'cyber', fieldPath: 'risks[0].mfaEnabled', operator: 'is_false', comparisonValue: true, outcome: 'Refer', reasonCode: 'CYB-MFA-NOT-ENABLED', reasonDescription: 'MFA not fully enabled (refer)' },
  { productCode: 'cyber', fieldPath: 'risks[0].backups', operator: 'equals', comparisonValue: 'none', outcome: 'Decline', reasonCode: 'CYB-BACKUPS-NONE', reasonDescription: 'No backup controls declared (decline)' },
  { productCode: 'cyber', fieldPath: 'risks[0].backups', operator: 'equals', comparisonValue: 'monthly', outcome: 'Refer', reasonCode: 'CYB-BACKUPS-MONTHLY', reasonDescription: 'Infrequent backup controls (refer)' },
  { productCode: 'cyber', fieldPath: 'risks[0].annualRevenue', operator: 'greater_than', comparisonValue: 100000000, outcome: 'Refer', reasonCode: 'CYB-REVENUE-100M', reasonDescription: 'Large revenue profile > $100M (refer)' },
  { productCode: 'cyber', fieldPath: 'risks[0].employeeCount', operator: 'greater_than', comparisonValue: 5000, outcome: 'Refer', reasonCode: 'CYB-EMPLOYEES-5000', reasonDescription: 'Large workforce > 5,000 (refer)' },
  { productCode: 'cyber', fieldPath: 'risks[0].recordsCount', operator: 'greater_than', comparisonValue: 5000000, outcome: 'Refer', reasonCode: 'CYB-RECORDS-5M', reasonDescription: 'Very high sensitive records count (refer)' },

  // professional-liability
  { productCode: 'professional-liability', fieldPath: 'risks[0].priorClaimsCount', operator: 'greater_than_or_equal', comparisonValue: 4, outcome: 'Decline', reasonCode: 'PL-CLAIMS-4', reasonDescription: '4+ prior professional liability claims (decline)' },
  { productCode: 'professional-liability', fieldPath: 'risks[0].priorClaimsCount', operator: 'greater_than_or_equal', comparisonValue: 2, outcome: 'Refer', reasonCode: 'PL-CLAIMS-2', reasonDescription: 'Multiple prior professional liability claims (refer)' },
  { productCode: 'professional-liability', fieldPath: 'risks[0].yearsInBusiness', operator: 'less_than', comparisonValue: 1, outcome: 'Refer', reasonCode: 'PL-NEW-VENTURE', reasonDescription: 'Startup or new venture with less than 1 year operations (refer)' },
  { productCode: 'professional-liability', fieldPath: 'risks[0].annualRevenue', operator: 'greater_than', comparisonValue: 50000000, outcome: 'Refer', reasonCode: 'PL-REVENUE-50M', reasonDescription: 'Revenue profile > $50M (refer)' },
  { productCode: 'professional-liability', fieldPath: 'risks[0].subcontractorPct', operator: 'greater_than', comparisonValue: 75, outcome: 'Refer', reasonCode: 'PL-SUBCONTRACTOR-75', reasonDescription: 'Subcontracted work exceeds 75% of revenue (refer)' },
  { productCode: 'professional-liability', fieldPath: 'risks[0].writtenContracts', operator: 'is_false', comparisonValue: true, outcome: 'Refer', reasonCode: 'PL-NO-WRITTEN-CONTRACTS', reasonDescription: 'Written engagement contracts not consistently used (refer)' },
  { productCode: 'professional-liability', fieldPath: 'risks[0].qualityControl', operator: 'equals', comparisonValue: 'limited', outcome: 'Refer', reasonCode: 'PL-QC-LIMITED', reasonDescription: 'Limited QA / peer review controls (refer)' },
  { productCode: 'professional-liability', fieldPath: 'risks[0].retroactiveYears', operator: 'less_than', comparisonValue: 1, outcome: 'Refer', reasonCode: 'PL-NO-RETRO', reasonDescription: 'No prior acts / retroactive coverage history (refer)' },
]

// POST /admin/seed-underwriting-rules
// Idempotent (SELECT-before-INSERT, safe to call repeatedly) conversion of
// evaluateUwFallback's hardcoded per-product checks into real
// underwriting_rules rows for the calling tenant -- see
// UNDERWRITING_RULE_SEEDS above for exactly what is (and isn't) ported, and
// uw.service.ts's evaluateUW for how a configured row takes over from the
// hardcoded fallback once seeded.
//
// Also migrates the legacy tenants/<id>/config.yaml
// `overrides.underwriting.rules` mechanism (the HO-ROOF-AGE override that
// uw.service.ts used to read directly) into a real, tenant-editable row:
// if this tenant's config has that override configured, an equivalent
// 'HO-ROOF-AGE' row is seeded for homeowners. That legacy code path has
// been removed from uw.service.ts entirely -- this is the one-time
// migration of its effect into the new system.
adminRoutes.post('/seed-underwriting-rules', requirePermission('admin.underwriting_rules.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = req.user?.username || req.user?.id || 'system'
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Seeding requires DB' })

  const seeds = [...UNDERWRITING_RULE_SEEDS]
  try {
    const tenantCfg = loadTenantOverrides(tenantId)
    const legacyRules = tenantCfg?.overrides?.underwriting?.rules || []
    for (const legacyRule of legacyRules) {
      if (legacyRule?.id === 'HO-ROOF-AGE') {
        seeds.push({
          productCode: 'homeowners',
          fieldPath: 'risks[0].roofAgeYears',
          operator: 'greater_than',
          comparisonValue: 25,
          outcome: 'Refer',
          reasonCode: 'HO-ROOF-AGE',
          reasonDescription: 'Roof age > 25 (refer)',
        })
      }
    }
  } catch {
    // No tenant config / override present -- nothing extra to migrate.
  }

  const summary = { created: [] as string[], skipped: [] as string[] }
  await withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)
    for (const seed of seeds) {
      const existing = await q(
        `SELECT 1 FROM underwriting_rules WHERE tenant_id=$1 AND product_code=$2 AND reason_code=$3 LIMIT 1`,
        [tenantId, seed.productCode, seed.reasonCode]
      )
      if ((existing as any).rowCount > 0) {
        summary.skipped.push(seed.reasonCode)
        continue
      }
      await q(
        `INSERT INTO underwriting_rules
           (tenant_id, product_code, state_code, field_path, operator, comparison_value, outcome,
            reason_code, reason_description, active, effective_date, created_by, updated_by)
         VALUES ($1,$2,NULL,$3,$4,$5::jsonb,$6,$7,$8,true,CURRENT_DATE,$9,$9)`,
        [
          tenantId, seed.productCode, seed.fieldPath, seed.operator, JSON.stringify(seed.comparisonValue),
          seed.outcome, seed.reasonCode, seed.reasonDescription, actor,
        ]
      )
      summary.created.push(seed.reasonCode)
    }
  })

  return res.json({ ok: true, summary })
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
