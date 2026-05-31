import { getDb, withTenantTx, toRawQuery } from '../db.js'

export type PermissionDefinition = {
  permissionCode: string
  scope: 'menu' | 'page' | 'api'
  resourceKey: string
  actionKey: 'view' | 'read' | 'manage' | 'approve' | 'decide' | 'access'
  label: string
  description: string
  sortOrder: number
}

export type RoleDefinition = {
  roleCode: string
  roleName: string
  description: string
  isSystem: boolean
  active: boolean
  permissionCodes: string[]
  userCount?: number
  createdAt?: string | null
  updatedAt?: string | null
}

export type SecurityRoleRelationship = {
  roleCode: string
  roleName: string
  active: boolean
  isSystem: boolean
  userCount: number
  permissionCount: number
  menuPermissionCount: number
  pagePermissionCount: number
  apiPermissionCount: number
  permissionCodes: string[]
}

export type SecurityUserRelationship = {
  userId: string
  username: string
  disabled: boolean
  roleCodes: string[]
  permissionCodes: string[]
  permissionCount: number
  menuPermissionCount: number
  pagePermissionCount: number
  apiPermissionCount: number
}

export type SecurityRelationshipMap = {
  generatedAt: string
  permissionCatalog: PermissionDefinition[]
  roleMappings: SecurityRoleRelationship[]
  userMappings: SecurityUserRelationship[]
}

const PERMISSION_CATALOG: PermissionDefinition[] = [
  { permissionCode: 'menu.search.view', scope: 'menu', resourceKey: 'search', actionKey: 'view', label: 'Menu: Search', description: 'View Search menu entry', sortOrder: 10 },
  { permissionCode: 'menu.portal.view', scope: 'menu', resourceKey: 'portal', actionKey: 'view', label: 'Menu: Customer Portal', description: 'View customer portal menu entry', sortOrder: 12 },
  { permissionCode: 'menu.rating.view', scope: 'menu', resourceKey: 'rating', actionKey: 'view', label: 'Menu: Rating', description: 'View Rating workbench menu entry', sortOrder: 15 },
  { permissionCode: 'menu.uw_queue.view', scope: 'menu', resourceKey: 'uw_queue', actionKey: 'view', label: 'Menu: UW Queue', description: 'View UW Queue menu entry', sortOrder: 20 },
  { permissionCode: 'menu.admin.view', scope: 'menu', resourceKey: 'admin', actionKey: 'view', label: 'Menu: Administration', description: 'View Administration menu entry', sortOrder: 30 },
  { permissionCode: 'menu.admin.forms.view', scope: 'menu', resourceKey: 'admin.forms', actionKey: 'view', label: 'Admin Menu: Forms', description: 'View Forms section in Administration', sortOrder: 31 },
  { permissionCode: 'menu.admin.uw_company.view', scope: 'menu', resourceKey: 'admin.uw_company', actionKey: 'view', label: 'Admin Menu: UW Company', description: 'View UW Company section in Administration', sortOrder: 32 },
  { permissionCode: 'menu.admin.users.view', scope: 'menu', resourceKey: 'admin.users', actionKey: 'view', label: 'Admin Menu: Users', description: 'View Users section in Administration', sortOrder: 33 },
  { permissionCode: 'menu.admin.tenant.view', scope: 'menu', resourceKey: 'admin.tenant', actionKey: 'view', label: 'Admin Menu: Tenant', description: 'View Tenant section in Administration', sortOrder: 34 },
  { permissionCode: 'menu.admin.security.view', scope: 'menu', resourceKey: 'admin.security', actionKey: 'view', label: 'Admin Menu: Security', description: 'View Security section in Administration', sortOrder: 35 },
  { permissionCode: 'menu.admin.customers.view', scope: 'menu', resourceKey: 'admin.customers', actionKey: 'view', label: 'Admin Menu: Customers', description: 'View Customers section in Administration', sortOrder: 36 },
  { permissionCode: 'menu.admin.onboarding.view', scope: 'menu', resourceKey: 'admin.onboarding', actionKey: 'view', label: 'Admin Menu: Agency Onboarding', description: 'View agency and broker onboarding section in Administration', sortOrder: 37 },

  { permissionCode: 'page.search.view', scope: 'page', resourceKey: 'search', actionKey: 'view', label: 'Page: Search', description: 'Access Search page', sortOrder: 110 },
  { permissionCode: 'page.portal.view', scope: 'page', resourceKey: 'portal', actionKey: 'view', label: 'Page: Customer Portal', description: 'Access customer portal page', sortOrder: 112 },
  { permissionCode: 'page.rating.view', scope: 'page', resourceKey: 'rating', actionKey: 'view', label: 'Page: Rating Workbench', description: 'Access actuary rating model workbench page', sortOrder: 115 },
  { permissionCode: 'page.wizard.view', scope: 'page', resourceKey: 'wizard', actionKey: 'view', label: 'Page: Quote/Transaction Wizard', description: 'Access Quote and transaction wizard pages', sortOrder: 120 },
  { permissionCode: 'page.policy.view', scope: 'page', resourceKey: 'policy', actionKey: 'view', label: 'Page: Policy View', description: 'Access policy detail and timeline pages', sortOrder: 130 },
  { permissionCode: 'page.uw_queue.view', scope: 'page', resourceKey: 'uw_queue', actionKey: 'view', label: 'Page: UW Queue', description: 'Access underwriting queue page', sortOrder: 140 },
  { permissionCode: 'page.admin.forms.view', scope: 'page', resourceKey: 'admin.forms', actionKey: 'view', label: 'Page: Admin Forms', description: 'Access forms administration page', sortOrder: 150 },
  { permissionCode: 'page.admin.uw_company.view', scope: 'page', resourceKey: 'admin.uw_company', actionKey: 'view', label: 'Page: Admin UW Company', description: 'Access underwriting company administration page', sortOrder: 160 },
  { permissionCode: 'page.admin.users.view', scope: 'page', resourceKey: 'admin.users', actionKey: 'view', label: 'Page: Admin Users', description: 'Access user administration page', sortOrder: 170 },
  { permissionCode: 'page.admin.tenant.view', scope: 'page', resourceKey: 'admin.tenant', actionKey: 'view', label: 'Page: Admin Tenant', description: 'Access tenant administration page', sortOrder: 180 },
  { permissionCode: 'page.admin.security.view', scope: 'page', resourceKey: 'admin.security', actionKey: 'view', label: 'Page: Admin Security', description: 'Access role and permission administration page', sortOrder: 190 },
  { permissionCode: 'page.admin.customers.view', scope: 'page', resourceKey: 'admin.customers', actionKey: 'view', label: 'Page: Admin Customers', description: 'Access customer administration page', sortOrder: 200 },
  { permissionCode: 'page.admin.onboarding.view', scope: 'page', resourceKey: 'admin.onboarding', actionKey: 'view', label: 'Page: Admin Agency Onboarding', description: 'Access agency and broker onboarding administration page', sortOrder: 210 },

  { permissionCode: 'admin.forms.read', scope: 'api', resourceKey: 'admin.forms', actionKey: 'read', label: 'Admin API: Forms Read', description: 'Read forms administration data', sortOrder: 210 },
  { permissionCode: 'admin.forms.manage', scope: 'api', resourceKey: 'admin.forms', actionKey: 'manage', label: 'Admin API: Forms Manage', description: 'Create and edit forms administration data', sortOrder: 220 },
  { permissionCode: 'admin.forms.approve', scope: 'api', resourceKey: 'admin.forms', actionKey: 'approve', label: 'Admin API: Forms Approve', description: 'Approve/activate forms in compliance workflow', sortOrder: 230 },
  { permissionCode: 'admin.uw_company.read', scope: 'api', resourceKey: 'admin.uw_company', actionKey: 'read', label: 'Admin API: UW Company Read', description: 'Read underwriting company configuration', sortOrder: 240 },
  { permissionCode: 'admin.uw_company.manage', scope: 'api', resourceKey: 'admin.uw_company', actionKey: 'manage', label: 'Admin API: UW Company Manage', description: 'Create and edit underwriting company configuration', sortOrder: 250 },
  { permissionCode: 'admin.users.read', scope: 'api', resourceKey: 'admin.users', actionKey: 'read', label: 'Admin API: Users Read', description: 'Read tenant users', sortOrder: 260 },
  { permissionCode: 'admin.users.manage', scope: 'api', resourceKey: 'admin.users', actionKey: 'manage', label: 'Admin API: Users Manage', description: 'Create and manage tenant users', sortOrder: 270 },
  { permissionCode: 'admin.tenant.read', scope: 'api', resourceKey: 'admin.tenant', actionKey: 'read', label: 'Admin API: Tenant Read', description: 'Read tenant settings', sortOrder: 280 },
  { permissionCode: 'admin.tenant.manage', scope: 'api', resourceKey: 'admin.tenant', actionKey: 'manage', label: 'Admin API: Tenant Manage', description: 'Update tenant settings', sortOrder: 290 },
  { permissionCode: 'admin.security.read', scope: 'api', resourceKey: 'admin.security', actionKey: 'read', label: 'Admin API: Security Read', description: 'Read roles and permissions', sortOrder: 300 },
  { permissionCode: 'admin.security.manage', scope: 'api', resourceKey: 'admin.security', actionKey: 'manage', label: 'Admin API: Security Manage', description: 'Create/edit roles and permission mappings', sortOrder: 310 },
  { permissionCode: 'uw.referrals.read', scope: 'api', resourceKey: 'uw.referrals', actionKey: 'read', label: 'UW API: Referrals Read', description: 'Read underwriting referrals', sortOrder: 320 },
  { permissionCode: 'uw.referrals.decide', scope: 'api', resourceKey: 'uw.referrals', actionKey: 'decide', label: 'UW API: Referrals Decide', description: 'Approve/decline underwriting referrals', sortOrder: 330 },
  { permissionCode: 'admin.customers.read', scope: 'api', resourceKey: 'admin.customers', actionKey: 'read', label: 'Admin API: Customers Read', description: 'Read and search customer records', sortOrder: 340 },
  { permissionCode: 'admin.customers.manage', scope: 'api', resourceKey: 'admin.customers', actionKey: 'manage', label: 'Admin API: Customers Manage', description: 'Create and update customer records', sortOrder: 350 },
  { permissionCode: 'admin.customers.contact.manage', scope: 'api', resourceKey: 'admin.customers.contact', actionKey: 'manage', label: 'Admin API: Customers Contact Manage', description: 'Update customer contact and address fields', sortOrder: 360 },
  { permissionCode: 'admin.customers.approve', scope: 'api', resourceKey: 'admin.customers', actionKey: 'approve', label: 'Admin API: Customers Approve', description: 'Approve pending customer workflows', sortOrder: 370 },
  { permissionCode: 'admin.customers.merge', scope: 'api', resourceKey: 'admin.customers', actionKey: 'manage', label: 'Admin API: Customers Merge', description: 'Merge duplicate customer records', sortOrder: 380 },
  { permissionCode: 'admin.customers.deactivate', scope: 'api', resourceKey: 'admin.customers', actionKey: 'manage', label: 'Admin API: Customers Deactivate', description: 'Deactivate and reactivate customers', sortOrder: 390 },
  { permissionCode: 'admin.customers.import', scope: 'api', resourceKey: 'admin.customers', actionKey: 'manage', label: 'Admin API: Customers Import', description: 'Import customer payloads with idempotency', sortOrder: 400 },
  { permissionCode: 'admin.customers.export', scope: 'api', resourceKey: 'admin.customers', actionKey: 'read', label: 'Admin API: Customers Export', description: 'Export customer canonical payload', sortOrder: 410 },
  { permissionCode: 'admin.customers.pii_reveal', scope: 'api', resourceKey: 'admin.customers', actionKey: 'read', label: 'Admin API: Customers PII Reveal', description: 'Reveal masked PII with justification', sortOrder: 420 },
  { permissionCode: 'admin.onboarding.read', scope: 'api', resourceKey: 'admin.onboarding', actionKey: 'read', label: 'Admin API: Onboarding Read', description: 'Read onboarding settings, jobs, history, and audit', sortOrder: 430 },
  { permissionCode: 'admin.onboarding.manage', scope: 'api', resourceKey: 'admin.onboarding', actionKey: 'manage', label: 'Admin API: Onboarding Manage', description: 'Manage onboarding jobs and commit staged records', sortOrder: 440 },
  { permissionCode: 'admin.onboarding.upload', scope: 'api', resourceKey: 'admin.onboarding', actionKey: 'manage', label: 'Admin API: Onboarding Upload', description: 'Upload onboarding files for parsing and staging', sortOrder: 450 },
  { permissionCode: 'admin.onboarding.service', scope: 'api', resourceKey: 'admin.onboarding', actionKey: 'manage', label: 'Admin API: Onboarding Service', description: 'Run onboarding service integrations', sortOrder: 460 },
  { permissionCode: 'admin.onboarding.approve', scope: 'api', resourceKey: 'admin.onboarding', actionKey: 'approve', label: 'Admin API: Onboarding Approve', description: 'Approve sensitive onboarding changes and overrides', sortOrder: 470 }
  ,
  { permissionCode: 'rating.models.read', scope: 'api', resourceKey: 'rating.models', actionKey: 'read', label: 'Rating API: Models Read', description: 'Read rating workbook models and published versions', sortOrder: 480 },
  { permissionCode: 'rating.models.manage', scope: 'api', resourceKey: 'rating.models', actionKey: 'manage', label: 'Rating API: Models Manage', description: 'Import and manage rating workbook versions', sortOrder: 490 },
  { permissionCode: 'rating.models.publish', scope: 'api', resourceKey: 'rating.models', actionKey: 'approve', label: 'Rating API: Models Publish', description: 'Publish/activate rating workbook versions', sortOrder: 500 },
  { permissionCode: 'customer.portal.read', scope: 'api', resourceKey: 'customer.portal', actionKey: 'read', label: 'Customer Portal API: Read', description: 'Read own customer portal policies, declarations, and ID cards', sortOrder: 510 }
]

type RoleSeed = {
  roleCode: string
  roleName: string
  description: string
  isSystem: boolean
  permissionCodes: string[]
}

const ALL_PERMISSION_CODES = PERMISSION_CATALOG.map((x) => x.permissionCode)

const DEFAULT_ROLE_SEEDS: RoleSeed[] = [
  {
    roleCode: 'admin',
    roleName: 'Administrator',
    description: 'Full tenant administration access',
    isSystem: true,
    permissionCodes: [...ALL_PERMISSION_CODES]
  },
  {
    roleCode: 'agent',
    roleName: 'Agent',
    description: 'Quote, bind, issue, and policy search access',
    isSystem: true,
    permissionCodes: ['menu.search.view', 'page.search.view', 'page.wizard.view', 'page.policy.view']
  },
  {
    roleCode: 'underwriter',
    roleName: 'Underwriter',
    description: 'Agent access plus underwriting queue and referral decisions',
    isSystem: true,
    permissionCodes: [
      'menu.search.view',
      'menu.uw_queue.view',
      'page.search.view',
      'page.wizard.view',
      'page.policy.view',
      'page.uw_queue.view',
      'uw.referrals.read',
      'uw.referrals.decide'
    ]
  },
  {
    roleCode: 'customer',
    roleName: 'Customer',
    description: 'End customer portal access for linked customer policies only',
    isSystem: true,
    permissionCodes: [
      'menu.portal.view',
      'page.portal.view',
      'customer.portal.read'
    ]
  },
  {
    roleCode: 'actuary',
    roleName: 'Actuary',
    description: 'Manages actuarial rating models, versions, and publishing',
    isSystem: true,
    permissionCodes: [
      'menu.rating.view',
      'page.rating.view',
      'rating.models.read',
      'rating.models.manage',
      'rating.models.publish'
    ]
  },
  {
    roleCode: 'forms_admin',
    roleName: 'Forms Administrator',
    description: 'Manages forms and form configuration',
    isSystem: true,
    permissionCodes: [
      'menu.admin.view',
      'menu.admin.forms.view',
      'page.admin.forms.view',
      'admin.forms.read',
      'admin.forms.manage'
    ]
  },
  {
    roleCode: 'compliance_admin',
    roleName: 'Compliance Administrator',
    description: 'Approves and activates form filings',
    isSystem: true,
    permissionCodes: [
      'menu.admin.view',
      'menu.admin.forms.view',
      'page.admin.forms.view',
      'admin.forms.read',
      'admin.forms.manage',
      'admin.forms.approve'
    ]
  },
  {
    roleCode: 'security_admin',
    roleName: 'Security Administrator',
    description: 'Manages roles, permissions, and user access',
    isSystem: true,
    permissionCodes: [
      'menu.admin.view',
      'menu.admin.security.view',
      'menu.admin.customers.view',
      'menu.admin.users.view',
      'page.admin.security.view',
      'page.admin.customers.view',
      'page.admin.users.view',
      'admin.security.read',
      'admin.security.manage',
      'admin.users.read',
      'admin.users.manage'
    ]
  },
  {
    roleCode: 'customer_admin',
    roleName: 'Customer Administrator',
    description: 'Manages customer entity lifecycle and merges',
    isSystem: true,
    permissionCodes: [
      'menu.search.view',
      'menu.admin.view',
      'menu.admin.customers.view',
      'page.search.view',
      'page.policy.view',
      'page.admin.customers.view',
      'admin.customers.read',
      'admin.customers.manage',
      'admin.customers.approve',
      'admin.customers.merge',
      'admin.customers.deactivate',
      'admin.customers.import',
      'admin.customers.export'
    ]
  },
  {
    roleCode: 'customer_service',
    roleName: 'Customer Service',
    description: 'Maintains customer contact details and notes',
    isSystem: true,
    permissionCodes: [
      'menu.search.view',
      'menu.admin.view',
      'menu.admin.customers.view',
      'page.search.view',
      'page.policy.view',
      'page.admin.customers.view',
      'admin.customers.read',
      'admin.customers.contact.manage',
      'admin.customers.export'
    ]
  },
  {
    roleCode: 'restricted_pii',
    roleName: 'Restricted PII Access',
    description: 'Can reveal masked SSN/FEIN/DOB with justification',
    isSystem: true,
    permissionCodes: [
      'menu.admin.view',
      'menu.admin.customers.view',
      'page.admin.customers.view',
      'admin.customers.read',
      'admin.customers.pii_reveal'
    ]
  },
  {
    roleCode: 'onboarding_admin',
    roleName: 'Onboarding Administrator',
    description: 'Manages agency and broker onboarding intake and commits',
    isSystem: true,
    permissionCodes: [
      'menu.admin.view',
      'menu.admin.onboarding.view',
      'page.admin.onboarding.view',
      'admin.onboarding.read',
      'admin.onboarding.manage',
      'admin.onboarding.upload',
      'admin.onboarding.service'
    ]
  },
  {
    roleCode: 'read_only',
    roleName: 'Read Only',
    description: 'Read-only access to search and policy pages',
    isSystem: true,
    permissionCodes: ['menu.search.view', 'page.search.view', 'page.policy.view']
  }
]

const defaultRoleMap = new Map(DEFAULT_ROLE_SEEDS.map((x) => [x.roleCode, x]))
const seededTenants = new Set<string>()

type MemoryRole = RoleDefinition
const memoryRolesByTenant = new Map<string, Map<string, MemoryRole>>()

function normalizeRoleCode(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '')
}

function normalizeText(value: any): string {
  return String(value || '').trim()
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function sortedCodes(values: string[]): string[] {
  return dedupe(values).sort((a, b) => a.localeCompare(b))
}

function summarizePermissionScopes(
  permissionCodes: string[],
  permissionScopeByCode: Map<string, PermissionDefinition['scope']>
): { menu: number; page: number; api: number } {
  const counts = { menu: 0, page: 0, api: 0 }
  for (const code of permissionCodes || []) {
    const scope = permissionScopeByCode.get(code)
    if (scope === 'menu') counts.menu += 1
    else if (scope === 'page') counts.page += 1
    else counts.api += 1
  }
  return counts
}

function ensureMemoryTenant(tenantId: string) {
  if (memoryRolesByTenant.has(tenantId)) return
  const next = new Map<string, MemoryRole>()
  for (const role of DEFAULT_ROLE_SEEDS) {
    next.set(role.roleCode, {
      roleCode: role.roleCode,
      roleName: role.roleName,
      description: role.description,
      isSystem: role.isSystem,
      active: true,
      permissionCodes: sortedCodes(role.permissionCodes),
      userCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  }
  memoryRolesByTenant.set(tenantId, next)
}

function validatePermissionCodes(permissionCodes: string[]): { valid: string[]; invalid: string[] } {
  const allowed = new Set(ALL_PERMISSION_CODES)
  const valid: string[] = []
  const invalid: string[] = []
  for (const code of sortedCodes(permissionCodes)) {
    if (allowed.has(code)) valid.push(code)
    else invalid.push(code)
  }
  return { valid, invalid }
}

export function getPermissionCatalog(): PermissionDefinition[] {
  return [...PERMISSION_CATALOG].sort((a, b) => a.sortOrder - b.sortOrder || a.permissionCode.localeCompare(b.permissionCode))
}

export function getDefaultPermissionCodesForRoles(roles: string[]): string[] {
  const normalized = dedupe((roles || []).map(normalizeRoleCode))
  if (normalized.includes('admin')) return [...ALL_PERMISSION_CODES]
  const next = new Set<string>()
  for (const roleCode of normalized) {
    const role = defaultRoleMap.get(roleCode)
    if (!role) continue
    for (const code of role.permissionCodes) next.add(code)
  }
  return sortedCodes(Array.from(next))
}

export async function ensureTenantRbacDefaults(tenantId: string): Promise<void> {
  const db = getDb()
  if (!db) {
    ensureMemoryTenant(tenantId)
    return
  }
  if (seededTenants.has(tenantId)) return
  await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    for (const permission of PERMISSION_CATALOG) {
      await q(
        `INSERT INTO rbac_permissions (
          permission_code, scope, resource_key, action_key, label, description, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (permission_code) DO NOTHING`,
        [
          permission.permissionCode,
          permission.scope,
          permission.resourceKey,
          permission.actionKey,
          permission.label,
          permission.description,
          permission.sortOrder
        ]
      )
    }

    const legacyRolesResult = await q(
      `SELECT DISTINCT ur.role_code
         FROM user_roles ur
         JOIN users u ON u.user_id = ur.user_id
        WHERE u.tenant_id = $1`,
      [tenantId]
    )
    const legacyRoleCodes = ((legacyRolesResult as any).rows || [])
      .map((x: any) => normalizeRoleCode(x.role_code))
      .filter(Boolean)
    for (const roleCode of legacyRoleCodes) {
      const seed = defaultRoleMap.get(roleCode)
      const roleName = seed?.roleName || roleCode.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase())
      const description = seed?.description || 'Custom role'
      const isSystem = !!seed?.isSystem
      await q(
        `INSERT INTO rbac_roles (
          tenant_id, role_code, role_name, description, is_system, active, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,true,now(),now())
        ON CONFLICT (tenant_id, role_code) DO NOTHING`,
        [tenantId, roleCode, roleName, description, isSystem]
      )
    }

    for (const role of DEFAULT_ROLE_SEEDS) {
      await q(
        `INSERT INTO rbac_roles (
          tenant_id, role_code, role_name, description, is_system, active, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,true,now(),now())
        ON CONFLICT (tenant_id, role_code) DO NOTHING`,
        [tenantId, role.roleCode, role.roleName, role.description, role.isSystem]
      )

      const countRes = await q(
        `SELECT COUNT(*)::int AS count
           FROM rbac_role_permissions
          WHERE tenant_id = $1 AND role_code = $2`,
        [tenantId, role.roleCode]
      )
      const existingCount = Number((countRes as any).rows?.[0]?.count || 0)
      if (existingCount > 0) continue
      for (const code of role.permissionCodes) {
        await q(
          `INSERT INTO rbac_role_permissions (
            tenant_id, role_code, permission_code, created_at, created_by
          ) VALUES ($1,$2,$3,now(),$4)
          ON CONFLICT (tenant_id, role_code, permission_code) DO NOTHING`,
          [tenantId, role.roleCode, code, 'system']
        )
      }
    }
  })
  seededTenants.add(tenantId)
}

export async function resolvePermissionsForRoles(tenantId: string, roles: string[]): Promise<string[]> {
  const normalizedRoles = dedupe((roles || []).map(normalizeRoleCode))
  if (!normalizedRoles.length) return []
  const db = getDb()
  if (!db) {
    ensureMemoryTenant(tenantId)
    const tenantRoles = memoryRolesByTenant.get(tenantId)!
    const next = new Set<string>()
    for (const roleCode of normalizedRoles) {
      const role = tenantRoles.get(roleCode)
      if (!role || role.active === false) continue
      for (const code of role.permissionCodes || []) next.add(code)
    }
    return sortedCodes(Array.from(next))
  }

  await ensureTenantRbacDefaults(tenantId)
  const rows = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    return q(
      `SELECT DISTINCT rp.permission_code
         FROM rbac_role_permissions rp
         JOIN rbac_roles r
           ON r.tenant_id = rp.tenant_id
          AND r.role_code = rp.role_code
        WHERE rp.tenant_id = $1
          AND rp.role_code = ANY($2)
          AND r.active = true`,
      [tenantId, normalizedRoles]
    )
  })
  const fromDb = ((rows as any).rows || []).map((x: any) => String(x.permission_code || '')).filter(Boolean)
  if (normalizedRoles.includes('admin') && !fromDb.length) return [...ALL_PERMISSION_CODES]
  return sortedCodes(fromDb)
}

export async function listRolesWithPermissions(tenantId: string): Promise<RoleDefinition[]> {
  const db = getDb()
  if (!db) {
    ensureMemoryTenant(tenantId)
    return Array.from(memoryRolesByTenant.get(tenantId)!.values())
      .sort((a, b) => a.roleCode.localeCompare(b.roleCode))
      .map((x) => ({ ...x, permissionCodes: sortedCodes(x.permissionCodes || []) }))
  }
  await ensureTenantRbacDefaults(tenantId)
  const result = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    return q(
      `SELECT
         r.role_code,
         r.role_name,
         r.description,
         r.is_system,
         r.active,
         r.created_at,
         r.updated_at,
         COALESCE(
           array_agg(rp.permission_code ORDER BY p.sort_order, rp.permission_code)
             FILTER (WHERE rp.permission_code IS NOT NULL),
           ARRAY[]::text[]
         ) AS permission_codes,
         COALESCE(uc.user_count, 0)::int AS user_count
       FROM rbac_roles r
       LEFT JOIN rbac_role_permissions rp
         ON rp.tenant_id = r.tenant_id AND rp.role_code = r.role_code
       LEFT JOIN rbac_permissions p
         ON p.permission_code = rp.permission_code
       LEFT JOIN (
         SELECT u.tenant_id, ur.role_code, COUNT(*)::int AS user_count
           FROM user_roles ur
           JOIN users u ON u.user_id = ur.user_id
          WHERE u.tenant_id = $1
          GROUP BY u.tenant_id, ur.role_code
       ) uc ON uc.tenant_id = r.tenant_id AND uc.role_code = r.role_code
      WHERE r.tenant_id = $1
      GROUP BY r.role_code, r.role_name, r.description, r.is_system, r.active, r.created_at, r.updated_at, uc.user_count
      ORDER BY r.role_code`,
      [tenantId]
    )
  })
  return ((result as any).rows || []).map((row: any) => ({
    roleCode: row.role_code,
    roleName: row.role_name,
    description: row.description || '',
    isSystem: !!row.is_system,
    active: !!row.active,
    permissionCodes: sortedCodes((row.permission_codes || []).map((x: any) => String(x))),
    userCount: Number(row.user_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }))
}

export async function listPermissionCatalog(_tenantId: string): Promise<PermissionDefinition[]> {
  return getPermissionCatalog()
}

export async function listSecurityRelationshipMap(tenantId: string): Promise<SecurityRelationshipMap> {
  const permissionCatalog = getPermissionCatalog()
  const permissionScopeByCode = new Map<string, PermissionDefinition['scope']>(
    permissionCatalog.map((permission) => [permission.permissionCode, permission.scope])
  )
  const db = getDb()

  if (!db) {
    ensureMemoryTenant(tenantId)
    const tenantRoles = Array.from(memoryRolesByTenant.get(tenantId)!.values())
      .sort((a, b) => a.roleCode.localeCompare(b.roleCode))
    const demoUsers = [
      { userId: 'demo-admin', username: 'admin', disabled: false, roleCodes: ['admin'] },
      { userId: 'demo-agent1', username: 'agent1', disabled: false, roleCodes: ['agent'] },
      { userId: 'demo-uw1', username: 'uw1', disabled: false, roleCodes: ['underwriter'] }
    ]

    const userMappings: SecurityUserRelationship[] = demoUsers.map((user) => {
      const permissionCodes = sortedCodes(getDefaultPermissionCodesForRoles(user.roleCodes))
      const counts = summarizePermissionScopes(permissionCodes, permissionScopeByCode)
      return {
        userId: user.userId,
        username: user.username,
        disabled: !!user.disabled,
        roleCodes: sortedCodes(user.roleCodes),
        permissionCodes,
        permissionCount: permissionCodes.length,
        menuPermissionCount: counts.menu,
        pagePermissionCount: counts.page,
        apiPermissionCount: counts.api
      }
    })

    const roleMappings: SecurityRoleRelationship[] = tenantRoles.map((role) => {
      const permissionCodes = sortedCodes(role.permissionCodes || [])
      const counts = summarizePermissionScopes(permissionCodes, permissionScopeByCode)
      const userCount = userMappings.filter((user) => user.roleCodes.includes(role.roleCode)).length
      return {
        roleCode: role.roleCode,
        roleName: role.roleName,
        active: role.active !== false,
        isSystem: !!role.isSystem,
        userCount,
        permissionCount: permissionCodes.length,
        menuPermissionCount: counts.menu,
        pagePermissionCount: counts.page,
        apiPermissionCount: counts.api,
        permissionCodes
      }
    })

    return {
      generatedAt: new Date().toISOString(),
      permissionCatalog,
      roleMappings,
      userMappings
    }
  }

  await ensureTenantRbacDefaults(tenantId)
  const roles = await listRolesWithPermissions(tenantId)
  const usersResult = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    return q(
      `SELECT
         u.user_id,
         u.username,
         u.disabled,
         COALESCE(
           array_agg(DISTINCT ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL),
           ARRAY[]::text[]
         ) AS role_codes,
         COALESCE(
           array_agg(DISTINCT rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),
           ARRAY[]::text[]
         ) AS permission_codes
       FROM users u
       LEFT JOIN user_roles ur
         ON ur.user_id = u.user_id
       LEFT JOIN rbac_roles rr
         ON rr.tenant_id = u.tenant_id
        AND rr.role_code = ur.role_code
        AND rr.active = true
       LEFT JOIN rbac_role_permissions rp
         ON rp.tenant_id = rr.tenant_id
        AND rp.role_code = rr.role_code
      WHERE u.tenant_id = $1
      GROUP BY u.user_id, u.username, u.disabled
      ORDER BY u.username ASC`,
      [tenantId]
    )
  })

  const userMappings: SecurityUserRelationship[] = ((usersResult as any).rows || []).map((row: any) => {
    const roleCodes = sortedCodes((row.role_codes || []).map((x: any) => String(x)))
    const permissionCodes = sortedCodes((row.permission_codes || []).map((x: any) => String(x)))
    const counts = summarizePermissionScopes(permissionCodes, permissionScopeByCode)
    return {
      userId: String(row.user_id),
      username: String(row.username || ''),
      disabled: !!row.disabled,
      roleCodes,
      permissionCodes,
      permissionCount: permissionCodes.length,
      menuPermissionCount: counts.menu,
      pagePermissionCount: counts.page,
      apiPermissionCount: counts.api
    }
  })

  const roleMappings: SecurityRoleRelationship[] = roles.map((role) => {
    const permissionCodes = sortedCodes(role.permissionCodes || [])
    const counts = summarizePermissionScopes(permissionCodes, permissionScopeByCode)
    const userCount = userMappings.filter((user) => user.roleCodes.includes(role.roleCode)).length
    return {
      roleCode: role.roleCode,
      roleName: role.roleName,
      active: role.active !== false,
      isSystem: !!role.isSystem,
      userCount,
      permissionCount: permissionCodes.length,
      menuPermissionCount: counts.menu,
      pagePermissionCount: counts.page,
      apiPermissionCount: counts.api,
      permissionCodes
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    permissionCatalog,
    roleMappings,
    userMappings
  }
}

export async function createRole(
  tenantId: string,
  payload: { roleCode: string; roleName: string; description?: string; active?: boolean; permissionCodes?: string[] },
  actor: string
): Promise<RoleDefinition> {
  const roleCode = normalizeRoleCode(payload.roleCode)
  const roleName = normalizeText(payload.roleName)
  const description = normalizeText(payload.description || '')
  const active = payload.active !== false
  if (!roleCode || !roleName) {
    throw new Error('INVALID_INPUT')
  }
  const { valid, invalid } = validatePermissionCodes(payload.permissionCodes || [])
  if (invalid.length) {
    throw new Error(`INVALID_PERMISSIONS:${invalid.join(',')}`)
  }

  const db = getDb()
  if (!db) {
    ensureMemoryTenant(tenantId)
    const map = memoryRolesByTenant.get(tenantId)!
    if (map.has(roleCode)) throw new Error('ROLE_EXISTS')
    const now = new Date().toISOString()
    const next: RoleDefinition = {
      roleCode,
      roleName,
      description,
      isSystem: false,
      active,
      permissionCodes: sortedCodes(valid),
      userCount: 0,
      createdAt: now,
      updatedAt: now
    }
    map.set(roleCode, next)
    return next
  }

  await ensureTenantRbacDefaults(tenantId)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const inserted = await q(
      `INSERT INTO rbac_roles (
        tenant_id, role_code, role_name, description, is_system, active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,false,$5,now(),now())
      ON CONFLICT (tenant_id, role_code) DO NOTHING
      RETURNING role_code, role_name, description, is_system, active, created_at, updated_at`,
      [tenantId, roleCode, roleName, description || null, active]
    )
    if (!((inserted as any).rowCount > 0)) throw new Error('ROLE_EXISTS')
    for (const code of valid) {
      await q(
        `INSERT INTO rbac_role_permissions (tenant_id, role_code, permission_code, created_at, created_by)
         VALUES ($1,$2,$3,now(),$4)
         ON CONFLICT (tenant_id, role_code, permission_code) DO NOTHING`,
        [tenantId, roleCode, code, actor || 'system']
      )
    }
    const row = (inserted as any).rows[0]
    return {
      roleCode: row.role_code,
      roleName: row.role_name,
      description: row.description || '',
      isSystem: !!row.is_system,
      active: !!row.active,
      permissionCodes: sortedCodes(valid),
      userCount: 0,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    }
  })
}

export async function updateRole(
  tenantId: string,
  roleCodeInput: string,
  payload: { roleName?: string; description?: string; active?: boolean; permissionCodes?: string[] },
  actor: string
): Promise<RoleDefinition> {
  const roleCode = normalizeRoleCode(roleCodeInput)
  if (!roleCode) throw new Error('INVALID_INPUT')
  const db = getDb()
  const roleName = payload.roleName != null ? normalizeText(payload.roleName) : null
  const description = payload.description != null ? normalizeText(payload.description) : null
  if (roleName != null && !roleName) throw new Error('INVALID_INPUT')
  const active = payload.active
  const updatePermissions = Array.isArray(payload.permissionCodes)
  const { valid, invalid } = validatePermissionCodes(payload.permissionCodes || [])
  if (invalid.length) throw new Error(`INVALID_PERMISSIONS:${invalid.join(',')}`)

  if (!db) {
    ensureMemoryTenant(tenantId)
    const map = memoryRolesByTenant.get(tenantId)!
    const existing = map.get(roleCode)
    if (!existing) throw new Error('ROLE_NOT_FOUND')
    if (existing.isSystem && active === false) throw new Error('SYSTEM_ROLE_IMMUTABLE')
    const next: RoleDefinition = {
      ...existing,
      roleName: roleName ?? existing.roleName,
      description: description ?? existing.description,
      active: active == null ? existing.active : active,
      permissionCodes: updatePermissions ? sortedCodes(valid) : existing.permissionCodes,
      updatedAt: new Date().toISOString()
    }
    map.set(roleCode, next)
    return next
  }

  await ensureTenantRbacDefaults(tenantId)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const current = await q(
      `SELECT role_code, role_name, description, is_system, active
         FROM rbac_roles
        WHERE tenant_id = $1 AND role_code = $2`,
      [tenantId, roleCode]
    )
    if (!((current as any).rowCount > 0)) throw new Error('ROLE_NOT_FOUND')
    const currentRole = (current as any).rows[0]
    if (currentRole.is_system && active === false) throw new Error('SYSTEM_ROLE_IMMUTABLE')
    const nextRoleName = roleName ?? currentRole.role_name
    const nextDescription = description ?? (currentRole.description || '')
    const nextActive = active == null ? !!currentRole.active : !!active
    await q(
      `UPDATE rbac_roles
          SET role_name = $3,
              description = $4,
              active = $5,
              updated_at = now()
        WHERE tenant_id = $1 AND role_code = $2`,
      [tenantId, roleCode, nextRoleName, nextDescription || null, nextActive]
    )
    if (updatePermissions) {
      await q('DELETE FROM rbac_role_permissions WHERE tenant_id = $1 AND role_code = $2', [tenantId, roleCode])
      for (const code of valid) {
        await q(
          `INSERT INTO rbac_role_permissions (tenant_id, role_code, permission_code, created_at, created_by)
           VALUES ($1,$2,$3,now(),$4)
           ON CONFLICT (tenant_id, role_code, permission_code) DO NOTHING`,
          [tenantId, roleCode, code, actor || 'system']
        )
      }
    }
    const updatedRole = await q(
      `SELECT
         r.role_code,
         r.role_name,
         r.description,
         r.is_system,
         r.active,
         r.created_at,
         r.updated_at,
         COALESCE(
           (
             SELECT array_agg(rp.permission_code ORDER BY p.sort_order, rp.permission_code)
               FROM rbac_role_permissions rp
               LEFT JOIN rbac_permissions p ON p.permission_code = rp.permission_code
              WHERE rp.tenant_id = r.tenant_id AND rp.role_code = r.role_code
           ),
           ARRAY[]::text[]
         ) AS permission_codes,
         COALESCE(
           (
             SELECT COUNT(*)::int
               FROM user_roles ur
               JOIN users u ON u.user_id = ur.user_id
              WHERE u.tenant_id = r.tenant_id AND ur.role_code = r.role_code
           ),
           0
         )::int AS user_count
       FROM rbac_roles r
      WHERE r.tenant_id = $1 AND r.role_code = $2
      LIMIT 1`,
      [tenantId, roleCode]
    )
    if (!((updatedRole as any).rowCount > 0)) throw new Error('ROLE_NOT_FOUND')
    const updatedRow = (updatedRole as any).rows[0]
    return {
      roleCode: updatedRow.role_code,
      roleName: updatedRow.role_name,
      description: updatedRow.description || '',
      isSystem: !!updatedRow.is_system,
      active: !!updatedRow.active,
      permissionCodes: sortedCodes((updatedRow.permission_codes || []).map((x: any) => String(x))),
      userCount: Number(updatedRow.user_count || 0),
      createdAt: updatedRow.created_at || null,
      updatedAt: updatedRow.updated_at || null
    }
  })
}

export async function deleteRole(tenantId: string, roleCodeInput: string): Promise<void> {
  const roleCode = normalizeRoleCode(roleCodeInput)
  if (!roleCode) throw new Error('INVALID_INPUT')
  const db = getDb()
  if (!db) {
    ensureMemoryTenant(tenantId)
    const map = memoryRolesByTenant.get(tenantId)!
    const existing = map.get(roleCode)
    if (!existing) throw new Error('ROLE_NOT_FOUND')
    if (existing.isSystem) throw new Error('SYSTEM_ROLE_IMMUTABLE')
    if ((existing.userCount || 0) > 0) throw new Error('ROLE_IN_USE')
    map.delete(roleCode)
    return
  }
  await ensureTenantRbacDefaults(tenantId)
  await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const roleResult = await q(
      `SELECT role_code, is_system
         FROM rbac_roles
        WHERE tenant_id = $1 AND role_code = $2`,
      [tenantId, roleCode]
    )
    if (!((roleResult as any).rowCount > 0)) throw new Error('ROLE_NOT_FOUND')
    const isSystem = !!(roleResult as any).rows[0].is_system
    if (isSystem) throw new Error('SYSTEM_ROLE_IMMUTABLE')
    const inUseResult = await q(
      `SELECT COUNT(*)::int AS count
         FROM user_roles ur
         JOIN users u ON u.user_id = ur.user_id
        WHERE u.tenant_id = $1
          AND ur.role_code = $2`,
      [tenantId, roleCode]
    )
    if (Number((inUseResult as any).rows?.[0]?.count || 0) > 0) throw new Error('ROLE_IN_USE')
    await q('DELETE FROM rbac_roles WHERE tenant_id = $1 AND role_code = $2', [tenantId, roleCode])
  })
}

export async function validateRoleCodesForTenant(
  tenantId: string,
  roleCodes: string[]
): Promise<{ validRoleCodes: string[]; missingRoleCodes: string[] }> {
  const normalized = sortedCodes((roleCodes || []).map(normalizeRoleCode))
  if (!normalized.length) return { validRoleCodes: [], missingRoleCodes: [] }
  const db = getDb()
  if (!db) {
    ensureMemoryTenant(tenantId)
    const map = memoryRolesByTenant.get(tenantId)!
    const validRoleCodes = normalized.filter((code) => map.has(code))
    const missingRoleCodes = normalized.filter((code) => !map.has(code))
    return { validRoleCodes, missingRoleCodes }
  }
  await ensureTenantRbacDefaults(tenantId)
  const result = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    return q(
      `SELECT role_code
         FROM rbac_roles
        WHERE tenant_id = $1
          AND role_code = ANY($2)
          AND active = true`,
      [tenantId, normalized]
    )
  })
  const validSet = new Set(((result as any).rows || []).map((x: any) => String(x.role_code || '')))
  const validRoleCodes = normalized.filter((code) => validSet.has(code))
  const missingRoleCodes = normalized.filter((code) => !validSet.has(code))
  return { validRoleCodes, missingRoleCodes }
}
