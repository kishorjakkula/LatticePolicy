import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const composeFile = fileURLToPath(new URL('./docker-compose.yml', import.meta.url))
const available = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0
const synthetic = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  LLM_RELEASE_SIGNER_TOKEN: 'synthetic-signer-token-'.repeat(2),
  CARRIER_TENANT_ID: 'synthetic-carrier',
  LLM_RELEASE_PRIVATE_KEY_FILE: '/synthetic/release-key.pem',
  LLM_RELEASE_SIGNER_LOG_DIR: '/synthetic/signer-log',
}
const config = (overrides = {}) => spawnSync('docker', ['compose', '--env-file', '/dev/null', '-f', composeFile,
  'config', '--format', 'json'], { env: { ...synthetic, ...overrides }, encoding: 'utf8', timeout: 30000 })

test('release signer runs on an internal network with a read-only key and no host ports',
  { skip: !available && 'Docker Compose CLI unavailable' }, () => {
    const result = config()
    assert.equal(result.status, 0, result.stderr)
    const rendered = JSON.parse(result.stdout)
    const signer = rendered.services['release-signer']
    assert.equal(rendered.networks.signing.internal, true)
    assert.equal(signer.ports?.length || 0, 0)
    assert.equal(signer.read_only, true)
    const key = signer.volumes.find((volume) => volume.target === '/run/secrets/release-key.pem')
    assert.equal(key.read_only, true)
    for (const name of ['LLM_RELEASE_PRIVATE_KEY_FILE', 'LLM_RELEASE_SIGNER_TOKEN', 'LLM_RELEASE_SIGNER_LOG_DIR']) {
      const missing = config({ [name]: '' })
      assert.notEqual(missing.status, 0)
      assert.match(missing.stderr, new RegExp(name))
    }
  })
