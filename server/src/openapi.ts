type RouteDef = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete'
  path: string
  tag: string
  summary: string
  requiresTenant?: boolean
  requiresAuth?: boolean
}

const routeDefs: RouteDef[] = [
  { method: 'get', path: '/health', tag: 'System', summary: 'Health check', requiresAuth: false, requiresTenant: false },
  { method: 'post', path: '/auth/login', tag: 'Auth', summary: 'Login', requiresAuth: false, requiresTenant: false },
  { method: 'post', path: '/auth/mfa/verify', tag: 'Auth', summary: 'Verify MFA', requiresAuth: false, requiresTenant: false },
  { method: 'post', path: '/auth/mfa/setup/confirm', tag: 'Auth', summary: 'Confirm MFA setup', requiresAuth: false, requiresTenant: false },

  { method: 'get', path: '/v1/tenant/preferences', tag: 'Tenant', summary: 'Get tenant preferences' },
  { method: 'get', path: '/v1/ai/settings', tag: 'AI/ML', summary: 'Get tenant AI/ML settings' },
  { method: 'post', path: '/v1/ai/quotes/insights', tag: 'AI/ML', summary: 'Infer quote AI/ML insights' },
  { method: 'get', path: '/v1/ai/dashboard/insights', tag: 'AI/ML', summary: 'Get dashboard AI/ML insights' },
  { method: 'get', path: '/v1/ai/policies/{id}/insights', tag: 'AI/ML', summary: 'Get policy AI/ML insights' },

  { method: 'get', path: '/v1/underwriting-companies', tag: 'Reference', summary: 'List underwriting companies' },
  { method: 'get', path: '/v1/reference/agencies', tag: 'Reference', summary: 'List agencies' },
  { method: 'get', path: '/v1/reference/agencies/{agencyId}/contacts', tag: 'Reference', summary: 'List agency contacts' },
  { method: 'get', path: '/v1/reference/underwriters', tag: 'Reference', summary: 'List underwriters' },
  { method: 'get', path: '/v1/reference/insurance-carriers', tag: 'Reference', summary: 'List prior insurance carriers' },

  { method: 'post', path: '/v1/forms/preview', tag: 'Forms', summary: 'Preview attached forms' },
  { method: 'get', path: '/v1/forms/{id}/document', tag: 'Forms', summary: 'Get form document preview' },

  { method: 'post', path: '/v1/quotes', tag: 'Quotes', summary: 'Rate/create quote' },
  { method: 'get', path: '/v1/quotes', tag: 'Quotes', summary: 'Search quotes' },
  { method: 'get', path: '/v1/quotes/export', tag: 'Quotes', summary: 'Export quotes CSV' },
  { method: 'get', path: '/v1/quotes/{id}', tag: 'Quotes', summary: 'Get quote' },
  { method: 'post', path: '/v1/quotes/draft', tag: 'Quotes', summary: 'Create quote draft' },
  { method: 'patch', path: '/v1/quotes/{id}/draft', tag: 'Quotes', summary: 'Update quote draft' },
  { method: 'post', path: '/v1/quotes/{id}/bind', tag: 'Quotes', summary: 'Bind quote to policy' },
  { method: 'post', path: '/v1/quotes/{id}/copy', tag: 'Quotes', summary: 'Copy quote' },

  { method: 'get', path: '/v1/policies', tag: 'Policies', summary: 'Search policies' },
  { method: 'get', path: '/v1/policies/export', tag: 'Policies', summary: 'Export policies CSV' },
  { method: 'get', path: '/v1/policies/{id}', tag: 'Policies', summary: 'Get policy summary' },
  { method: 'post', path: '/v1/policies/{id}/issue', tag: 'Policies', summary: 'Issue bound policy' },
  { method: 'get', path: '/v1/policies/{id}/versions', tag: 'Policies', summary: 'List policy versions' },
  { method: 'get', path: '/v1/policies/{id}/versions/{vid}/details', tag: 'Policies', summary: 'Get policy version details' },
  { method: 'get', path: '/v1/policies/{id}/versions/{vid}/rating-worksheet', tag: 'Policies', summary: 'Get persisted rating worksheet metadata' },
  { method: 'get', path: '/v1/policies/{id}/full', tag: 'Policies', summary: 'Get reconstructed policy payload' },
  { method: 'get', path: '/v1/policies/{id}/state', tag: 'Policies', summary: 'Get policy state snapshot' },
  { method: 'get', path: '/v1/policies/{id}/timeline', tag: 'Policies', summary: 'Get policy history timeline' },

  { method: 'post', path: '/v1/policies/{id}/endorse/reserve-number', tag: 'Transactions', summary: 'Reserve endorsement number' },
  { method: 'post', path: '/v1/policies/{id}/transactions/reserve-number', tag: 'Transactions', summary: 'Reserve transaction number' },
  { method: 'post', path: '/v1/policies/{id}/endorse/preview', tag: 'Transactions', summary: 'Preview endorsement (effective-dated)' },
  { method: 'post', path: '/v1/policies/{id}/endorse', tag: 'Transactions', summary: 'Issue endorsement' },
  { method: 'post', path: '/v1/policies/{id}/cancel', tag: 'Transactions', summary: 'Issue cancellation' },
  { method: 'post', path: '/v1/policies/{id}/reinstate', tag: 'Transactions', summary: 'Issue reinstatement' },
  { method: 'post', path: '/v1/policies/{id}/rewrite', tag: 'Transactions', summary: 'Issue rewrite' },
  { method: 'post', path: '/v1/policies/{id}/renew', tag: 'Transactions', summary: 'Issue renewal' },
  { method: 'post', path: '/v1/policies/{id}/renew/preview', tag: 'Transactions', summary: 'Preview renewal' },

  { method: 'get', path: '/v1/uw/referrals', tag: 'UW Queue', summary: 'List UW referrals' },
  { method: 'patch', path: '/v1/uw/referrals/{versionId}/approve', tag: 'UW Queue', summary: 'Approve referral' },
  { method: 'patch', path: '/v1/uw/referrals/{versionId}/decline', tag: 'UW Queue', summary: 'Decline referral' },

  { method: 'get', path: '/v1/products/{code}/config', tag: 'Products', summary: 'Get product config' },
  { method: 'get', path: '/v1/products/{code}/form', tag: 'Products', summary: 'Get product form schema' },
  { method: 'get', path: '/v1/products/{code}/field-meta', tag: 'Products', summary: 'Get product field metadata' },

  { method: 'get', path: '/v1/rating/models', tag: 'Rating Workbench', summary: 'List rating models' },
  { method: 'post', path: '/v1/rating/models/import', tag: 'Rating Workbench', summary: 'Import rating workbook' },
  { method: 'get', path: '/v1/rating/models/{modelId}/versions/{versionId}', tag: 'Rating Workbench', summary: 'Get rating model version' },
  { method: 'post', path: '/v1/rating/models/{modelId}/versions/{versionId}/publish', tag: 'Rating Workbench', summary: 'Publish rating model version' },
  { method: 'get', path: '/v1/rating/published', tag: 'Rating Workbench', summary: 'Get published rating model API payload' },

  { method: 'get', path: '/v1/admin/users', tag: 'Admin - Users', summary: 'List users' },
  { method: 'post', path: '/v1/admin/users', tag: 'Admin - Users', summary: 'Create user' },
  { method: 'patch', path: '/v1/admin/users/{id}', tag: 'Admin - Users', summary: 'Update user' },
  { method: 'delete', path: '/v1/admin/users/{id}', tag: 'Admin - Users', summary: 'Delete user' },
  { method: 'get', path: '/v1/admin/security/permissions', tag: 'Admin - Security', summary: 'List permission catalog' },
  { method: 'get', path: '/v1/admin/security/roles', tag: 'Admin - Security', summary: 'List roles' },
  { method: 'get', path: '/v1/admin/security/relationships', tag: 'Admin - Security', summary: 'List role-user-permission relationships' },
  { method: 'post', path: '/v1/admin/security/roles', tag: 'Admin - Security', summary: 'Create role' },
  { method: 'patch', path: '/v1/admin/security/roles/{roleCode}', tag: 'Admin - Security', summary: 'Update role' },
  { method: 'delete', path: '/v1/admin/security/roles/{roleCode}', tag: 'Admin - Security', summary: 'Delete role' },
  { method: 'patch', path: '/v1/admin/security/users/{id}/roles', tag: 'Admin - Security', summary: 'Update user roles' },
  { method: 'get', path: '/v1/admin/tenant', tag: 'Admin - Tenant', summary: 'Get tenant admin config' },
  { method: 'patch', path: '/v1/admin/tenant', tag: 'Admin - Tenant', summary: 'Update tenant admin config' },
  { method: 'get', path: '/v1/admin/underwriting-companies', tag: 'Admin - UW Companies', summary: 'List UW companies' },
  { method: 'post', path: '/v1/admin/underwriting-companies', tag: 'Admin - UW Companies', summary: 'Create UW company' },
  { method: 'patch', path: '/v1/admin/underwriting-companies/{id}', tag: 'Admin - UW Companies', summary: 'Update UW company' },
  { method: 'delete', path: '/v1/admin/underwriting-companies/{id}', tag: 'Admin - UW Companies', summary: 'Delete UW company' },
  { method: 'post', path: '/v1/admin/seed', tag: 'Admin - Utilities', summary: 'Seed demo data' },

  { method: 'get', path: '/v1/admin/forms', tag: 'Admin - Forms', summary: 'List forms' },
  { method: 'post', path: '/v1/admin/forms', tag: 'Admin - Forms', summary: 'Create form' },
  { method: 'post', path: '/v1/admin/forms/seed/iso-personal-auto-us', tag: 'Admin - Forms', summary: 'Seed ISO personal auto forms (demo)' },
  { method: 'get', path: '/v1/admin/forms/{id}', tag: 'Admin - Forms', summary: 'Get form' },
  { method: 'patch', path: '/v1/admin/forms/{id}', tag: 'Admin - Forms', summary: 'Update form' },
  { method: 'post', path: '/v1/admin/forms/{id}/clone', tag: 'Admin - Forms', summary: 'Clone form' },
  { method: 'delete', path: '/v1/admin/forms/{id}', tag: 'Admin - Forms', summary: 'Delete form' },
  { method: 'post', path: '/v1/admin/forms/{id}/submit', tag: 'Admin - Forms', summary: 'Submit form for review' },
  { method: 'post', path: '/v1/admin/forms/{id}/approve', tag: 'Admin - Forms', summary: 'Approve form' },
  { method: 'post', path: '/v1/admin/forms/{id}/activate', tag: 'Admin - Forms', summary: 'Activate form' },
  { method: 'post', path: '/v1/admin/forms/{id}/deactivate', tag: 'Admin - Forms', summary: 'Deactivate form' },
  { method: 'get', path: '/v1/admin/forms/{id}/jurisdictions', tag: 'Admin - Forms', summary: 'List form jurisdictions' },
  { method: 'post', path: '/v1/admin/forms/{id}/jurisdictions', tag: 'Admin - Forms', summary: 'Add form jurisdiction' },
  { method: 'patch', path: '/v1/admin/forms/{id}/jurisdictions/{jurisdictionId}', tag: 'Admin - Forms', summary: 'Update form jurisdiction' },
  { method: 'delete', path: '/v1/admin/forms/{id}/jurisdictions/{jurisdictionId}', tag: 'Admin - Forms', summary: 'Delete form jurisdiction' },
  { method: 'get', path: '/v1/admin/forms/{id}/applicability', tag: 'Admin - Forms', summary: 'List form applicability' },
  { method: 'post', path: '/v1/admin/forms/{id}/applicability', tag: 'Admin - Forms', summary: 'Add form applicability' },
  { method: 'patch', path: '/v1/admin/forms/{id}/applicability/{applicabilityId}', tag: 'Admin - Forms', summary: 'Update form applicability' },
  { method: 'delete', path: '/v1/admin/forms/{id}/applicability/{applicabilityId}', tag: 'Admin - Forms', summary: 'Delete form applicability' },
  { method: 'get', path: '/v1/admin/forms/{id}/triggers', tag: 'Admin - Forms', summary: 'List form triggers' },
  { method: 'post', path: '/v1/admin/forms/{id}/triggers', tag: 'Admin - Forms', summary: 'Add form trigger' },
  { method: 'patch', path: '/v1/admin/forms/{id}/triggers/{triggerId}', tag: 'Admin - Forms', summary: 'Update form trigger' },
  { method: 'delete', path: '/v1/admin/forms/{id}/triggers/{triggerId}', tag: 'Admin - Forms', summary: 'Delete form trigger' },
  { method: 'get', path: '/v1/admin/forms/{id}/output', tag: 'Admin - Forms', summary: 'Get form output config' },
  { method: 'get', path: '/v1/admin/forms/{id}/document', tag: 'Admin - Forms', summary: 'Get admin form preview document' },
  { method: 'get', path: '/v1/admin/forms/{id}/output/template', tag: 'Admin - Forms', summary: 'Get form template asset metadata' },
  { method: 'post', path: '/v1/admin/forms/{id}/output/template', tag: 'Admin - Forms', summary: 'Upload form template asset' },
  { method: 'delete', path: '/v1/admin/forms/{id}/output/template', tag: 'Admin - Forms', summary: 'Delete form template asset' },
  { method: 'put', path: '/v1/admin/forms/{id}/output', tag: 'Admin - Forms', summary: 'Update form output config' },
  { method: 'get', path: '/v1/admin/forms/{id}/delivery', tag: 'Admin - Forms', summary: 'Get form delivery config' },
  { method: 'put', path: '/v1/admin/forms/{id}/delivery', tag: 'Admin - Forms', summary: 'Update form delivery config' },
  { method: 'get', path: '/v1/admin/forms/{id}/security', tag: 'Admin - Forms', summary: 'Get form security config' },
  { method: 'put', path: '/v1/admin/forms/{id}/security', tag: 'Admin - Forms', summary: 'Update form security config' },
  { method: 'get', path: '/v1/admin/forms/{id}/audit', tag: 'Admin - Forms', summary: 'Get form audit' },
  { method: 'post', path: '/v1/admin/forms/preview', tag: 'Admin - Forms', summary: 'Preview form attachment rules (admin)' },
  { method: 'post', path: '/v1/admin/forms/test-expression', tag: 'Admin - Forms', summary: 'Test trigger expression' },

  { method: 'get', path: '/v1/admin/customers/settings', tag: 'Admin - Customers', summary: 'Get customer settings' },
  { method: 'patch', path: '/v1/admin/customers/settings', tag: 'Admin - Customers', summary: 'Update customer settings' },
  { method: 'post', path: '/v1/admin/customers/seed-samples', tag: 'Admin - Customers', summary: 'Seed sample customers' },
  { method: 'get', path: '/v1/admin/customers/search', tag: 'Admin - Customers', summary: 'Search customers' },
  { method: 'get', path: '/v1/admin/customers/policy-links/unlinked', tag: 'Admin - Customers', summary: 'List unlinked policy-customer links' },
  { method: 'post', path: '/v1/admin/customers/policy-links/assign', tag: 'Admin - Customers', summary: 'Assign customer to policy link' },
  { method: 'post', path: '/v1/admin/customers/validate', tag: 'Admin - Customers', summary: 'Validate customer payload + match candidates' },
  { method: 'post', path: '/v1/admin/customers/merge', tag: 'Admin - Customers', summary: 'Merge customers' },
  { method: 'post', path: '/v1/admin/customers/import', tag: 'Admin - Customers', summary: 'Import customer canonical payload' },
  { method: 'post', path: '/v1/admin/customers', tag: 'Admin - Customers', summary: 'Create customer' },
  { method: 'get', path: '/v1/admin/customers/{idOrKey}', tag: 'Admin - Customers', summary: 'Get customer' },
  { method: 'patch', path: '/v1/admin/customers/{idOrKey}', tag: 'Admin - Customers', summary: 'Update customer' },
  { method: 'delete', path: '/v1/admin/customers/{idOrKey}', tag: 'Admin - Customers', summary: 'Delete customer' },
  { method: 'get', path: '/v1/admin/customers/{idOrKey}/export', tag: 'Admin - Customers', summary: 'Export customer JSON' },
  { method: 'get', path: '/v1/admin/customers/{idOrKey}/audit', tag: 'Admin - Customers', summary: 'Get customer audit events' },
  { method: 'post', path: '/v1/admin/customers/{idOrKey}/reveal', tag: 'Admin - Customers', summary: 'Reveal masked PII field (audited)' },
  { method: 'post', path: '/v1/admin/customers/{idOrKey}/submit-approval', tag: 'Admin - Customers', summary: 'Submit customer for approval' },
  { method: 'post', path: '/v1/admin/customers/{idOrKey}/approve', tag: 'Admin - Customers', summary: 'Approve customer change' },
  { method: 'post', path: '/v1/admin/customers/{idOrKey}/deactivate', tag: 'Admin - Customers', summary: 'Deactivate customer' },
  { method: 'post', path: '/v1/admin/customers/{idOrKey}/reactivate', tag: 'Admin - Customers', summary: 'Reactivate customer' },
  { method: 'get', path: '/v1/admin/customers/{idOrKey}/policies', tag: 'Admin - Customers', summary: 'List customer policies' },
  { method: 'get', path: '/v1/admin/customers/{idOrKey}/quotes', tag: 'Admin - Customers', summary: 'List customer quotes' },
  { method: 'get', path: '/v1/admin/customers/{idOrKey}/ai-insights', tag: 'Admin - Customers', summary: 'Get customer AI/ML insights' },

  { method: 'get', path: '/v1/admin/onboarding/settings', tag: 'Admin - Onboarding', summary: 'Get onboarding settings' },
  { method: 'patch', path: '/v1/admin/onboarding/settings', tag: 'Admin - Onboarding', summary: 'Update onboarding settings' },
  { method: 'get', path: '/v1/admin/onboarding/agencies/search', tag: 'Admin - Onboarding', summary: 'Search agencies' },
  { method: 'get', path: '/v1/admin/onboarding/agencies/{agencyId}', tag: 'Admin - Onboarding', summary: 'Get agency' },
  { method: 'post', path: '/v1/admin/onboarding/agencies', tag: 'Admin - Onboarding', summary: 'Create agency' },
  { method: 'patch', path: '/v1/admin/onboarding/agencies/{agencyId}', tag: 'Admin - Onboarding', summary: 'Update agency' },
  { method: 'get', path: '/v1/admin/onboarding/agencies/{agencyId}/contacts', tag: 'Admin - Onboarding', summary: 'List agency contacts' },
  { method: 'post', path: '/v1/admin/onboarding/agencies/{agencyId}/contacts', tag: 'Admin - Onboarding', summary: 'Create agency contact' },
  { method: 'patch', path: '/v1/admin/onboarding/agencies/{agencyId}/contacts/{contactId}', tag: 'Admin - Onboarding', summary: 'Update agency contact' },
  { method: 'delete', path: '/v1/admin/onboarding/agencies/{agencyId}/contacts/{contactId}', tag: 'Admin - Onboarding', summary: 'Delete agency contact' },
  { method: 'get', path: '/v1/admin/onboarding/template', tag: 'Admin - Onboarding', summary: 'Download onboarding template' },
  { method: 'post', path: '/v1/admin/onboarding/jobs', tag: 'Admin - Onboarding', summary: 'Create onboarding job' },
  { method: 'post', path: '/v1/admin/onboarding/jobs/{jobId}/upload', tag: 'Admin - Onboarding', summary: 'Upload onboarding source file' },
  { method: 'post', path: '/v1/admin/onboarding/jobs/{jobId}/service-run', tag: 'Admin - Onboarding', summary: 'Run onboarding integration service' },
  { method: 'post', path: '/v1/admin/onboarding/jobs/{jobId}/normalize', tag: 'Admin - Onboarding', summary: 'Normalize staging rows' },
  { method: 'post', path: '/v1/admin/onboarding/jobs/{jobId}/validate', tag: 'Admin - Onboarding', summary: 'Validate onboarding rows' },
  { method: 'post', path: '/v1/admin/onboarding/jobs/{jobId}/commit', tag: 'Admin - Onboarding', summary: 'Commit onboarding job' },
  { method: 'post', path: '/v1/admin/onboarding/jobs/{jobId}/retry-failed', tag: 'Admin - Onboarding', summary: 'Retry failed onboarding rows' },
  { method: 'get', path: '/v1/admin/onboarding/jobs/{jobId}', tag: 'Admin - Onboarding', summary: 'Get onboarding job' },
  { method: 'patch', path: '/v1/admin/onboarding/jobs/{jobId}/rows/{rowId}', tag: 'Admin - Onboarding', summary: 'Edit onboarding staging row' },
  { method: 'get', path: '/v1/admin/onboarding/jobs/{jobId}/results', tag: 'Admin - Onboarding', summary: 'Get onboarding artifacts/results' },
  { method: 'get', path: '/v1/admin/onboarding/history', tag: 'Admin - Onboarding', summary: 'List onboarding job history' },
  { method: 'get', path: '/v1/admin/onboarding/audit', tag: 'Admin - Onboarding', summary: 'Get onboarding audit events' }
]

function pathToParameters(path: string) {
  const matches = Array.from(path.matchAll(/\{([^}]+)\}/g))
  return matches.map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' }
  }))
}

function mergeParameters(baseParams: any[] = [], overrideParams: any[] = []) {
  const merged = [...baseParams]
  for (const param of overrideParams) {
    const idx = merged.findIndex((p) => p?.name === param?.name && p?.in === param?.in)
    if (idx >= 0) merged[idx] = param
    else merged.push(param)
  }
  return merged
}

function jsonResponse(schemaRefOrSchema: any, description = 'Success') {
  return {
    description,
    content: {
      'application/json': {
        schema:
          typeof schemaRefOrSchema === 'string'
            ? { $ref: `#/components/schemas/${schemaRefOrSchema}` }
            : schemaRefOrSchema
      }
    }
  }
}

const componentSchemas: Record<string, any> = {
  ErrorResponse: {
    type: 'object',
    properties: {
      code: { type: 'string', example: 'DB_ERROR' },
      message: { type: 'string', example: 'Something failed' }
    },
    additionalProperties: true
  },
  LoginRequest: {
    type: 'object',
    required: ['username', 'password'],
    properties: {
      username: { type: 'string', example: 'admin' },
      password: { type: 'string', example: 'password' },
      tenantId: { type: 'string', example: 'sample-carrier' }
    }
  },
  LoginResponse: {
    type: 'object',
    properties: {
      token: { type: 'string' },
      user: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          tenantId: { type: 'string' },
          roles: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: true
      },
      mfaRequired: { type: 'boolean' },
      mfaSetupRequired: { type: 'boolean' }
    },
    additionalProperties: true
  },
  Money: {
    type: 'object',
    properties: {
      amount: { type: 'number', example: 1494.66 },
      currency: { type: 'string', example: 'USD' }
    },
    required: ['amount', 'currency']
  },
  QuotePayload: {
    type: 'object',
    properties: {
      productCode: { type: 'string', enum: ['personal-auto', 'commercial-auto', 'homeowners', 'cyber', 'professional-liability'] },
      effectiveDate: { type: 'string', format: 'date' },
      transactionEffectiveDate: { type: 'string', format: 'date' },
      termMonths: { type: 'integer', example: 12 },
      country: { type: 'string', example: 'US' },
      state: { type: 'string', example: 'PA' },
      underwritingCompanyId: { type: 'string' },
      underwritingCompanyName: { type: 'string' },
      agencyId: { type: 'string' },
      agencyName: { type: 'string' },
      agencyContactId: { type: 'string' },
      agencyContactName: { type: 'string' },
      agencyCommissionPct: { oneOf: [{ type: 'string' }, { type: 'number' }], example: '10' },
      qualificationAnswers: { type: 'object', additionalProperties: { type: 'string' } },
      applicant: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' }
        },
        additionalProperties: true
      },
      insureds: { type: 'object', additionalProperties: true },
      risks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      coverages: { type: 'array', items: { type: 'object', additionalProperties: true } }
    },
    additionalProperties: true
  },
  PremiumResponse: {
    type: 'object',
    properties: {
      base: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'number' }] },
      subtotal: { oneOf: [{ $ref: '#/components/schemas/Money' }, { type: 'number' }] },
      fees: { $ref: '#/components/schemas/Money' },
      taxes: { $ref: '#/components/schemas/Money' },
      total: { $ref: '#/components/schemas/Money' },
      byCoverage: { type: 'array', items: { type: 'object', additionalProperties: true } },
      discounts: { type: 'array', items: { type: 'object', additionalProperties: true } },
      surcharges: { type: 'array', items: { type: 'object', additionalProperties: true } },
      calcTrace: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  },
  UnderwritingResponse: {
    type: 'object',
    properties: {
      decision: { type: 'string', example: 'Eligible' },
      reasons: { type: 'array', items: { type: 'string' } }
    },
    additionalProperties: true
  },
  QuoteAiInsights: {
    type: 'object',
    properties: {
      recommendation: { type: 'string' },
      provider: { type: 'string' },
      modelVersion: { type: 'string' },
      scores: {
        type: 'object',
        properties: {
          risk: { type: 'number' },
          fraud: { type: 'number' },
          premiumAdequacy: { type: 'number' }
        },
        additionalProperties: true
      },
      reasons: { type: 'array', items: { type: 'string' } },
      suggestedActions: { type: 'array', items: { type: 'string' } },
      coveragePremiumAllocation: { type: 'array', items: { type: 'object', additionalProperties: true } }
    },
    additionalProperties: true
  },
  QuoteRateRequest: {
    allOf: [{ $ref: '#/components/schemas/QuotePayload' }]
  },
  QuoteRateResponse: {
    type: 'object',
    properties: {
      quoteId: { type: 'string' },
      quoteNumber: { type: 'string' },
      status: { type: 'string', example: 'Rated' },
      underwriting: { $ref: '#/components/schemas/UnderwritingResponse' },
      premium: { $ref: '#/components/schemas/PremiumResponse' },
      aiInsights: { $ref: '#/components/schemas/QuoteAiInsights' },
      timeline: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  },
  QuoteDraftRequest: {
    type: 'object',
    properties: {
      payload: { $ref: '#/components/schemas/QuotePayload' },
      status: { type: 'string' },
      progressStep: { type: 'integer' }
    },
    required: ['payload']
  },
  BindQuoteResponse: {
    type: 'object',
    properties: {
      policyId: { type: 'string', format: 'uuid' },
      policyNumber: { type: 'string' },
      status: { type: 'string', example: 'Bound' }
    },
    additionalProperties: true
  },
  PolicySummary: {
    type: 'object',
    properties: {
      policyId: { type: 'string', format: 'uuid' },
      policyNumber: { type: 'string' },
      productCode: { type: 'string' },
      status: { type: 'string' },
      term: { type: 'object', additionalProperties: true },
      premium: { $ref: '#/components/schemas/PremiumResponse' },
      customerId: { type: 'string' },
      customerKey: { type: 'string' }
    },
    additionalProperties: true
  },
  PolicyVersionRow: {
    type: 'object',
    properties: {
      versionId: { type: 'string', format: 'uuid' },
      transactionNumber: { type: 'string' },
      transactionType: { type: 'string' },
      effectiveDate: { type: 'string', format: 'date' },
      policyEffectiveDate: { type: 'string', format: 'date' },
      expirationDate: { type: 'string', format: 'date' },
      createdDate: { type: 'string' },
      updatedDate: { type: 'string' },
      updatedUser: { type: 'string' },
      premium: { $ref: '#/components/schemas/PremiumResponse' },
      uwDecision: { type: 'string', nullable: true }
    },
    additionalProperties: true
  },
  EndorsementPreviewRequest: {
    type: 'object',
    required: ['effectiveDate'],
    properties: {
      effectiveDate: { type: 'string', format: 'date' },
      changes: { type: 'array', items: { type: 'object', additionalProperties: true } },
      payload: { $ref: '#/components/schemas/QuotePayload' },
      overrideReason: { type: 'string' }
    },
    additionalProperties: true
  },
  EndorsementPreviewResponse: {
    type: 'object',
    properties: {
      effectiveDate: { type: 'string', format: 'date' },
      underwriting: { $ref: '#/components/schemas/UnderwritingResponse' },
      premium: { $ref: '#/components/schemas/PremiumResponse' },
      fullTerm: { type: 'object', additionalProperties: true },
      retroAdjustment: { type: 'object', additionalProperties: true },
      timeline: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  },
  TransactionIssueRequest: {
    type: 'object',
    properties: {
      effectiveDate: { type: 'string', format: 'date' },
      changes: { type: 'array', items: { type: 'object', additionalProperties: true } },
      payload: { $ref: '#/components/schemas/QuotePayload' },
      reason: { type: 'string' },
      overrideReason: { type: 'string' },
      transactionNumber: { type: 'string' }
    },
    additionalProperties: true
  },
  TransactionIssueResponse: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      status: { type: 'string' },
      policyId: { type: 'string' },
      policyNumber: { type: 'string' },
      transactionId: { type: 'string' },
      transactionNumber: { type: 'string' },
      versionId: { type: 'string' }
    },
    additionalProperties: true
  },
  ReserveTransactionNumberResponse: {
    type: 'object',
    properties: { transactionNumber: { type: 'string' } },
    required: ['transactionNumber']
  },
  RatingWorkbookImportRequest: {
    type: 'object',
    required: ['fileName', 'dataBase64'],
    properties: {
      fileName: { type: 'string' },
      mimeType: { type: 'string' },
      dataBase64: { type: 'string', description: 'Base64 encoded workbook bytes' },
      modelCode: { type: 'string' },
      productCode: { type: 'string' },
      stateCode: { type: 'string' },
      programName: { type: 'string' }
    },
    additionalProperties: false
  },
  RatingWorkbookModelSummary: {
    type: 'object',
    properties: {
      modelId: { type: 'string' },
      modelCode: { type: 'string' },
      productCode: { type: 'string' },
      stateCode: { type: 'string' },
      latestVersion: { type: 'string' },
      publishedVersion: { type: 'string' }
    },
    additionalProperties: true
  },
  PublishedRatingModelResponse: {
    type: 'object',
    properties: {
      modelCode: { type: 'string' },
      versionLabel: { type: 'string' },
      productCode: { type: 'string' },
      stateCode: { type: 'string' },
      workbook: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  },
  RatingWorksheetDocumentMetadata: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      type: { type: 'string', example: 'RATING_WORKSHEET' },
      uri: { type: 'string', example: 'generated://rating-worksheet/<transactionId>' },
      hash: { type: 'string' },
      createdAt: { type: 'string' },
      createdBy: { type: 'string', nullable: true },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  }
}

const operationOverrides: Record<string, any> = {
  'POST /auth/login': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } }
    },
    responses: {
      '200': jsonResponse('LoginResponse'),
      '401': jsonResponse('ErrorResponse', 'Invalid credentials')
    }
  },
  'POST /v1/quotes': {
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/QuoteRateRequest' }
        }
      }
    },
    responses: {
      '200': jsonResponse('QuoteRateResponse'),
      '400': jsonResponse('ErrorResponse')
    }
  },
  'GET /v1/quotes/{id}': {
    responses: { '200': jsonResponse('QuoteRateResponse') }
  },
  'POST /v1/quotes/draft': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteDraftRequest' } } }
    },
    responses: { '200': jsonResponse('QuoteRateResponse') }
  },
  'PATCH /v1/quotes/{id}/draft': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/QuoteDraftRequest' } } }
    },
    responses: { '200': jsonResponse('QuoteRateResponse') }
  },
  'POST /v1/quotes/{id}/bind': {
    requestBody: {
      required: false,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } }
    },
    responses: { '200': jsonResponse('BindQuoteResponse') }
  },
  'GET /v1/policies/{id}': {
    responses: { '200': jsonResponse('PolicySummary') }
  },
  'GET /v1/policies/{id}/versions': {
    responses: {
      '200': jsonResponse({ type: 'array', items: { $ref: '#/components/schemas/PolicyVersionRow' } })
    }
  },
  'GET /v1/policies/{id}/versions/{vid}/rating-worksheet': {
    responses: { '200': jsonResponse('RatingWorksheetDocumentMetadata') }
  },
  'POST /v1/policies/{id}/endorse/preview': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/EndorsementPreviewRequest' } } }
    },
    responses: { '200': jsonResponse('EndorsementPreviewResponse') }
  },
  'POST /v1/policies/{id}/endorse': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/TransactionIssueRequest' } } }
    },
    responses: { '200': jsonResponse('TransactionIssueResponse') }
  },
  'POST /v1/policies/{id}/cancel': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/TransactionIssueRequest' } } }
    },
    responses: { '200': jsonResponse('TransactionIssueResponse') }
  },
  'POST /v1/policies/{id}/reinstate': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/TransactionIssueRequest' } } }
    },
    responses: { '200': jsonResponse('TransactionIssueResponse') }
  },
  'POST /v1/policies/{id}/rewrite': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/TransactionIssueRequest' } } }
    },
    responses: { '200': jsonResponse('TransactionIssueResponse') }
  },
  'POST /v1/policies/{id}/renew': {
    requestBody: {
      required: false,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/TransactionIssueRequest' } } }
    },
    responses: { '200': jsonResponse('TransactionIssueResponse') }
  },
  'POST /v1/policies/{id}/endorse/reserve-number': {
    responses: { '200': jsonResponse('ReserveTransactionNumberResponse') }
  },
  'POST /v1/policies/{id}/transactions/reserve-number': {
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['mode'],
            properties: { mode: { type: 'string', enum: ['endorse', 'cancel', 'reinstate', 'rewrite', 'renew'] } }
          }
        }
      }
    },
    responses: { '200': jsonResponse('ReserveTransactionNumberResponse') }
  },
  'GET /v1/rating/models': {
    responses: { '200': jsonResponse({ type: 'array', items: { $ref: '#/components/schemas/RatingWorkbookModelSummary' } }) }
  },
  'POST /v1/rating/models/import': {
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/RatingWorkbookImportRequest' } } }
    },
    responses: { '200': jsonResponse({ type: 'object', additionalProperties: true }) }
  },
  'GET /v1/rating/published': {
    parameters: [
      { name: 'productCode', in: 'query', schema: { type: 'string' }, required: false },
      { name: 'stateCode', in: 'query', schema: { type: 'string' }, required: false },
      { name: 'modelCode', in: 'query', schema: { type: 'string' }, required: false },
      { name: 'versionLabel', in: 'query', schema: { type: 'string' }, required: false }
    ],
    responses: { '200': jsonResponse('PublishedRatingModelResponse') }
  }
}

export function buildOpenApiSpec(serverUrl: string) {
  const paths: Record<string, any> = {}
  for (const route of routeDefs) {
    const path = route.path
    const method = route.method
    if (!paths[path]) paths[path] = {}
    const security: any[] = []
    if (route.requiresAuth !== false) security.push({ BearerAuth: [] })
    if (route.requiresTenant !== false && route.path.startsWith('/v1')) security.push({ TenantHeader: [] })
    const key = `${method.toUpperCase()} ${path}`
    const override = operationOverrides[key] || {}
    const baseOp = {
      tags: [route.tag],
      summary: route.summary,
      operationId: `${method}_${path.replace(/[{}:/-]+/g, '_').replace(/^_+|_+$/g, '')}`,
      parameters: pathToParameters(path),
      security,
      responses: {
        '200': { description: 'Success' },
        '400': { description: 'Bad Request' },
        '401': { description: 'Unauthorized' },
        '403': { description: 'Forbidden' },
        '404': { description: 'Not Found' },
        '500': { description: 'Server Error' }
      }
    }
    const mergedOp = {
      ...baseOp,
      ...override,
      parameters: mergeParameters(baseOp.parameters, override.parameters || []),
      responses: {
        ...baseOp.responses,
        ...(override.responses || {})
      }
    }
    paths[path][method] = mergedOp
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'LatticePolicy API',
      version: '1.0.0',
      description:
        'Operational API inventory for LatticePolicy. This is a route-level catalog (schemas are intentionally minimal and can be expanded into a full OpenAPI contract).'
    },
    servers: [{ url: serverUrl }],
    tags: Array.from(new Set(routeDefs.map((r) => r.tag))).sort().map((name) => ({ name })),
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        TenantHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Tenant',
          description: 'Tenant context header required for /v1 APIs.'
        }
      },
      schemas: componentSchemas
    },
    paths
  }
}

export function swaggerUiHtml(specUrl: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LatticePolicy API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f5f7fb; }
      .topbar { padding: 12px 16px; font: 600 14px/1.4 Arial, sans-serif; background: #1f2937; color: #fff; }
      .topbar small { opacity: 0.8; font-weight: 400; margin-left: 8px; }
    </style>
  </head>
  <body>
    <div class="topbar">LatticePolicy API Docs <small>Swagger UI route catalog</small></div>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: '#swagger-ui',
        docExpansion: 'list',
        persistAuthorization: true,
        displayRequestDuration: true
      })
    </script>
  </body>
</html>`
}
