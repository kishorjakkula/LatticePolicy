export const queryKeys = {
  policies: {
    all: () => ['policies'] as const,
    lists: () => ['policies', 'list'] as const,
    list: (params: Record<string, any>) => ['policies', 'list', params] as const,
    detail: (id: string) => ['policies', id] as const,
    versions: (id: string) => ['policies', id, 'versions'] as const,
    full: (id: string) => ['policies', id, 'full'] as const,
    timeline: (id: string) => ['policies', id, 'timeline'] as const,
    interests: (id: string) => ['policies', id, 'interests'] as const,
    aiInsights: (id: string) => ['policies', id, 'ai-insights'] as const,
  },
  quotes: {
    all: () => ['quotes'] as const,
    lists: () => ['quotes', 'list'] as const,
    list: (params: Record<string, any>) => ['quotes', 'list', params] as const,
    detail: (id: string) => ['quotes', id] as const,
  },
  users: {
    all: () => ['users'] as const,
    list: () => ['users', 'list'] as const,
  },
  compliance: {
    eligibility: (opts: Record<string, any> = {}) => ['compliance', 'eligibility', opts] as const,
    ofacScreens: (disposition?: string) => ['compliance', 'ofac-screens', disposition ?? null] as const,
  },
  dataImport: {
    batches: () => ['data-import', 'batches'] as const,
    batch: (batchId: string) => ['data-import', 'batches', batchId] as const,
    rows: (batchId: string, status?: string) => ['data-import', 'batches', batchId, 'rows', status ?? null] as const,
  },
  exposure: {
    summary: (filters?: { productCode?: string; state?: string; asOf?: string }) =>
      ['exposure', 'summary', filters?.productCode ?? null, filters?.state ?? null, filters?.asOf ?? null] as const,
  },
  dashboard: {
    summary: () => ['dashboard', 'summary'] as const,
    outbox: (status?: string) => ['dashboard', 'outbox', status ?? null] as const,
    notifications: (status?: string) => ['dashboard', 'notifications', status ?? null] as const,
  },
  customers: {
    all: () => ['customers'] as const,
    search: (opts: Record<string, any>) => ['customers', 'search', opts] as const,
    detail: (id: string) => ['customers', id] as const,
    policies: (id: string) => ['customers', id, 'policies'] as const,
    quotes: (id: string) => ['customers', id, 'quotes'] as const,
  },
  forms: {
    all: () => ['forms'] as const,
    list: (opts: Record<string, any>) => ['forms', 'list', opts] as const,
    detail: (id: string) => ['forms', id] as const,
    templates: () => ['forms', 'templates'] as const,
  },
  ratingModels: {
    all: () => ['rating-models'] as const,
    list: () => ['rating-models', 'list'] as const,
    detail: (modelId: string, versionId: string) => ['rating-models', modelId, versionId] as const,
    published: (opts: Record<string, any>) => ['rating-models', 'published', opts] as const,
  },
  uwReferrals: {
    all: () => ['uw-referrals'] as const,
    list: (page: number, pageSize: number, status?: string) => ['uw-referrals', 'list', page, pageSize, status ?? null] as const,
    detail: (referralId: string) => ['uw-referrals', 'detail', referralId] as const,
  },
  reference: {
    agencies: (opts: Record<string, any>) => ['reference', 'agencies', opts] as const,
    agencyContacts: (agencyId: string) => ['reference', 'agencies', agencyId, 'contacts'] as const,
    underwriters: () => ['reference', 'underwriters'] as const,
    carriers: (opts: Record<string, any>) => ['reference', 'carriers', opts] as const,
    cancellationCodes: () => ['reference', 'cancellation-codes'] as const,
    uwCompanies: (opts: Record<string, any>) => ['reference', 'uw-companies', opts] as const,
  },
  tenant: {
    prefs: () => ['tenant', 'prefs'] as const,
    config: () => ['tenant', 'config'] as const,
  },
  ai: {
    settings: () => ['ai', 'settings'] as const,
    dashboardInsights: () => ['ai', 'dashboard', 'insights'] as const,
  },
  portal: {
    summary: () => ['portal', 'summary'] as const,
    policy: (id: string) => ['portal', 'policy', id] as const,
  },
  onboarding: {
    settings: () => ['onboarding', 'settings'] as const,
    agencies: (opts: Record<string, any>) => ['onboarding', 'agencies', opts] as const,
  },
  security: {
    permissions: () => ['security', 'permissions'] as const,
    roles: () => ['security', 'roles'] as const,
    relationships: () => ['security', 'relationships'] as const,
  },
  adminTenant: {
    detail: () => ['admin-tenant'] as const,
  },
  adminUwCompanies: {
    list: (opts: Record<string, any>) => ['admin-uw-companies', opts] as const,
  },
  notificationTemplates: {
    list: (opts: Record<string, any>) => ['notification-templates', opts] as const,
    detail: (id: string) => ['notification-templates', id] as const,
  },
}
