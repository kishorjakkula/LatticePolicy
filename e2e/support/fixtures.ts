import { test as base, expect, type Page } from '@playwright/test'
import { type AuthSession, installAuthState, loginApi, syntheticClientIp } from './api'

type TestFixtures = {
  /** Installs a cached API session for `username` into the page (no UI login). */
  signInAs: (page: Page, username: string, password?: string) => Promise<AuthSession>
}

type WorkerFixtures = {
  /** One API login per user per worker, so a full run stays far below the login limiter. */
  sessionFor: (username: string, password?: string) => Promise<AuthSession>
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Applies to both the browser context and the `request` fixture.
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'X-Forwarded-For': syntheticClientIp() })
  },

  sessionFor: [async ({ playwright }, use) => {
    const cache = new Map<string, Promise<AuthSession>>()
    const contexts: Array<{ dispose: () => Promise<void> }> = []
    await use((username, password) => {
      const key = `${username}:${password ?? ''}`
      if (!cache.has(key)) {
        cache.set(key, (async () => {
          const context = await playwright.request.newContext({
            extraHTTPHeaders: { 'X-Forwarded-For': syntheticClientIp() },
          })
          contexts.push(context)
          return loginApi(context, username, password)
        })())
      }
      return cache.get(key)!
    })
    await Promise.all(contexts.map((context) => context.dispose()))
  }, { scope: 'worker' }],

  signInAs: async ({ sessionFor }, use) => {
    await use(async (page, username, password) => {
      const session = await sessionFor(username, password)
      await installAuthState(page, session)
      return session
    })
  },
})

export { expect }
