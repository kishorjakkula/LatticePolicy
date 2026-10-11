import { logger } from '../../logger.js'
import type { EventEnvelope } from '../envelope.js'
import type { EventTransport } from '../transport.js'

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * Posts each message to ASYNC_PUSH_WEBHOOK_URL. With no URL it writes the
 * message to the log instead, which is how local and demo stacks run.
 */
export function createWebhookTransport(settings: { webhookUrl?: string; authHeader?: string; requestTimeoutMs?: number } = {}): EventTransport {
  const webhookUrl = (settings.webhookUrl ?? process.env.ASYNC_PUSH_WEBHOOK_URL ?? '').trim()
  const authHeader = (settings.authHeader ?? process.env.ASYNC_PUSH_AUTH_HEADER ?? '').trim()
  const requestTimeoutMs = settings.requestTimeoutMs ?? parsePositiveInt(process.env.ASYNC_PUSH_TIMEOUT_MS, 5000)

  return {
    name: 'webhook',
    async publish(envelope: EventEnvelope) {
      if (!webhookUrl) {
        logger.info({ envelope }, '[async-push] Emitted to stdout')
        return
      }
      const abortController = new AbortController()
      const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs)
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (authHeader) headers.authorization = authHeader
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(envelope),
          signal: abortController.signal,
        })
        if (!response.ok) {
          const body = (await safeReadBody(response)).trim()
          throw new Error(`webhook returned ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`)
        }
      } finally {
        clearTimeout(timeout)
      }
    },
    async close() {},
  }
}
