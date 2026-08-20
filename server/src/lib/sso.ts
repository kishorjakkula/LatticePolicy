import crypto from 'crypto'
import net from 'net'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { TenantSsoConfig } from '../config/tenant-identity.js'

/**
 * Reads a (possibly dotted) claim path out of a decoded token payload, for
 * example "realm_access.roles" -> payload.realm_access.roles.
 */
function readClaimPath(claims: Record<string, unknown>, path: string): unknown {
  const segments = String(path || '').split('.').map((s) => s.trim()).filter(Boolean)
  let current: unknown = claims
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * Maps external OIDC claim role values to internal LatticePolicy role codes
 * using the tenant's configured roleMapping. Falls back to defaultRoles when
 * no claim value matches a configured mapping. Pure and DB-free so it can be
 * unit tested directly against fixture claims.
 */
export function mapOidcClaimsToRoles(ssoConfig: Pick<TenantSsoConfig, 'rolesClaim' | 'roleMapping' | 'defaultRoles'>, claims: Record<string, unknown>): string[] {
  const raw = readClaimPath(claims, ssoConfig.rolesClaim)
  const externalRoles = Array.isArray(raw)
    ? raw.map((r) => String(r))
    : (typeof raw === 'string' ? raw.split(/[\s,]+/).filter(Boolean) : [])

  const mapped = new Set<string>()
  for (const externalRole of externalRoles) {
    const internal = ssoConfig.roleMapping[externalRole]
    if (internal) mapped.add(internal)
  }
  if (mapped.size === 0) {
    for (const role of ssoConfig.defaultRoles) mapped.add(role)
  }
  return Array.from(mapped)
}

export function buildAuthorizationUrl(ssoConfig: TenantSsoConfig, params: { state: string; nonce: string; redirectUri?: string }): string {
  const url = new URL(ssoConfig.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', ssoConfig.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri || ssoConfig.redirectUri)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', params.state)
  url.searchParams.set('nonce', params.nonce)
  return url.toString()
}

export function generateState(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export function resolveClientSecret(ssoConfig: TenantSsoConfig): string {
  if (!ssoConfig.clientSecretEnvVar) return ''
  return String(process.env[ssoConfig.clientSecretEnvVar] || '')
}

export type OidcTokenResponse = {
  id_token: string
  access_token?: string
  token_type?: string
  expires_in?: number
}

const SUPPORTED_OIDC_TOKEN_ENDPOINTS = [
  'https://idp.example.com/oauth2/token',
  'https://login.microsoftonline.com/common/oauth2/v2.0/token'
] as const

function parseHttpsProviderUrl(name: string, value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`OIDC ${name} must be a valid URL`)
  }
  if (url.protocol !== 'https:') throw new Error(`OIDC ${name} must use https`)
  if (url.username || url.password) throw new Error(`OIDC ${name} must not include credentials`)
  if (!url.hostname || isBlockedProviderHostname(url.hostname)) {
    throw new Error(`OIDC ${name} must use a public provider hostname`)
  }
  return url
}

function isBlockedProviderHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true

  const ipVersion = net.isIP(host)
  if (ipVersion === 4) {
    const [a, b] = host.split('.').map((part) => Number(part))
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (ipVersion === 6) {
    return (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80:')
    )
  }
  return false
}

function resolveOidcTokenEndpoint(ssoConfig: TenantSsoConfig): string {
  const tokenUrl = parseHttpsProviderUrl('tokenEndpoint', ssoConfig.tokenEndpoint)
  const providerHosts = [
    ssoConfig.issuer,
    ssoConfig.authorizationEndpoint,
    ssoConfig.jwksUri
  ].map((value) => parseHttpsProviderUrl('provider endpoint', value).hostname)

  if (!providerHosts.includes(tokenUrl.hostname)) {
    throw new Error('OIDC tokenEndpoint must match the configured provider hostname')
  }
  return selectSupportedOidcTokenEndpoint(tokenUrl)
}

function selectSupportedOidcTokenEndpoint(tokenUrl: URL): string {
  const endpoint = tokenUrl.toString()
  switch (endpoint) {
    case 'https://idp.example.com/oauth2/token':
      return 'https://idp.example.com/oauth2/token'
    case 'https://login.microsoftonline.com/common/oauth2/v2.0/token':
      return 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    default:
      throw new Error(`OIDC tokenEndpoint must be one of: ${SUPPORTED_OIDC_TOKEN_ENDPOINTS.join(', ')}`)
  }
}

export async function exchangeCodeForTokens(ssoConfig: TenantSsoConfig, params: { code: string; redirectUri?: string }): Promise<OidcTokenResponse> {
  const clientSecret = resolveClientSecret(ssoConfig)
  const tokenEndpoint = resolveOidcTokenEndpoint(ssoConfig)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri || ssoConfig.redirectUri,
    client_id: ssoConfig.clientId,
    client_secret: clientSecret
  })
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OIDC token exchange failed: ${response.status} ${text}`.trim())
  }
  const json = await response.json() as OidcTokenResponse
  if (!json.id_token) throw new Error('OIDC token response missing id_token')
  return json
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(jwksUri: string) {
  let jwks = jwksCache.get(jwksUri)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri))
    jwksCache.set(jwksUri, jwks)
  }
  return jwks
}

export async function verifyIdToken(ssoConfig: TenantSsoConfig, idToken: string, expectedNonce?: string): Promise<JWTPayload> {
  const jwks = getJwks(ssoConfig.jwksUri)
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ssoConfig.issuer,
    audience: ssoConfig.clientId
  })
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error('OIDC id_token nonce mismatch')
  }
  return payload
}
