// Barrel re-export — assembles domain modules into the same public API shape.

import {
  createQuote, bindQuote, copyQuote, createQuoteDraft, updateQuoteDraft,
  searchQuotes, getQuote, inferQuoteAiInsights, exportQuotesCsv
} from './quotes.api'

import {
  issuePolicy, getPolicy, getPolicyVersions, getFullPolicy, getPolicyTimeline,
  searchPolicies, exportPoliciesCsv, getPolicyAiInsights,
  reserveEndorsementNumber, reserveTransactionNumber,
  endorsePolicy, endorsePreview,
  cancelPolicy, reinstatePolicy, rewritePolicy, renewPolicy, nonRenewPolicy,
  getAdditionalInterests, createAdditionalInterest, updateAdditionalInterest, deleteAdditionalInterest,
  getCancellationReasonCodes,
  apiDetails as _apiDetails, apiPreview as _apiPreview
} from './policies.api'

import {
  listRatingModels, importRatingWorkbook, getRatingModelVersion,
  publishRatingModelVersion, getPublishedRatingModel
} from './rating.api'

import {
  listUnderwritingCompanies, listReferenceAgencies, listAgencyContacts,
  listUnderwriters, listReferenceInsuranceCarriers,
  getProductConfig, getProductForm, previewForms, getFormDocument,
  getTenantPreferences, getAiSettings, getDashboardAiInsights
} from './references.api'

import { adminApi as _adminApi } from './admin.api'

import { apiUw as _apiUw } from './uw.api'

import {
  getCustomerPortalSummary, getCustomerPortalPolicy
} from './portal.api'

export const api = {
  // Quotes
  createQuote, bindQuote, copyQuote, createQuoteDraft, updateQuoteDraft,
  searchQuotes, getQuote, inferQuoteAiInsights, exportQuotesCsv,
  // Policies
  issuePolicy, getPolicy, getPolicyVersions, getFullPolicy, getPolicyTimeline,
  searchPolicies, exportPoliciesCsv, getPolicyAiInsights,
  reserveEndorsementNumber, reserveTransactionNumber,
  endorsePolicy, endorsePreview,
  cancelPolicy, reinstatePolicy, rewritePolicy, renewPolicy, nonRenewPolicy,
  getAdditionalInterests, createAdditionalInterest, updateAdditionalInterest, deleteAdditionalInterest,
  getCancellationReasonCodes,
  // Rating
  listRatingModels, importRatingWorkbook, getRatingModelVersion,
  publishRatingModelVersion, getPublishedRatingModel,
  // References
  listUnderwritingCompanies, listReferenceAgencies, listAgencyContacts,
  listUnderwriters, listReferenceInsuranceCarriers,
  getProductConfig, getProductForm, previewForms, getFormDocument,
  getTenantPreferences, getAiSettings, getDashboardAiInsights,
  // Portal
  getCustomerPortalSummary, getCustomerPortalPolicy
}

export const adminApi = _adminApi
export const apiDetails = _apiDetails
export const apiPreview = _apiPreview
export const apiUw = _apiUw

// Convenient re-exports (backward compat)
export const apiAdmin = adminApi
export const apiAdminUsers = adminApi
