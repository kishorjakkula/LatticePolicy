import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAuthorizationUrl, exchangeCodeForTokens, generateState, mapOidcClaimsToRoles, resolveClientSecret } from '../sso.js'
import { defaultTenantSsoConfig } from '../../config/tenant-identity.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapOidcClaimsToRoles', () => {
  const baseConfig = {
    rolesClaim: 'roles',
    roleMapping: { 'lattice-underwriter': 'underwriter', 'lattice-admin': 'admin' },
    defaultRoles: ['agent']
  }

  it('maps a simple array claim through the configured role mapping', () => {
    const roles = mapOidcClaimsToRoles(baseConfig, { roles: ['lattice-underwriter'] })
    expect(roles).toEqual(['underwriter'])
  })

  it('maps multiple claim values and de-duplicates', () => {
    const roles = mapOidcClaimsToRoles(baseConfig, { roles: ['lattice-underwriter', 'lattice-admin', 'lattice-underwriter'] })
    expect(roles.sort()).toEqual(['admin', 'underwriter'])
  })

  it('supports a dotted claim path for nested claim structures', () => {
    const roles = mapOidcClaimsToRoles(
      { ...baseConfig, rolesClaim: 'realm_access.roles' },
      { realm_access: { roles: ['lattice-admin'] } }
    )
    expect(roles).toEqual(['admin'])
  })

  it('supports a space/comma-delimited string claim', () => {
    const roles = mapOidcClaimsToRoles(baseConfig, { roles: 'lattice-underwriter lattice-admin' })
    expect(roles.sort()).toEqual(['admin', 'underwriter'])
  })

  it('falls back to defaultRoles when no claim value matches the mapping', () => {
    const roles = mapOidcClaimsToRoles(baseConfig, { roles: ['unmapped-group'] })
    expect(roles).toEqual(['agent'])
  })

  it('falls back to defaultRoles when the claim is missing entirely', () => {
    const roles = mapOidcClaimsToRoles(baseConfig, {})
    expect(roles).toEqual(['agent'])
  })

  it('returns an empty list when nothing matches and there is no default', () => {
    const roles = mapOidcClaimsToRoles({ ...baseConfig, defaultRoles: [] }, { roles: ['unmapped-group'] })
    expect(roles).toEqual([])
  })
})

describe('buildAuthorizationUrl', () => {
  it('builds a standard OIDC authorization code request URL', () => {
    const config = {
      ...defaultTenantSsoConfig(),
      authorizationEndpoint: 'https://idp.example.com/authorize',
      clientId: 'lattice-client',
      redirectUri: 'https://api.example.com/auth/sso/acme/callback'
    }
    const url = new URL(buildAuthorizationUrl(config, { state: 'state-123', nonce: 'nonce-456' }))
    expect(url.origin + url.pathname).toBe('https://idp.example.com/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('lattice-client')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/auth/sso/acme/callback')
    expect(url.searchParams.get('state')).toBe('state-123')
    expect(url.searchParams.get('nonce')).toBe('nonce-456')
    expect(url.searchParams.get('scope')).toContain('openid')
  })
})

describe('generateState', () => {
  it('produces unique, non-empty values', () => {
    const a = generateState()
    const b = generateState()
    expect(a).not.toEqual(b)
    expect(a.length).toBeGreaterThan(10)
  })
})

describe('resolveClientSecret', () => {
  it('reads the secret from the configured environment variable name, never storing it directly', () => {
    process.env.TEST_TENANT_OIDC_SECRET = 'super-secret-value'
    const config = { ...defaultTenantSsoConfig(), clientSecretEnvVar: 'TEST_TENANT_OIDC_SECRET' }
    expect(resolveClientSecret(config)).toBe('super-secret-value')
    delete process.env.TEST_TENANT_OIDC_SECRET
  })

  it('returns empty string when no env var is configured', () => {
    const config = defaultTenantSsoConfig()
    expect(resolveClientSecret(config)).toBe('')
  })
})

describe('exchangeCodeForTokens', () => {
  const baseConfig = {
    ...defaultTenantSsoConfig(),
    issuer: 'https://idp.example.com',
    authorizationEndpoint: 'https://idp.example.com/oauth2/authorize',
    tokenEndpoint: 'https://idp.example.com/oauth2/token',
    jwksUri: 'https://idp.example.com/oauth2/keys',
    clientId: 'lattice-client',
    redirectUri: 'https://api.example.com/auth/sso/acme/callback'
  }

  it('rejects non-public token endpoints before making an outbound request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeCodeForTokens({
      ...baseConfig,
      issuer: 'https://127.0.0.1',
      authorizationEndpoint: 'https://127.0.0.1/authorize',
      tokenEndpoint: 'https://127.0.0.1/token',
      jwksUri: 'https://127.0.0.1/keys'
    }, { code: 'abc' })).rejects.toThrow('public provider hostname')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects token endpoints that do not match the configured provider host', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeCodeForTokens({
      ...baseConfig,
      tokenEndpoint: 'https://tokens.example.net/oauth2/token'
    }, { code: 'abc' })).rejects.toThrow('configured provider hostname')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects public provider hosts that are not enabled in server-owned OIDC presets', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeCodeForTokens({
      ...baseConfig,
      tokenEndpoint: 'https://idp.example.com/custom/token'
    }, { code: 'abc' })).rejects.toThrow('must be one of')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows the supported Microsoft common token endpoint preset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ id_token: 'id-token-456' })
    })))

    const tokens = await exchangeCodeForTokens({
      ...baseConfig,
      issuer: 'https://login.microsoftonline.com',
      authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys'
    }, { code: 'abc' })
    expect(tokens.id_token).toBe('id-token-456')
  })

  it('exchanges codes with a validated public provider token endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ id_token: 'id-token-123', access_token: 'access-token-123' })
    })))

    const tokens = await exchangeCodeForTokens(baseConfig, { code: 'abc' })
    expect(tokens.id_token).toBe('id-token-123')
    expect(fetch).toHaveBeenCalledWith('https://idp.example.com/oauth2/token', expect.objectContaining({
      method: 'POST'
    }))
  })
})
