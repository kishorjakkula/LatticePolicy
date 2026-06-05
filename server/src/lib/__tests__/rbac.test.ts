import { describe, expect, it } from 'vitest'
import { getDefaultPermissionCodesForRoles, getPermissionCatalog } from '../rbac.js'

describe('rbac', () => {
  it('returns a sorted permission catalog with unique codes', () => {
    const catalog = getPermissionCatalog()
    const codes = catalog.map((item) => item.permissionCode)

    expect(catalog.length).toBeGreaterThan(0)
    expect(new Set(codes).size).toBe(codes.length)
    expect(catalog.map((item) => item.sortOrder)).toEqual([...catalog.map((item) => item.sortOrder)].sort((a, b) => a - b))
  })

  it('grants all catalog permissions to admin', () => {
    const allCodes = getPermissionCatalog().map((item) => item.permissionCode).sort()
    const adminCodes = getDefaultPermissionCodesForRoles(['admin']).sort()

    expect(adminCodes).toEqual(allCodes)
  })

  it('combines role defaults without duplicates', () => {
    const codes = getDefaultPermissionCodesForRoles(['agent', 'underwriter', 'agent'])

    expect(codes).toContain('page.search.view')
    expect(codes).toContain('page.wizard.view')
    expect(codes).toContain('page.uw_queue.view')
    expect(codes).toContain('uw.referrals.decide')
    expect(codes.filter((code) => code === 'page.search.view')).toHaveLength(1)
  })

  it('normalizes role code casing and ignores unknown roles', () => {
    const codes = getDefaultPermissionCodesForRoles([' Customer ', 'missing-role'])

    expect(codes).toEqual(['customer.portal.read', 'menu.portal.view', 'page.portal.view'])
  })
})
