import { describe, expect, it, vi } from 'vitest'
import { seedProductDocumentTemplates } from '../product-document-templates.service.js'

vi.mock('../../routes/forms-admin.routes.js', () => ({ ensureDefaultFormRows: vi.fn().mockResolvedValue(undefined) }))

const options = { carrierCode: 'LATTICE-DEMO', authority: 'DEMO', editionDate: '2026-11-01' }

function store() {
  const forms = new Map<string, { form_id: string; metadata: any }>()
  const rules = new Set<string>()
  const assets = new Set<string>()
  const q = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('SELECT form_id')) {
      const form = forms.get(params[3])
      return { rows: form ? [form] : [], rowCount: form ? 1 : 0 }
    }
    if (sql.includes('INSERT INTO forms_admin_forms')) {
      const form = { form_id: params[3], metadata: JSON.parse(params[7]) }
      forms.set(params[3], form)
      return { rows: [form], rowCount: 1 }
    }
    if (sql.includes('SELECT 1 FROM forms_admin_applicability')) return { rows: [], rowCount: rules.has(params[1]) ? 1 : 0 }
    if (sql.includes('INSERT INTO forms_admin_applicability')) rules.add(params[1])
    if (sql.includes('SELECT 1 FROM forms_admin_template_assets')) return { rows: [], rowCount: assets.has(params[1]) ? 1 : 0 }
    if (sql.includes('INSERT INTO forms_admin_template_assets')) {
      assets.add(params[1])
      return { rows: [{ asset_id: `asset-${params[1]}` }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
  return { q, forms, assets }
}

describe('explicit businessowners document opt-in', () => {
  it('retains the homeowners-only default used by normal admin reference seeding', async () => {
    const { q } = store()
    const result = await seedProductDocumentTemplates(q, 'synthetic', 'operator', options)
    expect(result.created.sort()).toEqual(['HO-BINDER', 'HO-DEC', 'HO-EOI'])
    expect(q.mock.calls.some(([, params]) => params?.some(p => typeof p === 'string' && p.includes('businessowners')))).toBe(false)
  })

  it('an empty selection performs no queries', async () => {
    const { q } = store()
    expect(await seedProductDocumentTemplates(q, 'synthetic', 'operator', { ...options, productCodes: [] }))
      .toEqual({ created: [], attached: [], skipped: [] })
    expect(q).not.toHaveBeenCalled()
  })

  it('explicitly seeds only demo BOP forms once and does not replace assets or rules', async () => {
    const { q, forms } = store()
    const selected = { ...options, productCodes: ['businessowners'] }
    const first = await seedProductDocumentTemplates(q, 'synthetic', 'operator', selected)
    expect(first.created.sort()).toEqual(['BOP-BINDER', 'BOP-DEC', 'BOP-QUOTE'])
    expect(first.attached.sort()).toEqual(['BOP-BINDER', 'BOP-DEC', 'BOP-QUOTE'])
    expect([...forms.values()].every(form => form.metadata.nonContractual && !form.metadata.regulatoryApprovalClaimed)).toBe(true)
    const insertions = q.mock.calls.filter(([sql]) => sql.includes('INSERT INTO forms_admin_applicability'))
    expect(insertions.map(([, params]) => [params![1], params![3]])).toEqual([
      ['BOP-QUOTE', ['Quote']], ['BOP-BINDER', ['Bind']], ['BOP-DEC', ['Issue', 'Endorse', 'Renew', 'Rewrite']],
    ])
    q.mockClear()
    const second = await seedProductDocumentTemplates(q, 'synthetic', 'operator', selected)
    expect(second.created).toEqual([])
    expect(second.attached).toEqual([])
    expect(q.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false)
  })

  it('does not adopt a carrier-owned form with the same demo number', async () => {
    const { q, forms } = store()
    for (const number of ['BOP-QUOTE', 'BOP-BINDER', 'BOP-DEC']) forms.set(number, { form_id: number, metadata: { carrierOwned: true } })
    const result = await seedProductDocumentTemplates(q, 'synthetic', 'operator', { ...options, productCodes: ['businessowners'] })
    expect(result.created).toEqual([])
    expect(result.attached).toEqual([])
    expect(q.mock.calls.some(([sql]) => sql.includes('INSERT') || sql.includes('UPDATE'))).toBe(false)
  })
})
