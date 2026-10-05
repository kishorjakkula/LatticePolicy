import { describe, expect, it, vi } from 'vitest'
import {
  createNotificationTemplate,
  getNotificationTemplate,
  listNotificationTemplates,
  previewNotificationTemplate,
  setNotificationTemplateActive,
  updateNotificationTemplate,
  validateNotificationTemplateInput,
} from '../notification-template-admin.service.js'

// Maps INSERT INTO notification_templates (...) VALUES ($1..$15) params, in
// the exact order createNotificationTemplate binds them.
function insertRowFromParams(params: any[]) {
  return {
    template_id: params[0],
    tenant_id: params[1],
    template_code: params[2],
    event_type: params[3],
    channel: params[4],
    product_code: params[5],
    transaction_type: params[6],
    locale: params[7],
    subject_template: params[8],
    body_template: params[9],
    visibility: params[10],
    active: params[11],
    effective_date: params[12],
    expiration_date: params[13],
    metadata: typeof params[14] === 'string' ? JSON.parse(params[14]) : params[14],
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

// Maps the full UPDATE ... SET template_code = $3, ... params, in the exact
// order updateNotificationTemplate binds them ($1=tenantId, $2=templateId).
function updateRowFromParams(params: any[]) {
  return {
    template_id: params[1],
    tenant_id: params[0],
    template_code: params[2],
    event_type: params[3],
    channel: params[4],
    product_code: params[5],
    transaction_type: params[6],
    locale: params[7],
    subject_template: params[8],
    body_template: params[9],
    visibility: params[10],
    active: true,
    effective_date: params[11],
    expiration_date: params[12],
    metadata: typeof params[13] === 'string' ? JSON.parse(params[13]) : params[13],
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:05:00.000Z',
  }
}

function makeRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    template_id: 't1',
    tenant_id: 'sample-carrier',
    template_code: 'pa-cancel-ca',
    event_type: 'POLICY_CANCELLED',
    channel: 'EMAIL',
    product_code: null,
    transaction_type: null,
    locale: 'en-US',
    subject_template: 'Old subject',
    body_template: 'Old body',
    visibility: ['customer'],
    active: true,
    effective_date: null,
    expiration_date: null,
    metadata: {},
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function createDbMock(rows: any[] = []) {
  const calls: Array<{ text: string; params?: any[] }> = []
  const query = vi.fn(async (text: string, params: any[] = []) => {
    calls.push({ text, params })
    if (text.includes('INSERT INTO notification_templates')) {
      return { rows: [insertRowFromParams(params)], rowCount: 1 }
    }
    if (text.includes('SELECT * FROM notification_templates WHERE tenant_id = $1 AND template_id')) {
      const [tenantId, templateId] = params
      const found = rows.filter((r) => r.tenant_id === tenantId && r.template_id === templateId)
      return { rows: found, rowCount: found.length }
    }
    if (text.includes('SELECT * FROM notification_templates')) {
      return { rows, rowCount: rows.length }
    }
    if (text.includes('UPDATE notification_templates') && text.includes('SET template_code')) {
      return { rows: [updateRowFromParams(params)], rowCount: 1 }
    }
    if (text.includes('UPDATE notification_templates') && text.includes('SET active')) {
      const [tenantId, templateId, active, metadataJson] = params
      return {
        rows: [
          {
            ...makeRow({ tenant_id: tenantId, template_id: templateId, active }),
            metadata: JSON.parse(metadataJson),
          },
        ],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  })
  return { db: { __pgClient: { query } } as any, calls }
}

const validInput = {
  templateCode: 'pa-cancel-ca',
  eventType: 'POLICY_CANCELLED',
  subjectTemplate: 'Cancellation {{policyNumber}}',
  bodyTemplate: 'Cancelled {{effectiveDate}} because {{reason}}',
}

describe('notification template admin validation', () => {
  it('requires templateCode, eventType, subjectTemplate, and bodyTemplate on create', () => {
    expect(validateNotificationTemplateInput({})).toBe('templateCode is required')
    expect(validateNotificationTemplateInput({ templateCode: 'x' })).toBe('eventType is required')
    expect(
      validateNotificationTemplateInput({ templateCode: 'x', eventType: 'POLICY_ISSUED' })
    ).toBe('subjectTemplate is required')
    expect(
      validateNotificationTemplateInput({ templateCode: 'x', eventType: 'POLICY_ISSUED', subjectTemplate: 'Hi' })
    ).toBe('bodyTemplate is required')
    expect(validateNotificationTemplateInput(validInput)).toBeNull()
  })

  it('allows partial payloads for updates', () => {
    expect(validateNotificationTemplateInput({ subjectTemplate: 'New subject' }, { partial: true })).toBeNull()
    expect(validateNotificationTemplateInput({ subjectTemplate: '' }, { partial: true })).toBe(
      'subjectTemplate is required'
    )
  })

  it('rejects unsupported channel and visibility values', () => {
    expect(validateNotificationTemplateInput({ ...validInput, channel: 'SMS' })).toBe('channel must be one of EMAIL')
    expect(validateNotificationTemplateInput({ ...validInput, visibility: ['vendor'] })).toBe(
      'visibility values must be one of customer, internal'
    )
  })

  it('rejects invalid effective/expiration dates', () => {
    expect(validateNotificationTemplateInput({ ...validInput, effectiveDate: 'not-a-date' })).toBe(
      'effectiveDate must be a valid date'
    )
    expect(validateNotificationTemplateInput({ ...validInput, expirationDate: 'nope' })).toBe(
      'expirationDate must be a valid date'
    )
  })
})

describe('notification template admin service', () => {
  it('creates a template with defaults and maps the row back to camelCase', async () => {
    const { db, calls } = createDbMock()

    const result = await createNotificationTemplate(db, 'sample-carrier', validInput, 'admin1')

    expect(result).toMatchObject({
      templateCode: 'pa-cancel-ca',
      eventType: 'POLICY_CANCELLED',
      channel: 'EMAIL',
      locale: 'en-US',
      visibility: ['customer'],
      active: true,
    })

    const insertCall = calls.find((call) => call.text.includes('INSERT INTO notification_templates'))
    expect(insertCall?.params).toEqual(
      expect.arrayContaining(['sample-carrier', 'pa-cancel-ca', 'POLICY_CANCELLED', 'EMAIL'])
    )
  })

  it('raises TEMPLATE_CODE_EXISTS on a unique constraint violation', async () => {
    const { db } = createDbMock()
    ;(db.__pgClient.query as any).mockImplementationOnce(async () => {
      const err: any = new Error('duplicate key value violates unique constraint')
      err.code = '23505'
      throw err
    })

    await expect(createNotificationTemplate(db, 'sample-carrier', validInput, 'admin1')).rejects.toThrow(
      'TEMPLATE_CODE_EXISTS'
    )
  })

  it('lists templates scoped to the tenant with the requested filters', async () => {
    const { db, calls } = createDbMock([makeRow()])

    const result = await listNotificationTemplates(db, 'sample-carrier', { eventType: 'POLICY_CANCELLED' })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ templateId: 't1', templateCode: 'pa-cancel-ca' })
    const listCall = calls.find(
      (call) => call.text.includes('SELECT * FROM notification_templates') && call.text.includes('ORDER BY')
    )
    expect(listCall?.params).toEqual(['sample-carrier', 'POLICY_CANCELLED'])
  })

  it('returns null from getNotificationTemplate when no row matches', async () => {
    const { db } = createDbMock([])
    const result = await getNotificationTemplate(db, 'sample-carrier', 'missing-id')
    expect(result).toBeNull()
  })

  it('updates a template, merging unspecified fields from the current row', async () => {
    const { db, calls } = createDbMock([makeRow()])

    const result = await updateNotificationTemplate(
      db,
      'sample-carrier',
      't1',
      { subjectTemplate: 'New subject' },
      'admin1'
    )

    expect(result).toMatchObject({ subjectTemplate: 'New subject', bodyTemplate: 'Old body' })
    const updateCall = calls.find(
      (call) => call.text.includes('UPDATE notification_templates') && call.text.includes('SET template_code')
    )
    expect(updateCall?.params).toEqual([
      'sample-carrier',
      't1',
      'pa-cancel-ca',
      'POLICY_CANCELLED',
      'EMAIL',
      null,
      null,
      'en-US',
      'New subject',
      'Old body',
      ['customer'],
      null,
      null,
      expect.any(String),
    ])
  })

  it('returns null from updateNotificationTemplate when the template does not exist', async () => {
    const { db } = createDbMock([])
    const result = await updateNotificationTemplate(db, 'sample-carrier', 'missing-id', { subjectTemplate: 'x' }, 'admin1')
    expect(result).toBeNull()
  })

  it('activates and deactivates a template', async () => {
    const { db, calls } = createDbMock([makeRow({ active: false })])

    const result = await setNotificationTemplateActive(db, 'sample-carrier', 't1', true, 'admin1')

    expect(result).toMatchObject({ active: true })
    const activateCall = calls.find((call) => call.text.includes('SET active'))
    expect(activateCall?.params).toEqual(['sample-carrier', 't1', true, expect.any(String)])
  })
})

describe('notification template preview', () => {
  it('renders subject and body against sample merge fields using the runtime renderer', () => {
    const result = previewNotificationTemplate({
      subjectTemplate: 'Policy {{policyNumber}} for {{recipient.name}}',
      bodyTemplate: 'Cancelled {{effectiveDate}} because {{reason}}',
      sampleFields: {
        policyNumber: 'PA-1',
        effectiveDate: '2026-08-01',
        reason: 'insured request',
        recipient: { name: 'Ada Lovelace' },
      },
    })

    expect(result).toEqual({
      subject: 'Policy PA-1 for Ada Lovelace',
      body: 'Cancelled 2026-08-01 because insured request',
    })
  })

  it('renders blank for missing merge fields instead of leaving placeholders', () => {
    const result = previewNotificationTemplate({
      subjectTemplate: 'Hello {{unknownField}}',
      bodyTemplate: 'Body {{alsoUnknown}}',
    })
    expect(result).toEqual({ subject: 'Hello ', body: 'Body ' })
  })
})
