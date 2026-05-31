type UserLike = {
  roles?: string[]
  permissions?: string[]
} | null | undefined

const ROLE_PERMISSION_DEFAULTS: Record<string, string[]> = {
  admin: [
    'menu.search.view',
    'menu.portal.view',
    'menu.rating.view',
    'menu.uw_queue.view',
    'menu.admin.view',
    'menu.admin.forms.view',
    'menu.admin.uw_company.view',
    'menu.admin.users.view',
    'menu.admin.tenant.view',
    'menu.admin.security.view',
    'menu.admin.customers.view',
    'menu.admin.onboarding.view',
    'page.search.view',
    'page.portal.view',
    'page.rating.view',
    'page.wizard.view',
    'page.policy.view',
    'page.uw_queue.view',
    'page.admin.forms.view',
    'page.admin.uw_company.view',
    'page.admin.users.view',
    'page.admin.tenant.view',
    'page.admin.security.view',
    'page.admin.customers.view',
    'page.admin.onboarding.view',
    'admin.forms.read',
    'admin.forms.manage',
    'admin.forms.approve',
    'admin.uw_company.read',
    'admin.uw_company.manage',
    'admin.users.read',
    'admin.users.manage',
    'admin.tenant.read',
    'admin.tenant.manage',
    'admin.security.read',
    'admin.security.manage',
    'admin.customers.read',
    'admin.customers.manage',
    'admin.customers.contact.manage',
    'admin.customers.approve',
    'admin.customers.merge',
    'admin.customers.deactivate',
    'admin.customers.import',
    'admin.customers.export',
    'admin.customers.pii_reveal',
    'admin.onboarding.read',
    'admin.onboarding.manage',
    'admin.onboarding.upload',
    'admin.onboarding.service',
    'admin.onboarding.approve',
    'uw.referrals.read',
    'uw.referrals.decide',
    'rating.models.read',
    'rating.models.manage',
    'rating.models.publish'
  ],
  customer: ['menu.portal.view', 'page.portal.view', 'customer.portal.read'],
  actuary: ['menu.rating.view', 'page.rating.view', 'rating.models.read', 'rating.models.manage', 'rating.models.publish'],
  agent: ['menu.search.view', 'page.search.view', 'page.wizard.view', 'page.policy.view'],
  underwriter: [
    'menu.search.view',
    'menu.uw_queue.view',
    'page.search.view',
    'page.wizard.view',
    'page.policy.view',
    'page.uw_queue.view',
    'uw.referrals.read',
    'uw.referrals.decide'
  ],
  forms_admin: ['menu.admin.view', 'menu.admin.forms.view', 'page.admin.forms.view', 'admin.forms.read', 'admin.forms.manage'],
  compliance_admin: [
    'menu.admin.view',
    'menu.admin.forms.view',
    'page.admin.forms.view',
    'admin.forms.read',
    'admin.forms.manage',
    'admin.forms.approve'
  ],
  security_admin: [
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
  ],
  customer_admin: [
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
  ],
  customer_service: [
    'menu.search.view',
    'menu.admin.view',
    'menu.admin.customers.view',
    'page.search.view',
    'page.policy.view',
    'page.admin.customers.view',
    'admin.customers.read',
    'admin.customers.contact.manage',
    'admin.customers.export'
  ],
  restricted_pii: [
    'menu.admin.view',
    'menu.admin.customers.view',
    'page.admin.customers.view',
    'admin.customers.read',
    'admin.customers.pii_reveal'
  ],
  onboarding_admin: [
    'menu.admin.view',
    'menu.admin.onboarding.view',
    'page.admin.onboarding.view',
    'admin.onboarding.read',
    'admin.onboarding.manage',
    'admin.onboarding.upload',
    'admin.onboarding.service'
  ],
  read_only: ['menu.search.view', 'page.search.view', 'page.policy.view']
}

export function getDefaultPermissionsForRoles(roles: string[]): string[] {
  const normalized = Array.from(new Set((roles || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)))
  if (normalized.includes('admin')) return Array.from(new Set(ROLE_PERMISSION_DEFAULTS.admin || []))
  const next = new Set<string>()
  for (const role of normalized) {
    for (const permissionCode of ROLE_PERMISSION_DEFAULTS[role] || []) {
      next.add(permissionCode)
    }
  }
  return Array.from(next).sort((a, b) => a.localeCompare(b))
}

export function getEffectivePermissions(user: UserLike): string[] {
  if (!user) return []
  const explicit = Array.isArray(user.permissions) ? user.permissions.filter(Boolean) : []
  const defaults = getDefaultPermissionsForRoles(user.roles || [])
  return Array.from(new Set([...explicit, ...defaults])).sort((a, b) => a.localeCompare(b))
}

export function hasPermission(user: UserLike, permissionCode: string): boolean {
  if (!user) return false
  const roles = Array.isArray(user.roles) ? user.roles.map((x) => String(x || '').toLowerCase()) : []
  if (roles.includes('admin')) return true
  const effective = getEffectivePermissions(user)
  return effective.includes(permissionCode)
}
