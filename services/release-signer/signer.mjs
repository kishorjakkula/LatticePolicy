import http from 'node:http'
import { createHash, createPrivateKey, sign, timingSafeEqual } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'

/**
 * The carrier's release signer: the only process that holds the Ed25519
 * release key. LatticePolicy asks it to sign; it checks each request against
 * its own rules and appends every signature to a hash-chained log before
 * returning it. A compromised API can ask for a signature but cannot copy the
 * key, and cannot sign anything the log does not show.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA = /^[a-f0-9]{64}$/
const SKEW_MS = 5 * 60 * 1000
const MAX_LIFETIME_MS = 31 * 86400000

export function checkPayload(kind, payload, { tenantId, now = Date.now() }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload required')
  if (payload.schemaVersion !== 1) throw new Error('unsupported schema')
  if (tenantId && payload.tenantId !== tenantId) throw new Error('payload is for a different carrier')
  if (typeof payload.tenantId !== 'string' || !payload.tenantId) throw new Error('carrier required')
  if (kind === 'release-authorization') {
    const a = payload.artifacts || {}
    if (!UUID.test(payload.releaseId || '')) throw new Error('release id required')
    if (!['validation', 'production'].includes(payload.environment)) throw new Error('invalid environment')
    if (!UUID.test(payload.approvedBy || '')) throw new Error('approver required')
    if (!SHA.test(a.profileSha256 || '') || !SHA.test(a.modelSha256 || '') || !a.profileId || !a.profileVersion || !a.model)
      throw new Error('artifacts incomplete')
    const approved = Date.parse(payload.approvedAt)
    const expires = Date.parse(payload.expiresAt)
    if (!Number.isFinite(approved) || Math.abs(approved - now) > SKEW_MS) throw new Error('approval time is not current')
    if (!Number.isFinite(expires) || expires <= approved || expires - approved > MAX_LIFETIME_MS)
      throw new Error('expiry must be within 31 days of approval')
    if (payload.environment === 'production' && !SHA.test(payload.validationReportSha256 || ''))
      throw new Error('production requires a validation report hash')
  } else if (kind === 'revocation-list') {
    const issued = Date.parse(payload.issuedAt)
    if (!Number.isFinite(issued) || Math.abs(issued - now) > SKEW_MS) throw new Error('issue time is not current')
    if (!Array.isArray(payload.releaseIds) || payload.releaseIds.some((id) => !UUID.test(id)))
      throw new Error('release ids required')
  } else throw new Error('unknown signing kind')
}

export async function lastLogHash(logFile) {
  try {
    const lines = (await readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean)
    return lines.length ? JSON.parse(lines[lines.length - 1]).entryHash : null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function createSigner({ privateKeyPem, token, logFile, tenantId, now = () => Date.now() }) {
  if (!token || token.length < 32) throw new Error('SIGNER_TOKEN must be at least 32 characters')
  if (!logFile) throw new Error('SIGNER_LOG_FILE is required')
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('The release key must be Ed25519')
  let previous = await lastLogHash(logFile)
  let queue = Promise.resolve()
  async function record(entry) {
    const line = { ...entry, prevHash: previous }
    line.entryHash = createHash('sha256').update(JSON.stringify(line)).digest('hex')
    const handle = await open(logFile, 'a', 0o600)
    try {
      await handle.write(`${JSON.stringify(line)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    previous = line.entryHash
  }
  return async function signRequest(kind, payload) {
    checkPayload(kind, payload, { tenantId, now: now() })
    const bytes = Buffer.from(JSON.stringify(payload))
    const signature = sign(null, bytes, key).toString('base64url')
    // Serialize log writes; the signature is released only after it is logged.
    const logged = queue.then(() =>
      record({
        at: new Date(now()).toISOString(),
        kind,
        tenantId: payload.tenantId,
        releaseId: payload.releaseId || null,
        environment: payload.environment || null,
        approvedBy: payload.approvedBy || null,
        releaseIds: payload.releaseIds || null,
        payloadSha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    )
    queue = logged.catch(() => {})
    await logged
    return signature
  }
}

export function createServer({ token, signRequest }) {
  const expected = Buffer.from(`Bearer ${token}`)
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'ok' })
    const supplied = Buffer.from(req.headers.authorization || '')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, { error: 'Unauthorized' })
    if (req.method !== 'POST' || req.url !== '/sign') return send(404, { error: 'Not found' })
    const chunks = []
    let bytes = 0
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 64 * 1024) return send(413, { error: 'Request too large' })
      chunks.push(chunk)
    }
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return send(400, { error: 'Invalid JSON' })
    }
    try {
      return send(200, { signature: await signRequest(body?.kind, body?.payload) })
    } catch (error) {
      return send(422, { error: String(error?.message || 'Refused').slice(0, 200) })
    }
  })
}
