import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  q: vi.fn(),
  send: vi.fn(),
  transport: vi.fn(),
}))
vi.mock('../../db.js', () => ({
  withTenantTx: async (_tenant: string, operation: any) => operation({}),
  toRawQuery: () => mocks.q,
}))
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.transport } }))
import { sendLlmReleaseEmail } from '../llm-release-email.service.js'

const id = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('LLM_EMAIL_ENABLED', 'true')
  vi.stubEnv('LLM_SMTP_HOST', 'smtp.internal.test')
  vi.stubEnv('LLM_SMTP_FROM', 'release@example.test')
  vi.stubEnv('LLM_SMTP_PORT', '587')
  mocks.transport.mockReturnValue({ sendMail: mocks.send })
  mocks.send.mockResolvedValue({
    messageId: 'smtp-message',
    accepted: ['technical@example.test'],
  })
  mocks.q.mockImplementation(async (sql: string) =>
    sql.includes('SELECT n.*')
      ? {
          rows: [
            {
              subject: 'Candidate ready',
              body: 'Review the release',
              payload: { recipientUserId: id },
              current_email: 'technical@example.test',
            },
          ],
          rowCount: 1,
        }
      : sql.includes('SELECT 1')
        ? { rows: [{}], rowCount: 1 }
        : { rows: [], rowCount: 1 },
  )
})
afterEach(() => vi.unstubAllEnvs())
describe('technical-admin SMTP delivery', () => {
  it.each(['', 'false', 'TRUE', '1'])(
    'suppresses queued email for non-opt-in flag %j without SMTP or retries',
    async (flag) => {
      vi.stubEnv('LLM_EMAIL_ENABLED', flag)
      vi.stubEnv('LLM_SMTP_HOST', '')
      vi.stubEnv('LLM_SMTP_FROM', '')
      await sendLlmReleaseEmail('carrier', id, 1, 8)
      expect(mocks.transport).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
      expect(mocks.q).toHaveBeenCalledWith(
        expect.stringContaining(
          "status='Suppressed',last_error='LLM email disabled",
        ),
        ['carrier', id],
      )
      expect(
        mocks.q.mock.calls.some(
          ([sql]) => sql.includes("status='Sent'") || sql.includes('SELECT 1'),
        ),
      ).toBe(false)
    },
  )
  it('defaults to disabled when the flag is absent', async () => {
    vi.stubEnv('LLM_EMAIL_ENABLED', undefined)
    await sendLlmReleaseEmail('carrier', id, 1, 8)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.q).toHaveBeenCalledWith(
      expect.stringContaining("status='Suppressed'"),
      ['carrier', id],
    )
  })
  it.each(['Sent', 'Suppressed'])(
    'leaves terminal %s notices unchanged even after enabling email',
    async (status) => {
      mocks.q.mockResolvedValueOnce({ rows: [{ status }] })
      await sendLlmReleaseEmail('carrier', id, 1, 8)
      expect(mocks.q).toHaveBeenCalledTimes(1)
      expect(mocks.send).not.toHaveBeenCalled()
    },
  )
  it('does not send to a revoked technical administrator when enabled', async () => {
    mocks.q.mockResolvedValueOnce({
      rows: [
        {
          payload: { recipientUserId: id },
          current_email: 'technical@example.test',
        },
      ],
    })
    mocks.q.mockResolvedValueOnce({ rowCount: 0 })
    await sendLlmReleaseEmail('carrier', id, 1, 8)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.q).toHaveBeenCalledWith(
      expect.stringContaining("status='Suppressed'"),
      ['carrier', id],
    )
  })
  it('rejects non-TLS SMTP ports when enabled', async () => {
    vi.stubEnv('LLM_SMTP_PORT', '25')
    await expect(sendLlmReleaseEmail('carrier', id, 1, 8)).rejects.toThrow(
      /email delivery failed/,
    )
    expect(mocks.transport).not.toHaveBeenCalled()
  })
  it('requires TLS and disables document/URL attachments and protocol logging', async () => {
    await sendLlmReleaseEmail('carrier', id, 1, 8)
    expect(mocks.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.internal.test',
        port: 587,
        requireTLS: true,
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
        tls: { rejectUnauthorized: true },
      }),
    )
    expect(mocks.send).toHaveBeenCalledWith({
      from: 'release@example.test',
      to: 'technical@example.test',
      subject: 'Candidate ready',
      text: 'Review the release',
      messageId: `<llm-${id}@latticepolicy.local>`,
    })
  })
  it('fails closed instead of logging or silently dropping mail when SMTP is absent', async () => {
    vi.stubEnv('LLM_SMTP_HOST', '')
    await expect(sendLlmReleaseEmail('carrier', id, 1, 8)).rejects.toThrow(
      /email delivery failed/,
    )
    expect(mocks.send).not.toHaveBeenCalled()
    expect(
      mocks.q.mock.calls.some(
        ([sql, params]) =>
          sql.includes('UPDATE notification_intents') && params[2] === 'Queued',
      ),
    ).toBe(true)
  })
  it('records exhausted retries as failed without exposing relay errors', async () => {
    mocks.send.mockRejectedValue(new Error('smtp-password-do-not-log'))
    await expect(sendLlmReleaseEmail('carrier', id, 8, 8)).rejects.toThrow(
      'Technical-admin email delivery failed; check SMTP configuration',
    )
    expect(
      mocks.q.mock.calls.some(
        ([sql, params]) =>
          sql.includes('UPDATE notification_intents') && params[2] === 'Failed',
      ),
    ).toBe(true)
  })
})
