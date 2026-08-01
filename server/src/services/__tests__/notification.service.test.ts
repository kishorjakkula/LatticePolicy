import { describe, expect, it, vi } from 'vitest'
import {
  createPolicyNotificationIntent,
  renderNotificationTemplate,
  resolvePolicyNotificationRecipient,
} from '../notification.service.js'

function createDbMock(templateRows: any[] = []) {
  const calls: Array<{ text: string; params?: any[] }> = []
  const query = vi.fn(async (text: string, params?: any[]) => {
    calls.push({ text, params })
    if (text.includes('FROM notification_templates')) {
      return { rows: templateRows, rowCount: templateRows.length }
    }
    return { rows: [], rowCount: 1 }
  })
  return {
    db: { __pgClient: { query } } as any,
    calls,
  }
}

const baseContext = {
  tenantId: 'sample-carrier',
  policyId: '11111111-1111-1111-1111-111111111111',
  policyNumber: 'PA-2026-000001',
  productCode: 'personal-auto',
  transactionId: '22222222-2222-2222-2222-222222222222',
  transactionType: 'Issue',
  transactionNumber: 'NB-20260801-ABCD',
  effectiveDate: '2026-08-01',
  expirationDate: '2027-08-01',
  payload: {
    applicant: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada@example.com',
    },
  },
  actorId: null,
}

describe('notification service', () => {
  it('renders merge fields and resolves customer recipients', () => {
    expect(
      renderNotificationTemplate('Policy {{policyNumber}} for {{recipient.name}}', {
        policyNumber: 'PA-1',
        recipient: { name: 'Ada Lovelace' },
      })
    ).toBe('Policy PA-1 for Ada Lovelace')

    expect(resolvePolicyNotificationRecipient(baseContext.payload)).toEqual({
      type: 'customer',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      visibility: 'customer',
    })
  })

  it('creates queued issue notification intents and outbox messages', async () => {
    const { db, calls } = createDbMock()

    const result = await createPolicyNotificationIntent(db, {
      ...baseContext,
      eventType: 'POLICY_ISSUED',
    })

    expect(result).toMatchObject({
      eventType: 'POLICY_ISSUED',
      templateCode: 'policy-issued-default',
      status: 'Queued',
      channel: 'EMAIL',
      recipient: { email: 'ada@example.com' },
    })
    expect(result.subject).toBe('Policy PA-2026-000001 issued')

    const intentInsert = calls.find((call) => call.text.includes('INSERT INTO notification_intents'))
    expect(intentInsert?.params).toEqual(
      expect.arrayContaining([
        'sample-carrier',
        baseContext.policyId,
        baseContext.transactionId,
        'POLICY_ISSUED',
        'policy-issued-default',
        'Policy PA-2026-000001 issued',
        'Queued',
      ])
    )

    const outboxInsert = calls.find((call) => call.text.includes('INSERT INTO async_message_outbox'))
    expect(outboxInsert?.params).toEqual(
      expect.arrayContaining(['sample-carrier', 'notification.policy_issued'])
    )
  })

  it('uses configured templates for cancellation notices', async () => {
    const { db } = createDbMock([
      {
        template_code: 'pa-cancel-ca',
        subject_template: 'Cancellation {{policyNumber}}',
        body_template: 'Cancelled {{effectiveDate}} because {{reason}}',
        visibility: ['customer'],
      },
    ])

    const result = await createPolicyNotificationIntent(db, {
      ...baseContext,
      transactionType: 'Cancel',
      eventType: 'POLICY_CANCELLED',
      reason: 'insured request',
    })

    expect(result).toMatchObject({
      eventType: 'POLICY_CANCELLED',
      templateCode: 'pa-cancel-ca',
      status: 'Queued',
      subject: 'Cancellation PA-2026-000001',
      body: 'Cancelled 2026-08-01 because insured request',
    })
  })

  it('records non-renewal notifications as suppressed when no recipient is available', async () => {
    const { db, calls } = createDbMock()

    const result = await createPolicyNotificationIntent(db, {
      ...baseContext,
      transactionType: 'NonRenewal',
      eventType: 'POLICY_NON_RENEWAL',
      noticeDate: '2027-01-01',
      payload: { applicant: { firstName: 'No', lastName: 'Email' } },
    })

    expect(result).toMatchObject({
      eventType: 'POLICY_NON_RENEWAL',
      templateCode: 'policy-non-renewal-default',
      status: 'Suppressed',
      recipient: { email: null },
    })
    expect(calls.some((call) => call.text.includes('INSERT INTO notification_intents'))).toBe(true)
    expect(calls.some((call) => call.text.includes('INSERT INTO async_message_outbox'))).toBe(false)
  })
})
