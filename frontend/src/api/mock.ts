import { config } from '../config'
import { v4 as uuidv4 } from './uuid'

type QuoteAuditEntry = {
  value: string | number
  updatedAt: string
  updatedBy: string
}

const mockPolicies = new Map<string, any>()
const mockQuotes = new Map<string, {
  quoteId: string
  quoteNumber: string
  payload: any
  premium: any
  underwriting: any
  status: 'Draft' | 'Rated' | 'Converted'
  progressStep: number
  updatedAt: string
  updatedBy?: string
  statusHistory?: QuoteAuditEntry[]
  stepHistory?: QuoteAuditEntry[]
  createdAt: string
  convertedPolicyId?: string
}>()
const mockUnderwritingCompanies = new Map<string, {
  companyId: string
  name: string
  productCode: string
  country: string
  state: string
  active: boolean
  createdAt: string
  updatedAt: string
}>()
const mockFormTemplates = new Map<string, any>()
const mockReferenceAgencies = [
  {
    agencyId: 'f645e5d1-1d14-4e07-9c2a-b0d8f1d51a51',
    agencyCode: 'AG0001',
    agencyKey: 'AGY-SAMPLE-2026-000001',
    legalName: 'Sample Agency One',
    dbaName: 'Sample Agency'
  },
  {
    agencyId: 'b6e9b4f9-9f30-4f32-8761-6e49024222d3',
    agencyCode: 'AG0002',
    agencyKey: 'AGY-SAMPLE-2026-000002',
    legalName: 'Northline Insurance Brokers',
    dbaName: ''
  }
]
const mockReferenceAgencyContacts: Record<string, any[]> = {
  'f645e5d1-1d14-4e07-9c2a-b0d8f1d51a51': [
    {
      contactId: 'a0ce9f7a-1668-4430-ad0f-e7650cff3563',
      displayName: 'Mia Turner',
      firstName: 'Mia',
      lastName: 'Turner',
      email: 'mia.turner@sampleagency.example',
      phoneNumber: '+1 555 100 1001'
    }
  ],
  'b6e9b4f9-9f30-4f32-8761-6e49024222d3': [
    {
      contactId: 'b0f3ca30-8c2d-48db-a014-67e5d53117f1',
      displayName: 'Ethan Cole',
      firstName: 'Ethan',
      lastName: 'Cole',
      email: 'ethan.cole@northline.example',
      phoneNumber: '+1 555 200 3000'
    }
  ]
}
const mockReferenceInsuranceCarriers = [
  'Allstate',
  'American Family Insurance',
  'Amica Mutual',
  'Auto-Owners Insurance',
  'Chubb',
  'COUNTRY Financial',
  'Erie Insurance',
  'Farmers Insurance',
  'GEICO',
  'Grange Insurance',
  'Liberty Mutual',
  'Mercury Insurance',
  'Nationwide',
  'NJM Insurance',
  'Progressive',
  'Safeco',
  'State Farm',
  'The Hartford',
  'Travelers',
  'USAA'
].sort((a, b) => a.localeCompare(b))
let mockTenantSettings = {
  tenantId: 'sample-carrier',
  name: 'Sample Carrier',
  defaultCountry: 'US',
  mfaRequired: false,
  dateFormatsByCountry: {
    US: 'MM-DD-YYYY',
    CA: 'MM-DD-YYYY'
  } as Record<string, string>,
  policyNumberFormatsByProduct: {
    'personal-auto': 'PC-{ID8}',
    'commercial-auto': 'CA-{ID8}',
    homeowners: 'HO-{ID8}',
    cyber: 'CY-{ID8}',
    'professional-liability': 'PL-{ID8}'
  } as Record<string, string>
}

export async function mockApi<T>(method: string, path: string, body?: any): Promise<T> {
  if (config.mockApiDelayMs > 0) {
    await delay(config.mockApiDelayMs)
  }
  seedMockUnderwritingCompanies()
  if (method === 'GET' && path === '/v1/tenant/preferences') {
    const defaultCountry = String(mockTenantSettings.defaultCountry || 'US').toUpperCase()
    const dateFormat =
      mockTenantSettings.dateFormatsByCountry[defaultCountry] ||
      mockTenantSettings.dateFormatsByCountry.US ||
      'MM-DD-YYYY'
    return {
      tenantId: mockTenantSettings.tenantId,
      defaultCountry,
      dateFormatsByCountry: { ...mockTenantSettings.dateFormatsByCountry },
      dateFormat
    } as unknown as T
  }
  if (method === 'GET' && path === '/v1/admin/tenant') {
    return {
      tenantId: mockTenantSettings.tenantId,
      name: mockTenantSettings.name,
      defaultCountry: mockTenantSettings.defaultCountry,
      mfaRequired: mockTenantSettings.mfaRequired,
      dateFormatsByCountry: { ...mockTenantSettings.dateFormatsByCountry },
      policyNumberFormatsByProduct: { ...mockTenantSettings.policyNumberFormatsByProduct }
    } as unknown as T
  }
  if (method === 'PATCH' && path === '/v1/admin/tenant') {
    const name = String(body?.name || '').trim()
    const defaultCountry = String(body?.defaultCountry || mockTenantSettings.defaultCountry || 'US').trim().toUpperCase()
    const dateFormatsByCountry = body?.dateFormatsByCountry && typeof body.dateFormatsByCountry === 'object'
      ? Object.entries(body.dateFormatsByCountry).reduce<Record<string, string>>((acc, [key, value]) => {
          const country = String(key || '').trim().toUpperCase()
          const format = String(value || '').trim().toUpperCase()
          if (!country) return acc
          acc[country] = format || 'MM-DD-YYYY'
          return acc
        }, {})
      : { ...mockTenantSettings.dateFormatsByCountry }
    const policyNumberFormatsByProduct = normalizeMockPolicyNumberFormatsByProduct(
      body?.policyNumberFormatsByProduct,
      mockTenantSettings.policyNumberFormatsByProduct
    )
    mockTenantSettings = {
      ...mockTenantSettings,
      name: name || mockTenantSettings.name,
      defaultCountry: defaultCountry || 'US',
      mfaRequired: body?.mfaRequired === true,
      dateFormatsByCountry: Object.keys(dateFormatsByCountry).length ? dateFormatsByCountry : { US: 'MM-DD-YYYY' },
      policyNumberFormatsByProduct
    }
    if (!mockTenantSettings.dateFormatsByCountry[mockTenantSettings.defaultCountry]) {
      mockTenantSettings.dateFormatsByCountry[mockTenantSettings.defaultCountry] = 'MM-DD-YYYY'
    }
    return {
      tenantId: mockTenantSettings.tenantId,
      name: mockTenantSettings.name,
      defaultCountry: mockTenantSettings.defaultCountry,
      mfaRequired: mockTenantSettings.mfaRequired,
      dateFormatsByCountry: { ...mockTenantSettings.dateFormatsByCountry },
      policyNumberFormatsByProduct: { ...mockTenantSettings.policyNumberFormatsByProduct }
    } as unknown as T
  }
  // Simple in-memory-ish static dataset for search/listing
  const samplePolicies = [
    { policyId: '11111111-1111-1111-1111-111111111111', policyNumber: 'PC-11111111', productCode: 'personal-auto', status: 'Issued', term: { effectiveDate: '2025-01-01', expirationDate: '2026-01-01' } },
    { policyId: '22222222-2222-2222-2222-222222222222', policyNumber: 'PC-22222222', productCode: 'homeowners', status: 'Issued', term: { effectiveDate: '2025-03-15', expirationDate: '2026-03-15' } },
    { policyId: '33333333-3333-3333-3333-333333333333', policyNumber: 'PC-33333333', productCode: 'personal-auto', status: 'Cancelled', term: { effectiveDate: '2024-09-01', expirationDate: '2025-09-01' } }
  ]
  if (method === 'GET' && path.startsWith('/v1/underwriting-companies')) {
    const query = path.includes('?') ? (path.split('?')[1] || '') : ''
    const usp = new URLSearchParams(query)
    const productCode = normalizeProductCode(usp.get('productCode'))
    const country = normalizeCountryCode(usp.get('country'))
    const state = normalizeRegionCode(usp.get('state'))
    const items = filterMockUnderwritingCompanies({ productCode, country, state, includeInactive: false })
      .map(({ companyId, name, productCode: companyProduct, country: companyCountry, state: companyState }) => ({
        companyId,
        name,
        productCode: companyProduct,
        country: companyCountry,
        state: companyState
      }))
    return { items } as unknown as T
  }
  if (method === 'GET' && path.startsWith('/v1/reference/agencies')) {
    const [basePath, query] = path.split('?')
    if (basePath === '/v1/reference/agencies') {
      const params = new URLSearchParams(query || '')
      const q = String(params.get('q') || '').trim().toLowerCase()
      const items = mockReferenceAgencies.filter((item) => {
        if (!q) return true
        const haystack = `${item.agencyCode} ${item.agencyKey} ${item.legalName} ${item.dbaName || ''}`.toLowerCase()
        return haystack.includes(q)
      })
      return { items } as unknown as T
    }
    const contactMatch = /^\/v1\/reference\/agencies\/([^/]+)\/contacts$/.exec(basePath)
    if (contactMatch) {
      const agencyId = decodeURIComponent(contactMatch[1] || '')
      return { items: mockReferenceAgencyContacts[agencyId] || [] } as unknown as T
    }
  }
  if (method === 'GET' && path === '/v1/reference/underwriters') {
    return {
      items: [
        { userId: 'demo-admin', username: 'admin', displayName: 'admin' },
        { userId: 'demo-uw1', username: 'uw1', displayName: 'uw1' }
      ]
    } as unknown as T
  }
  if (method === 'GET' && path.startsWith('/v1/reference/insurance-carriers')) {
    const query = path.includes('?') ? (path.split('?')[1] || '') : ''
    const params = new URLSearchParams(query)
    const q = String(params.get('q') || '').trim().toLowerCase()
    const items = mockReferenceInsuranceCarriers
      .filter((name) => !q || name.toLowerCase().includes(q))
      .map((name) => ({ name, country: 'US' }))
    return { items } as unknown as T
  }
  if (method === 'GET' && path.startsWith('/v1/admin/underwriting-companies')) {
    const query = path.includes('?') ? (path.split('?')[1] || '') : ''
    const usp = new URLSearchParams(query)
    const productCode = normalizeProductCode(usp.get('productCode'))
    const country = normalizeCountryCode(usp.get('country'))
    const state = normalizeRegionCode(usp.get('state'))
    const includeInactive = String(usp.get('includeInactive') || '').toLowerCase() === 'true'
    const items = filterMockUnderwritingCompanies({ productCode, country, state, includeInactive })
    return items as unknown as T
  }
  if (method === 'POST' && path === '/v1/admin/underwriting-companies') {
    const name = normalizeCompanyName(body?.name)
    const productCode = normalizeProductCode(body?.productCode)
    const country = normalizeCountryCode(body?.country)
    const state = normalizeRegionCode(body?.state)
    if (!name || !productCode || !state) throw new Error('Invalid underwriting company input')
    if (hasMockUnderwritingCompanyConflict({ name, productCode, country, state })) {
      throw new Error('Duplicate combination not allowed for this company, product, country, and state/province')
    }
    const nowIso = new Date().toISOString()
    const created = {
      companyId: uuidv4(),
      name,
      productCode,
      country,
      state,
      active: body?.active !== false,
      createdAt: nowIso,
      updatedAt: nowIso
    }
    mockUnderwritingCompanies.set(created.companyId, created)
    return created as unknown as T
  }
  // Form templates admin
  if (method === 'GET' && path === '/v1/admin/form-templates') {
    const items = Array.from(mockFormTemplates.values())
    return items as unknown as T
  }
  if (method === 'POST' && path === '/v1/admin/form-templates') {
    const payload = body || {}
    if (!payload.key || !payload.name) throw new Error('Invalid form template payload: key and name required')
    const now = new Date().toISOString()
    const id = uuidv4()
    const created = { ...payload, id, createdAt: now, updatedAt: now }
    mockFormTemplates.set(id, created)
    return created as unknown as T
  }
  if (method === 'PATCH' && path.startsWith('/v1/admin/form-templates/')) {
    const id = path.split('/')[4]
    const existing = mockFormTemplates.get(id)
    if (!existing) throw new Error('Form template not found')
    const next = { ...existing, ...body, updatedAt: new Date().toISOString() }
    mockFormTemplates.set(id, next)
    return next as unknown as T
  }
  if (method === 'DELETE' && path.startsWith('/v1/admin/form-templates/')) {
    const id = path.split('/')[4]
    mockFormTemplates.delete(id)
    return {} as unknown as T
  }
  if (method === 'PATCH' && path.startsWith('/v1/admin/underwriting-companies/')) {
    const companyId = path.split('/')[4]
    const existing = mockUnderwritingCompanies.get(companyId)
    if (!existing) throw new Error('Underwriting company not found')
    const next = {
      ...existing,
      name: body?.name != null ? normalizeCompanyName(body.name) : existing.name,
      productCode: body?.productCode != null ? normalizeProductCode(body.productCode) : existing.productCode,
      country: body?.country != null ? normalizeCountryCode(body.country) : existing.country,
      state: body?.state != null ? normalizeRegionCode(body.state) : existing.state,
      active: body?.active != null ? body.active !== false : existing.active,
      updatedAt: new Date().toISOString()
    }
    if (
      hasMockUnderwritingCompanyConflict({
        name: next.name,
        productCode: next.productCode,
        country: next.country,
        state: next.state,
        excludeCompanyId: companyId
      })
    ) {
      throw new Error('Duplicate combination not allowed for this company, product, country, and state/province')
    }
    mockUnderwritingCompanies.set(companyId, next)
    return next as unknown as T
  }
  if (method === 'DELETE' && path.startsWith('/v1/admin/underwriting-companies/')) {
    const companyId = path.split('/')[4]
    mockUnderwritingCompanies.delete(companyId)
    return {} as T
  }
  if (method === 'POST' && path === '/v1/quotes') {
    const now = new Date().toISOString()
    const id = body.quoteId || uuidv4()
    const existing = Array.from(mockQuotes.values()).find(q => q.quoteId === id)
    const number = existing?.quoteNumber || `Q${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    const total = mockRate(body)
    const premium = {
      byCoverage: [],
      fees: { amount: 25, currency: 'USD' },
      taxes: { amount: Math.round(total * 0.03 * 100) / 100, currency: 'USD' },
      total: { amount: total, currency: 'USD' }
    }
    const underwriting = mockUW(body)
    const updatedBy = 'mock-user'
    const statusHistory = upsertQuoteAuditHistory(existing?.statusHistory || [], 'Rated', now, updatedBy)
    const stepHistory = upsertQuoteAuditHistory(existing?.stepHistory || [], 5, now, updatedBy)
    mockQuotes.set(id, {
      quoteId: id,
      quoteNumber: number,
      payload: body,
      premium,
      underwriting,
      status: 'Rated',
      progressStep: 5,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      updatedBy,
      statusHistory,
      stepHistory
    })
    return {
      quoteId: id,
      quoteNumber: number,
      premium: {
        ...premium
      },
      underwriting,
      nextActions: ['bind'],
      status: 'Rated',
      progressStep: 5,
      updatedAt: now,
      updatedBy,
      statusHistory,
      stepHistory
    } as unknown as T
  }
  if (method === 'POST' && path === '/v1/quotes/draft') {
    const quoteId = uuidv4()
    const quoteNumber = `Q${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    const payload = body.payload || {}
    const now = new Date().toISOString()
    const updatedBy = 'mock-user'
    const status = body.status || 'Draft'
    const progressStep = body.progressStep || 1
    const statusHistory = upsertQuoteAuditHistory([], status, now, updatedBy)
    const stepHistory = upsertQuoteAuditHistory([], progressStep, now, updatedBy)
    mockQuotes.set(quoteId, {
      quoteId,
      quoteNumber,
      payload,
      premium: null,
      underwriting: null,
      status,
      progressStep,
      createdAt: now,
      updatedAt: now,
      updatedBy,
      statusHistory,
      stepHistory
    })
    return { quoteId, quoteNumber, status, progressStep, updatedAt: now, updatedBy, statusHistory, stepHistory } as unknown as T
  }
  if (method === 'PATCH' && path.startsWith('/v1/quotes/')) {
    const quoteId = path.split('/')[3]
    const existing = mockQuotes.get(quoteId)
    if (!existing) throw new Error('Quote not found')
    const now = new Date().toISOString()
    const payload = body.payload || existing.payload
    const status = body.status || existing.status
    const progressStep = body.progressStep || existing.progressStep
    const updatedBy = 'mock-user'
    const statusHistory = upsertQuoteAuditHistory(existing.statusHistory || [], status, now, updatedBy)
    const stepHistory = upsertQuoteAuditHistory(existing.stepHistory || [], progressStep, now, updatedBy)
    const updated = { ...existing, payload, status, progressStep, updatedAt: now, updatedBy, statusHistory, stepHistory }
    mockQuotes.set(quoteId, updated)
    return {
      quoteId,
      quoteNumber: updated.quoteNumber,
      status: updated.status,
      progressStep: updated.progressStep,
      updatedAt: updated.updatedAt,
      updatedBy: updated.updatedBy || null,
      statusHistory: updated.statusHistory || [],
      stepHistory: updated.stepHistory || []
    } as unknown as T
  }
  if (method === 'GET' && path.startsWith('/v1/quotes?')) {
    const query = path.split('?')[1] || ''
    const usp = new URLSearchParams(query)
    const q = (usp.get('q') || '').toLowerCase()
    const status = usp.get('status') || ''
    const product = (usp.get('product') || '').toLowerCase()
    const page = Math.max(1, Number(usp.get('page') || '1'))
    const pageSize = Math.max(1, Math.min(100, Number(usp.get('pageSize') || '20')))
    const sortBy = usp.get('sortBy') || 'effectiveDate'
    const sortDir = (usp.get('sortDir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'
    const hiddenQuoteStatuses = new Set(['Converted', 'Issued'])
    let items = Array.from(mockQuotes.values())
    items = items.filter((x) => !hiddenQuoteStatuses.has(String(x.status || 'Draft')))
    if (q) items = items.filter(x => x.quoteNumber.toLowerCase().includes(q) || x.quoteId.toLowerCase().includes(q))
    if (status) items = items.filter(x => x.status === status)
    if (product) items = items.filter(x => (x.payload?.productCode || '').toLowerCase() === product)
    const dirMul = sortDir === 'asc' ? 1 : -1
    items.sort((a, b) => {
      const map = {
        effectiveDate: (x: any) => x.payload?.effectiveDate || '',
        quoteNumber: (x: any) => x.quoteNumber || '',
        updatedAt: (x: any) => x.updatedAt || '',
        productCode: (x: any) => x.payload?.productCode || '',
        status: (x: any) => x.status || ''
      } as Record<string, (x:any)=>string>
      const getter = map[sortBy] || map.effectiveDate
      const av = getter(a)
      const bv = getter(b)
      if (av < bv) return -1 * dirMul
      if (av > bv) return 1 * dirMul
      return 0
    })
    const total = items.length
    const start = (page - 1) * pageSize
    const paged = items.slice(start, start + pageSize).map(x => ({
      quoteId: x.quoteId,
      quoteNumber: x.quoteNumber,
      productCode: x.payload?.productCode,
      effectiveDate: x.payload?.effectiveDate,
      status: x.status,
      progressStep: x.progressStep,
      updatedAt: x.updatedAt,
      updatedBy: x.updatedBy || null
    }))
    return { items: paged, total, page, pageSize } as unknown as T
  }
  if (method === 'GET' && path.startsWith('/v1/quotes/') && !path.endsWith('/bind')) {
    const quoteId = path.split('/')[3]
    const existing = mockQuotes.get(quoteId)
    if (!existing) throw new Error('Quote not found')
    return existing as unknown as T
  }
  if (method === 'GET' && path.startsWith('/v1/policies?')) {
    const query = path.split('?')[1] || ''
    const usp = new URLSearchParams(query)
    const q = (usp.get('q') || '').toLowerCase()
    const product = (usp.get('product') || '').toLowerCase()
    const status = normalizePolicyStatusFilter(usp.get('status') || '')
    const effFrom = usp.get('effectiveFrom') || ''
    const effTo = usp.get('effectiveTo') || ''
    const page = Math.max(1, Number(usp.get('page') || '1'))
    const pageSize = Math.max(1, Math.min(100, Number(usp.get('pageSize') || '20')))
    const sortBy = usp.get('sortBy') || 'effectiveDate'
    const sortDir = (usp.get('sortDir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'

    const dynamicPolicies = Array.from(mockPolicies.values()).map(p => ({
      policyId: p.policyId,
      policyNumber: p.policyNumber,
      productCode: p.productCode,
      status: p.status,
      term: p.term
    }))
    const dynamicIds = new Set(dynamicPolicies.map(p => p.policyId))
    let items = [...dynamicPolicies, ...samplePolicies.filter(p => !dynamicIds.has(p.policyId))]

    items = items.filter(p =>
      (!q || p.policyNumber.toLowerCase().includes(q) || p.policyId.toLowerCase().includes(q)) &&
      (!product || p.productCode.toLowerCase() === product) &&
      (!status || matchesPolicyStatusFilter(status, p.status, p.term?.effectiveDate, p.term?.expirationDate)) &&
      (!effFrom || p.term.effectiveDate >= effFrom) &&
      (!effTo || p.term.effectiveDate <= effTo)
    )

    const dirMul = sortDir === 'asc' ? 1 : -1
    items = items.sort((a, b) => {
      const get = (p: any) => {
        switch (sortBy) {
          case 'policyNumber': return p.policyNumber
          case 'productCode': return p.productCode
          case 'status': return derivePolicyWorkflowStatus(p.status, p.term?.effectiveDate, p.term?.expirationDate)
          case 'createdAt': return p.createdAt || p.created_at || ''
          case 'updatedAt': return p.updatedAt || p.updated_at || ''
          case 'updatedBy': return p.updatedBy || p.updated_by || 'system'
          case 'expirationDate': return p.term?.expirationDate
          case 'effectiveDate': default: return p.term?.effectiveDate
        }
      }
      const av = get(a) || ''
      const bv = get(b) || ''
      if (av < bv) return -1 * dirMul
      if (av > bv) return 1 * dirMul
      return 0
    })

    const total = items.length
    const start = (page - 1) * pageSize
    const paged = items.slice(start, start + pageSize).map((item: any) => ({
      ...item,
      status: derivePolicyWorkflowStatus(item.status, item.term?.effectiveDate, item.term?.expirationDate),
      internalStatus: item.status
    }))
    return { items: paged, total, page, pageSize } as unknown as T
  }
  if (method === 'GET' && path.match(/^\/v1\/policies\/.+\/timeline$/)) {
    const parts = path.split('/')
    const id = parts[3]
    const policy = mockPolicies.get(id)
    if (policy) {
      return {
        policy: {
          policyId: policy.policyId,
          policyNumber: policy.policyNumber,
          productCode: policy.productCode,
          status: policy.status,
          currencyCode: 'USD',
          term: policy.term
        },
        transactions: policy.transactions,
        ledger: policy.ledger
      } as unknown as T
    }
    const summary = samplePolicies.find(p => p.policyId === id) || samplePolicies[0]
    const effective = summary?.term?.effectiveDate || '2025-01-01'
    const timeline = {
      policy: {
        policyId: summary.policyId,
        policyNumber: summary.policyNumber,
        productCode: summary.productCode,
        status: summary.status,
        currencyCode: 'USD',
        term: summary.term
      },
      transactions: [
        {
          transactionId: 'mock-tx-1',
          type: 'NB',
          status: 'Issued',
          jurisdiction: { code: 'PA-US' },
          term: summary.term,
          requestedChanges: [],
          snapshot: { premium: { total: { amount: 1645.4, currency: 'USD' } } },
          uw: { decision: 'Approve' },
          metadata: { source: 'mock' },
          createdAt: `${effective}T09:00:00Z`,
          createdBy: 'mock-user',
          rating: {
            ratingId: 'mock-rating-1',
            transactionId: 'mock-tx-1',
            inputs: { ratingFactors: { construction: 'Frame' } },
            components: [{ code: 'BASE', amount: { value: 1600, currency: 'USD' } }],
            discounts: [{ code: 'ALARM', amount: { value: -120, currency: 'USD' } }],
            surcharges: [],
            taxes: [{ code: 'PREMIUM_TAX', amount: { value: 50.4, currency: 'USD' } }],
            total: { amount: 1645.4, currency: 'USD' },
            currencyCode: 'USD',
            calcTrace: null
          },
          forms: [
            {
              policyFormId: 'mock-form-1',
              transactionId: 'mock-tx-1',
              formId: 'mock-form-iso-ho3',
              code: 'ISO-HO3',
              name: 'Mock HO3 Policy Jacket',
              edition: '2024-01',
              metadata: { source: 'mock' },
              createdAt: `${effective}T09:00:00Z`
            }
          ],
          documents: [
            {
              documentId: 'mock-doc-1',
              transactionId: 'mock-tx-1',
              type: 'Policy',
              uri: 'https://example.com/policy.pdf',
              hash: null,
              metadata: { source: 'mock' },
              createdAt: `${effective}T09:05:00Z`,
              createdBy: 'mock-user'
            }
          ],
          notes: [
            {
              noteId: 'mock-note-1',
              transactionId: 'mock-tx-1',
              noteType: 'System',
              noteText: 'Mock timeline note',
              visibility: ['Agent'],
              addedBy: 'mock-user',
              createdAt: `${effective}T09:10:00Z`,
              metadata: { source: 'mock' }
            }
          ]
        }
      ],
      ledger: [
        {
          eventId: 'mock-ledger-1',
          event: 'POLICY_STATUS_CHANGE',
          fromState: 'Quote',
          toState: 'Issued',
          payload: { transactionId: 'mock-tx-1' },
          occurredAt: `${effective}T09:10:00Z`,
          actor: 'mock-user'
        }
      ]
    }
    return timeline as unknown as T
  }
  if (method === 'GET' && path.match(/^\/v1\/policies\/.+\/versions$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (policy) return policy.versions as unknown as T
    const sample = samplePolicies.find(p => p.policyId === id)
    if (!sample) return [] as unknown as T
    const payload = defaultPayload(sample.productCode, sample.term.effectiveDate, diffMonths(sample.term.effectiveDate, sample.term.expirationDate) || 12)
    const premium = buildPremium(payload)
    const processedDate = `${sample.term.effectiveDate}T09:00:00Z`
    const version = {
      versionId: 'sample-version-1',
      effectiveDate: sample.term.effectiveDate,
      processedDate,
      transactionType: 'NB',
      premium
    }
    return [version] as unknown as T
  }
  if (method === 'GET' && path.match(/^\/v1\/policies\/.+\/full$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (policy) return policy.payload as unknown as T
    const sample = samplePolicies.find(p => p.policyId === id)
    if (sample) {
      return defaultPayload(sample.productCode, sample.term.effectiveDate, diffMonths(sample.term.effectiveDate, sample.term.expirationDate) || 12) as unknown as T
    }
    const eff = today()
    return defaultPayload('personal-auto', eff, 12) as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/quotes\/.+\/bind$/)) {
    const policyId = uuidv4()
    const quoteId = path.split('/')[3]
    const existing = mockQuotes.get(quoteId)
    const rawPayload = existing?.payload || {}
    const productCode = rawPayload.productCode || 'personal-auto'
    const policyNumber = generateMockPolicyNumber(
      policyId,
      productCode,
      mockTenantSettings.policyNumberFormatsByProduct
    )
    const effectiveDate = rawPayload.effectiveDate || today()
    const termMonths = Number(rawPayload.termMonths || 12)
    const payload = normalizePayload(rawPayload, productCode, effectiveDate, termMonths)
    const expirationDate = addMonths(effectiveDate, termMonths)
    const premium = buildPremium(payload)
    const now = new Date().toISOString()
    const transactionId = uuidv4()
    const versionId = uuidv4()

    const transaction = {
      transactionId,
      type: 'NB',
      status: 'Bound',
      jurisdiction: payload?.state ? { code: payload.state } : null,
      term: { effectiveDate, expirationDate, termMonths },
      requestedChanges: [],
      snapshot: clone(payload),
      rating: buildRating(premium),
      uw: existing?.underwriting || null,
      notes: [],
      forms: [],
      documents: [],
      createdAt: now,
      createdBy: 'mock-user',
      metadata: { sourceQuoteId: quoteId }
    }

    const version = {
      versionId,
      effectiveDate,
      processedDate: now,
      transactionType: 'Issue',
      premium,
      uwDecision: existing?.underwriting?.decision || null,
      uwOverride: false,
      meta: existing?.underwriting ? { uwDecision: existing.underwriting } : undefined
    }

    const policy = {
      policyId,
      policyNumber,
      productCode: payload.productCode || productCode,
      status: 'Bound',
      term: { effectiveDate, expirationDate },
      payload: clone(payload),
      versions: [version],
      transactions: [transaction],
      ledger: [
        {
          eventId: uuidv4(),
          event: 'STATUS_CHANGE',
          fromState: 'Quote',
          toState: 'Bound',
          payload: { transactionId, quoteId },
          occurredAt: now,
          actor: 'mock-user'
        }
      ],
      lastFullTermPremium: premium.total.amount
    }

    mockPolicies.set(policyId, policy)
    if (existing) {
      const updatedBy = 'mock-user'
      mockQuotes.set(quoteId, {
        ...existing,
        status: 'Converted',
        progressStep: 5,
        updatedAt: now,
        updatedBy,
        convertedPolicyId: policyId,
        statusHistory: upsertQuoteAuditHistory(existing.statusHistory || [], 'Converted', now, updatedBy),
        stepHistory: upsertQuoteAuditHistory(existing.stepHistory || [], 5, now, updatedBy)
      })
    }
    return { policyId, policyNumber, status: 'Bound' } as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/issue$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error(`Policy ${id} not found or not bound`)
    if (policy.status === 'Issued') throw new Error('Policy already issued')
    if (policy.status === 'Cancelled') throw new Error('Policy is cancelled')
    const issuedAt = new Date().toISOString()
    policy.status = 'Issued'
    const nbTxn = policy.transactions?.find((tx: any) => tx.type === 'NB')
    if (nbTxn) nbTxn.status = 'Issued'
    policy.ledger.push({
      eventId: uuidv4(),
      event: 'STATUS_CHANGE',
      fromState: 'Bound',
      toState: 'Issued',
      payload: { issuedAt },
      occurredAt: issuedAt,
      actor: 'mock-user'
    })
    return { policyId: policy.policyId, policyNumber: policy.policyNumber, status: 'Issued', issuedAt } as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/endorse\/reserve-number$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    const invalidState = validateTransactionNumberReservation('endorse', policy.status)
    if (invalidState) throw new Error(invalidState)
    return { transactionNumber: reserveTransactionNumber('endorse') } as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/transactions\/reserve-number$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    const mode = parseTransactionNumberMode(body?.mode)
    if (!mode) throw new Error('mode must be endorse, cancel, reinstate, rewrite, or renew')
    const invalidState = validateTransactionNumberReservation(mode, policy.status)
    if (invalidState) throw new Error(invalidState)
    return { transactionNumber: reserveTransactionNumber(mode) } as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/endorse$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    const bodyChanges = Array.isArray(body?.changes) ? body.changes : []
    const overridePayload = body?.payload && typeof body.payload === 'object' ? body.payload : null
    const eff = asDateOnly(body?.effectiveDate) || policy.term.effectiveDate
    const prevPayload = policy.payload || {}
    const newPayload = overridePayload
      ? overridePayload
      : applyJsonPatch(clone(prevPayload), bodyChanges)
    const changes = overridePayload
      ? diffPayloadPaths(prevPayload || {}, newPayload || {})
      : bodyChanges
    const newPrem = buildPremium(newPayload)
    const fullNew = newPrem.total.amount
    const fullOld = policy.lastFullTermPremium
    const factor = proRataFactor(eff, policy.term.effectiveDate, policy.term.expirationDate)
    const delta = round2((fullNew - fullOld) * factor)
    const uw = mockUW(newPayload)
    if (uw.decision === 'Decline') throw new Error(`Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ') || ''}`)
    const processedAt = new Date().toISOString()
    const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
    const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('endorse')
    const version = {
      versionId: uuidv4(),
      effectiveDate: eff,
      processedDate: processedAt,
      transactionType: 'Endorse',
      transactionNumber,
      premium: simplePremium(delta),
      uwDecision: uw.decision,
      uwOverride: false,
      meta: { changes, uwDecision: uw, transactionNumber }
    }
    policy.versions.push(version)
    policy.payload = clone(newPayload)
    policy.lastFullTermPremium = fullNew

    const transactionId = uuidv4()
    const transaction = {
      transactionId,
      type: 'Endorse',
      status: 'Issued',
      jurisdiction: newPayload?.state ? { code: newPayload.state } : null,
      term: { effectiveDate: policy.term.effectiveDate, expirationDate: policy.term.expirationDate },
      requestedChanges: changes,
      snapshot: clone(newPayload),
      rating: buildRating(newPrem),
      uw,
      notes: [],
      forms: [],
      documents: [],
      createdAt: processedAt,
      createdBy: 'mock-user',
      metadata: { delta, transactionNumber }
    }
    policy.transactions.push(transaction)
    policy.ledger.push({
      eventId: uuidv4(),
      event: 'ENDORSE_ISSUED',
      fromState: policy.status,
      toState: policy.status,
      payload: { transactionId, delta, changes, transactionNumber },
      occurredAt: processedAt,
      actor: 'mock-user'
    })

    return version as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/cancel$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    if (policy.status === 'Cancelled') throw new Error('Policy already cancelled')
    const txPayload = body?.payload && typeof body.payload === 'object'
      ? clone(body.payload)
      : clone(policy.payload || {})
    const eff = asDateOnly(body?.effectiveDate) || today()
    const factor = proRataFactor(eff, policy.term.effectiveDate, policy.term.expirationDate)
    const refund = round2(policy.lastFullTermPremium * factor)
    const processedAt = new Date().toISOString()
    const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
    const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('cancel')
    const version = {
      versionId: uuidv4(),
      effectiveDate: eff,
      processedDate: processedAt,
      transactionType: 'Cancel',
      transactionNumber,
      premium: simplePremium(-refund)
    }
    policy.versions.push(version)
    policy.payload = clone(txPayload)
    policy.status = 'Cancelled'

    const transactionId = uuidv4()
    const transaction = {
      transactionId,
      type: 'Cancel',
      status: 'Issued',
      jurisdiction: txPayload?.state ? { code: txPayload.state } : null,
      term: { effectiveDate: policy.term.effectiveDate, expirationDate: policy.term.expirationDate, cancelDate: eff },
      requestedChanges: [],
      snapshot: clone(txPayload),
      rating: buildRating(simplePremium(-refund)),
      uw: null,
      notes: [],
      forms: [],
      documents: [],
      createdAt: processedAt,
      createdBy: 'mock-user',
      metadata: { reason: body?.reason || null, refund, transactionNumber }
    }
    policy.transactions.push(transaction)
    policy.ledger.push({
      eventId: uuidv4(),
      event: 'CANCELLED',
      fromState: 'Issued',
      toState: 'Cancelled',
      payload: { transactionId, refund, reason: body?.reason || null, transactionNumber },
      occurredAt: processedAt,
      actor: 'mock-user'
    })

    return version as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/reinstate$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    if (policy.status !== 'Cancelled') throw new Error('Policy is not cancelled')
    const txPayload = body?.payload && typeof body.payload === 'object'
      ? clone(body.payload)
      : clone(policy.payload || {})
    const eff = asDateOnly(body?.effectiveDate) || today()
    const factor = proRataFactor(eff, policy.term.effectiveDate, policy.term.expirationDate)
    const reinstatementCharge = round2((Number(policy.lastFullTermPremium) || 0) * factor)
    const processedAt = new Date().toISOString()
    const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
    const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('reinstate')
    const version = {
      versionId: uuidv4(),
      effectiveDate: eff,
      processedDate: processedAt,
      transactionType: 'Reinstate',
      transactionNumber,
      premium: simplePremium(reinstatementCharge)
    }
    policy.versions.push(version)
    policy.payload = clone(txPayload)
    policy.status = 'Issued'

    const transactionId = uuidv4()
    const transaction = {
      transactionId,
      type: 'Reinstate',
      status: 'Issued',
      jurisdiction: txPayload?.state ? { code: txPayload.state } : null,
      term: { effectiveDate: policy.term.effectiveDate, expirationDate: policy.term.expirationDate, reinstateDate: eff },
      requestedChanges: [],
      snapshot: clone(txPayload),
      rating: buildRating(simplePremium(reinstatementCharge)),
      uw: null,
      notes: [],
      forms: [],
      documents: [],
      createdAt: processedAt,
      createdBy: 'mock-user',
      metadata: { reinstateDate: eff, transactionNumber, reinstatementCharge }
    }
    policy.transactions.push(transaction)
    policy.ledger.push({
      eventId: uuidv4(),
      event: 'REINSTATED',
      fromState: 'Cancelled',
      toState: 'Issued',
      payload: { transactionId, effectiveDate: eff, transactionNumber, reinstatementCharge },
      occurredAt: processedAt,
      actor: 'mock-user'
    })

    return version as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/rewrite$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    if (policy.status !== 'Cancelled') throw new Error('Policy is not cancelled')
    const prevPayload = policy.payload || {}
    const payload = body?.payload && typeof body.payload === 'object' ? clone(body.payload) : clone(prevPayload)
    const termMonths = Number(payload?.termMonths || diffMonths(policy.term.effectiveDate, policy.term.expirationDate) || 12)
    const nextEff = asDateOnly(body?.effectiveDate) || asDateOnly(payload?.effectiveDate) || today()
    const nextExp = addMonths(nextEff, termMonths)
    payload.effectiveDate = nextEff
    payload.termMonths = termMonths
    payload.productCode = payload.productCode || policy.productCode
    const prem = buildPremium(payload)
    const uw = mockUW(payload)
    if (uw.decision === 'Decline') throw new Error(`Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ') || ''}`)
    const processedAt = new Date().toISOString()
    const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
    const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('rewrite')
    const fromState = policy.status

    const version = {
      versionId: uuidv4(),
      effectiveDate: nextEff,
      processedDate: processedAt,
      transactionType: 'Rewrite',
      transactionNumber,
      premium: prem,
      uwDecision: uw.decision,
      meta: { uwDecision: uw, rewrite: true, transactionNumber }
    }
    policy.versions.push(version)
    policy.payload = clone(payload)
    policy.term = { effectiveDate: nextEff, expirationDate: nextExp }
    policy.status = 'Issued'
    policy.lastFullTermPremium = prem.total.amount

    const transactionId = uuidv4()
    const transaction = {
      transactionId,
      type: 'Rewrite',
      status: 'Issued',
      jurisdiction: payload?.state ? { code: payload.state } : null,
      term: { effectiveDate: nextEff, expirationDate: nextExp, termMonths },
      requestedChanges: [],
      snapshot: clone(payload),
      rating: buildRating(prem),
      uw,
      notes: [],
      forms: [],
      documents: [],
      createdAt: processedAt,
      createdBy: 'mock-user',
      metadata: { rewrite: true, transactionNumber }
    }
    policy.transactions.push(transaction)
    policy.ledger.push({
      eventId: uuidv4(),
      event: 'REWRITTEN',
      fromState,
      toState: 'Issued',
      payload: { transactionId, effectiveDate: nextEff, transactionNumber },
      occurredAt: processedAt,
      actor: 'mock-user'
    })

    return version as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/renew$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    if (policy.status === 'Cancelled') throw new Error('Policy is cancelled')
    const termMonths = diffMonths(policy.term.effectiveDate, policy.term.expirationDate) || 12
    const nextEff = asDateOnly(body?.effectiveDate) || policy.term.expirationDate
    const nextExp = addMonths(nextEff, termMonths)
    const prevPayload = policy.payload || {}
    const payload = body?.payload && typeof body.payload === 'object' ? clone(body.payload) : clone(prevPayload)
    payload.effectiveDate = nextEff
    payload.termMonths = termMonths
    payload.productCode = payload.productCode || policy.productCode
    const prem = buildPremium(payload)
    const uw = mockUW(payload)
    if (uw.decision === 'Decline') throw new Error(`Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ') || ''}`)
    const processedAt = new Date().toISOString()
    const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
    const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('renew')

    const version = {
      versionId: uuidv4(),
      effectiveDate: nextEff,
      processedDate: processedAt,
      transactionType: 'Renew',
      transactionNumber,
      premium: prem,
      uwDecision: uw.decision,
      meta: { uwDecision: uw, transactionNumber }
    }
    policy.versions.push(version)
    policy.payload = clone(payload)
    policy.term = { effectiveDate: nextEff, expirationDate: nextExp }
    policy.lastFullTermPremium = prem.total.amount

    const transactionId = uuidv4()
    const transaction = {
      transactionId,
      type: 'Renew',
      status: 'Issued',
      jurisdiction: payload?.state ? { code: payload.state } : null,
      term: { effectiveDate: nextEff, expirationDate: nextExp, termMonths },
      requestedChanges: [],
      snapshot: clone(payload),
      rating: buildRating(prem),
      uw,
      notes: [],
      forms: [],
      documents: [],
      createdAt: processedAt,
      createdBy: 'mock-user',
      metadata: { renewal: true, transactionNumber }
    }
    policy.transactions.push(transaction)
    policy.ledger.push({
      eventId: uuidv4(),
      event: 'RENEWED',
      fromState: policy.status,
      toState: policy.status,
      payload: { transactionId, nextEffective: nextEff, transactionNumber },
      occurredAt: processedAt,
      actor: 'mock-user'
    })

    return version as unknown as T
  }
  if (method === 'POST' && path.match(/^\/v1\/policies\/.+\/renew\/preview$/)) {
    const id = path.split('/')[3]
    const policy = mockPolicies.get(id)
    if (!policy) throw new Error('Policy not found')
    const termMonths = diffMonths(policy.term.effectiveDate, policy.term.expirationDate) || 12
    const nextEff = policy.term.expirationDate
    const nextExp = addMonths(nextEff, termMonths)
    const prevPayload = policy.payload || {}
    const payload = clone(prevPayload)
    payload.effectiveDate = nextEff
    payload.termMonths = termMonths
    payload.productCode = payload.productCode || policy.productCode
    const premium = buildPremium(payload)
    const underwriting = mockUW(payload)
    return { underwriting, premium, nextEffectiveDate: nextEff, nextExpirationDate: nextExp } as unknown as T
  }
  if (method === 'GET' && path.match(/^\/v1\/policies\/.+$/)) {
    const id = path.split('/').pop()!
    const policy = mockPolicies.get(id)
    if (policy) {
      return {
        policyId: policy.policyId,
        policyNumber: policy.policyNumber,
        tenantId: 'sample-carrier',
        productCode: policy.productCode,
        status: derivePolicyWorkflowStatus(policy.status, policy.term?.effectiveDate, policy.term?.expirationDate),
        internalStatus: policy.status,
        term: policy.term,
        versions: policy.versions,
        payload: policy.payload
      } as unknown as T
    }
    const sample = samplePolicies.find(p => p.policyId === id)
    if (sample) {
      return {
        policyId: sample.policyId,
        policyNumber: sample.policyNumber,
        tenantId: 'sample-carrier',
        productCode: sample.productCode,
        status: derivePolicyWorkflowStatus(sample.status, sample.term?.effectiveDate, sample.term?.expirationDate),
        internalStatus: sample.status,
        term: sample.term,
        versions: [],
        payload: defaultPayload(sample.productCode, sample.term.effectiveDate, diffMonths(sample.term.effectiveDate, sample.term.expirationDate) || 12)
      } as unknown as T
    }
    const effectiveDate = today()
    const expirationDate = addMonths(effectiveDate, 12)
    return {
      policyId: id,
      policyNumber: generateMockPolicyNumber(id, 'personal-auto', mockTenantSettings.policyNumberFormatsByProduct),
      tenantId: 'sample-carrier',
      productCode: 'personal-auto',
      status: derivePolicyWorkflowStatus('Issued', effectiveDate, expirationDate),
      internalStatus: 'Issued',
      term: { effectiveDate, expirationDate },
      versions: [],
      payload: defaultPayload('personal-auto', effectiveDate, 12)
    } as unknown as T
  }
  throw new Error(`Mock not implemented for ${method} ${path}`)
}

function normalizePayload(payload: any, productCode: string, effectiveDate: string, termMonths: number) {
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return defaultPayload(productCode, effectiveDate, termMonths)
  }
  return {
    ...payload,
    productCode: payload.productCode || productCode,
    effectiveDate: payload.effectiveDate || effectiveDate,
    termMonths: payload.termMonths || termMonths
  }
}

function defaultPayload(productCode: string, effectiveDate: string, termMonths: number) {
  const base = {
    productCode,
    effectiveDate,
    termMonths,
    state: 'NY',
    applicant: { firstName: 'Test', lastName: 'User', email: '' },
    coverages: [] as any[]
  }
  if (productCode === 'homeowners') {
    return {
      ...base,
      risks: [{ type: 'dwelling', address: '1 Main St', construction: 'frame', yearBuilt: 2000, roofAgeYears: 10, squareFeet: 1800 }]
    }
  }
  if (productCode === 'cyber') {
    return {
      ...base,
      risks: [{
        type: 'cyberProfile',
        industry: 'technology',
        annualRevenue: 1000000,
        employeeCount: 50,
        recordsCount: 50000,
        mfaEnabled: 'true',
        endpointProtection: 'true',
        backups: 'daily',
        priorIncidents: 0,
        publicFacingApps: 2,
        domain: 'example.com'
      }]
    }
  }
  if (productCode === 'commercial-auto') {
    return {
      ...base,
      risks: [{
        type: 'commercialAutoFleet',
        businessName: 'Acme Services LLC',
        garagingZip: '10001',
        vehicleCount: 3,
        driverCount: 4,
        useClass: 'artisan-contractor',
        radiusClass: 'local',
        vehicleType: 'service-van',
        gvwClass: 'light',
        annualMileage: 18000,
        yearsInBusiness: 5,
        priorLossesCount: 0
      }],
      uwAnswers: { vehicleCount: 3, driverCount: 4, priorLossesCount: 0, radiusClass: 'local', useClass: 'artisan-contractor' }
    }
  }
  if (productCode === 'professional-liability') {
    return {
      ...base,
      risks: [{
        type: 'professionalLiabilityProfile',
        industry: 'consulting',
        annualRevenue: 1000000,
        employeeCount: 10,
        yearsInBusiness: 5,
        priorClaimsCount: 0,
        largestContractValue: 150000,
        subcontractorPct: 10,
        writtenContracts: 'true',
        qualityControl: 'standard',
        retroactiveYears: 3
      }]
    }
  }
  return {
    ...base,
    risks: [{ type: 'autoVehicle', year: 2018, make: 'Toyota', model: 'Camry', garagingZip: '10001', usage: 'commute', annualMiles: 12000, driverAge: 30 }],
    uwAnswers: { driverAge: 30 }
  }
}

function buildPremium(payload: any) {
  const total = mockRate(payload)
  return makePremium(total)
}

function makePremium(total: number, currency = 'USD') {
  return {
    byCoverage: [],
    fees: { amount: 25, currency },
    taxes: { amount: round2(total * 0.03), currency },
    total: { amount: round2(total), currency }
  }
}

function simplePremium(amount: number, currency = 'USD') {
  return {
    byCoverage: [],
    fees: { amount: 0, currency },
    taxes: { amount: 0, currency },
    total: { amount: round2(amount), currency }
  }
}

function buildRating(premium: any) {
  if (!premium || !premium.total) return null
  return {
    ratingId: uuidv4(),
    transactionId: null,
    inputs: null,
    components: [],
    discounts: [],
    surcharges: [],
    taxes: [],
    total: { amount: premium.total.amount, currency: premium.total.currency || 'USD' },
    currencyCode: premium.total.currency || 'USD',
    calcTrace: null
  }
}

function generateTransactionNumber(prefix = 'EN-') {
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `${prefix}${stamp}-${rand}`
}

type TransactionNumberMode = 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'

function parseTransactionNumberMode(value: any): TransactionNumberMode | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'endorse' || normalized === 'cancel' || normalized === 'reinstate' || normalized === 'rewrite' || normalized === 'renew') {
    return normalized
  }
  return null
}

function transactionNumberPrefix(mode: TransactionNumberMode): string {
  if (mode === 'cancel') return 'CN-'
  if (mode === 'reinstate') return 'RI-'
  if (mode === 'rewrite') return 'RW-'
  if (mode === 'renew') return 'RN-'
  return 'EN-'
}

function validateTransactionNumberReservation(mode: TransactionNumberMode, rawStatus: any): string | null {
  const status = String(rawStatus || '').toLowerCase()
  if (mode === 'reinstate' || mode === 'rewrite') {
    return status === 'cancelled' ? null : 'Policy is not cancelled'
  }
  if (mode === 'cancel' && status === 'cancelled') return 'Policy already cancelled'
  if (status === 'cancelled') return 'Policy is cancelled'
  return null
}

function reserveTransactionNumber(mode: TransactionNumberMode): string {
  return generateTransactionNumber(transactionNumberPrefix(mode))
}

function clone<T>(value: T): T {
  if (value == null) return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

type PatchOp = { path: string; op: 'add'|'replace'|'remove'; value?: any }

function applyJsonPatch(obj: any, ops: PatchOp[]): any {
  for (const op of ops) {
    const path = op.path || ''
    const parts = path.split('/').slice(1).map(p => p.replace(/~1/g,'/').replace(/~0/g,'~'))
    let target = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      if (!(key in target) || typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {}
      }
      target = target[key]
    }
    const last = parts[parts.length - 1]
    if (op.op === 'remove') {
      if (last in target) delete target[last]
    } else if (op.op === 'add' || op.op === 'replace') {
      target[last] = op.value
    }
  }
  return obj
}

function diffPayloadPaths(a: any, b: any, base: string = ''): string[] {
  const changes: string[] = []
  const isObj = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      const pa = a[k]
      const pb = b[k]
      const p = base + '/' + k
      if (isObj(pa) || isObj(pb)) {
        changes.push(...diffPayloadPaths(pa ?? {}, pb ?? {}, p))
      } else if (JSON.stringify(pa) !== JSON.stringify(pb)) {
        changes.push(p)
      }
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    changes.push(base || '/')
  }
  return changes
}

function addMonths(yyyyMmDd: string, months: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(n => Number(n))
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCMonth(dt.getUTCMonth() + months)
  return dt.toISOString().slice(0, 10)
}

function diffMonths(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth())
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeQuoteAuditHistory(raw: any): QuoteAuditEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry: any) => entry && entry.value != null)
    .map((entry: any) => ({
      value: typeof entry.value === 'number' ? entry.value : String(entry.value),
      updatedAt: typeof entry.updatedAt === 'string' && entry.updatedAt ? entry.updatedAt : new Date().toISOString(),
      updatedBy: typeof entry.updatedBy === 'string' && entry.updatedBy ? entry.updatedBy : 'mock-user'
    }))
}

function upsertQuoteAuditHistory(raw: any, value: string | number, updatedAt: string, updatedBy: string): QuoteAuditEntry[] {
  const history = normalizeQuoteAuditHistory(raw)
  const key = typeof value === 'number' ? String(value) : String(value || '')
  const nextEntry: QuoteAuditEntry = { value, updatedAt, updatedBy }
  const index = history.findIndex((entry) => String(entry.value) === key)
  if (index >= 0) {
    history[index] = nextEntry
  } else {
    history.push(nextEntry)
  }
  return history
}

type PolicyStatusFilter = '' | 'Draft' | 'Rated' | 'Bind' | 'Issued' | 'Inforced' | 'Expired' | 'Cancelled'

function normalizePolicyStatusFilter(rawValue: any): PolicyStatusFilter {
  const value = String(rawValue || '').trim().toLowerCase()
  if (!value) return ''
  if (value === 'bound' || value === 'bind') return 'Bind'
  if (value === 'inforce' || value === 'inforced') return 'Inforced'
  if (value === 'cancelled' || value === 'canceled') return 'Cancelled'
  if (value === 'draft') return 'Draft'
  if (value === 'rated') return 'Rated'
  if (value === 'issued') return 'Issued'
  if (value === 'expired') return 'Expired'
  return ''
}

function derivePolicyWorkflowStatus(rawStatus: any, effectiveDate: any, expirationDate: any): PolicyStatusFilter {
  const normalized = String(rawStatus || '').trim().toLowerCase()
  const todayValue = today()
  const eff = asDateOnly(effectiveDate) || todayValue
  const exp = asDateOnly(expirationDate) || todayValue

  if (normalized === 'cancelled') return 'Cancelled'
  if (exp < todayValue) return 'Expired'
  if (normalized === 'bound') return 'Bind'
  if (normalized === 'issued') {
    if (eff <= todayValue && exp >= todayValue) return 'Inforced'
    return 'Issued'
  }
  if (normalized === 'rated') return 'Rated'
  if (normalized === 'draft' || normalized === 'quote') return 'Draft'
  return 'Draft'
}

function matchesPolicyStatusFilter(
  filter: PolicyStatusFilter,
  rawStatus: any,
  effectiveDate: any,
  expirationDate: any
): boolean {
  if (!filter) return true
  if (filter === 'Issued') {
    const normalized = String(rawStatus || '').trim().toLowerCase()
    if (normalized !== 'issued') return false
    const todayValue = today()
    const eff = asDateOnly(effectiveDate) || todayValue
    const exp = asDateOnly(expirationDate) || todayValue
    return eff > todayValue && exp >= todayValue
  }
  return derivePolicyWorkflowStatus(rawStatus, effectiveDate, expirationDate) === filter
}

function asDateOnly(s?: string): string | undefined {
  if (!s) return undefined
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(s)
  return m ? s : undefined
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime()
  const db = new Date(b + 'T00:00:00Z').getTime()
  return Math.max(0, Math.round((db - da) / 86400000))
}

function proRataFactor(eff: string, termEff: string, termExp: string): number {
  const total = Math.max(1, daysBetween(termEff, termExp))
  const remaining = Math.max(0, daysBetween(eff, termExp))
  return remaining / total
}

function mockRate(payload: any): number {
  const product = payload?.productCode
  if (product === 'personal-auto') {
    let base = 500
    const zip = payload?.risks?.[0]?.garagingZip
    if (zip === '10001') base *= 1.15
    const age = payload?.uwAnswers?.driverAge
    if (age && age < 25) base *= 1.3
    return round2(base + 25 + base * 0.03)
  }
  if (product === 'homeowners') {
    let base = 700
    const roofAge = payload?.risks?.[0]?.roofAgeYears
    if (roofAge && roofAge > 20) base *= 1.1
    return round2(base + 35 + base * 0.02)
  }
  if (product === 'cyber') {
    let base = 1800
    const risk = payload?.risks?.[0] || {}
    if (String(risk?.industry || '').toLowerCase() === 'healthcare') base *= 1.15
    if (String(risk?.mfaEnabled || '').toLowerCase() !== 'true') base *= 1.12
    const priorIncidents = Number(risk?.priorIncidents || 0)
    if (Number.isFinite(priorIncidents) && priorIncidents > 0) base *= (1 + Math.min(priorIncidents, 5) * 0.12)
    return round2(base + 65 + base * 0.025)
  }
  if (product === 'commercial-auto') {
    let base = 4200
    const risk = payload?.risks?.[0] || {}
    const state = String(payload?.state || '').toUpperCase()
    if (state === 'NY' || state === 'CA') base *= 1.15
    if (String(risk?.radiusClass || '').toLowerCase() === 'long-haul') base *= 1.22
    if (String(risk?.vehicleType || '').toLowerCase() === 'tractor-trailer') base *= 1.25
    const vehicleCount = Number(risk?.vehicleCount || 1)
    if (Number.isFinite(vehicleCount) && vehicleCount > 10) base *= 1.25
    else if (Number.isFinite(vehicleCount) && vehicleCount > 5) base *= 1.12
    const priorLosses = Number(risk?.priorLossesCount || 0)
    if (Number.isFinite(priorLosses) && priorLosses > 0) base *= (1 + Math.min(priorLosses, 6) * 0.14)
    return round2(base + 95 + base * 0.03)
  }
  if (product === 'professional-liability') {
    let base = 2400
    const risk = payload?.risks?.[0] || {}
    const industry = String(risk?.industry || '').toLowerCase()
    if (industry === 'legal-services') base *= 1.22
    else if (industry === 'architecture-engineering') base *= 1.15
    else if (industry === 'consulting') base *= 1.0
    else base *= 1.08
    const priorClaims = Number(risk?.priorClaimsCount || 0)
    if (Number.isFinite(priorClaims) && priorClaims > 0) base *= (1 + Math.min(priorClaims, 5) * 0.16)
    const writtenContracts = String(risk?.writtenContracts || '').toLowerCase()
    if (writtenContracts !== 'true' && writtenContracts !== 'yes') base *= 1.1
    return round2(base + 85 + base * 0.025)
  }
  return 500
}

function seedMockUnderwritingCompanies() {
  if (mockUnderwritingCompanies.size > 0) return
  const nowIso = new Date().toISOString()
  const seedItems = [
    { name: 'Atlas Insurance Co', productCode: 'personal-auto', country: 'US', state: 'NY', active: true },
    { name: 'Harbor Mutual', productCode: 'personal-auto', country: 'US', state: 'CA', active: true },
    { name: 'FleetGuard Commercial', productCode: 'commercial-auto', country: 'US', state: 'ALL', active: true },
    { name: 'Maple Shield', productCode: 'homeowners', country: 'CA', state: 'ON', active: true },
    { name: 'Summit Professional Indemnity', productCode: 'professional-liability', country: 'US', state: 'ALL', active: true }
  ]
  for (const item of seedItems) {
    const id = uuidv4()
    mockUnderwritingCompanies.set(id, {
      companyId: id,
      name: item.name,
      productCode: item.productCode,
      country: item.country,
      state: item.state,
      active: item.active,
      createdAt: nowIso,
      updatedAt: nowIso
    })
  }
}

function filterMockUnderwritingCompanies(filters: { productCode?: string; country?: string; state?: string; includeInactive?: boolean }) {
  return Array.from(mockUnderwritingCompanies.values())
    .filter((item) => {
      if (!filters.includeInactive && !item.active) return false
      if (filters.productCode && item.productCode !== filters.productCode) return false
      if (filters.country && item.country !== filters.country) return false
      if (filters.state && item.state !== filters.state && item.state !== 'ALL') return false
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function statesOverlap(a: string, b: string): boolean {
  return a === b || a === 'ALL' || b === 'ALL'
}

function hasMockUnderwritingCompanyConflict(input: {
  name: string
  productCode: string
  country: string
  state: string
  excludeCompanyId?: string
}): boolean {
  const normalizedName = normalizeCompanyName(input.name).toLowerCase()
  const normalizedProductCode = normalizeProductCode(input.productCode)
  const normalizedCountry = normalizeCountryCode(input.country)
  const normalizedState = normalizeRegionCode(input.state)
  const excludeCompanyId = input.excludeCompanyId || ''
  return Array.from(mockUnderwritingCompanies.values()).some((item) => {
    if (excludeCompanyId && item.companyId === excludeCompanyId) return false
    return (
      item.name.toLowerCase() === normalizedName &&
      item.productCode === normalizedProductCode &&
      item.country === normalizedCountry &&
      statesOverlap(item.state, normalizedState)
    )
  })
}

function normalizeCompanyName(value: any): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function normalizeMockPolicyNumberFormatsByProduct(input: any, fallback: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  const source = input && typeof input === 'object' ? input : {}
  for (const [rawProductCode, rawTemplate] of Object.entries(source)) {
    const productCode = String(rawProductCode || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '')
    if (!productCode) continue
    const template = String(rawTemplate || '').trim().slice(0, 80)
    if (!template) continue
    normalized[productCode] = template
  }
  if (!Object.keys(normalized).length) {
    return { ...fallback }
  }
  for (const [productCode, template] of Object.entries(fallback || {})) {
    if (!normalized[productCode]) normalized[productCode] = template
  }
  return normalized
}

function generateMockPolicyNumber(policyId: string, productCode: string, formatsByProduct: Record<string, string>): string {
  const normalizedProduct = String(productCode || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
  const template =
    formatsByProduct[normalizedProduct] ||
    formatsByProduct['*'] ||
    '{PRODUCT}-{ID8}'
  const now = new Date()
  const rawId = String(policyId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
  const productToken = normalizedProduct.replace(/[^a-z0-9]/g, '').toUpperCase() || 'POL'
  const tokenValues: Record<string, string> = {
    PRODUCT: productToken,
    ID8: (rawId + 'XXXXXXXX').slice(0, 8),
    ID6: (rawId + 'XXXXXX').slice(0, 6),
    ID: rawId || 'POLICY',
    YYYY: String(now.getUTCFullYear()),
    YY: String(now.getUTCFullYear()).slice(-2),
    MM: String(now.getUTCMonth() + 1).padStart(2, '0'),
    DD: String(now.getUTCDate()).padStart(2, '0')
  }
  const rendered = template.replace(/\{([A-Z0-9_]+)\}/g, (_, token: string) => tokenValues[token] || '')
  const normalized = rendered
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return (normalized || `POL-${(rawId + 'XXXXXXXX').slice(0, 8)}`).slice(0, 40)
}

function normalizeProductCode(value: any): string {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'personal-auto' || normalized === 'commercial-auto' || normalized === 'homeowners' || normalized === 'cyber' || normalized === 'professional-liability' ? normalized : ''
}

function normalizeCountryCode(value: any): string {
  return String(value || '').trim().toUpperCase() === 'CA' ? 'CA' : 'US'
}

function normalizeRegionCode(value: any): string {
  return String(value || '').trim().toUpperCase()
}

function round2(n: number) { return Math.round(n * 100) / 100 }
function delay(ms: number) { return new Promise(res => setTimeout(res, ms)) }

function mockUW(payload: any) {
  const product = payload?.productCode
  if (product === 'personal-auto') {
    const age = payload?.uwAnswers?.driverAge || payload?.risks?.[0]?.driverAge
    if (age != null && age < 16) return { decision: 'Decline', reasons: ['Driver age under 16 (decline)'] }
    if (age != null && age < 18) return { decision: 'Refer', reasons: ['Driver age under 18 (refer)'] }
  }
  if (product === 'homeowners') {
    const roof = payload?.risks?.[0]?.roofAgeYears
    if (roof != null && roof > 25) return { decision: 'Refer', reasons: ['Roof age > 25 (refer)'] }
  }
  if (product === 'cyber') {
    const risk = payload?.risks?.[0] || {}
    const priorIncidents = Number(risk?.priorIncidents || 0)
    if (Number.isFinite(priorIncidents) && priorIncidents >= 3) return { decision: 'Decline', reasons: ['3+ prior cyber incidents (decline)'] }
    if (String(risk?.mfaEnabled || '').toLowerCase() !== 'true') return { decision: 'Refer', reasons: ['MFA not fully enabled (refer)'] }
  }
  if (product === 'commercial-auto') {
    const risk = payload?.risks?.[0] || {}
    const priorLossesCount = Number(risk?.priorLossesCount || 0)
    if (Number.isFinite(priorLossesCount) && priorLossesCount >= 6) return { decision: 'Decline', reasons: ['6+ prior commercial auto losses (decline)'] }
    if (String(risk?.radiusClass || '').toLowerCase() === 'long-haul') return { decision: 'Refer', reasons: ['Long-haul operations (refer)'] }
    if (String(risk?.vehicleType || '').toLowerCase() === 'tractor-trailer') return { decision: 'Refer', reasons: ['Tractor-trailer exposure (refer)'] }
  }
  if (product === 'professional-liability') {
    const risk = payload?.risks?.[0] || {}
    const priorClaimsCount = Number(risk?.priorClaimsCount || 0)
    if (Number.isFinite(priorClaimsCount) && priorClaimsCount >= 4) return { decision: 'Decline', reasons: ['4+ prior PL claims (decline)'] }
    if (Number.isFinite(priorClaimsCount) && priorClaimsCount >= 2) return { decision: 'Refer', reasons: ['Multiple prior PL claims (refer)'] }
    if (String(risk?.writtenContracts || '').toLowerCase() !== 'true') return { decision: 'Refer', reasons: ['Written contracts not consistently used (refer)'] }
  }
  return { decision: 'Eligible', reasons: [] }
}
