import { request, type FullConfig } from '@playwright/test'
import { apiBaseUrl, loginApi, seedReferenceData, syntheticClientIp } from './support/api'

/**
 * Runs once before the suite. A fresh stack has no underwriting companies,
 * forms, or agency, and the Quote Wizard cannot leave its first step without
 * them, so seed the (idempotent) reference data up front.
 */
export default async function globalSetup(_config: FullConfig) {
  const context = await request.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': syntheticClientIp() } })
  try {
    const deadline = Date.now() + 120_000
    for (;;) {
      const health = await context.get(`${apiBaseUrl}/health`).catch(() => null)
      if (health?.ok()) break
      if (Date.now() > deadline) throw new Error(`API at ${apiBaseUrl} did not become healthy`)
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    const admin = await loginApi(context, 'admin')
    await seedReferenceData(context, admin.token)
  } finally {
    await context.dispose()
  }
}
