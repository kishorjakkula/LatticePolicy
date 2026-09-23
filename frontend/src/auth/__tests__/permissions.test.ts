import { describe, expect, it } from 'vitest'
import { getDefaultPermissionsForRoles, hasPermission } from '../permissions'

describe('role permission defaults', () => {
  it('keeps the exposure_admin frontend fallback aligned with the server role', () => {
    expect(getDefaultPermissionsForRoles(['exposure_admin'])).toEqual([
      'admin.exposure.read',
      'menu.admin.exposure.view',
      'menu.admin.view',
      'page.admin.exposure.view',
    ])
  })

  it('allows an exposure_admin-only user to see and open Exposure administration', () => {
    const user = { roles: ['exposure_admin'], permissions: [] }

    expect(hasPermission(user, 'menu.admin.view')).toBe(true)
    expect(hasPermission(user, 'menu.admin.exposure.view')).toBe(true)
    expect(hasPermission(user, 'page.admin.exposure.view')).toBe(true)
    expect(hasPermission(user, 'admin.exposure.read')).toBe(true)
    expect(hasPermission(user, 'admin.exposure.manage')).toBe(false)
  })
})
