import { Router, type Response } from 'express'
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
  flow?: 'popup'
}

function sendPopupResult(res: Response, targetOrigin: string, payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  return res.send(`<!doctype html><html><body><script>window.opener.postMessage(${serialized}, ${JSON.stringify(targetOrigin)});window.close();</script></body></html>`)
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
  const flow = String(req.query.flow || '') === 'popup' ? 'popup' : undefined
  const statePayload: SsoStatePayload = { tenantId, nonce, flow }
  const state = jwt.sign(statePayload, getSsoStateSecret(), { expiresIn: '10m' })
  const url = buildAuthorizationUrl(ssoConfig, { state, nonce })
  return res.redirect(url)
})

/**
 * OIDC authorization code callback. Exchanges the code for tokens, verifies
 * the id_token against the tenant's JWKS, maps claims to internal roles, and
 * issues a normal LatticePolicy JWT the same shape /auth/login returns.
 *
 * Popup flows hand the normal application token directly to the configured
 * frontend origin. Non-popup clients receive the JSON response.
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
      if (statePayload.flow === 'popup') {
        const targetOrigin = String(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).find(Boolean)
        if (targetOrigin) return sendPopupResult(res, targetOrigin, { type: 'lattice:sso:error', message: 'No application role is assigned to this account' })
      }
      return res.status(403).json({ code: 'SSO_NO_ROLE_MAPPING', message: 'No tenant role could be mapped from identity provider claims' })
    }

    const username = String(claims.email || claims.preferred_username || subject)
    const base = await findOrCreateSsoUser({ tenantId, externalSubject: subject, username, roles })
    const user = await buildAuthUser({ id: base.id, username: base.username, tenantId, roles: base.roles })
    const token = issueToken(user)
    if (statePayload.flow === 'popup') {
      const targetOrigin = String(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).find(Boolean)
      if (!targetOrigin) return res.status(500).json({ code: 'SSO_ORIGIN_REQUIRED', message: 'SSO popup requires an allowed frontend origin' })
      return sendPopupResult(res, targetOrigin, { type: 'lattice:sso', token, user })
    }
    return res.json({ token, user })
  } catch (err: any) {
    if (statePayload.flow === 'popup') {
      const targetOrigin = String(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).find(Boolean)
      if (targetOrigin) return sendPopupResult(res, targetOrigin, { type: 'lattice:sso:error', message: 'Single sign-on could not be completed' })
    }
    return res.status(401).json({ code: 'SSO_AUTHENTICATION_FAILED', message: String(err?.message || err) })
  }
})
