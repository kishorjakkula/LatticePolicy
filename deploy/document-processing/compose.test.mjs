import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const composeFile = fileURLToPath(new URL('./docker-compose.yml', import.meta.url))
const available = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0
const synthetic = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  DOCUMENT_PROCESSOR_TOKEN: 'synthetic-token-'.repeat(4),
  MODEL_NAME: 'synthetic-model@v1', MODEL_ARTIFACT_SHA256: 'a'.repeat(64),
  CARRIER_TENANT_ID: 'synthetic-carrier',
  EXTRACTION_PROFILES_DIR: '/synthetic/profiles',
  LLM_RELEASE_PUBLIC_KEY_FILE: '/synthetic/public.pem',
  LLM_RELEASE_REVOCATION_DIR: '/synthetic/release-policy',
  LOCAL_MODELS_DIR: '/synthetic/models',
  OLLAMA_IMAGE: `synthetic-ollama@sha256:${'b'.repeat(64)}`,
}

function config(overrides = {}) {
  return spawnSync('docker', ['compose', '--env-file', '/dev/null', '-f', composeFile,
    'config', '--format', 'json'], { env: { ...synthetic, ...overrides }, encoding: 'utf8', timeout: 30000 })
}

test('synthetic compose config requires a read-only policy-directory mount and defaults signed policy',
  { skip: !available && 'Docker Compose CLI unavailable' }, () => {
    const result = config()
    assert.equal(result.status, 0, result.stderr)
    const rendered = JSON.parse(result.stdout)
    const processor = rendered.services['document-processor']
    assert.equal(processor.environment.RELEASE_ENVIRONMENT, 'production')
    assert.equal(String(processor.environment.LLM_RELEASE_MAX_AGE_SECONDS), '604800')
    assert.equal(processor.environment.LLM_RELEASE_REVOCATION_FILE, '/release-policy/revocations.json')
    const mount = processor.volumes.find(volume => volume.target === '/release-policy')
    assert.equal(mount.type, 'bind')
    assert.equal(mount.source, '/synthetic/release-policy')
    assert.equal(mount.read_only, true)
    assert.equal(mount.bind.create_host_path, false)
    assert.equal(processor.read_only, true)
    assert.equal(rendered.networks.processing.internal, true)
    for (const service of Object.values(rendered.services))
      assert.equal(service.ports?.length || 0, 0)
  })

test('synthetic compose config passes custom receipt policy and denies an unset or empty host policy directory',
  { skip: !available && 'Docker Compose CLI unavailable' }, () => {
    const result = config({ RELEASE_ENVIRONMENT: 'validation', LLM_RELEASE_MAX_AGE_SECONDS: '3600',
      LLM_RELEASE_REVOCATION_FILE: '/release-policy/carrier-revocations.json' })
    assert.equal(result.status, 0, result.stderr)
    const env = JSON.parse(result.stdout).services['document-processor'].environment
    assert.equal(env.RELEASE_ENVIRONMENT, 'validation')
    assert.equal(String(env.LLM_RELEASE_MAX_AGE_SECONDS), '3600')
    assert.equal(env.LLM_RELEASE_REVOCATION_FILE, '/release-policy/carrier-revocations.json')
    for (const value of [undefined, '']) {
      const missing = config({ LLM_RELEASE_REVOCATION_DIR: value })
      assert.notEqual(missing.status, 0)
      assert.match(missing.stderr, /LLM_RELEASE_REVOCATION_DIR/)
    }
  })
