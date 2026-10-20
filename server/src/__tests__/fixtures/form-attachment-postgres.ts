import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { setTimeout } from 'node:timers/promises'
import { Pool } from 'pg'

const exec = promisify(execFile)

/** Root runner owns this database; ordinary inherited URLs are never trusted. */
export function disposableFormAttachmentDatabase(env: Record<string, string | undefined>): string | undefined {
  if (env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true') return undefined
  const value = env.DATABASE_URL
  let parsed: URL
  try { parsed = new URL(value || '') } catch {
    throw new Error('Disposable integration database opt-in requires a valid DATABASE_URL')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.pathname !== '/lattice_policy_integration'
    || !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(parsed.hostname)
    || parsed.search || parsed.hash) {
    throw new Error('Disposable integration database requires an exact lattice_policy_integration database on a local host, without URL options')
  }
  return value
}

/** Standalone owns Docker; the explicit root-runner opt-in never invokes Docker. */
export async function startFormAttachmentPostgres() {
  const inherited = disposableFormAttachmentDatabase(process.env)
  if (inherited) return { url: inherited, name: 'root-runner-owned', stop: async () => {} }
  const name = `lattice-form-attachment-test-${randomUUID()}`
  const password = randomUUID()
  const stop = async () => { await exec('docker', ['rm', '-f', name]) }
  try {
    await exec('docker', [
      'run', '--detach', '--rm', '--name', name,
      '--publish', '127.0.0.1::5432',
      '--env', 'POSTGRES_DB=form_attachment_test',
      '--env', `POSTGRES_PASSWORD=${password}`,
      'postgres:16-alpine',
    ], { timeout: 120_000 })
    const { stdout } = await exec('docker', ['port', name, '5432/tcp'])
    const parts = stdout.trim().split(':')
    const port = Number(parts[parts.length - 1])
    if (!Number.isInteger(port) || port <= 0) throw new Error('Missing disposable PostgreSQL port')
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/form_attachment_test`
    const probe = new Pool({ connectionString: url, connectionTimeoutMillis: 500 })
    try {
      let ready = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try { await probe.query('SELECT 1'); ready = true; break } catch { await setTimeout(100) }
      }
      if (!ready) throw new Error('Disposable PostgreSQL did not become ready')
    } finally {
      await probe.end()
    }
    return { url, name, stop }
  } catch (error) {
    await stop().catch(() => undefined)
    throw error
  }
}
