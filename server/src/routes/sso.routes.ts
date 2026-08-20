import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { getSsoStateSecret } from '../config.js'
import { loadTenantSsoConfig } from '../config/tenant-identity.js'
import { buildAuthorizationUrl, exchangeCodeForTokens, generateState, mapOidcClaimsToRoles, verifyIdToken } from '../lib/sso.js'
import { findOrCreateSsoUser } from '../services/user.service.js'
import { buildAuthUser, issueToken } from '../auth.js'

export const ssoRoutes = Router()

type SsoStatePayload = {
  tenantId: string
  nonce: string
}

/**
 * Redirects the browser to the tenant's configured OIDC identity provider.
 * The `state` query param IS a short-lived signed JWT (no server-side
 * session store needed) so /callback can verify it came from us and recover
 * which tenant/nonce it belongs to.
 */
ssoRoutes.get('/:tenantId/login', async (req, res) => {
  const tenantId = String(req.params.tenantId || '').trim()
  if (!tenantId) return res.status(400).json({ code: 'TENANT_REQUIRED' })
  const ssoConfig = await loadTenantSsoConfig(tenantId)
  if (!ssoConfig.enabled) {
    return res.status(404).json({ code: 'SSO_NOT_CONFIGURED', message: 'Single sign-on is not enabled for this tenant' })
  }
  const nonce = generateState()
  const statePayload: SsoStatePayload = { tenantId, nonce }
  const state = jwt.sign(statePayload, getSsoStateSecret(), { expiresIn: '10m' })
  const url = buildAuthorizationUrl(ssoConfig, { state, nonce })
  return res.redirect(url)
})

/**
 * OIDC authorization code callback. Exchanges the code for tokens, verifies
 * the id_token against the tenant's JWKS, maps claims to internal roles, and
 * issues a normal LatticePolicy JWT the same shape /auth/login returns.
 *
 * Returns JSON rather than a browser redirect with a token fragment; wiring
 * this into the frontend SPA (popup or redirect-with-fragment handoff) is a
 * follow-up — see docs/tasks/issue-65-enterprise-identity-security.md.
 */
ssoRoutes.get('/:tenantId/callback', async (req, res) => {
  const tenantId = String(req.params.tenantId || '').trim()
  const code = String((req.query as any)?.code || '').trim()
  const state = String((req.query as any)?.state || '').trim()
  if (!tenantId || !code || !state) {
    return res.status(400).json({ code: 'INVALID_SSO_CALLBACK', message: 'Missing code or state' })
  }

  let statePayload: SsoStatePayload
  try {
    statePayload = jwt.verify(state, getSsoStateSecret()) as SsoStatePayload
  } catch {
    return res.status(401).json({ code: 'INVALID_SSO_STATE', message: 'SSO state expired or invalid' })
  }
  if (statePayload.tenantId !== tenantId) {
    return res.status(401).json({ code: 'INVALID_SSO_STATE', message: 'SSO state does not match tenant' })
  }

  const ssoConfig = await loadTenantSsoConfig(tenantId)
  if (!ssoConfig.enabled) {
    return res.status(404).json({ code: 'SSO_NOT_CONFIGURED', message: 'Single sign-on is not enabled for this tenant' })
  }

  try {
    const tokens = await exchangeCodeForTokens(ssoConfig, { code })
    const claims = await verifyIdToken(ssoConfig, tokens.id_token, statePayload.nonce)
    const subject = String(claims.sub || '')
    if (!subject) return res.status(401).json({ code: 'INVALID_SSO_TOKEN', message: 'id_token missing subject' })

    const roles = mapOidcClaimsToRoles(ssoConfig, claims as Record<string, unknown>)
    if (!roles.length) {
      return res.status(403).json({ code: 'SSO_NO_ROLE_MAPPING', message: 'No tenant role could be mapped from identity provider claims' })
    }

    const username = String(claims.email || claims.preferred_username || subject)
    const base = await findOrCreateSsoUser({ tenantId, externalSubject: subject, username, roles })
    const user = await buildAuthUser({ id: base.id, username: base.username, tenantId, roles: base.roles })
    const token = issueToken(user)
    return res.json({ token, user })
  } catch (err: any) {
    return res.status(401).json({ code: 'SSO_AUTHENTICATION_FAILED', message: String(err?.message || err) })
  }
})
