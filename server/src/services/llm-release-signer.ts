import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { isManagedDeployment } from '../config.js'

/**
 * Signs release authorizations and revocation lists.
 *
 * Managed deployments (test, validation, staging, production) must use the
 * separate release signer (LLM_RELEASE_SIGNER_URL): the private key never
 * enters the API process, so a compromised API cannot copy it, and the signer
 * keeps its own append-only log of everything it signed. An inline
 * LLM_RELEASE_SIGNING_KEY is accepted only for local development.
 *
 * Every signature is checked against LLM_RELEASE_PUBLIC_KEY (or the local
 * key's public half) before it is stored.
 */
export type SignKind = 'release-authorization' | 'revocation-list'
type Fetch = typeof fetch

function pem(value: string | undefined) {
  return String(value || '').replace(/\\n/g, '\n')
}

export function signerMode(env = process.env): 'remote' | 'local' {
  if (env.LLM_RELEASE_SIGNER_URL) return 'remote'
  if (isManagedDeployment())
    throw new Error(
      'LLM_RELEASE_SIGNER_REQUIRED: managed deployments sign through the separate release signer (LLM_RELEASE_SIGNER_URL)',
    )
  if (!env.LLM_RELEASE_SIGNING_KEY)
    throw new Error('LLM release signing is not configured')
  return 'local'
}

function publicKeyFor(mode: 'remote' | 'local', env = process.env) {
  const key =
    mode === 'local'
      ? createPublicKey(createPrivateKey(pem(env.LLM_RELEASE_SIGNING_KEY)))
      : createPublicKey(pem(env.LLM_RELEASE_PUBLIC_KEY))
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('LLM release signing requires an Ed25519 key')
  return key
}

export async function signGovernancePayload(
  kind: SignKind,
  payload: Record<string, unknown>,
  { env = process.env, fetchImpl = fetch as Fetch } = {},
): Promise<string> {
  const mode = signerMode(env)
  const bytes = Buffer.from(JSON.stringify(payload))
  let signature: string
  if (mode === 'local') {
    const key = createPrivateKey(pem(env.LLM_RELEASE_SIGNING_KEY))
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('LLM release signing requires an Ed25519 key')
    signature = sign(null, bytes, key).toString('base64url')
  } else {
    const token = String(env.LLM_RELEASE_SIGNER_TOKEN || '')
    if (token.length < 32)
      throw new Error('LLM_RELEASE_SIGNER_TOKEN must be at least 32 characters')
    const url = new URL('/sign', env.LLM_RELEASE_SIGNER_URL)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid LLM_RELEASE_SIGNER_URL')
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind, payload }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Release signer refused the request (${response.status})`)
    const body = (await response.json()) as { signature?: unknown }
    if (typeof body.signature !== 'string') throw new Error('Release signer returned no signature')
    signature = body.signature
  }
  if (!verify(null, bytes, publicKeyFor(mode, env), Buffer.from(signature, 'base64url')))
    throw new Error('Release signature does not match the trusted public key')
  return signature
}
