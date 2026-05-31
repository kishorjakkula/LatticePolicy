import { v4 as uuidv4 } from '../uuid.js'

export type UnderwritingCompanyRecord = {
  companyId: string
  tenantId: string
  name: string
  productCode: string
  country: string
  state: string
  active: boolean
  createdAt: string
  updatedAt: string
}

type MemoryFilters = {
  productCode?: string
  country?: string
  state?: string
  includeInactive?: boolean
}

type DuplicateCheckInput = {
  name: string
  productCode: string
  country: string
  state: string
  excludeCompanyId?: string
}

const memoryByTenant = new Map<string, UnderwritingCompanyRecord[]>()

export function normalizeCompanyName(value: any): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function normalizeCompanyProductCode(value: any): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'personal-auto' || normalized === 'commercial-auto' || normalized === 'homeowners' || normalized === 'cyber' || normalized === 'professional-liability') return normalized
  return ''
}

export function normalizeCompanyCountryCode(value: any): string {
  return String(value || '').trim().toUpperCase() === 'CA' ? 'CA' : 'US'
}

export function normalizeCompanyStateCode(value: any): string {
  return String(value || '').trim().toUpperCase()
}

function upsertMemoryTenant(tenantId: string): UnderwritingCompanyRecord[] {
  if (!memoryByTenant.has(tenantId)) {
    memoryByTenant.set(tenantId, [])
  }
  return memoryByTenant.get(tenantId) || []
}

function statesOverlap(a: string, b: string): boolean {
  return a === b || a === 'ALL' || b === 'ALL'
}

export function hasMemoryUnderwritingCompanyConflict(tenantId: string, input: DuplicateCheckInput): boolean {
  const name = normalizeCompanyName(input.name).toLowerCase()
  const productCode = normalizeCompanyProductCode(input.productCode)
  const country = normalizeCompanyCountryCode(input.country)
  const state = normalizeCompanyStateCode(input.state)
  const excludeCompanyId = input.excludeCompanyId || ''
  return upsertMemoryTenant(tenantId).some((item) => {
    if (excludeCompanyId && item.companyId === excludeCompanyId) return false
    return (
      item.name.toLowerCase() === name &&
      item.productCode === productCode &&
      item.country === country &&
      statesOverlap(item.state, state)
    )
  })
}

export function listMemoryUnderwritingCompanies(tenantId: string, filters: MemoryFilters = {}): UnderwritingCompanyRecord[] {
  const productCode = normalizeCompanyProductCode(filters.productCode)
  const country = filters.country ? normalizeCompanyCountryCode(filters.country) : ''
  const state = filters.state ? normalizeCompanyStateCode(filters.state) : ''
  const includeInactive = !!filters.includeInactive
  return upsertMemoryTenant(tenantId)
    .filter((item) => {
      if (!includeInactive && !item.active) return false
      if (productCode && item.productCode !== productCode) return false
      if (country && item.country !== country) return false
      if (state && item.state !== state && item.state !== 'ALL') return false
      return true
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function createMemoryUnderwritingCompany(
  tenantId: string,
  input: { name: string; productCode: string; country: string; state: string; active?: boolean }
): UnderwritingCompanyRecord {
  const nowIso = new Date().toISOString()
  const item: UnderwritingCompanyRecord = {
    companyId: uuidv4(),
    tenantId,
    name: normalizeCompanyName(input.name),
    productCode: normalizeCompanyProductCode(input.productCode),
    country: normalizeCompanyCountryCode(input.country),
    state: normalizeCompanyStateCode(input.state),
    active: input.active !== false,
    createdAt: nowIso,
    updatedAt: nowIso
  }
  const all = upsertMemoryTenant(tenantId)
  all.push(item)
  return item
}

export function updateMemoryUnderwritingCompany(
  tenantId: string,
  companyId: string,
  patch: Partial<{ name: string; productCode: string; country: string; state: string; active: boolean }>
): UnderwritingCompanyRecord | null {
  const all = upsertMemoryTenant(tenantId)
  const index = all.findIndex((item) => item.companyId === companyId)
  if (index < 0) return null
  const current = all[index]
  const next: UnderwritingCompanyRecord = {
    ...current,
    name: patch.name != null ? normalizeCompanyName(patch.name) : current.name,
    productCode: patch.productCode != null ? normalizeCompanyProductCode(patch.productCode) : current.productCode,
    country: patch.country != null ? normalizeCompanyCountryCode(patch.country) : current.country,
    state: patch.state != null ? normalizeCompanyStateCode(patch.state) : current.state,
    active: patch.active != null ? patch.active : current.active,
    updatedAt: new Date().toISOString()
  }
  all[index] = next
  return next
}

export function deleteMemoryUnderwritingCompany(tenantId: string, companyId: string): boolean {
  const all = upsertMemoryTenant(tenantId)
  const index = all.findIndex((item) => item.companyId === companyId)
  if (index < 0) return false
  all.splice(index, 1)
  return true
}
