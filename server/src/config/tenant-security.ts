const memoryMfaRequiredByTenant = new Map<string, boolean>()

export function defaultTenantMfaRequired(): boolean {
  return false
}

export function normalizeTenantMfaRequired(value: any, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value == null) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false
  return fallback
}

export function tenantMfaRequiredFromRow(row: any): boolean {
  if (!row || typeof row !== 'object') return defaultTenantMfaRequired()
  return normalizeTenantMfaRequired(row.mfa_required ?? row.mfaRequired, defaultTenantMfaRequired())
}

export function getMemoryTenantMfaRequired(tenantId: string): boolean {
  if (memoryMfaRequiredByTenant.has(tenantId)) {
    return Boolean(memoryMfaRequiredByTenant.get(tenantId))
  }
  const fallback = defaultTenantMfaRequired()
  memoryMfaRequiredByTenant.set(tenantId, fallback)
  return fallback
}

export function setMemoryTenantMfaRequired(tenantId: string, required: any): boolean {
  const current = getMemoryTenantMfaRequired(tenantId)
  const normalized = normalizeTenantMfaRequired(required, current)
  memoryMfaRequiredByTenant.set(tenantId, normalized)
  return normalized
}
