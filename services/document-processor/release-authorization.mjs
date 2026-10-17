import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  return value
}
export function profileDigest(profile) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(profile)))
    .digest('hex')
}

export function verifyAuthorization(
  authorization,
  { publicKey, tenantId, environment, model, modelSha256,
    maxAgeSeconds = 604800, revocationFile, now = Date.now },
  profile,
) {
  const key = createPublicKey(publicKey)
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !authorization?.payload ||
    typeof authorization.signature !== 'string' ||
    !verify(
      null,
      Buffer.from(JSON.stringify(authorization.payload)),
      key,
      Buffer.from(authorization.signature, 'base64url'),
    )
  )
    throw new Error('Invalid release authorization signature')
  const { payload } = authorization
  const artifacts = payload.artifacts
  if (
    payload.schemaVersion !== 1 ||
    payload.tenantId !== tenantId ||
    payload.environment !== environment ||
    !['validation', 'production'].includes(environment) ||
    !payload.approvedBy ||
    !payload.releaseId ||
    artifacts?.profileId !== profile.id ||
    artifacts.profileVersion !== profile.version ||
    artifacts.profileSha256 !== profileDigest(profile) ||
    artifacts.model !== model ||
    artifacts.modelSha256 !== modelSha256 ||
    (environment === 'production' &&
      !/^[a-f0-9]{64}$/.test(payload.validationReportSha256 || ''))
  )
    throw new Error(
      'Release authorization does not match carrier, environment, or artifacts',
    )
  // Apply local lifetime policy without changing the signed v1 payload bytes.
  const current = now()
  const approved = Date.parse(payload.approvedAt)
  const expires = payload.expiresAt === undefined ? Infinity : Date.parse(payload.expiresAt)
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0 ||
      !Number.isFinite(current) || !Number.isFinite(approved) ||
      approved > current + 60000 || Number.isNaN(expires) ||
      current >= approved + maxAgeSeconds * 1000 || current >= expires)
    throw new Error('Release authorization expired or has invalid lifetime')
  if (revocationFile) {
    // Intentionally uncached: emergency revocation takes effect on the next run.
    const revoked = JSON.parse(readFileSync(revocationFile, 'utf8'))
    if (revoked?.schemaVersion !== 1 || !Array.isArray(revoked.releaseIds) ||
        revoked.releaseIds.some(id => typeof id !== 'string' || !id))
      throw new Error('Invalid release revocation policy')
    if (revoked.releaseIds.includes(payload.releaseId))
      throw new Error('Release authorization revoked')
  }
  return payload
}

export async function loadAuthorization(directory, profile, policy) {
  const authorization = JSON.parse(
    await readFile(
      path.join(directory, profile.id, `${profile.version}.authorization.json`),
      'utf8',
    ),
  )
  return verifyAuthorization(authorization, policy, profile)
}

export async function releasePolicyFromEnv(env = process.env) {
  const environment = env.RELEASE_ENVIRONMENT || 'development'
  if (environment === 'development') return null
  if (
    !['validation', 'production'].includes(environment) ||
    !env.CARRIER_TENANT_ID ||
    !env.MODEL_NAME ||
    !/^[a-f0-9]{64}$/.test(env.MODEL_ARTIFACT_SHA256 || '') ||
    !env.LLM_RELEASE_PUBLIC_KEY_FILE
  )
    throw new Error('Configure the signed carrier release policy')
  const publicKey = await readFile(env.LLM_RELEASE_PUBLIC_KEY_FILE, 'utf8')
  if (createPublicKey(publicKey).asymmetricKeyType !== 'ed25519')
    throw new Error('Release verification requires an Ed25519 public key')
  const maxAgeSeconds = env.LLM_RELEASE_MAX_AGE_SECONDS === undefined
    ? 604800 : Number(env.LLM_RELEASE_MAX_AGE_SECONDS)
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > 31536000)
    throw new Error('Release maximum age must be 1 through 31536000 seconds')
  return {
    environment,
    tenantId: env.CARRIER_TENANT_ID,
    model: env.MODEL_NAME,
    modelSha256: env.MODEL_ARTIFACT_SHA256,
    publicKey,
    maxAgeSeconds,
    revocationFile: env.LLM_RELEASE_REVOCATION_FILE || undefined,
  }
}
