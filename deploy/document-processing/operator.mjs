import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { releasePolicyFromEnv, verifyAuthorization } from '../../services/document-processor/release-authorization.mjs'
import { activateProfile, validateProfile } from '../../services/document-processor/profiles.mjs'
import { privateJson, isPrivateAddress } from '../../services/document-processor/private-http.mjs'

/** Hash actual bytes, never a model name or a caller-supplied manifest digest. */
export async function verifyModelArtifact(file, expected) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || (before.mode & 0o222n) !== 0n || before.size === 0n)
      throw new Error('Model artifact must be a nonempty read-only regular file')
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    const after = await handle.stat({ bigint: true })
    if (before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        hash.digest('hex') !== expected)
      throw new Error('Local model artifact SHA256 mismatch or file changed')
    return { sha256: expected, bytes: Number(after.size) }
  } finally { await handle.close() }
}

async function privateEndpoint(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.hash || url.search || url.pathname !== '/v1/extract')
    throw new Error('A private /v1/extract endpoint is required')
  const answers = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true })
  if (!answers.length || answers.some(answer => !isPrivateAddress(answer.address)))
    throw new Error('Smoke endpoint must resolve only to private addresses')
}

export async function preflight(config, authorization, env = process.env) {
  for (const key of ['profilesDir', 'modelArtifactFile', 'recordsDir', 'privateEndpoint', 'tokenFile'])
    if (typeof config[key] !== 'string' || !config[key]) throw new Error('Incomplete operator configuration')
  const policy = await releasePolicyFromEnv(env)
  if (!policy || !policy.revocationFile) throw new Error('Signed policy and carrier revocation file are required')
  const artifacts = authorization?.payload?.artifacts
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(artifacts?.profileId || '') ||
      !/^\d+\.\d+\.\d+$/.test(artifacts?.profileVersion || ''))
    throw new Error('Invalid receipt profile identity')
  const profile = validateProfile(JSON.parse(await readFile(
    path.join(config.profilesDir, artifacts.profileId, `${artifacts.profileVersion}.json`), 'utf8')))
  const payload = verifyAuthorization(authorization, policy, profile)
  const artifact = await verifyModelArtifact(config.modelArtifactFile, policy.modelSha256)
  await privateEndpoint(config.privateEndpoint)
  const token = (await readFile(config.tokenFile, 'utf8')).trim()
  if (token.length < 32 || /[\r\n]/.test(token)) throw new Error('Invalid processor token file')
  return { policy, profile, payload, artifact, token }
}

export async function runDeployment(command, config, authorization, env = process.env) {
  if (!['preflight', 'activate', 'rollback'].includes(command)) throw new Error('Unknown deployment command')
  const checked = await preflight(config, authorization, env)
  const { profile, policy, payload, artifact, token } = checked
  const record = {
    schemaVersion: 1, deploymentId: randomUUID(), operation: command,
    tenantId: policy.tenantId, environment: policy.environment, releaseId: payload.releaseId,
    profileId: profile.id, profileVersion: profile.version,
    profileSha256: payload.artifacts.profileSha256,
    authorizationSha256: createHash('sha256').update(JSON.stringify(authorization)).digest('hex'),
    model: policy.model, modelSha256: artifact.sha256, modelBytes: artifact.bytes,
    startedAt: new Date().toISOString(), status: 'preflight-verified',
  }
  if (command === 'preflight') return record
  await mkdir(config.recordsDir, { recursive: true, mode: 0o700 })
  const lock = path.join(config.profilesDir, '.deployment.lock')
  await writeFile(lock, '', { flag: 'wx', mode: 0o600 })
  const destination = path.join(config.recordsDir, `${record.deploymentId}.json`)
  const temporary = `${destination}.tmp`
  try {
    record.status = 'started'
    await writeFile(destination, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 })
    try {
      // Rollback is an activation of a previous release, never a pointer bypass.
      await verifyModelArtifact(config.modelArtifactFile, policy.modelSha256)
      await activateProfile(config.profilesDir, profile.id, profile.version, authorization, policy)
      const response = await privateJson(config.privateEndpoint, {
        schemaVersion: 1, profile: profile.id,
        documents: [{ id: 'deployment-smoke', fileName: 'synthetic.txt', mediaType: 'text/plain',
          textLines: ['Synthetic deployment smoke check. No carrier data.'] }],
        schema: { fields: [], variants: [] },
      }, { token, timeoutMs: 180000, maxBytes: 1024 * 1024 })
      if (response?.schemaVersion !== 1 || response.releaseId !== payload.releaseId ||
          response.model !== policy.model || response.profile?.id !== profile.id ||
          response.profile?.version !== profile.version || !Array.isArray(response.result?.values) ||
          !Array.isArray(response.result?.conflicts))
        throw new Error('Private smoke response does not match deployment')
      await verifyModelArtifact(config.modelArtifactFile, policy.modelSha256)
      verifyAuthorization(authorization, policy, profile)
      record.status = 'smoke-passed'
    } catch {
      // Never persist response/error bodies, paths, tokens, or document content.
      record.status = 'failed'
    }
    record.completedAt = new Date().toISOString()
    await writeFile(temporary, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 })
    await rename(temporary, destination)
    if (record.status === 'failed') throw new Error('Deployment failed; inspect metadata record and use a verified rollback receipt')
    return record
  } finally {
    await unlink(temporary).catch(() => {})
    await unlink(lock)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, configFile, receiptFile, ...extra] = process.argv.slice(2)
    if (!command || !configFile || !receiptFile || extra.length)
      throw new Error('Usage: operator.mjs preflight|activate|rollback CONFIG.json RECEIPT.json')
    const config = JSON.parse(await readFile(configFile, 'utf8'))
    for (const key of ['profilesDir', 'modelArtifactFile', 'recordsDir', 'tokenFile'])
      if (typeof config[key] === 'string') config[key] = path.resolve(path.dirname(configFile), config[key])
    const authorization = JSON.parse(await readFile(receiptFile, 'utf8'))
    const record = await runDeployment(command, config, authorization)
    console.log(JSON.stringify(record))
  } catch {
    console.error('Operator command failed. Check local policy, receipt, artifact, private endpoint and deployment metadata. No payload logged.')
    process.exitCode = 1
  }
}
