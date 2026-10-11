import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { credentials, login, prepare, pilotRoot, profile } from './pilot-lib.mjs'

const auth = credentials()
const session = await login()
await prepare(session.token)
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.pilot.config.ts'], {
  stdio: 'inherit', env: { ...process.env, E2E_BASE_URL: profile.uiUrl, E2E_API_BASE_URL: profile.apiUrl,
    E2E_TENANT_ID: profile.tenantId, E2E_PASSWORD: auth.password, PILOT_USERNAME: auth.username,
    PILOT_PACK_PATH: path.join(pilotRoot, 'pack') },
})
process.exitCode = result.status ?? 1
