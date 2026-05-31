import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiDetails, adminApi } from '../../api/client'
import {
  useUnderwritingCompanies,
  useReferenceAgencies,
  useUnderwriters,
  useReferenceInsuranceCarriers,
  useCancellationReasonCodes,
  useAgencyContacts
} from '../../api/hooks'
import carrierLogo from '../../assets/sample-carrier-logo.svg'
import { normalizePayloadCoverages } from './coverageUtils'
import { clearPendingTransaction, savePendingTransaction, type PendingTransactionMode } from './pendingEndorsement'
import { deriveWizardTransactionStatus } from '../policies/statusModel'
import type { Field } from './schema'
import { setByPath, validateFields } from './schema'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/Toast'
import { hasPermission } from '../../auth/permissions'
import { StatusBadge } from '../../components/StatusBadge'
import {
  isRegionInCountry,
  normalizeCountryCode,
  normalizeRegionCode,
  regionsForCountry,
  type CountryCode
} from '../../shared/usStates'
import { formatDisplayDate } from '../../shared/dateDisplay'

type ProductCode = 'personal-auto' | 'commercial-auto' | 'homeowners' | 'cyber' | 'professional-liability'
type QuoteProductCode = ProductCode | ''
type WizardMode = 'quote' | 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'
type UnderwritingCompanyConfig = {
  companyId: string
  name: string
  productCode: ProductCode
  country: CountryCode
  state: string
}

type AgencyOption = {
  agencyId: string
  agencyCode: string
  agencyKey: string
  legalName: string
  dbaName?: string
}

type AgencyContactOption = {
  contactId: string
  displayName: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
}

type UnderwriterOption = {
  userId: string
  username: string
  displayName: string
}

type QualificationAnswer = '' | 'yes' | 'no'
type QualificationAnswers = Record<string, QualificationAnswer>
type QualificationVisibilityCondition = {
  key: string
  answer: Exclude<QualificationAnswer, ''>
}
type QualificationQuestion = {
  key: string
  label: string
  required?: boolean
  showWhen?: QualificationVisibilityCondition
}

type QuoteState = {
  productCode: QuoteProductCode
  effectiveDate: string
  termMonths: number
  country: CountryCode | ''
  state: string
  underwritingCompanyId?: string
  underwritingCompanyName?: string
  agencyId?: string
  agencyName?: string
  agencyContactId?: string
  agencyContactName?: string
  agencyCommissionPct?: string
  policyOffering?: string
  underwriterUserId?: string
  underwriterName?: string
  priorPolicyNumber?: string
  priorCarrier?: string
  qualificationAnswers: QualificationAnswers
  applicant: { firstName: string; lastName: string; email?: string }
  risks: any[]
  coverages: any[]
}

type InsuredAddress = {
  street: string
  city: string
  state: string
  zip: string
}

type InsuredParty = {
  firstName: string
  lastName: string
  dob: string
  prefix: string
  displayName: string
  email: string
  phone: string
  customerId: string
  customerKey: string
  address: InsuredAddress
}

type InsuredState = {
  primary: InsuredParty
  secondary: InsuredParty
  additional: InsuredParty[]
}

type QuoteDraft = {
  quoteId: string
  quoteNumber: string
  status: string
  progressStep: number
}

type QuoteAuditEntry = {
  value: string | number
  updatedAt: string
  updatedBy: string
}

type WizardFormsTab = 'forms' | 'documents'
type FormAttachmentStage = 'Quote' | 'Bind' | 'Issue'
type AttachedForm = {
  formId: string
  formNumber: string
  formTitle: string
  editionDate?: string
  packetPlacement?: string
  reasons?: string[]
}

type GeneratedDocumentRow = {
  id: string
  name: string
  stage: FormAttachmentStage
  status: string
}

type EndorsementImpactedSegment = {
  startDate: string
  endDate: string
  oldPremium: number
  newPremium: number
  oldFees: number
  newFees: number
  oldTaxes: number
  newTaxes: number
  proRatedDelta: number
  proRatedFeesDelta: number
  proRatedTaxesDelta: number
}

type EndorsementRebasedTransaction = {
  versionId: string
  transactionId: string | null
  transactionType: string
  transactionNumber: string | null
  effectiveDate: string
}

type EndorsementPreviewResponse = {
  effectiveDate: string
  underwriting?: any
  premium?: any
  fullTerm?: {
    old: number
    new: number
    delta: number
    currency: string
  }
  retroAdjustment?: {
    totalDelta: number
    feesDelta: number
    taxesDelta: number
    currency: string
    impactedSegments: EndorsementImpactedSegment[]
  }
  timeline?: {
    wouldRebase: boolean
    rebasedTransactions: EndorsementRebasedTransaction[]
  }
}

type QuoteSummaryDocumentModel = {
  quoteNumber: string
  generatedAt: string
  product: string
  effectiveDate: string
  termMonths: number
  country: string
  state: string
  underwritingCompany: string
  agencyName: string
  agencyContactName: string
  insuredName: string
  commissionPct: string
  commissionAmount: string
  premiumBase: string
  premiumFees: string
  premiumTaxes: string
  premiumTotal: string
  coveragePremiumRows: Array<{
    code: string
    name: string
    amount: number
    amountFormatted: string
    share: string
  }>
  vehicles: PolicyVehicleCard[]
}

type PolicyVehicleCard = {
  vehicleLabel: string
  vin: string
  garagingZip: string
}

type PolicyPacketDocumentModel = {
  policyNumber: string
  quoteNumber: string
  generatedAt: string
  insuredName: string
  underwritingCompany: string
  agencyName: string
  agencyContactName: string
  effectiveDate: string
  expirationDate: string
  state: string
  country: string
  product: string
  commissionPct: string
  commissionAmount: string
  premiumTotal: string
  coverageRows: Array<{
    code: string
    name: string
    details: string
  }>
  idCards: PolicyVehicleCard[]
}

type PolicyIdCardsDocumentModel = {
  policyNumber: string
  generatedAt: string
  insuredName: string
  underwritingCompany: string
  effectiveDate: string
  expirationDate: string
  state: string
  vehicles: PolicyVehicleCard[]
}

type RatingWorksheetCoverageFormulaRow = {
  code: string
  name: string
  limitOrDeductible: string
  formula: string
  factorSummary: string
  amountFormatted: string
}

type RatingWorksheetDocumentModel = {
  documentTitle: string
  generatedAt: string
  quoteOrTransactionNumber: string
  policyNumber: string
  transactionType: string
  product: string
  insuredName: string
  underwritingCompany: string
  state: string
  country: string
  effectiveDate: string
  transactionEffectiveDate: string
  termMonths: number
  raterSource: string
  raterModelCode: string
  raterVersion: string
  premiumFees: string
  premiumTaxes: string
  premiumTotal: string
  coverageFormulaRows: RatingWorksheetCoverageFormulaRow[]
  globalFactorRows: Array<{ label: string; value: string }>
  calcTraceJson: Record<string, any> | null
}

const defaultState: QuoteState = {
  productCode: '',
  effectiveDate: new Date().toISOString().slice(0,10),
  termMonths: 12,
  country: '',
  state: '',
  underwritingCompanyId: '',
  underwritingCompanyName: '',
  agencyId: '',
  agencyName: '',
  agencyContactId: '',
  agencyContactName: '',
  agencyCommissionPct: '',
  policyOffering: '',
  underwriterUserId: '',
  underwriterName: '',
  priorPolicyNumber: '',
  priorCarrier: '',
  qualificationAnswers: {},
  applicant: { firstName: 'Test', lastName: 'User' },
  risks: [],
  coverages: []
}

const PRODUCT_LABELS: Record<ProductCode, string> = {
  'personal-auto': 'Personal Auto',
  'commercial-auto': 'Commercial Auto',
  homeowners: 'Homeowners',
  cyber: 'Cyber',
  'professional-liability': 'Professional Liability'
}

const ENDORSEMENT_REASONS: Record<ProductCode, string[]> = {
  'personal-auto': [
    'Address Change',
    'Named Insured Change',
    'Vehicle Addition',
    'Vehicle Removal',
    'Vehicle Use Change',
    'Driver Addition',
    'Driver Removal',
    'Coverage Addition',
    'Coverage Removal',
    'Coverage Modification',
    'Limit Increase',
    'Limit Decrease',
    'Deductible Change',
    'Lienholder Change',
    'Additional Insured Addition',
    'Additional Insured Removal',
    'Discount Addition',
    'Discount Removal',
    'Policy Correction',
    'Underwriting Information Update',
    'Other',
  ],
  'commercial-auto': [
    'Address Change',
    'Named Insured Change',
    'Vehicle Addition',
    'Vehicle Removal',
    'Driver Addition',
    'Driver Removal',
    'Fleet Size Change',
    'Business Use Change',
    'DOT / Compliance Update',
    'Coverage Addition',
    'Coverage Removal',
    'Coverage Modification',
    'Limit Increase',
    'Limit Decrease',
    'Deductible Change',
    'Lienholder Change',
    'Additional Insured Addition',
    'Additional Insured Removal',
    'Premium Audit Adjustment',
    'Policy Correction',
    'Underwriting Information Update',
    'Other',
  ],
  homeowners: [
    'Mailing Address Change',
    'Named Insured Change',
    'Occupancy Change',
    'Property Improvement',
    'Roof Update',
    'Coverage Addition',
    'Coverage Removal',
    'Coverage Modification',
    'Limit Increase',
    'Limit Decrease',
    'Deductible Change',
    'Mortgagee Addition',
    'Mortgagee Removal',
    'Mortgagee Change',
    'Additional Insured Addition',
    'Additional Insured Removal',
    'Discount Addition',
    'Discount Removal',
    'Policy Correction',
    'Underwriting Information Update',
    'Other',
  ],
  cyber: [
    'Named Insured Change',
    'Revenue / Exposure Change',
    'Industry Classification Change',
    'Security Controls Update',
    'Technology Environment Change',
    'Coverage Addition',
    'Coverage Removal',
    'Coverage Modification',
    'Limit Increase',
    'Limit Decrease',
    'Retention Change',
    'Deductible Change',
    'Additional Insured Addition',
    'Additional Insured Removal',
    'Sublimit Adjustment',
    'Policy Correction',
    'Underwriting Information Update',
    'Other',
  ],
  'professional-liability': [
    'Named Insured Change',
    'Scope of Services Change',
    'Personnel Change',
    'Revenue / Exposure Change',
    'Retroactive Date Change',
    'Coverage Addition',
    'Coverage Removal',
    'Coverage Modification',
    'Limit Increase',
    'Limit Decrease',
    'Deductible Change',
    'Additional Insured Addition',
    'Additional Insured Removal',
    'Prior Acts Coverage Change',
    'Extended Reporting Period Addition',
    'Policy Correction',
    'Underwriting Information Update',
    'Other',
  ],
}

const QUALIFICATION_QUESTIONS: Record<ProductCode, QualificationQuestion[]> = {
  'personal-auto': [
    { key: 'noMajorViolations3Years', label: 'No major traffic violations in last 3 years?', required: true },
    {
      key: 'majorViolationsOlderThan12Months',
      label: 'If there were violations, were they more than 12 months ago?',
      required: true,
      showWhen: { key: 'noMajorViolations3Years', answer: 'no' }
    },
    { key: 'noAtFaultAccidents3Years', label: 'No at-fault accidents in last 3 years?', required: true },
    {
      key: 'singleAtFaultAccidentOnly',
      label: 'If there were accidents, was there only one at-fault accident?',
      required: true,
      showWhen: { key: 'noAtFaultAccidents3Years', answer: 'no' }
    },
    { key: 'continuousInsurance6Months', label: 'Continuous auto insurance for last 6 months?', required: true },
    {
      key: 'coverageLapseUnder30Days',
      label: 'If coverage lapsed, was the lapse 30 days or less?',
      required: true,
      showWhen: { key: 'continuousInsurance6Months', answer: 'no' }
    },
    { key: 'noRideshareOrDeliveryUse', label: 'Vehicle not used for rideshare or delivery?', required: true },
    { key: 'garagedAtResidence', label: 'Vehicle is primarily garaged at residence?', required: true }
  ],
  'commercial-auto': [
    { key: 'validCommercialDriversLicensed', label: 'All listed/operators are properly licensed for vehicle classes operated?', required: true },
    { key: 'fleetMaintained', label: 'Vehicles are maintained on a documented preventive maintenance schedule?', required: true },
    { key: 'noHazmatHauling', label: 'No hazardous materials hauling or specialized hazardous operations?', required: true },
    { key: 'noMajorLosses3Years', label: 'No severe/fatality losses in the last 3 years?', required: true },
    { key: 'dotComplianceControls', label: 'DOT/compliance controls and driver file management are in place (if applicable)?', required: true }
  ],
  homeowners: [
    { key: 'noPropertyClaims5Years', label: 'No property claims in last 5 years?', required: true },
    { key: 'roofMaintained', label: 'Roof is in good condition with no active leaks?', required: true },
    { key: 'noBusinessOnPremises', label: 'No business operations on premises?', required: true },
    { key: 'noVacancyOver30Days', label: 'Home not vacant for more than 30 days?', required: true },
    { key: 'protectiveDevicesInstalled', label: 'Smoke/CO detectors and basic protection devices installed?', required: true }
  ],
  cyber: [
    { key: 'mfaRequiredForRemoteAccess', label: 'MFA enforced for all remote and privileged access?', required: true },
    { key: 'edrOnManagedEndpoints', label: 'EDR/anti-malware active on managed endpoints?', required: true },
    { key: 'immutableBackupsTested', label: 'Backups are immutable/offline and tested regularly?', required: true },
    { key: 'incidentResponsePlan', label: 'Incident response plan documented and tested annually?', required: true },
    { key: 'noMaterialCyberLoss3Years', label: 'No material cyber loss events in the last 3 years?', required: true }
  ],
  'professional-liability': [
    { key: 'licensedAndInGoodStanding', label: 'Required licenses/certifications are active and in good standing?', required: true },
    { key: 'writtenContractsForAllWork', label: 'Written contracts and scope definitions are used for all engagements?', required: true },
    { key: 'noKnownCircumstances', label: 'No known incidents/circumstances likely to lead to a claim?', required: true },
    { key: 'qaPeerReviewProcess', label: 'Formal QA/peer review or supervisory controls are in place?', required: true },
    { key: 'noMaterialDisciplinaryActions', label: 'No material disciplinary actions in the last 5 years?', required: true }
  ]
}

const POLICY_OFFERINGS: Record<ProductCode, string[]> = {
  'personal-auto': [
    'Standard Personal Auto',
    'Preferred Driver',
    'Non-Owner Liability',
    'High-Risk / Assigned Risk',
    'Usage-Based Auto'
  ],
  'commercial-auto': [
    'Commercial Auto - Artisan Contractor',
    'Commercial Auto - Service Fleet',
    'Commercial Auto - Delivery Fleet',
    'Commercial Auto - Mixed Fleet'
  ],
  homeowners: [
    'HO-3 Special Form',
    'HO-5 Comprehensive',
    'HO-6 Condo Unit-Owners',
    'HO-4 Renters',
    'DP-3 Dwelling Fire'
  ],
  cyber: [
    'Cyber Essentials',
    'Cyber Preferred',
    'Cyber Plus',
    'Cyber Enterprise'
  ],
  'professional-liability': [
    'Miscellaneous Professional Liability',
    'Errors & Omissions Standard',
    'Professional Liability Preferred',
    'Professional Liability Plus'
  ]
}

function parseWizardMode(value: string | null): WizardMode {
  const mode = (value || 'quote').toLowerCase()
  if (mode === 'endorse' || mode === 'cancel' || mode === 'reinstate' || mode === 'rewrite' || mode === 'renew') {
    return mode
  }
  return 'quote'
}

function isTruthyQueryFlag(value: string | null): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function normalizeDateInput(value: any): string {
  const text = String(value || '').trim()
  if (!text) return ''
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  if (isoPrefix) return isoPrefix[1]
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function transactionLabel(mode: WizardMode): string {
  if (mode === 'endorse') return 'Endorsement'
  if (mode === 'cancel') return 'Cancellation'
  if (mode === 'reinstate') return 'Reinstatement'
  if (mode === 'rewrite') return 'Rewrite'
  if (mode === 'renew') return 'Renewal'
  return 'Quote'
}

function isSupportedProductCode(value: any): value is ProductCode {
  return value === 'personal-auto' || value === 'commercial-auto' || value === 'homeowners' || value === 'cyber' || value === 'professional-liability'
}

function productLabel(code: ProductCode): string {
  return PRODUCT_LABELS[code] || code
}

function formatSelectionLabel(value: any): string {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function defaultRisksForProduct(code: QuoteProductCode): any[] {
  if (code === 'personal-auto') return [defaultAutoRisk()]
  if (code === 'commercial-auto') return [defaultCommercialAutoRisk()]
  if (code === 'homeowners') return [defaultDwellingRisk()]
  if (code === 'cyber') return [defaultCyberRisk()]
  if (code === 'professional-liability') return [defaultProfessionalLiabilityRisk()]
  return []
}

function qualificationQuestionCatalogForProduct(code: QuoteProductCode): QualificationQuestion[] {
  return isSupportedProductCode(code) ? QUALIFICATION_QUESTIONS[code] || [] : []
}

function isQualificationQuestionVisible(
  question: QualificationQuestion,
  answers: QualificationAnswers = {}
): boolean {
  if (!question.showWhen) return true
  return answers?.[question.showWhen.key] === question.showWhen.answer
}

function qualificationQuestionsForProduct(
  code: QuoteProductCode,
  answers: QualificationAnswers = {}
): QualificationQuestion[] {
  return qualificationQuestionCatalogForProduct(code).filter((question) => isQualificationQuestionVisible(question, answers))
}

function emptyQualificationAnswers(code: QuoteProductCode): QualificationAnswers {
  const out: QualificationAnswers = {}
  for (const question of qualificationQuestionCatalogForProduct(code)) {
    out[question.key] = ''
  }
  return out
}

function normalizeQualificationAnswer(value: any): QualificationAnswer {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'yes' || normalized === 'true') return 'yes'
  if (normalized === 'no' || normalized === 'false') return 'no'
  return ''
}

function qualificationAnswersFromUw(
  productCode: QuoteProductCode,
  uwAnswers: any,
  current: QualificationAnswers = {}
): QualificationAnswers {
  const base = emptyQualificationAnswers(productCode)
  for (const question of qualificationQuestionCatalogForProduct(productCode)) {
    const raw = uwAnswers?.[question.key] ?? current?.[question.key]
    base[question.key] = normalizeQualificationAnswer(raw)
  }
  return base
}

function validateQualificationAnswers(
  productCode: QuoteProductCode,
  answers: QualificationAnswers
): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const question of qualificationQuestionsForProduct(productCode, answers)) {
    if (!question.required) continue
    if (!answers?.[question.key]) errs[question.key] = 'Required'
  }
  return errs
}

function formatQualificationAnswer(value: QualificationAnswer): string {
  if (value === 'yes') return 'Yes'
  if (value === 'no') return 'No'
  return '-'
}

function formatInsuredAddress(address: Partial<InsuredAddress> | null | undefined): string {
  if (!address || typeof address !== 'object') return ''
  const street = String(address.street || '').trim()
  const city = String(address.city || '').trim()
  const state = String(address.state || '').trim()
  const zip = String(address.zip || '').trim()
  const cityStateZip = [city, state].filter(Boolean).join(', ')
  const cityStateZipWithPostal = [cityStateZip, zip].filter(Boolean).join(' ')
  return [street, cityStateZipWithPostal].filter(Boolean).join(', ')
}

function companyNameKey(value: any): string {
  return String(value || '').trim().toLowerCase()
}

function dedupeCompanyNames(items: UnderwritingCompanyConfig[]): UnderwritingCompanyConfig[] {
  const byKey = new Map<string, UnderwritingCompanyConfig>()
  for (const item of items) {
    if (!item) continue
    const key = companyNameKey(item.name)
    if (!key || byKey.has(key)) continue
    byKey.set(key, item)
  }
  return Array.from(byKey.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

function configMatchesState(configState: string, selectedState: string): boolean {
  if (!selectedState) return true
  const normalizedConfigState = normalizeRegionCode(configState)
  const normalizedSelectedState = normalizeRegionCode(selectedState)
  return normalizedConfigState === 'ALL' || normalizedConfigState === normalizedSelectedState
}

function resolveUnderwritingCompanyConfig(
  state: QuoteState,
  configs: UnderwritingCompanyConfig[]
): UnderwritingCompanyConfig | null {
  const selectedName = companyNameKey(state.underwritingCompanyName)
  if (!selectedName) return null
  const candidates = configs.filter((item) => {
    if (companyNameKey(item.name) !== selectedName) return false
    if (state.productCode && item.productCode !== state.productCode) return false
    if (state.country && normalizeCountryCode(item.country) !== state.country) return false
    if (state.state && !configMatchesState(item.state, state.state)) return false
    return true
  })
  if (!candidates.length) return null
  const normalizedState = normalizeRegionCode(state.state)
  if (normalizedState) {
    const exactState = candidates.find((item) => normalizeRegionCode(item.state) === normalizedState)
    if (exactState) return exactState
  }
  if (state.underwritingCompanyId) {
    const byId = candidates.find((item) => item.companyId === state.underwritingCompanyId)
    if (byId) return byId
  }
  return candidates[0]
}

function emptyInsuredParty(): InsuredParty {
  return {
    firstName: '',
    lastName: '',
    dob: '',
    prefix: '',
    displayName: '',
    email: '',
    phone: '',
    customerId: '',
    customerKey: '',
    address: {
      street: '',
      city: '',
      state: '',
      zip: ''
    }
  }
}

function createDefaultInsuredState(): InsuredState {
  return {
    primary: emptyInsuredParty(),
    secondary: emptyInsuredParty(),
    additional: []
  }
}

function normalizeInsuredParty(raw: any, fallback?: Partial<InsuredParty>): InsuredParty {
  const source = raw && typeof raw === 'object' ? raw : {}
  const sourceAddress = source.address && typeof source.address === 'object' ? source.address : {}
  const fallbackAddress = fallback?.address || { street: '', city: '', state: '', zip: '' }
  const firstName = String(source.firstName ?? fallback?.firstName ?? '').trim()
  const lastName = String(source.lastName ?? fallback?.lastName ?? '').trim()
  const computedDisplayName = [firstName, lastName].filter(Boolean).join(' ').trim()
  return {
    firstName,
    lastName,
    dob: String(source.dob ?? fallback?.dob ?? '').trim(),
    prefix: String(source.prefix ?? fallback?.prefix ?? '').trim(),
    displayName: String(source.displayName ?? fallback?.displayName ?? '').trim() || computedDisplayName,
    email: String(source.email ?? fallback?.email ?? '').trim(),
    phone: String(source.phone ?? fallback?.phone ?? '').trim(),
    customerId: String(source.customerId ?? fallback?.customerId ?? '').trim(),
    customerKey: String(source.customerKey ?? fallback?.customerKey ?? '').trim(),
    address: {
      street: String(sourceAddress.street ?? fallbackAddress.street ?? '').trim(),
      city: String(sourceAddress.city ?? fallbackAddress.city ?? '').trim(),
      state: String(sourceAddress.state ?? fallbackAddress.state ?? '').trim(),
      zip: String(sourceAddress.zip ?? fallbackAddress.zip ?? '').trim()
    }
  }
}

function hasInsuredData(party: InsuredParty): boolean {
  if (!party) return false
  if (party.firstName || party.lastName || party.displayName || party.email || party.phone) return true
  if (party.customerId || party.customerKey) return true
  return Boolean(party.address?.street || party.address?.city || party.address?.state || party.address?.zip)
}

function normalizeInsuredState(raw: any, applicant?: QuoteState['applicant']): InsuredState {
  const source = raw && typeof raw === 'object' ? raw : {}
  const applicantFallback: Partial<InsuredParty> = applicant
    ? {
        firstName: String(applicant.firstName || '').trim(),
        lastName: String(applicant.lastName || '').trim(),
        email: String(applicant.email || '').trim(),
        displayName: `${String(applicant.firstName || '').trim()} ${String(applicant.lastName || '').trim()}`.trim()
      }
    : {}
  const primary = normalizeInsuredParty(source.primary, applicantFallback)
  const secondary = normalizeInsuredParty(source.secondary)
  const additionalRaw = Array.isArray(source.additional) ? source.additional : []
  const additional = additionalRaw
    .map((item: any) => normalizeInsuredParty(item))
    .filter((item: InsuredParty) => hasInsuredData(item))
  return { primary, secondary, additional }
}

export function QuoteWizard() {
  const [step, setStep] = useState(1)
  const [cfg, setCfg] = useState<any | null>(null)
  const [riskFields, setRiskFields] = useState<Field[]>([])
  const [q, setQ] = useState<QuoteState>({ ...defaultState })
  const [action, setAction] = useState<'rate' | 'bind' | 'issue' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quoteResp, setQuoteResp] = useState<any | null>(null)
  const [endorsementPreview, setEndorsementPreview] = useState<EndorsementPreviewResponse | null>(null)
  const [boundPolicy, setBoundPolicy] = useState<{ policyId: string; policyNumber: string } | null>(null)
  const [issued, setIssued] = useState(false)
  const [boundModifyMode, setBoundModifyMode] = useState(false)
  const [overrideReason, setOverrideReason] = useState<string>('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [qualificationErrors, setQualificationErrors] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<QuoteDraft | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [copying, setCopying] = useState(false)
  const [policyContext, setPolicyContext] = useState<{ policyId: string; policyNumber?: string } | null>(null)
  const [transactionEffectiveDate, setTransactionEffectiveDate] = useState<string>(defaultState.effectiveDate)
  const [transactionDateDirty, setTransactionDateDirty] = useState(false)
  const [cancelReasonCode, setCancelReasonCode] = useState<string>('')
  const [cancelReasonNotes, setCancelReasonNotes] = useState<string>('')
  const [endorseReason, setEndorseReason] = useState<string>('')
  const [endorseNotes, setEndorseNotes] = useState<string>('')
  const [issuedTransactionVersion, setIssuedTransactionVersion] = useState<any | null>(null)
  const [quoteAudit, setQuoteAudit] = useState<{ updatedAt?: string; updatedBy?: string; statusHistory: QuoteAuditEntry[]; stepHistory: QuoteAuditEntry[] }>({
    statusHistory: [],
    stepHistory: []
  })
  const [insureds, setInsureds] = useState<InsuredState>(() => createDefaultInsuredState())
  const [primarySearchQuery, setPrimarySearchQuery] = useState('')
  const [primarySearchResults, setPrimarySearchResults] = useState<any[]>([])
  const [primarySearchLoading, setPrimarySearchLoading] = useState(false)
  const [primarySelecting, setPrimarySelecting] = useState(false)
  const [secondarySearchQuery, setSecondarySearchQuery] = useState('')
  const [secondarySearchResults, setSecondarySearchResults] = useState<any[]>([])
  const [secondarySearchLoading, setSecondarySearchLoading] = useState(false)
  const [secondarySelecting, setSecondarySelecting] = useState(false)
  const [additionalSearchQuery, setAdditionalSearchQuery] = useState('')
  const [additionalSearchResults, setAdditionalSearchResults] = useState<any[]>([])
  const [additionalSearchLoading, setAdditionalSearchLoading] = useState(false)
  const [additionalSelecting, setAdditionalSelecting] = useState(false)
  const [contactDetailLoading, setContactDetailLoading] = useState(false)
  const [contactDetailError, setContactDetailError] = useState<string | null>(null)
  const [contactDetailRecord, setContactDetailRecord] = useState<any | null>(null)
  const [contactDetailLookup, setContactDetailLookup] = useState('')
  const [contactDetailTitle, setContactDetailTitle] = useState('')
  const [contactDetailPopupOpen, setContactDetailPopupOpen] = useState(false)
  const [formsTab, setFormsTab] = useState<WizardFormsTab>('forms')
  const [attachedFormsByStage, setAttachedFormsByStage] = useState<Record<FormAttachmentStage, AttachedForm[]>>({
    Quote: [],
    Bind: [],
    Issue: []
  })
  const [formsLoading, setFormsLoading] = useState(false)
  const [formsError, setFormsError] = useState<string | null>(null)
  const [documentOpeningFormId, setDocumentOpeningFormId] = useState<string | null>(null)
  const [documentOpeningId, setDocumentOpeningId] = useState<string | null>(null)
  const [quoteDocumentModel, setQuoteDocumentModel] = useState<QuoteSummaryDocumentModel | null>(null)
  const [readOnlyVersion, setReadOnlyVersion] = useState<any | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const quoteIdParam = searchParams.get('quoteId') || ''
  const customerIdParam = searchParams.get('customerId') || ''
  const customerKeyParam = searchParams.get('customerKey') || ''
  const policyIdParam = searchParams.get('policyId') || ''
  const policyNumberParam = searchParams.get('policyNumber') || ''
  const versionIdParam = searchParams.get('versionId') || ''
  const transactionEffectiveDateParam = searchParams.get('effectiveDate') || ''
  const reservedTransactionNumberParam = searchParams.get('transactionNumber') || ''
  const isReadOnlyView = isTruthyQueryFlag(searchParams.get('readonly') || searchParams.get('readOnly'))
  const wizardMode = parseWizardMode(searchParams.get('mode'))
  const isPolicyTransactionMode = wizardMode !== 'quote'
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const canUwOverride = !!(hasPermission(user, 'uw.referrals.decide') || user?.roles?.includes('underwriter') || user?.roles?.includes('admin'))
  const canViewCustomerInAdmin = !!(hasPermission(user, 'page.admin.customers.view') && hasPermission(user, 'admin.customers.read'))
  const canViewCustomerClassic = !!hasPermission(user, 'admin.customers.read')
  const canViewCustomerDetails = canViewCustomerInAdmin || canViewCustomerClassic
  const canEditCustomerInAdmin = !!(canViewCustomerInAdmin && (hasPermission(user, 'admin.customers.manage') || hasPermission(user, 'admin.customers.contact.manage')))
  const hoDefaultsApplied = useRef(false)
  const customerPrefillAppliedRef = useRef('')
  const ratedPayloadSnapshot = useRef<string>('')
  const exitSnapshotRef = useRef<{ quoteId: string; step: number; payload: QuoteState; insureds: InsuredState }>({
    quoteId: '',
    step: 1,
    payload: { ...defaultState },
    insureds: createDefaultInsuredState()
  })

  useEffect(() => {
    if (!q.productCode) {
      setCfg(null)
      setRiskFields([])
      return
    }
    void loadConfig(q.productCode)
  }, [q.productCode])
  useEffect(() => {
    if (!cfg) return
    if (q.productCode !== 'homeowners') return
    const hasSelections = Array.isArray(q.coverages) && q.coverages.length > 0
    if (hoDefaultsApplied.current && hasSelections) return
    const defaults = buildHomeownerDefaults(cfg, q.coverages)
    hoDefaultsApplied.current = true
    setQ(prev => ({ ...prev, coverages: defaults }))
  }, [cfg, q.productCode, q.coverages])

  useEffect(() => {
    if (isReadOnlyView) return
    if (!quoteIdParam) return
    if (draft?.quoteId === quoteIdParam) return
    void loadQuoteFromServer(quoteIdParam)
  }, [isReadOnlyView, quoteIdParam, draft?.quoteId])

  useEffect(() => {
    if (isReadOnlyView) return
    if (isPolicyTransactionMode || wizardMode !== 'quote') return
    if (quoteIdParam || draft?.quoteId) return
    const prefillKey = String(customerIdParam || customerKeyParam || '').trim()
    if (!prefillKey) return
    if (customerPrefillAppliedRef.current === prefillKey) return
    let cancelled = false
    const applyPrefill = async () => {
      try {
        const lookupKeys = [customerIdParam, customerKeyParam]
          .map((value) => String(value || '').trim())
          .filter((value, index, list) => value && list.indexOf(value) === index)
        let details: any = null
        let lookupError: any = null
        for (const key of lookupKeys) {
          try {
            details = await adminApi.getCustomer(key)
            if (details) break
          } catch (err) {
            lookupError = err
          }
        }
        if (!details) {
          throw lookupError || new Error('Customer not found for prefill')
        }
        if (cancelled) return
        const mapped = normalizeInsuredParty(buildInsuredFromCustomerDetails(details, details))
        setInsureds((prev) => ({ ...prev, primary: mapped }))
        setQ((prev) => ({
          ...prev,
          applicant: {
            ...prev.applicant,
            firstName: String(mapped?.firstName || prev.applicant?.firstName || ''),
            lastName: String(mapped?.lastName || prev.applicant?.lastName || ''),
            email: String(mapped?.email || prev.applicant?.email || '')
          }
        }))
        setPrimarySearchQuery('')
        setPrimarySearchResults([])
      } catch (err) {
        if (!cancelled) console.error('Customer prefill failed:', err)
      } finally {
        if (!cancelled) customerPrefillAppliedRef.current = prefillKey
      }
    }
    void applyPrefill()
    return () => {
      cancelled = true
    }
  }, [
    isReadOnlyView,
    isPolicyTransactionMode,
    wizardMode,
    quoteIdParam,
    draft?.quoteId,
    customerIdParam,
    customerKeyParam
  ])

  useEffect(() => {
    if (!quoteIdParam && wizardMode === 'quote') {
      setQuoteDocumentModel(null)
    }
  }, [quoteIdParam, wizardMode])

  useEffect(() => {
    if (wizardMode === 'quote') return
    setQuoteDocumentModel(null)
  }, [wizardMode])

  useEffect(() => {
    const fallbackDate = q.effectiveDate || new Date().toISOString().slice(0,10)
    if (isPolicyTransactionMode) {
      if (!transactionDateDirty) {
        setTransactionEffectiveDate(transactionEffectiveDateParam || fallbackDate)
      }
    } else {
      if (transactionEffectiveDate !== fallbackDate) {
        setTransactionEffectiveDate(fallbackDate)
      }
      if (transactionDateDirty) {
        setTransactionDateDirty(false)
      }
    }
  }, [isPolicyTransactionMode, transactionEffectiveDateParam, q.effectiveDate, transactionDateDirty, transactionEffectiveDate])

  useEffect(() => {
    if (!policyIdParam) return
    setPolicyContext({ policyId: policyIdParam, policyNumber: policyNumberParam || undefined })
    if (!policyNumberParam) {
      api.getPolicy(policyIdParam)
        .then(p => setPolicyContext({ policyId: policyIdParam, policyNumber: p.policyNumber }))
        .catch(() => {})
    }
  }, [policyIdParam, policyNumberParam])

  useEffect(() => {
    if (!isReadOnlyView) return
    if (!policyIdParam || !versionIdParam) return
    let cancelled = false
    setLoadingDraft(true)
    setError(null)
    Promise.all([
      apiDetails.getVersionDetails(policyIdParam, versionIdParam),
      api.getPolicyVersions(policyIdParam).catch(() => [] as any[])
    ])
      .then(([details, versions]) => {
        if (cancelled) return
        const payload = normalizePayloadCoverages(details?.payload || {})
        const merged = mergeQuoteState(payload, { ...defaultState })
        const matchingVersion = Array.isArray(versions)
          ? versions.find((row: any) => String(row?.versionId || '') === String(versionIdParam))
          : null
        setQ(merged)
        setInsureds(normalizeInsuredState(payload?.insureds, merged.applicant))
        setDraft(null)
        setQuoteResp(null)
        setEndorsementPreview(null)
        setReadOnlyVersion(matchingVersion || null)
        if (matchingVersion?.premium) {
          const syntheticResponse = {
            quoteNumber: matchingVersion.transactionNumber || matchingVersion.versionId || '',
            premium: matchingVersion.premium
          }
          setQuoteDocumentModel(buildQuoteSummaryModel(syntheticResponse, merged))
        } else {
          setQuoteDocumentModel(null)
        }
        setFieldErrors({})
        setQualificationErrors({})
        setQuoteAudit({ statusHistory: [], stepHistory: [] })
        setStep(1)
        setIssued(false)
        setIssuedTransactionVersion(null)
        ratedPayloadSnapshot.current = ''
        if (isPolicyTransactionMode) {
          const nextTransactionDate = normalizeDateInput(transactionEffectiveDateParam || merged.effectiveDate)
          if (nextTransactionDate) setTransactionEffectiveDate(nextTransactionDate)
          setTransactionDateDirty(false)
        }
      })
      .catch((err: any) => {
        if (cancelled) return
        setError(err?.message || String(err))
        setReadOnlyVersion(null)
      })
      .finally(() => {
        if (cancelled) return
        setLoadingDraft(false)
      })
    return () => {
      cancelled = true
    }
  }, [isReadOnlyView, policyIdParam, versionIdParam, isPolicyTransactionMode, transactionEffectiveDateParam])

  useEffect(() => {
    if (!isPolicyTransactionMode && !isReadOnlyView) return
    if (!policyContext?.policyId) return
    if (boundPolicy?.policyId === policyContext.policyId) return
    setBoundPolicy({ policyId: policyContext.policyId, policyNumber: policyContext.policyNumber || '' })
    setIssued(false)
  }, [isPolicyTransactionMode, isReadOnlyView, policyContext, boundPolicy])

  useEffect(() => {
    if (!boundPolicy || issued) {
      setBoundModifyMode(false)
    }
  }, [boundPolicy, issued])

  useEffect(() => {
    if (isReadOnlyView) return
    if (readOnlyVersion) setReadOnlyVersion(null)
  }, [isReadOnlyView, readOnlyVersion])

  const riskStepTitle = q.productCode === 'personal-auto'
    ? 'Vehicles'
    : q.productCode === 'commercial-auto'
      ? 'Commercial Auto Risk'
    : q.productCode === 'cyber'
      ? 'Cyber Risk'
      : q.productCode === 'professional-liability'
        ? 'Professional Risk'
        : 'Risk'
  const steps = useMemo(() => [
    { id: 1, title: 'Product' },
    { id: 2, title: 'Qualification Questions' },
    { id: 3, title: 'Insureds' },
    { id: 4, title: riskStepTitle },
    { id: 5, title: 'Coverages' },
    { id: 6, title: 'Rating' },
    { id: 7, title: 'Premium' },
    { id: 8, title: 'Forms & Documents' }
  ], [riskStepTitle])
  const isBoundQuoteReadOnly = !isReadOnlyView && wizardMode === 'quote' && Boolean(boundPolicy) && !issued && !boundModifyMode
  const isIssuedReviewOnly = !isReadOnlyView && issued
  const isViewOnly = isReadOnlyView || isBoundQuoteReadOnly || isIssuedReviewOnly
  const locked = isPolicyTransactionMode ? issued : Boolean(boundPolicy) && !boundModifyMode
  const isBinding = action === 'bind'
  const isIssuing = action === 'issue'
  const isRating = action === 'rate'
  const isCancellationMode = isPolicyTransactionMode && wizardMode === 'cancel'
  const isEndorsementMode = isPolicyTransactionMode && wizardMode === 'endorse'

  const { data: uwCompaniesResp, isLoading: loadingUnderwritingCompanies } = useUnderwritingCompanies({})
  const underwritingConfigurations = useMemo<UnderwritingCompanyConfig[]>(() => {
    const items = Array.isArray((uwCompaniesResp as any)?.items) ? (uwCompaniesResp as any).items : []
    return items
      .filter((item: any) => isSupportedProductCode(item?.productCode))
      .map((item: any) => ({
        companyId: String(item.companyId || ''),
        name: String(item.name || '').trim(),
        productCode: item.productCode as ProductCode,
        country: normalizeCountryCode(item.country) as CountryCode,
        state: normalizeRegionCode(item.state || '')
      }))
  }, [uwCompaniesResp])

  const { data: agenciesResp, isLoading: loadingAgencyOptions } = useReferenceAgencies({ limit: 500 })
  const agencyOptions = useMemo<AgencyOption[]>(() => {
    const items = Array.isArray((agenciesResp as any)?.items) ? (agenciesResp as any).items : []
    return items
      .map((item: any) => ({
        agencyId: String(item?.agencyId || ''),
        agencyCode: String(item?.agencyCode || ''),
        agencyKey: String(item?.agencyKey || ''),
        legalName: String(item?.legalName || ''),
        dbaName: String(item?.dbaName || '').trim() || ''
      }))
      .filter((item: AgencyOption) => item.agencyId && item.legalName)
  }, [agenciesResp])

  const { data: underwritersResp, isLoading: loadingUnderwriterOptions } = useUnderwriters()
  const underwriterOptions = useMemo<UnderwriterOption[]>(() => {
    const items = Array.isArray((underwritersResp as any)?.items) ? (underwritersResp as any).items : []
    return items
      .map((item: any) => ({
        userId: String(item?.userId || ''),
        username: String(item?.username || ''),
        displayName: String(item?.displayName || item?.username || '')
      }))
      .filter((item: UnderwriterOption) => item.userId && item.displayName)
  }, [underwritersResp])

  const { data: carriersResp, isLoading: loadingPriorCarrierOptions } = useReferenceInsuranceCarriers({ limit: 5000 })
  const priorCarrierOptions = useMemo<string[]>(() => {
    const items = Array.isArray((carriersResp as any)?.items) ? (carriersResp as any).items : []
    return Array.from(
      new Set(
        items
          .map((item: any) => String(item?.name || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => (a as string).localeCompare(b as string)) as string[]
  }, [carriersResp])

  const { data: cancelCodesResp, isLoading: cancelReasonCodesLoading } = useCancellationReasonCodes(isCancellationMode)
  const cancelReasonCodes = useMemo<any[]>(() => {
    return Array.isArray((cancelCodesResp as any)?.items) ? (cancelCodesResp as any).items : []
  }, [cancelCodesResp])

  const agencyId = String(q.agencyId || '').trim()
  const { data: agencyContactsResp, isLoading: loadingAgencyContacts } = useAgencyContacts(agencyId)
  const agencyContacts = useMemo<AgencyContactOption[]>(() => {
    const items = Array.isArray((agencyContactsResp as any)?.items) ? (agencyContactsResp as any).items : []
    return items
      .map((item: any) => ({
        contactId: String(item?.contactId || ''),
        displayName: String(item?.displayName || ''),
        firstName: String(item?.firstName || ''),
        lastName: String(item?.lastName || ''),
        email: String(item?.email || ''),
        phoneNumber: String(item?.phoneNumber || '')
      }))
      .filter((item: AgencyContactOption) => item.contactId && item.displayName)
  }, [agencyContactsResp])
  const isRewriteTransaction = isPolicyTransactionMode && wizardMode === 'rewrite'
  const qualificationEditable = !isPolicyTransactionMode || isRewriteTransaction
  const lockCoreProductFields = isPolicyTransactionMode && !isRewriteTransaction
  const policyNumber = policyContext?.policyNumber || boundPolicy?.policyNumber
  const showQuoteNumber = wizardMode === 'quote' && draft?.quoteNumber
  const transactionNumber =
    issuedTransactionVersion?.transactionNumber ||
    issuedTransactionVersion?.meta?.transactionNumber ||
    (isPolicyTransactionMode ? reservedTransactionNumberParam : '')
  const txLabel = transactionLabel(wizardMode)
  const trackedPolicyId = policyContext?.policyId || boundPolicy?.policyId || policyIdParam
  const transactionMode: PendingTransactionMode | null = isPolicyTransactionMode
    ? (wizardMode as PendingTransactionMode)
    : null
  const workflowStatus = isReadOnlyView
    ? 'Read-only'
    : deriveWizardTransactionStatus({
        isPolicyTransactionMode,
        issued,
        bound: Boolean(boundPolicy),
        hasRateResult: Boolean(quoteResp)
      })
  const visiblePremium = quoteResp?.premium || readOnlyVersion?.premium || null
  const visibleUnderwriting = quoteResp?.underwriting || (readOnlyVersion?.uwDecision ? { decision: readOnlyVersion.uwDecision, reasons: [] } : null)
  const visibleAiInsights = quoteResp?.aiInsights || readOnlyVersion?.aiInsights || null
  const visibleRetroAdjustment = useMemo(() => {
    if (endorsementPreview?.retroAdjustment) return endorsementPreview.retroAdjustment
    if (quoteResp?.retroAdjustment) return quoteResp.retroAdjustment
    return readOnlyVersion?.meta?.retroAdjustment || null
  }, [endorsementPreview, quoteResp, readOnlyVersion])
  const visibleTimelineImpact = useMemo(() => {
    if (endorsementPreview?.timeline) return endorsementPreview.timeline
    if (quoteResp?.timeline) return quoteResp.timeline
    const rebased = Array.isArray(readOnlyVersion?.meta?.rebasedTransactions)
      ? readOnlyVersion.meta.rebasedTransactions
      : []
    if (!rebased.length) return null
    return {
      wouldRebase: true,
      rebasedTransactions: rebased
    }
  }, [endorsementPreview, quoteResp, readOnlyVersion])
  const visibleFullTermImpact = useMemo(() => {
    if (endorsementPreview?.fullTerm) return endorsementPreview.fullTerm
    return quoteResp?.fullTerm || null
  }, [endorsementPreview, quoteResp])
  const commissionPctValue = parseCommissionPercent(q.agencyCommissionPct)
  const commissionAmountValue = useMemo(() => {
    const total = moneyAmountValue(visiblePremium?.total)
    if (commissionPctValue == null || total <= 0) return null
    return (total * commissionPctValue) / 100
  }, [visiblePremium, commissionPctValue])
  const coveragePremiumRows = useMemo(() => {
    const byCoverage = Array.isArray(visiblePremium?.byCoverage) ? visiblePremium.byCoverage : []
    const premiumCurrency = visiblePremium?.total?.currency || 'USD'
    if (!byCoverage.length) {
      const aiRows = Array.isArray(visibleAiInsights?.coveragePremiumAllocation)
        ? visibleAiInsights.coveragePremiumAllocation
        : []
      if (aiRows.length > 0) {
        return aiRows.map((item: any, index: number) => {
          const code = String(item?.code || `COV-${index + 1}`).toUpperCase()
          const amount = Number(item?.premiumAmount)
          const share = Number(item?.sharePct)
          return {
            code,
            name: coverageName(code, cfg),
            amountFormatted: formatCurrencyAmount(amount, premiumCurrency),
            share: Number.isFinite(share) ? `${share.toFixed(2)}%` : '-'
          }
        })
      }
      return []
    }
    const subtotal = byCoverage.reduce((sum: number, item: any) => sum + coverageAmountValue(item), 0)
    return byCoverage.map((item: any, index: number) => {
      const code = String(item?.code || item?.coverageCode || item?.coverage_code || `COV-${index + 1}`).toUpperCase()
      const amount = coverageAmountValue(item)
      const currency = item?.amount?.currency || premiumCurrency
      return {
        code,
        name: coverageName(code, cfg),
        amountFormatted: formatCurrencyAmount(amount, currency),
        share: subtotal > 0 ? `${((amount / subtotal) * 100).toFixed(2)}%` : '-'
      }
    })
  }, [visiblePremium, visibleAiInsights, cfg])
  const currentActor = user?.username || user?.id || 'system'
  const normalizedInsureds = useMemo(
    () => normalizeInsuredState(insureds, q.applicant),
    [insureds, q.applicant]
  )
  const linkedCustomerId = String(normalizedInsureds?.primary?.customerId || customerIdParam || '').trim()
  const linkedCustomerKey = String(normalizedInsureds?.primary?.customerKey || customerKeyParam || '').trim()
  const linkedCustomerLookup = linkedCustomerId || linkedCustomerKey
  const linkedCustomerLabel = linkedCustomerKey || linkedCustomerId
  const linkedCustomerName = String(
    normalizedInsureds?.primary?.displayName ||
      `${String(normalizedInsureds?.primary?.firstName || '').trim()} ${String(normalizedInsureds?.primary?.lastName || '').trim()}`.trim()
  ).trim()
  function buildQuotePayload(state: QuoteState, insuredState: InsuredState = normalizedInsureds): any {
    const commissionPct = parseCommissionPercent(state.agencyCommissionPct)
    const payload = normalizePayloadCoverages({
      ...state,
      agencyCommissionPct: commissionPct ?? undefined,
      insureds: normalizeInsuredState(insuredState, state.applicant),
      uwAnswers: deriveUwAnswers(state)
    })
    if (commissionPct == null && payload && typeof payload === 'object' && 'agencyCommissionPct' in payload) {
      delete payload.agencyCommissionPct
    }
    return payload
  }
  const selectedCoverageCodes = useMemo(() => {
    return (Array.isArray(q.coverages) ? q.coverages : [])
      .filter((item: any) => item && item.selected !== false)
      .map((item: any) => String(item.code || '').trim())
      .filter(Boolean)
  }, [q.coverages])
  const formAttachmentAttributes = useMemo(() => {
    const firstRisk = Array.isArray(q.risks) && q.risks.length && q.risks[0] && typeof q.risks[0] === 'object'
      ? q.risks[0]
      : {}
    return {
      ...firstRisk,
      country: q.country || undefined,
      state: q.state || undefined,
      termMonths: q.termMonths,
      underwritingCompany: q.underwritingCompanyName || undefined,
      agencyId: q.agencyId || undefined,
      agencyName: q.agencyName || undefined,
      agencyContactName: q.agencyContactName || undefined,
      agencyCommissionPct: parseCommissionPercent(q.agencyCommissionPct) ?? undefined,
      policyOffering: q.policyOffering || undefined,
      underwriter: q.underwriterName || undefined,
      priorPolicyNumber: q.priorPolicyNumber || undefined,
      priorCarrier: q.priorCarrier || undefined,
      applicant: q.applicant || {}
    }
  }, [
    q.risks,
    q.country,
    q.state,
    q.termMonths,
    q.underwritingCompanyName,
    q.agencyId,
    q.agencyName,
    q.agencyContactName,
    q.agencyCommissionPct,
    q.policyOffering,
    q.underwriterName,
    q.priorPolicyNumber,
    q.priorCarrier,
    q.applicant
  ])

  const selectedUnderwriterName = companyNameKey(q.underwritingCompanyName)
  const companyScopedConfigs = useMemo(() => {
    if (!selectedUnderwriterName) return underwritingConfigurations
    return underwritingConfigurations.filter((item) => companyNameKey(item.name) === selectedUnderwriterName)
  }, [underwritingConfigurations, selectedUnderwriterName])

  const countryOptions = useMemo(() => {
    const allowed = new Set<string>()
    companyScopedConfigs.forEach((item) => {
      allowed.add(item.country)
    })
    const out: Array<{ code: CountryCode; label: string }> = []
    if (allowed.has('US')) out.push({ code: 'US', label: 'USA' })
    if (allowed.has('CA')) out.push({ code: 'CA', label: 'Canada' })
    return out
  }, [companyScopedConfigs])

  const stateOptions = useMemo(() => {
    if (!q.country) return []
    const scoped = companyScopedConfigs.filter((item) => {
      if (item.country !== q.country) return false
      if (q.productCode && item.productCode !== q.productCode) return false
      return true
    })
    if (!scoped.length) return []
    const regionCatalog = regionsForCountry(q.country)
    if (scoped.some((item) => normalizeRegionCode(item.state) === 'ALL')) return regionCatalog
    const allowed = new Set(
      scoped
        .map((item) => normalizeRegionCode(item.state))
        .filter((code) => code && code !== 'ALL')
    )
    return regionCatalog.filter((entry) => allowed.has(entry.code))
  }, [companyScopedConfigs, q.country, q.productCode])

  const availableProductCodes = useMemo(() => {
    const codes = new Set<ProductCode>()
    companyScopedConfigs.forEach((item) => {
      if (q.country && item.country !== q.country) return
      if (q.state && !configMatchesState(item.state, q.state)) return
      codes.add(item.productCode)
    })
    return Array.from(codes).sort((a, b) => productLabel(a).localeCompare(productLabel(b)))
  }, [companyScopedConfigs, q.country, q.state])

  const qualificationQuestions = useMemo(() => {
    return qualificationQuestionsForProduct(q.productCode, q.qualificationAnswers)
  }, [q.productCode, q.qualificationAnswers])
  const policyOfferingOptions = useMemo(() => {
    if (!isSupportedProductCode(q.productCode)) return []
    return POLICY_OFFERINGS[q.productCode] || []
  }, [q.productCode])

  const underwritingCompanies = useMemo(() => {
    return dedupeCompanyNames(underwritingConfigurations)
  }, [underwritingConfigurations])

  useEffect(() => {
    const visibleKeys = new Set(qualificationQuestions.map((question) => question.key))
    setQualificationErrors((prev) => {
      let changed = false
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(prev)) {
        if (visibleKeys.has(key)) {
          next[key] = value
          continue
        }
        changed = true
      }
      return changed ? next : prev
    })
  }, [qualificationQuestions])

  useEffect(() => {
    if (isViewOnly) return
    if (loadingUnderwritingCompanies) return
    setQ((prev) => {
      const next: QuoteState = { ...prev }
      let changed = false
      const previousProductCode = next.productCode

      if (!lockCoreProductFields && !next.underwritingCompanyName && underwritingCompanies.length === 1) {
        next.underwritingCompanyName = underwritingCompanies[0].name
        changed = true
      }

      if (!lockCoreProductFields && next.underwritingCompanyName) {
        const hasUnderwriter = underwritingCompanies.some((item) => companyNameKey(item.name) === companyNameKey(next.underwritingCompanyName))
        if (underwritingCompanies.length > 0 && !hasUnderwriter) {
          next.underwritingCompanyName = ''
          next.underwritingCompanyId = ''
          changed = true
        }
      }

      if (!lockCoreProductFields && next.country && countryOptions.length > 0 && !countryOptions.some((entry) => entry.code === next.country)) {
        next.country = ''
        next.state = ''
        changed = true
      }
      if (!lockCoreProductFields && !next.country && countryOptions.length === 1) {
        next.country = countryOptions[0].code
        next.state = ''
        changed = true
      }

      if (!lockCoreProductFields && next.productCode && availableProductCodes.length > 0 && !availableProductCodes.includes(next.productCode as ProductCode)) {
        next.productCode = ''
        next.risks = []
        next.coverages = []
        next.underwritingCompanyId = ''
        next.policyOffering = ''
        changed = true
      }
      if (!lockCoreProductFields && !next.productCode && availableProductCodes.length === 1) {
        next.productCode = availableProductCodes[0]
        next.risks = defaultRisksForProduct(next.productCode)
        next.coverages = []
        next.underwritingCompanyId = ''
        next.policyOffering = ''
        changed = true
      }

      if (next.productCode !== previousProductCode) {
        next.qualificationAnswers = emptyQualificationAnswers(next.productCode)
        if (next.policyOffering && !policyOfferingOptions.includes(next.policyOffering)) {
          next.policyOffering = ''
        }
        changed = true
      }

      const normalizedQualificationAnswers = qualificationAnswersFromUw(next.productCode, next.qualificationAnswers, next.qualificationAnswers)
      const answerKeys = new Set([...Object.keys(next.qualificationAnswers || {}), ...Object.keys(normalizedQualificationAnswers)])
      for (const key of answerKeys) {
        if ((next.qualificationAnswers?.[key] || '') !== (normalizedQualificationAnswers[key] || '')) {
          next.qualificationAnswers = normalizedQualificationAnswers
          changed = true
          break
        }
      }

      if (!lockCoreProductFields && next.state && stateOptions.length > 0 && !stateOptions.some((entry) => entry.code === next.state)) {
        next.state = ''
        changed = true
      }
      if (!lockCoreProductFields && !next.state && next.country && stateOptions.length === 1) {
        next.state = stateOptions[0].code
        changed = true
      }

      const resolvedCompany = resolveUnderwritingCompanyConfig(next, underwritingConfigurations)
      const resolvedId = resolvedCompany?.companyId || (lockCoreProductFields ? (next.underwritingCompanyId || '') : '')
      if ((next.underwritingCompanyId || '') !== resolvedId) {
        next.underwritingCompanyId = resolvedId
        changed = true
      }
      if (resolvedCompany && next.underwritingCompanyName !== resolvedCompany.name) {
        next.underwritingCompanyName = resolvedCompany.name
        changed = true
      }

      if (!lockCoreProductFields && next.policyOffering && policyOfferingOptions.length > 0 && !policyOfferingOptions.includes(next.policyOffering)) {
        next.policyOffering = ''
        changed = true
      }
      if (!lockCoreProductFields && !next.policyOffering && policyOfferingOptions.length === 1) {
        next.policyOffering = policyOfferingOptions[0]
        changed = true
      }

      if (!lockCoreProductFields && !loadingAgencyOptions) {
        if (next.agencyId && agencyOptions.length > 0 && !agencyOptions.some((item) => item.agencyId === next.agencyId)) {
          next.agencyId = ''
          next.agencyName = ''
          next.agencyContactId = ''
          next.agencyContactName = ''
          changed = true
        } else if (!next.agencyId && agencyOptions.length === 1) {
          next.agencyId = agencyOptions[0].agencyId
          next.agencyName = agencyOptions[0].legalName
          next.agencyContactId = ''
          next.agencyContactName = ''
          changed = true
        } else if (next.agencyId) {
          const selectedAgency = agencyOptions.find((item) => item.agencyId === next.agencyId)
          if (selectedAgency && next.agencyName !== selectedAgency.legalName) {
            next.agencyName = selectedAgency.legalName
            changed = true
          }
        }
      }

      if (!next.agencyId) {
        if (next.agencyContactId || next.agencyContactName) {
          next.agencyContactId = ''
          next.agencyContactName = ''
          changed = true
        }
      } else if (!loadingAgencyContacts) {
        const selectedContact = agencyContacts.find((item) => item.contactId === next.agencyContactId)
        if (next.agencyContactId && !selectedContact) {
          next.agencyContactId = ''
          next.agencyContactName = ''
          changed = true
        }
        if (!next.agencyContactId && agencyContacts.length === 1) {
          next.agencyContactId = agencyContacts[0].contactId
          next.agencyContactName = agencyContacts[0].displayName
          changed = true
        } else if (selectedContact && next.agencyContactName !== selectedContact.displayName) {
          next.agencyContactName = selectedContact.displayName
          changed = true
        }
      }

      if (!loadingUnderwriterOptions && !lockCoreProductFields) {
        if (next.underwriterUserId && underwriterOptions.length > 0 && !underwriterOptions.some((item) => item.userId === next.underwriterUserId)) {
          next.underwriterUserId = ''
          next.underwriterName = ''
          changed = true
        } else if (!next.underwriterUserId && underwriterOptions.length === 1) {
          next.underwriterUserId = underwriterOptions[0].userId
          next.underwriterName = underwriterOptions[0].displayName
          changed = true
        } else if (next.underwriterUserId) {
          const selectedUnderwriter = underwriterOptions.find((item) => item.userId === next.underwriterUserId)
          if (selectedUnderwriter && next.underwriterName !== selectedUnderwriter.displayName) {
            next.underwriterName = selectedUnderwriter.displayName
            changed = true
          }
        }
      }

      return changed ? next : prev
    })
  }, [
    isViewOnly,
    loadingUnderwritingCompanies,
    underwritingCompanies,
    countryOptions,
    availableProductCodes,
    stateOptions,
    underwritingConfigurations,
    lockCoreProductFields,
    policyOfferingOptions,
    agencyOptions,
    loadingAgencyOptions,
    agencyContacts,
    loadingAgencyContacts,
    underwriterOptions,
    loadingUnderwriterOptions
  ])

  useEffect(() => {
    exitSnapshotRef.current = {
      quoteId: draft?.quoteId || '',
      step,
      payload: q,
      insureds: normalizedInsureds
    }
  }, [draft?.quoteId, step, q, normalizedInsureds])

  useEffect(() => {
    return () => {
      if (isViewOnly) return
      const snapshot = exitSnapshotRef.current
      if (!snapshot.quoteId) return
      const payload = buildQuotePayload(snapshot.payload, snapshot.insureds)
      void api.updateQuoteDraft(snapshot.quoteId, payload, { progressStep: snapshot.step })
    }
  }, [isViewOnly])

  function normalizeAuditHistory(raw: any): QuoteAuditEntry[] {
    if (!Array.isArray(raw)) return []
    return raw
      .filter((entry: any) => entry && entry.value != null)
      .map((entry: any) => ({
        value: typeof entry.value === 'number' ? entry.value : String(entry.value),
        updatedAt: typeof entry.updatedAt === 'string' && entry.updatedAt ? entry.updatedAt : new Date().toISOString(),
        updatedBy: typeof entry.updatedBy === 'string' && entry.updatedBy ? entry.updatedBy : 'system'
      }))
  }

  function upsertAuditHistory(entries: QuoteAuditEntry[], value: string | number, updatedAt: string, updatedBy: string): QuoteAuditEntry[] {
    const next = [...entries]
    const key = String(value)
    const index = next.findIndex(entry => String(entry.value) === key)
    const replacement: QuoteAuditEntry = { value, updatedAt, updatedBy }
    if (index >= 0) next[index] = replacement
    else next.push(replacement)
    return next
  }

  function applyQuoteAudit(source: any) {
    if (!source || typeof source !== 'object') return
    const statusHistory = normalizeAuditHistory(source.statusHistory)
    const stepHistory = normalizeAuditHistory(source.stepHistory)
    setQuoteAudit({
      updatedAt: source.updatedAt || undefined,
      updatedBy: source.updatedBy || undefined,
      statusHistory,
      stepHistory
    })
  }

  function applyLocalQuoteAudit(nextStatus?: string, nextStep?: number) {
    const updatedAt = new Date().toISOString()
    const updatedBy = currentActor
    setQuoteAudit(prev => ({
      updatedAt,
      updatedBy,
      statusHistory: nextStatus ? upsertAuditHistory(prev.statusHistory, nextStatus, updatedAt, updatedBy) : prev.statusHistory,
      stepHistory: typeof nextStep === 'number' ? upsertAuditHistory(prev.stepHistory, nextStep, updatedAt, updatedBy) : prev.stepHistory
    }))
  }

  function resetBindingState() {
    setBoundPolicy(null)
    setIssued(false)
    setIssuedTransactionVersion(null)
    setEndorsementPreview(null)
    ratedPayloadSnapshot.current = ''
  }

  function snapshotFromState(state: QuoteState, insuredState: InsuredState = normalizedInsureds): string {
    const payload = buildQuotePayload(state, insuredState)
    try {
      return JSON.stringify(payload)
    } catch {
      return ''
    }
  }

  useEffect(() => {
    if (isViewOnly) return
    if (!transactionMode) return
    if (issued) return
    if (!trackedPolicyId || !quoteIdParam) return
    if (!transactionNumber) return
    savePendingTransaction({
      policyId: trackedPolicyId,
      policyNumber,
      mode: transactionMode,
      quoteId: quoteIdParam,
      transactionNumber,
      effectiveDate: transactionEffectiveDate
    })
  }, [isViewOnly, transactionMode, issued, trackedPolicyId, policyNumber, quoteIdParam, transactionNumber, transactionEffectiveDate])

  useEffect(() => {
    if (!quoteResp) return
    if (issued) return
    const stableStatus = String(draft?.status || quoteResp?.status || '').trim()
    if (stableStatus === 'Converted' || stableStatus === 'Issued' || stableStatus === 'Bound') return
    const snapshot = snapshotFromState(q)
    if (!snapshot || !ratedPayloadSnapshot.current) return
    if (snapshot !== ratedPayloadSnapshot.current) {
      setQuoteResp(null)
      setQuoteDocumentModel(null)
      setEndorsementPreview(null)
      setDraft(prev => prev ? { ...prev, status: 'Draft' } : prev)
      applyLocalQuoteAudit('Draft', draft?.progressStep || step)
      if (!isPolicyTransactionMode && boundPolicy) {
        setBoundPolicy(null)
      }
    }
  }, [q, normalizedInsureds, quoteResp, issued, draft?.status, isPolicyTransactionMode, boundPolicy, draft?.progressStep, step])

  useEffect(() => {
    if (step !== 8) return
    if (!q.productCode || !q.state) {
      setAttachedFormsByStage({ Quote: [], Bind: [], Issue: [] })
      setFormsError(null)
      return
    }

    const stages: FormAttachmentStage[] = []
    if (isReadOnlyView) {
      if (wizardMode === 'quote') {
        stages.push('Quote', 'Bind', 'Issue')
      } else if (wizardMode === 'reinstate') {
        stages.push('Issue')
      } else {
        stages.push('Quote', 'Issue')
      }
    } else {
      if (quoteResp) stages.push('Quote')
      if (boundPolicy) stages.push('Bind')
      if (issued) stages.push('Issue')
    }

    if (stages.length === 0) {
      setAttachedFormsByStage({ Quote: [], Bind: [], Issue: [] })
      setFormsError(null)
      return
    }

    let cancelled = false
    setFormsLoading(true)
    setFormsError(null)

    const effectiveDateForPreview = isPolicyTransactionMode
      ? (transactionEffectiveDate || q.effectiveDate)
      : q.effectiveDate
    const uwContext = {
      ...deriveUwAnswers(q),
      decision: quoteResp?.underwriting?.decision || undefined,
      overrideReason: overrideReason.trim() || undefined,
      isBound: Boolean(boundPolicy),
      isIssued: issued
    }

    Promise.all(
      stages.map(async (stage) => {
        const rows = await api.previewForms({
          lineOfBusiness: q.productCode,
          productCode: q.productCode,
          transactionType: stage,
          state: q.state,
          effectiveDate: effectiveDateForPreview || undefined,
          coverages: selectedCoverageCodes,
          attributes: formAttachmentAttributes,
          uw: uwContext
        })
        const mapped: AttachedForm[] = (Array.isArray(rows) ? rows : []).map((item: any) => ({
          formId: String(item.formId || ''),
          formNumber: String(item.formNumber || ''),
          formTitle: String(item.formTitle || ''),
          editionDate: String(item.editionDate || ''),
          packetPlacement: String(item.packetPlacement || ''),
          reasons: Array.isArray(item.reasons) ? item.reasons.map((r: any) => String(r)) : []
        }))
        return [stage, mapped] as const
      })
    )
      .then((results) => {
        if (cancelled) return
        const next: Record<FormAttachmentStage, AttachedForm[]> = { Quote: [], Bind: [], Issue: [] }
        for (const [stage, items] of results) {
          next[stage] = items
        }
        setAttachedFormsByStage(next)
      })
      .catch((err: any) => {
        if (cancelled) return
        setFormsError(err?.message || String(err))
      })
      .finally(() => {
        if (cancelled) return
        setFormsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    step,
    q.productCode,
    q.state,
    q.effectiveDate,
    selectedCoverageCodes,
    formAttachmentAttributes,
    quoteResp,
    boundPolicy,
    issued,
    isReadOnlyView,
    wizardMode,
    transactionEffectiveDate,
    isPolicyTransactionMode,
    overrideReason
  ])

  async function loadConfig(code: ProductCode) {
    try { setCfg(await api.getProductConfig(code)) } catch { setCfg(null) }
    try { const form = await api.getProductForm(code); setRiskFields(form?.fields || []) } catch { setRiskFields([]) }
  }

  async function loadQuoteFromServer(quoteId: string) {
    if (!quoteId) return
    setLoadingDraft(true)
    setError(null)
    try {
      const resp = await api.getQuote(quoteId)
      setDraft({
        quoteId: resp.quoteId,
        quoteNumber: resp.quoteNumber,
        status: resp.status || 'Draft',
        progressStep: resp.progressStep || 1
      })
      let normalizedPayload = normalizePayloadCoverages(resp.payload)
      const policyIdForPrefill = policyIdParam || policyContext?.policyId
      if (isPolicyTransactionMode && policyIdForPrefill) {
        try {
          const latestIssuedPayload = normalizePayloadCoverages(await api.getFullPolicy(policyIdForPrefill))
          normalizedPayload = mergePayloadWithFallback(normalizedPayload, latestIssuedPayload)
        } catch {
          // keep quote payload as-is when latest issued fallback is unavailable
        }
      }
      const mergedState = mergeQuoteState(normalizedPayload, q)
      const loadedInsureds = normalizeInsuredState(normalizedPayload?.insureds, mergedState.applicant)
      setQ(prev => mergeQuoteState(normalizedPayload, prev))
      setInsureds(loadedInsureds)
      setFieldErrors({})
      setQualificationErrors({})
      let nextStep = Math.min(steps.length, Math.max(1, resp.progressStep || 1))
      const normalizedStatus = String(resp.status || '').trim()
      if (normalizedStatus === 'Rated' && nextStep >= 4) {
        nextStep = Math.min(steps.length, 7)
      } else if (['Converted', 'Issued'].includes(normalizedStatus) && nextStep >= 4) {
        nextStep = steps.length
      }
      setStep(nextStep)
      resetBindingState()
      const convertedPolicyId = String(resp.convertedPolicyId || '').trim()
      if (wizardMode === 'quote' && ['Converted', 'Issued'].includes(normalizedStatus) && convertedPolicyId) {
        let policyNumberFromApi = String(policyContext?.policyNumber || '').trim()
        try {
          const policy = await api.getPolicy(convertedPolicyId)
          policyNumberFromApi = String(policy?.policyNumber || '').trim() || policyNumberFromApi
        } catch {
          // keep best available policy number from context
        }
        setPolicyContext({
          policyId: convertedPolicyId,
          policyNumber: policyNumberFromApi || undefined
        })
        setBoundPolicy({
          policyId: convertedPolicyId,
          policyNumber: policyNumberFromApi
        })
        setIssued(normalizedStatus === 'Issued')
        setBoundModifyMode(false)
      } else if (wizardMode === 'quote') {
        setPolicyContext(null)
        setIssued(false)
        setBoundModifyMode(false)
      }
      ratedPayloadSnapshot.current = resp.status === 'Draft' ? '' : snapshotFromState(mergedState, loadedInsureds)
      setQuoteResp(resp.status === 'Draft' ? null : resp)
      setEndorsementPreview(null)
      if (wizardMode === 'quote' && resp.status !== 'Draft') {
        const model = buildQuoteSummaryModel(resp, mergedState)
        setQuoteDocumentModel(model)
      } else if (resp.status === 'Draft') {
        setQuoteDocumentModel(null)
      }
      applyQuoteAudit(resp)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoadingDraft(false)
    }
  }

  async function ensureDraftAtStep(target: number): Promise<boolean> {
    if (isViewOnly) return true
    if (savingDraft) return false
    const desiredStep = Math.min(steps.length, Math.max(1, target))
    if (!draft?.quoteId && !q.productCode && !isPolicyTransactionMode) return true
    const payload = buildQuotePayload(q)
    setSavingDraft(true)
    setError(null)
    try {
      if (draft?.quoteId) {
        const res = await api.updateQuoteDraft(draft.quoteId, payload, { progressStep: desiredStep })
        setDraft({ quoteId: draft.quoteId, quoteNumber: res.quoteNumber, status: res.status, progressStep: res.progressStep })
        applyQuoteAudit(res)
        return true
      }
      const res = await api.createQuoteDraft(payload, { progressStep: desiredStep })
      setDraft({ quoteId: res.quoteId, quoteNumber: res.quoteNumber, status: res.status, progressStep: res.progressStep })
      applyQuoteAudit(res)
      const params = new URLSearchParams(searchParams)
      params.set('quoteId', res.quoteId)
      setSearchParams(params, { replace: true })
      return true
    } catch (err: any) {
      setError(err.message || String(err))
      return false
    } finally {
      setSavingDraft(false)
    }
  }

  async function attemptStepChange(target: number) {
    if (target === step) return
    if (isViewOnly) {
      setError(null)
      setStep(target)
      return
    }
    if (locked && target < step) return
    if (step === 2 && target > step && qualificationEditable) {
      const errs = validateQualificationAnswers(q.productCode, q.qualificationAnswers)
      setQualificationErrors(errs)
      if (Object.keys(errs).length > 0) return
    }
    if (step === 3 && target > step) {
      // TODO: Add validation for insureds (primary/secondary required fields)
    }
    if (step === 4 && target > step) {
      const errs = q.productCode === 'personal-auto'
        ? validatePersonalAutoVehicles(q.risks)
        : validateFields(riskFields, q)
      setFieldErrors(errs)
      if (Object.keys(errs).length > 0) return
    }
    if (step === 6 && target > step && wizardMode !== 'reinstate' && !quoteResp) {
      setError('Rate premium before continuing to Premium.')
      return
    }
    setError(null)
    const saved = await ensureDraftAtStep(target)
    if (!saved) return
    setStep(target)
  }

  function onProductChange(code: QuoteProductCode) {
    if (isViewOnly) return
    if (lockCoreProductFields) return
    if (code === 'homeowners') hoDefaultsApplied.current = false
    if (!code) hoDefaultsApplied.current = false
    setQ(prev => ({
      ...prev,
      productCode: code,
      policyOffering: '',
      qualificationAnswers: emptyQualificationAnswers(code),
      risks: defaultRisksForProduct(code),
      coverages: [],
      underwritingCompanyId: ''
    }))
    setQuoteResp(null)
    setQuoteDocumentModel(null)
    resetBindingState()
    setQualificationErrors({})
    if (!code) {
      setCfg(null)
      setRiskFields([])
    }
  }

  async function searchPrimaryInsured(query: string) {
    if (!query.trim()) {
      setPrimarySearchResults([])
      return
    }
    setPrimarySearchLoading(true)
    try {
      const results = await adminApi.searchCustomers({ q: query, limit: 20 })
      setPrimarySearchResults(results || [])
    } catch (err) {
      console.error('Customer search failed:', err)
      setPrimarySearchResults([])
    } finally {
      setPrimarySearchLoading(false)
    }
  }

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      searchPrimaryInsured(primarySearchQuery)
    }, 300)
    return () => clearTimeout(debounceTimer)
  }, [primarySearchQuery])

  function resolveCustomerDob(source: any): string {
    return String(source?.identity?.person?.dob || source?.identity?.person?.birthDate || source?.dob || source?.birthDate || '').trim()
  }

  function buildInsuredFromCustomerSummary(customer: any) {
    const fullName = String(customer?.name || customer?.displayName || '').trim()
    const summaryFirst = String(customer?.firstName || '').trim()
    const summaryLast = String(customer?.lastName || '').trim()
    const firstName = summaryFirst || (fullName ? fullName.split(/\s+/)[0] : '')
    const lastName = summaryLast || (fullName && fullName !== firstName ? fullName.slice(firstName.length).trim() : '')
    return {
      firstName,
      lastName,
      dob: resolveCustomerDob(customer),
      prefix: String(customer?.prefix || '').trim(),
      displayName: fullName || [firstName, lastName].filter(Boolean).join(' ').trim(),
      email: String(customer?.email || '').trim(),
      phone: String(customer?.phone || '').trim(),
      address: {
        street: String(customer?.address?.street || '').trim(),
        city: String(customer?.address?.city || '').trim(),
        state: String(customer?.address?.state || '').trim(),
        zip: String(customer?.address?.zip || '').trim()
      },
      customerId: String(customer?.customerId || '').trim(),
      customerKey: String(customer?.customerKey || '').trim()
    }
  }

  function buildInsuredFromCustomerDetails(details: any, summary: any) {
    const person = details?.identity?.person || {}
    const contactPoints = Array.isArray(details?.contactPoints) ? details.contactPoints : []
    const addresses = Array.isArray(details?.addresses) ? details.addresses : []
    const preferredAddress = addresses.find((item: any) => item?.primary) || addresses[0] || {}
    const preferredEmail =
      contactPoints.find((item: any) => item?.contactType === 'EMAIL' && item?.preferred)?.value ||
      contactPoints.find((item: any) => item?.contactType === 'EMAIL')?.value ||
      ''
    const preferredPhone =
      contactPoints.find((item: any) => item?.contactType === 'PHONE' && item?.preferred)?.value ||
      contactPoints.find((item: any) => item?.contactType === 'PHONE')?.value ||
      ''
    const firstName = String(person?.firstName || summary?.firstName || '').trim()
    const lastName = String(person?.lastName || summary?.lastName || '').trim()
    const displayName = String(details?.displayName || summary?.name || `${firstName} ${lastName}` || '').trim()
    return {
      firstName,
      lastName,
      dob: resolveCustomerDob(details) || resolveCustomerDob(summary),
      prefix: String(summary?.prefix || '').trim(),
      displayName,
      email: String(preferredEmail || summary?.email || '').trim(),
      phone: String(preferredPhone || summary?.phone || '').trim(),
      address: {
        street: String(preferredAddress?.line1 || preferredAddress?.street || summary?.address?.street || '').trim(),
        city: String(preferredAddress?.city || summary?.address?.city || '').trim(),
        state: String(preferredAddress?.state || summary?.address?.state || '').trim(),
        zip: String(preferredAddress?.postalCode || preferredAddress?.zip || summary?.address?.zip || '').trim()
      },
      customerId: String(details?.customerId || summary?.customerId || '').trim(),
      customerKey: String(details?.customerKey || summary?.customerKey || '').trim()
    }
  }

  function isSameInsuredCandidate(candidate: any, selected: any): boolean {
    const candidateId = String(candidate?.customerId || '').trim()
    const selectedId = String(selected?.customerId || '').trim()
    if (candidateId && selectedId && candidateId === selectedId) return true
    const candidateKey = String(candidate?.customerKey || '').trim()
    const selectedKey = String(selected?.customerKey || '').trim()
    if (candidateKey && selectedKey && candidateKey === selectedKey) return true
    const candidateEmail = String(candidate?.email || '').trim().toLowerCase()
    const selectedEmail = String(selected?.email || '').trim().toLowerCase()
    if (candidateEmail && selectedEmail && candidateEmail === selectedEmail) return true
    const digits = (value: any) => String(value || '').replace(/\D/g, '')
    const candidatePhone = digits(candidate?.phone)
    const selectedPhone = digits(selected?.phone)
    if (candidatePhone && selectedPhone && candidatePhone === selectedPhone) return true
    const candidateName = String(candidate?.displayName || candidate?.name || `${candidate?.firstName || ''} ${candidate?.lastName || ''}`)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
    const selectedName = String(selected?.displayName || `${selected?.firstName || ''} ${selected?.lastName || ''}`)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
    if (candidateName && selectedName && candidateName === selectedName) return true
    return false
  }

  function isAlreadySelectedInInsureds(candidate: any, currentInsureds: InsuredState): boolean {
    if (isSameInsuredCandidate(candidate, currentInsureds?.primary || {})) return true
    if (isSameInsuredCandidate(candidate, currentInsureds?.secondary || {})) return true
    return (Array.isArray(currentInsureds?.additional) ? currentInsureds.additional : []).some((item) =>
      isSameInsuredCandidate(candidate, item || {})
    )
  }

  function resolveCustomerLookup(candidate: any): string {
    const customerId = String(candidate?.customerId || candidate?.id || '').trim()
    const customerKey = String(candidate?.customerKey || '').trim()
    return customerId || customerKey
  }

  function resolveCandidateDisplayName(candidate: any): string {
    return String(candidate?.displayName || candidate?.name || `${candidate?.firstName || ''} ${candidate?.lastName || ''}` || '').trim() || 'Contact'
  }

  function clearCustomerContactView() {
    setContactDetailPopupOpen(false)
    setContactDetailLoading(false)
    setContactDetailError(null)
    setContactDetailRecord(null)
    setContactDetailLookup('')
    setContactDetailTitle('')
  }

  function openCustomerContactInPage(mode: 'view' | 'edit' = 'view') {
    if (!contactDetailLookup) return
    if (canViewCustomerInAdmin) {
      navigate(`/admin/customers/${mode}/${encodeURIComponent(contactDetailLookup)}`)
      return
    }
    if (mode === 'view' && canViewCustomerClassic) {
      navigate(`/customers/${encodeURIComponent(contactDetailLookup)}`)
      return
    }
    toast.error('Access denied', 'You do not have permission to open this contact profile.')
  }

  function preferredContactValue(points: any[], type: 'EMAIL' | 'PHONE'): string {
    const typed = points.filter((item: any) => String(item?.contactType || '').toUpperCase() === type)
    if (!typed.length) return ''
    const preferred = typed.find((item: any) => item?.preferred)
    return String(preferred?.value || typed[0]?.value || '').trim()
  }

  function preferredAddress(addresses: any[]): any {
    return addresses.find((item: any) => item?.primary) || addresses[0] || {}
  }

  function buildContactDetailFallback(candidate: any) {
    const firstName = String(candidate?.identity?.person?.firstName || candidate?.firstName || '').trim()
    const lastName = String(candidate?.identity?.person?.lastName || candidate?.lastName || '').trim()
    const dob = resolveCustomerDob(candidate)
    const email = String(
      preferredContactValue(Array.isArray(candidate?.contactPoints) ? candidate.contactPoints : [], 'EMAIL') || candidate?.email || ''
    ).trim()
    const phone = String(
      preferredContactValue(Array.isArray(candidate?.contactPoints) ? candidate.contactPoints : [], 'PHONE') || candidate?.phone || ''
    ).trim()
    const street = String(candidate?.address?.street || '').trim()
    const city = String(candidate?.address?.city || '').trim()
    const state = String(candidate?.address?.state || '').trim()
    const zip = String(candidate?.address?.zip || '').trim()
    const hasInlineAddress = Boolean(street || city || state || zip)
    const fallbackAddresses = hasInlineAddress
      ? [{ line1: street, city, state, postalCode: zip, country: 'US', primary: true }]
      : []
    const contactPoints = Array.isArray(candidate?.contactPoints) && candidate.contactPoints.length
      ? candidate.contactPoints
      : [
          ...(email ? [{ contactType: 'EMAIL', value: email, usage: '', preferred: true }] : []),
          ...(phone ? [{ contactType: 'PHONE', value: phone, usage: '', preferred: !email }] : [])
        ]
    const addresses = Array.isArray(candidate?.addresses) ? candidate.addresses : fallbackAddresses
    return {
      firstName,
      lastName,
      dob,
      contactPoints,
      addresses
    }
  }

  function syncInsuredFromContactDetail(detail: any, lookup: string) {
    if (!lookup) return
    const points = Array.isArray(detail?.contactPoints) ? detail.contactPoints : []
    const addresses = Array.isArray(detail?.addresses) ? detail.addresses : []
    const currentAddress = preferredAddress(addresses)
    const preferredDob = resolveCustomerDob(detail)
    const preferredEmail = preferredContactValue(points, 'EMAIL')
    const preferredPhone = preferredContactValue(points, 'PHONE')
    const preferredStreet = String(currentAddress?.line1 || currentAddress?.street || '').trim()
    const preferredCity = String(currentAddress?.city || '').trim()
    const preferredState = String(currentAddress?.state || '').trim()
    const preferredZip = String(currentAddress?.postalCode || currentAddress?.zip || '').trim()

    const applyToParty = (party: InsuredParty): InsuredParty => {
      if (resolveCustomerLookup(party) !== lookup) return party
      return {
        ...party,
        dob: preferredDob || party.dob,
        email: preferredEmail || party.email,
        phone: preferredPhone || party.phone,
        address: {
          street: preferredStreet || party.address?.street || '',
          city: preferredCity || party.address?.city || '',
          state: preferredState || party.address?.state || '',
          zip: preferredZip || party.address?.zip || ''
        }
      }
    }

    setInsureds((prev) => ({
      ...prev,
      primary: applyToParty(prev.primary),
      secondary: applyToParty(prev.secondary),
      additional: (Array.isArray(prev.additional) ? prev.additional : []).map((item) => applyToParty(item))
    }))
  }

  function updateContactDetailRecord(nextRecord: any) {
    setContactDetailRecord(nextRecord)
    syncInsuredFromContactDetail(nextRecord, contactDetailLookup)
  }

  function updateContactPoint(index: number, field: 'contactType' | 'value' | 'usage', value: string) {
    const points = Array.isArray(contactDetailRecord?.contactPoints) ? [...contactDetailRecord.contactPoints] : []
    if (!points[index]) return
    points[index] = { ...points[index], [field]: value }
    updateContactDetailRecord({ ...(contactDetailRecord || {}), contactPoints: points })
  }

  function toggleContactPointPreferred(index: number) {
    const points = Array.isArray(contactDetailRecord?.contactPoints) ? [...contactDetailRecord.contactPoints] : []
    if (!points[index]) return
    const pointType = String(points[index]?.contactType || '').toUpperCase()
    const nextPreferred = !points[index]?.preferred
    const updated = points.map((item: any, itemIndex: number) => {
      if (itemIndex === index) return { ...item, preferred: nextPreferred }
      if (!nextPreferred) return item
      if (String(item?.contactType || '').toUpperCase() !== pointType) return item
      return { ...item, preferred: false }
    })
    updateContactDetailRecord({ ...(contactDetailRecord || {}), contactPoints: updated })
  }

  function addContactPoint() {
    const points = Array.isArray(contactDetailRecord?.contactPoints) ? [...contactDetailRecord.contactPoints] : []
    points.push({ contactType: 'EMAIL', value: '', usage: '', preferred: points.length === 0 })
    updateContactDetailRecord({ ...(contactDetailRecord || {}), contactPoints: points })
  }

  function removeContactPoint(index: number) {
    const points = (Array.isArray(contactDetailRecord?.contactPoints) ? contactDetailRecord.contactPoints : []).filter((_: any, itemIndex: number) => itemIndex !== index)
    updateContactDetailRecord({ ...(contactDetailRecord || {}), contactPoints: points })
  }

  function updateAddress(index: number, field: 'line1' | 'city' | 'state' | 'postalCode' | 'country', value: string) {
    const addresses = Array.isArray(contactDetailRecord?.addresses) ? [...contactDetailRecord.addresses] : []
    if (!addresses[index]) return
    addresses[index] = { ...addresses[index], [field]: value }
    updateContactDetailRecord({ ...(contactDetailRecord || {}), addresses })
  }

  function setAddressPrimary(index: number) {
    const addresses = Array.isArray(contactDetailRecord?.addresses) ? [...contactDetailRecord.addresses] : []
    if (!addresses[index]) return
    const updated = addresses.map((item: any, itemIndex: number) => ({ ...item, primary: itemIndex === index }))
    updateContactDetailRecord({ ...(contactDetailRecord || {}), addresses: updated })
  }

  function addAddress() {
    const addresses = Array.isArray(contactDetailRecord?.addresses) ? [...contactDetailRecord.addresses] : []
    addresses.push({
      line1: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'US',
      primary: addresses.length === 0
    })
    updateContactDetailRecord({ ...(contactDetailRecord || {}), addresses })
  }

  function removeAddress(index: number) {
    const addresses = (Array.isArray(contactDetailRecord?.addresses) ? contactDetailRecord.addresses : []).filter((_: any, itemIndex: number) => itemIndex !== index)
    const existingPrimaryIndex = addresses.findIndex((item: any) => item?.primary)
    const normalized = addresses.map((item: any, itemIndex: number) => ({
      ...item,
      primary: existingPrimaryIndex >= 0 ? itemIndex === existingPrimaryIndex : itemIndex === 0
    }))
    updateContactDetailRecord({ ...(contactDetailRecord || {}), addresses: normalized })
  }

  async function openCustomerContactView(candidate: any) {
    const lookup = resolveCustomerLookup(candidate)
    const fallbackRecord = buildContactDetailFallback(candidate)
    const canFetchFullRecord = Boolean(lookup && canViewCustomerDetails)
    setContactDetailPopupOpen(true)
    setContactDetailLookup(canFetchFullRecord ? lookup : '')
    setContactDetailTitle(resolveCandidateDisplayName(candidate))
    setContactDetailError(null)
    setContactDetailRecord(fallbackRecord)
    if (!canFetchFullRecord) {
      setContactDetailLoading(false)
      return
    }
    setContactDetailLoading(true)
    try {
      const details = await adminApi.getCustomer(lookup)
      if (details) {
        setContactDetailRecord(details)
        syncInsuredFromContactDetail(details, lookup)
      }
    } catch (e: any) {
      const msg = e?.message || String(e || 'Unable to load customer details.')
      setContactDetailError(msg)
    } finally {
      setContactDetailLoading(false)
    }
  }

  async function selectPrimaryInsured(customer: any) {
    if (isViewOnly) return
    const summaryMapped = buildInsuredFromCustomerSummary(customer)
    setPrimarySelecting(true)
    const applyPrimarySelection = (mapped: any) => {
      setInsureds(prev => ({
        ...prev,
        primary: mapped
      }))
      setQ(prev => ({
        ...prev,
        applicant: {
          ...prev.applicant,
          firstName: String(mapped?.firstName || prev.applicant?.firstName || ''),
          lastName: String(mapped?.lastName || prev.applicant?.lastName || ''),
          email: String(mapped?.email || prev.applicant?.email || '')
        }
      }))
      setPrimarySearchQuery('')
      setPrimarySearchResults([])
    }
    try {
      const lookupKey = summaryMapped.customerId || summaryMapped.customerKey
      let mapped = summaryMapped
      if (lookupKey) {
        const details = await adminApi.getCustomer(lookupKey)
        mapped = buildInsuredFromCustomerDetails(details, customer)
      }
      applyPrimarySelection(mapped)
    } catch {
      applyPrimarySelection(summaryMapped)
    } finally {
      setPrimarySelecting(false)
    }
  }

  async function searchSecondaryInsuredImpl(query: string) {
    if (!query.trim()) {
      setSecondarySearchResults([])
      return
    }
    setSecondarySearchLoading(true)
    try {
      const results = await adminApi.searchCustomers({ q: query, limit: 20 })
      const filtered = (results || []).filter((item: any) => !isSameInsuredCandidate(item, insureds?.primary || {}))
      setSecondarySearchResults(filtered)
    } catch (err) {
      console.error('Customer search failed:', err)
      setSecondarySearchResults([])
    } finally {
      setSecondarySearchLoading(false)
    }
  }

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      searchSecondaryInsuredImpl(secondarySearchQuery)
    }, 300)
    return () => clearTimeout(debounceTimer)
  }, [secondarySearchQuery])

  useEffect(() => {
    setSecondarySearchResults((prev) => prev.filter((item: any) => !isSameInsuredCandidate(item, insureds?.primary || {})))
  }, [
    insureds?.primary?.customerId,
    insureds?.primary?.customerKey,
    insureds?.primary?.email,
    insureds?.primary?.phone,
    insureds?.primary?.displayName,
    insureds?.primary?.firstName,
    insureds?.primary?.lastName
  ])

  async function selectSecondaryInsured(customer: any) {
    if (isViewOnly) return
    if (isSameInsuredCandidate(customer, insureds?.primary || {})) {
      setSecondarySearchResults((prev) => prev.filter((item: any) => !isSameInsuredCandidate(item, insureds?.primary || {})))
      return
    }
    const summaryMapped = buildInsuredFromCustomerSummary(customer)
    setSecondarySelecting(true)
    try {
      const lookupKey = summaryMapped.customerId || summaryMapped.customerKey
      let mapped = summaryMapped
      if (lookupKey) {
        const details = await adminApi.getCustomer(lookupKey)
        mapped = buildInsuredFromCustomerDetails(details, customer)
      }
      setInsureds(prev => ({
        ...prev,
        secondary: mapped
      }))
      setSecondarySearchQuery('')
      setSecondarySearchResults([])
    } catch {
      setInsureds(prev => ({
        ...prev,
        secondary: summaryMapped
      }))
      setSecondarySearchQuery('')
      setSecondarySearchResults([])
    } finally {
      setSecondarySelecting(false)
    }
  }

  function addAdditionalInsured() {
    if (isViewOnly) return
    setInsureds((prev) => ({
      ...prev,
      additional: [...(Array.isArray(prev.additional) ? prev.additional : []), emptyInsuredParty()]
    }))
  }

  function removeAdditionalInsured(index: number) {
    if (isViewOnly) return
    setInsureds((prev) => ({
      ...prev,
      additional: (Array.isArray(prev.additional) ? prev.additional : []).filter((_, rowIndex) => rowIndex !== index)
    }))
  }

  function updateAdditionalInsuredField(
    index: number,
    field: keyof Omit<InsuredParty, 'address'>,
    value: string
  ) {
    if (isViewOnly) return
    setInsureds((prev) => ({
      ...prev,
      additional: (Array.isArray(prev.additional) ? prev.additional : []).map((item, rowIndex) =>
        rowIndex === index ? { ...item, [field]: value } : item
      )
    }))
  }

  function updateAdditionalInsuredAddressField(index: number, field: keyof InsuredAddress, value: string) {
    if (isViewOnly) return
    setInsureds((prev) => ({
      ...prev,
      additional: (Array.isArray(prev.additional) ? prev.additional : []).map((item, rowIndex) =>
        rowIndex === index
          ? { ...item, address: { ...(item.address || emptyInsuredParty().address), [field]: value } }
          : item
      )
    }))
  }

  async function searchAdditionalInsuredImpl(query: string) {
    if (!query.trim()) {
      setAdditionalSearchResults([])
      return
    }
    setAdditionalSearchLoading(true)
    try {
      const results = await adminApi.searchCustomers({ q: query, limit: 20 })
      const filtered = (results || []).filter((item: any) => !isAlreadySelectedInInsureds(item, insureds))
      setAdditionalSearchResults(filtered)
    } catch (err) {
      console.error('Customer search failed:', err)
      setAdditionalSearchResults([])
    } finally {
      setAdditionalSearchLoading(false)
    }
  }

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      searchAdditionalInsuredImpl(additionalSearchQuery)
    }, 300)
    return () => clearTimeout(debounceTimer)
  }, [additionalSearchQuery])

  useEffect(() => {
    setAdditionalSearchResults((prev) => prev.filter((item: any) => !isAlreadySelectedInInsureds(item, insureds)))
  }, [insureds])

  useEffect(() => {
    if (step !== 3) clearCustomerContactView()
  }, [step])

  async function selectAdditionalInsured(customer: any) {
    if (isViewOnly) return
    if (isAlreadySelectedInInsureds(customer, insureds)) {
      setAdditionalSearchResults((prev) => prev.filter((item: any) => !isAlreadySelectedInInsureds(item, insureds)))
      return
    }
    const summaryMapped = buildInsuredFromCustomerSummary(customer)
    setAdditionalSelecting(true)
    const applyAdditionalSelection = (mapped: InsuredParty) => {
      setInsureds((prev) => {
        if (isAlreadySelectedInInsureds(mapped, prev)) return prev
        const nextAdditional = [...(Array.isArray(prev.additional) ? prev.additional : []), mapped]
        return { ...prev, additional: nextAdditional }
      })
      setAdditionalSearchQuery('')
      setAdditionalSearchResults([])
    }
    try {
      const lookupKey = summaryMapped.customerId || summaryMapped.customerKey
      let mapped = summaryMapped
      if (lookupKey) {
        const details = await adminApi.getCustomer(lookupKey)
        mapped = buildInsuredFromCustomerDetails(details, customer)
      }
      applyAdditionalSelection(mapped)
    } catch {
      applyAdditionalSelection(summaryMapped)
    } finally {
      setAdditionalSelecting(false)
    }
  }

  async function rateQuote() {
    if (isViewOnly) return
    if (locked || wizardMode === 'reinstate') return
    if (!q.productCode) {
      setError('Select a product before rating premium.')
      return
    }
    if (!q.country) {
      setError('Select a country before rating premium.')
      return
    }
    if (!q.state) {
      setError('Select a state/province before rating premium.')
      return
    }
    const resolvedCompany = resolveUnderwritingCompanyConfig(q, underwritingConfigurations)
    if (!resolvedCompany) {
      setError('Select an underwriting company before rating premium.')
      return
    }
    const rateState: QuoteState = {
      ...q,
      underwritingCompanyId: resolvedCompany.companyId,
      underwritingCompanyName: resolvedCompany.name
    }
    if (q.underwritingCompanyId !== resolvedCompany.companyId || q.underwritingCompanyName !== resolvedCompany.name) {
      setQ((prev) => ({
        ...prev,
        underwritingCompanyId: resolvedCompany.companyId,
        underwritingCompanyName: resolvedCompany.name
      }))
    }
    setAction('rate'); setError(null)
    resetBindingState()
    try {
      const payload: any = buildQuotePayload(rateState)
      if (draft?.quoteId) payload.quoteId = draft.quoteId
      const resp = await api.createQuote(payload)
      let ratedResponse: any = resp
      let previewWarning: string | null = null
      if (wizardMode === 'endorse') {
        const policyIdForPreview = policyContext?.policyId || boundPolicy?.policyId || policyIdParam
        if (policyIdForPreview) {
          try {
            const preview = await api.endorsePreview(policyIdForPreview, {
              effectiveDate: transactionEffectiveDate || q.effectiveDate,
              payload
            })
            setEndorsementPreview(preview)
            ratedResponse = {
              ...resp,
              underwriting: preview?.underwriting || resp?.underwriting,
              premium: preview?.premium || resp?.premium,
              retroAdjustment: preview?.retroAdjustment || null,
              timeline: preview?.timeline || null,
              fullTerm: preview?.fullTerm || null
            }
          } catch (previewErr: any) {
            setEndorsementPreview(null)
            previewWarning = `Rated premium, but OOS timeline preview failed: ${previewErr?.message || String(previewErr)}`
          }
        } else {
          setEndorsementPreview(null)
        }
      } else {
        setEndorsementPreview(null)
      }
      setQuoteResp(ratedResponse)
      if (wizardMode === 'quote') {
        setQuoteDocumentModel(buildQuoteSummaryModel(ratedResponse))
      } else {
        setQuoteDocumentModel(null)
      }
      // Snapshot the exact state sent for rating so post-rate draft checks
      // do not clear premium on the first click.
      ratedPayloadSnapshot.current = snapshotFromState(rateState)
      applyQuoteAudit(resp)
      const nextDraft = {
        quoteId: resp.quoteId || draft?.quoteId || '',
        quoteNumber: resp.quoteNumber || draft?.quoteNumber || '',
        status: resp.status || draft?.status || 'Draft',
        progressStep: Math.max(resp.progressStep || 1, Math.min(steps.length, 7))
      }
      setDraft(prev => prev ? { ...prev, ...nextDraft } : nextDraft)
      setStep(Math.min(steps.length, 7))
      if (nextDraft.quoteId) {
        const params = new URLSearchParams(searchParams)
        params.set('quoteId', nextDraft.quoteId)
        setSearchParams(params, { replace: true })
      }
      if (previewWarning) setError(previewWarning)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setAction(null) }
  }

  async function bindQuote() {
    if (isReadOnlyView) return
    if (!quoteResp?.quoteId || boundPolicy || locked) return
    setAction('bind'); setError(null)
    try {
      const payload = (quoteResp.underwriting && quoteResp.underwriting.decision === 'Refer' && canUwOverride && overrideReason.trim()) ? { overrideReason: overrideReason.trim() } : undefined
      const res = await api.bindQuote(quoteResp.quoteId, payload)
      setBoundPolicy({ policyId: res.policyId, policyNumber: res.policyNumber })
      setIssued(false)
      setDraft(prev => prev ? { ...prev, status: 'Converted', progressStep: steps.length } : prev)
      applyLocalQuoteAudit('Converted', steps.length)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setAction(null) }
  }

  async function issuePolicy() {
    if (isReadOnlyView) return
    if (!boundPolicy || issued) return
    if (isPolicyTransactionMode && wizardMode !== 'reinstate' && !quoteResp) return
    setAction('issue'); setError(null)
    try {
      if (isPolicyTransactionMode) {
        const payload = buildQuotePayload(q)
        let version: any
        if (wizardMode === 'endorse') {
          const endorsePayload: { effectiveDate: string; payload: any; transactionNumber?: string; reason?: string; notes?: string } = {
            effectiveDate: transactionEffectiveDate,
            payload
          }
          if (transactionNumber) endorsePayload.transactionNumber = transactionNumber
          if (endorseReason.trim()) endorsePayload.reason = endorseReason.trim()
          if (endorseNotes.trim()) endorsePayload.notes = endorseNotes.trim()
          version = await api.endorsePolicy(boundPolicy.policyId, {
            ...endorsePayload
          })
        } else if (wizardMode === 'cancel') {
          const cancelPayload: { effectiveDate: string; payload: any; transactionNumber?: string; reason?: string; cancellationReasonCode?: string } = {
            effectiveDate: transactionEffectiveDate,
            payload
          }
          if (transactionNumber) cancelPayload.transactionNumber = transactionNumber
          if (cancelReasonCode) cancelPayload.cancellationReasonCode = cancelReasonCode
          if (cancelReasonNotes.trim()) cancelPayload.reason = cancelReasonNotes.trim()
          version = await api.cancelPolicy(boundPolicy.policyId, cancelPayload)
        } else if (wizardMode === 'reinstate') {
          const reinstatePayload: { effectiveDate: string; payload: any; transactionNumber?: string } = {
            effectiveDate: transactionEffectiveDate,
            payload
          }
          if (transactionNumber) reinstatePayload.transactionNumber = transactionNumber
          version = await api.reinstatePolicy(boundPolicy.policyId, reinstatePayload)
        } else if (wizardMode === 'rewrite') {
          const rewritePayload: { effectiveDate: string; payload: any; overrideReason?: string; transactionNumber?: string } = {
            effectiveDate: transactionEffectiveDate,
            payload,
            overrideReason: overrideReason.trim() || undefined
          }
          if (transactionNumber) rewritePayload.transactionNumber = transactionNumber
          version = await api.rewritePolicy(boundPolicy.policyId, rewritePayload)
        } else {
          const renewPayload: { effectiveDate: string; payload: any; overrideReason?: string; transactionNumber?: string } = {
            effectiveDate: transactionEffectiveDate,
            payload,
            overrideReason: overrideReason.trim() || undefined
          }
          if (transactionNumber) renewPayload.transactionNumber = transactionNumber
          version = await api.renewPolicy(boundPolicy.policyId, renewPayload)
        }
        clearPendingTransaction(boundPolicy.policyId, wizardMode as PendingTransactionMode)
        setIssuedTransactionVersion(version)
        setIssued(true)
        const txLabels: Record<string, string> = { endorse: 'Endorsement', cancel: 'Cancellation', reinstate: 'Reinstatement', rewrite: 'Rewrite', renew: 'Renewal' }
        toast.success(`${txLabels[wizardMode] ?? 'Transaction'} applied`, `Policy #${boundPolicy.policyNumber} updated successfully.`)
        setDraft(prev => prev ? { ...prev, status: 'Issued' } : prev)
        setQuoteResp(null)
        setQuoteDocumentModel(null)
        setEndorsementPreview(null)
        applyLocalQuoteAudit('Issued', steps.length)
        if (draft?.quoteId) {
          try {
            const auditResp = await api.updateQuoteDraft(draft.quoteId, buildQuotePayload(q), { status: 'Issued', progressStep: steps.length })
            applyQuoteAudit(auditResp)
          } catch {
            // keep local audit even if persistence update fails
          }
        }
        return
      }
      const res = await api.issuePolicy(boundPolicy.policyId)
      setBoundPolicy({ policyId: res.policyId, policyNumber: res.policyNumber })
      setIssued(true)
      toast.success('Policy issued', `Policy #${res.policyNumber} has been issued successfully.`)
      setDraft(prev => prev ? { ...prev, status: 'Issued' } : prev)
      applyLocalQuoteAudit('Issued', steps.length)
      if (draft?.quoteId) {
        try {
          const auditResp = await api.updateQuoteDraft(draft.quoteId, buildQuotePayload(q), { status: 'Issued', progressStep: steps.length })
          applyQuoteAudit(auditResp)
        } catch {
          // keep local audit even if persistence update fails
        }
      }
    } catch (e: any) {
      const msg = e.message || String(e)
      setError(msg)
      toast.error('Action failed', msg)
    } finally { setAction(null) }
  }

  function cancelPendingTransaction() {
    if (isReadOnlyView) return
    if (!isPolicyTransactionMode) return
    if (!trackedPolicyId) return
    clearPendingTransaction(trackedPolicyId, wizardMode as PendingTransactionMode)
    navigate(`/policies/${trackedPolicyId}#edit`)
  }

  async function copyQuote() {
    if (isReadOnlyView) return
    if (!draft?.quoteId || copying) return
    setCopying(true)
    setError(null)
    try {
      const resp = await api.copyQuote(draft.quoteId)
      resetBindingState()
      setQuoteResp(null)
      setQuoteDocumentModel(null)
      setEndorsementPreview(null)
      setDraft(null)
      setQuoteAudit({ statusHistory: [], stepHistory: [] })
      setQualificationErrors({})
      setStep(1)
      const params = new URLSearchParams(searchParams)
      params.set('quoteId', resp.quoteId)
      setSearchParams(params, { replace: true })
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setCopying(false)
    }
  }

  function toggleBoundModifyMode() {
    if (isReadOnlyView) return
    if (wizardMode !== 'quote') return
    if (!boundPolicy || issued) return
    const nextMode = !boundModifyMode
    setBoundModifyMode(nextMode)
    setError(null)
    if (nextMode) {
      setStep(1)
    } else {
      setStep(steps.length)
    }
  }

  async function openFormDocument(formId: string) {
    if (!formId) return
    setDocumentOpeningFormId(formId)
    setFormsError(null)
    try {
      const blob = await api.getFormDocument(formId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      setFormsError(e?.message || String(e))
    } finally {
      setDocumentOpeningFormId(null)
    }
  }

  function buildQuoteSummaryModel(resp: any, sourceState?: QuoteState): QuoteSummaryDocumentModel {
    const source = sourceState || q
    const quoteNumber = String(draft?.quoteNumber || resp?.quoteNumber || resp?.quoteId || '').trim()
    const commissionPctValue = parseCommissionPercent(source.agencyCommissionPct)
    const totalPremiumAmount = moneyAmountValue(resp?.premium?.total)
    const commissionAmount = commissionPctValue == null
      ? '-'
      : formatCurrencyAmount((totalPremiumAmount * commissionPctValue) / 100, resp?.premium?.total?.currency || 'USD')
    const byCoverage = Array.isArray(resp?.premium?.byCoverage) ? resp.premium.byCoverage : []
    const coverageSubtotal = byCoverage.reduce((sum: number, item: any) => sum + coverageAmountValue(item), 0)
    const coveragePremiumRows = byCoverage.map((item: any) => {
      const code = String(item?.code || item?.coverageCode || item?.coverage_code || '').toUpperCase() || 'COV'
      const amount = coverageAmountValue(item)
      const share = coverageSubtotal > 0 ? `${((amount / coverageSubtotal) * 100).toFixed(2)}%` : '-'
      return {
        code,
        name: coverageName(code, cfg),
        amount,
        amountFormatted: formatCurrencyAmount(amount, item?.amount?.currency || resp?.premium?.total?.currency || 'USD'),
        share
      }
    })
    return {
      quoteNumber: quoteNumber || 'Pending',
      generatedAt: new Date().toISOString(),
      product: source.productCode ? productLabel(source.productCode as ProductCode) : '-',
      effectiveDate: source.effectiveDate,
      termMonths: Number(source.termMonths) || 12,
      country: source.country || '-',
      state: source.state || '-',
      underwritingCompany: source.underwritingCompanyName || '-',
      agencyName: source.agencyName || '-',
      agencyContactName: source.agencyContactName || '-',
      insuredName: `${source.applicant?.firstName || ''} ${source.applicant?.lastName || ''}`.trim() || '-',
      commissionPct: formatCommissionPercent(source.agencyCommissionPct),
      commissionAmount,
      premiumBase: formatMoney(resp?.premium?.base) || formatMoney(resp?.premium?.subtotal) || '-',
      premiumFees: formatMoney(resp?.premium?.fees) || '-',
      premiumTaxes: formatMoney(resp?.premium?.taxes) || '-',
      premiumTotal: formatMoney(resp?.premium?.total) || '-',
      coveragePremiumRows,
      vehicles: buildVehicleCards(source)
    }
  }

  function buildRatingWorksheetModel(
    sourceState: QuoteState,
    premium: any,
    context?: { transactionType?: string; quoteOrTransactionNumber?: string; policyNumber?: string }
  ): RatingWorksheetDocumentModel {
    const calcTrace = premium?.calcTrace && typeof premium.calcTrace === 'object' ? premium.calcTrace : null
    const coverageRows = Array.isArray(premium?.byCoverage) ? premium.byCoverage : []
    const coverageTraceRows = Array.isArray(calcTrace?.coverageDetails) ? calcTrace.coverageDetails : []
    const coverageFormulaRows: RatingWorksheetCoverageFormulaRow[] = coverageRows.map((item: any, index: number) => {
      const code = String(item?.code || '').toUpperCase() || 'COV'
      const traceRow = coverageTraceRows.find((row: any) => String(row?.code || '').toUpperCase() === code) || coverageTraceRows[index] || null
      const factorSummary = traceRow?.factors && typeof traceRow.factors === 'object'
        ? Object.entries(traceRow.factors)
          .map(([key, value]) => `${key}=${typeof value === 'number' ? Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : String(value)}`)
          .join(' ; ')
        : '-'
      const limitOrDeductible = [
        item?.limit != null ? `Limit ${String(item.limit)}` : '',
        item?.deductible != null ? `Ded ${String(item.deductible)}` : ''
      ].filter(Boolean).join(' | ') || '-'
      return {
        code,
        name: coverageName(code, cfg),
        limitOrDeductible,
        formula: String(traceRow?.formula || 'rating-engine formula'),
        factorSummary,
        amountFormatted: formatCurrencyAmount(coverageAmountValue(item), item?.amount?.currency || premium?.total?.currency || 'USD')
      }
    })

    const globalFactorRows = calcTrace?.factors && typeof calcTrace.factors === 'object'
      ? Object.entries(calcTrace.factors).map(([label, value]) => ({
        label,
        value: typeof value === 'number'
          ? Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
          : String(value ?? '-')
      }))
      : []

    const insuredName = `${sourceState.applicant?.firstName || ''} ${sourceState.applicant?.lastName || ''}`.trim() || '-'
    const txType = context?.transactionType || (wizardMode === 'quote' ? 'Quote' : txLabel)
    const quoteOrTransactionNumber =
      String(
        context?.quoteOrTransactionNumber ||
        transactionNumber ||
        draft?.quoteNumber ||
        quoteResp?.quoteNumber ||
        quoteResp?.quoteId ||
        '-'
      ).trim() || '-'
    return {
      documentTitle: 'Rating Worksheet',
      generatedAt: new Date().toISOString(),
      quoteOrTransactionNumber,
      policyNumber: String(context?.policyNumber || boundPolicy?.policyNumber || policyNumber || '-'),
      transactionType: txType,
      product: sourceState.productCode ? productLabel(sourceState.productCode as ProductCode) : '-',
      insuredName,
      underwritingCompany: sourceState.underwritingCompanyName || '-',
      state: sourceState.state || '-',
      country: sourceState.country || '-',
      effectiveDate: sourceState.effectiveDate || '',
      transactionEffectiveDate: transactionEffectiveDate || sourceState.effectiveDate || '',
      termMonths: Number(sourceState.termMonths) || 12,
      raterSource: String(calcTrace?.source || 'legacy-rating-engine'),
      raterModelCode: String(calcTrace?.modelCode || '-'),
      raterVersion: String(calcTrace?.versionLabel || calcTrace?.version || '-'),
      premiumFees: formatMoney(premium?.fees) || '-',
      premiumTaxes: formatMoney(premium?.taxes) || '-',
      premiumTotal: formatMoney(premium?.total) || '-',
      coverageFormulaRows,
      globalFactorRows,
      calcTraceJson: calcTrace
    }
  }

  async function openQuoteSummaryDocument() {
    const model = quoteDocumentModel || (quoteResp ? buildQuoteSummaryModel(quoteResp) : null)
    if (!model) return
    setDocumentOpeningId('quote-summary')
    setFormsError(null)
    try {
      const blob = await buildQuoteSummaryPdf(model)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      setFormsError(e?.message || String(e))
    } finally {
      setDocumentOpeningId(null)
    }
  }

  async function openPolicyPacketDocument() {
    if (!boundPolicy) return
    setDocumentOpeningId('policy-pocket')
    setFormsError(null)
    try {
      const effectiveDate = q.effectiveDate || new Date().toISOString().slice(0, 10)
      const expirationDate = addMonthsToIsoDate(effectiveDate, Number(q.termMonths) || 12)
      const quoteNumber = String(quoteDocumentModel?.quoteNumber || draft?.quoteNumber || quoteResp?.quoteNumber || quoteResp?.quoteId || '').trim() || '-'
      const totalPremiumAmount = moneyAmountValue(quoteResp?.premium?.total || visiblePremium?.total)
      const commissionPctValue = parseCommissionPercent(q.agencyCommissionPct)
      const idCards = buildVehicleCards(q)
      const coverageRows = (Array.isArray(q.coverages) ? q.coverages : [])
        .filter((sel: any) => sel && sel.selected !== false)
        .map((sel: any) => {
          const code = String(sel.code || '').toUpperCase() || 'COV'
          return {
            code,
            name: coverageName(code, cfg),
            details: coverageSummary(sel) || 'Selected'
          }
        })
      const model: PolicyPacketDocumentModel = {
        policyNumber: boundPolicy.policyNumber || '-',
        quoteNumber,
        generatedAt: new Date().toISOString(),
        insuredName: `${q.applicant?.firstName || ''} ${q.applicant?.lastName || ''}`.trim() || '-',
        underwritingCompany: q.underwritingCompanyName || '-',
        agencyName: q.agencyName || '-',
        agencyContactName: q.agencyContactName || '-',
        effectiveDate,
        expirationDate,
        state: q.state || '-',
        country: q.country || '-',
        product: q.productCode ? productLabel(q.productCode as ProductCode) : '-',
        commissionPct: formatCommissionPercent(q.agencyCommissionPct),
        commissionAmount:
          commissionPctValue == null
            ? '-'
            : formatCurrencyAmount((totalPremiumAmount * commissionPctValue) / 100, visiblePremium?.total?.currency || 'USD'),
        premiumTotal: formatMoney(quoteResp?.premium?.total) || formatMoney(visiblePremium?.total) || '-',
        coverageRows,
        idCards
      }
      const blob = await buildPolicyPacketPdf(model)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      setFormsError(e?.message || String(e))
    } finally {
      setDocumentOpeningId(null)
    }
  }

  async function openIdCardsDocument() {
    if (!boundPolicy) return
    setDocumentOpeningId('id-cards')
    setFormsError(null)
    try {
      const effectiveDate = q.effectiveDate || new Date().toISOString().slice(0, 10)
      const expirationDate = addMonthsToIsoDate(effectiveDate, Number(q.termMonths) || 12)
      const model: PolicyIdCardsDocumentModel = {
        policyNumber: boundPolicy.policyNumber || '-',
        generatedAt: new Date().toISOString(),
        insuredName: `${q.applicant?.firstName || ''} ${q.applicant?.lastName || ''}`.trim() || '-',
        underwritingCompany: q.underwritingCompanyName || '-',
        effectiveDate,
        expirationDate,
        state: q.state || '-',
        vehicles: buildVehicleCards(q)
      }
      const blob = await buildPolicyIdCardsPdf(model)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      setFormsError(e?.message || String(e))
    } finally {
      setDocumentOpeningId(null)
    }
  }

  async function openGeneratedDocument(documentId: string) {
    if (documentId === 'quote-summary') {
      await openQuoteSummaryDocument()
      return
    }
    if (documentId === 'rating-worksheet') {
      await openRatingWorksheetDocument()
      return
    }
    if (documentId === 'policy-pocket') {
      await openPolicyPacketDocument()
      return
    }
    if (documentId === 'id-cards') {
      await openIdCardsDocument()
    }
  }

  async function openRatingWorksheetDocument() {
    const premium = quoteResp?.premium || visiblePremium
    if (!premium) return
    setDocumentOpeningId('rating-worksheet')
    setFormsError(null)
    try {
      let model: RatingWorksheetDocumentModel | null = null

      if (isReadOnlyView && policyIdParam && versionIdParam) {
        try {
          const persisted = await apiDetails.getVersionRatingWorksheet(policyIdParam, versionIdParam)
          const snapshot = persisted?.metadata?.snapshot
          if (snapshot?.payload && snapshot?.premium) {
            const persistedPayload = normalizePayloadCoverages(snapshot.payload || {})
            const persistedState = mergeQuoteState(persistedPayload, { ...defaultState })
            const context = snapshot?.context && typeof snapshot.context === 'object'
              ? {
                transactionType: String(snapshot.context.transactionType || txLabel || 'Issue'),
                quoteOrTransactionNumber: String(snapshot.context.quoteOrTransactionNumber || snapshot.context.transactionNumber || '-'),
                policyNumber: String(snapshot.context.policyNumber || boundPolicy?.policyNumber || policyNumber || '-')
              }
              : undefined
            model = buildRatingWorksheetModel(persistedState, snapshot.premium, context)
            if (persisted?.createdAt) model.generatedAt = String(persisted.createdAt)
            if (snapshot?.context?.transactionEffectiveDate) {
              model.transactionEffectiveDate = String(snapshot.context.transactionEffectiveDate)
            }
          }
        } catch {
          // Fall back to on-demand rendering from the loaded readonly version payload.
        }
      }

      if (!model) {
        model = buildRatingWorksheetModel(q, premium, {
          transactionType: wizardMode === 'quote' ? 'Quote' : txLabel,
          quoteOrTransactionNumber: wizardMode === 'quote'
            ? (draft?.quoteNumber || quoteResp?.quoteNumber || quoteResp?.quoteId || '-')
            : (transactionNumber || '-'),
          policyNumber: boundPolicy?.policyNumber || policyNumber || '-'
        })
      }
      const blob = await buildRatingWorksheetPdf(model)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      setFormsError(e?.message || String(e))
    } finally {
      setDocumentOpeningId(null)
    }
  }

  const uwDecision = quoteResp?.underwriting?.decision
  const needsOverride = uwDecision === 'Refer' && canUwOverride
  const overrideReady = overrideReason.trim().length >= 3
  const requiresRatingBeforeIssue = isPolicyTransactionMode && wizardMode !== 'reinstate'
  const bindDisabledReason = (() => {
    if (issued) return 'Policy already issued'
    if (boundPolicy) return 'Policy already bound'
    if (!quoteResp) return 'Rate premium first'
    if (uwDecision === 'Decline') return 'Underwriting declined this risk'
    if (uwDecision === 'Refer' && !canUwOverride) return 'Awaiting underwriting approval'
    if (needsOverride && !overrideReady) return 'Provide override reason to override'
    return null
  })()
  const issueDisabledReason = (() => {
    if (!boundPolicy) return isPolicyTransactionMode ? 'Policy context is required' : 'Bind the quote before issuing'
    if (issued) return 'Policy already issued'
    if (requiresRatingBeforeIssue && !quoteResp) return 'Rate premium before issuing'
    return null
  })()
  const formsRows = useMemo(
    () =>
      (['Quote', 'Bind', 'Issue'] as FormAttachmentStage[]).flatMap((stage) =>
        (attachedFormsByStage[stage] || []).map((item) => ({ stage, item }))
      ),
    [attachedFormsByStage]
  )
  const documentRows = useMemo<GeneratedDocumentRow[]>(() => {
    const rows: GeneratedDocumentRow[] = []
    if (visiblePremium) {
      const versionSuffix = visiblePremium?.calcTrace?.versionLabel ? ` (${visiblePremium.calcTrace.versionLabel})` : ''
      rows.push({
        id: 'rating-worksheet',
        name: `Rating Worksheet${versionSuffix}`,
        stage: wizardMode === 'quote' ? 'Quote' : 'Issue',
        status: 'Attached'
      })
    }
    if (wizardMode === 'quote' && quoteDocumentModel) {
      rows.push({
        id: 'quote-summary',
        name: quoteDocumentModel.quoteNumber ? `Quote Summary #${quoteDocumentModel.quoteNumber}` : 'Quote Summary',
        stage: 'Quote',
        status: 'Attached'
      })
    }
    if (boundPolicy && q.productCode === 'personal-auto') {
      rows.push({
        id: 'policy-pocket',
        name: `Policy Packet #${boundPolicy.policyNumber || ''}`.trim(),
        stage: 'Bind',
        status: 'Attached'
      })
      rows.push({
        id: 'id-cards',
        name: 'Policy ID Cards',
        stage: 'Bind',
        status: 'Attached'
      })
    }
    return rows
  }, [wizardMode, quoteDocumentModel, boundPolicy, q.productCode, visiblePremium])
  const aiInsightsPanel = visibleAiInsights ? (
    <div className="block-spaced-sm">
      <h3>AI / ML Insights</h3>
      <div className="kvline"><span className="muted">Recommendation</span><span>{String(visibleAiInsights?.recommendation || '-')}</span></div>
      <div className="kvline"><span className="muted">Provider</span><span>{String(visibleAiInsights?.provider || '-')}</span></div>
      <div className="kvline"><span className="muted">Model Version</span><span>{String(visibleAiInsights?.modelVersion || '-')}</span></div>
      <div className="kvline"><span className="muted">Risk Score</span><span>{formatScorePct(visibleAiInsights?.scores?.risk)}</span></div>
      <div className="kvline"><span className="muted">Fraud Score</span><span>{formatScorePct(visibleAiInsights?.scores?.fraud)}</span></div>
      <div className="kvline"><span className="muted">Premium Adequacy</span><span>{formatScorePct(visibleAiInsights?.scores?.premiumAdequacy)}</span></div>
      {Array.isArray(visibleAiInsights?.reasons) && visibleAiInsights.reasons.length > 0 && (
        <div className="block-spaced-sm">
          <div className="muted">Insights</div>
          <ul>
            {visibleAiInsights.reasons.map((reason: string, index: number) => (
              <li key={`ai-reason-${index}`}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(visibleAiInsights?.suggestedActions) && visibleAiInsights.suggestedActions.length > 0 && (
        <div className="block-spaced-sm">
          <div className="muted">Suggested Actions</div>
          <ul>
            {visibleAiInsights.suggestedActions.map((item: string, index: number) => (
              <li key={`ai-action-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : null
  const aiInsightsPendingBanner =
    !aiInsightsPanel && wizardMode !== 'reinstate'
      ? (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>AI / ML Insights</h3>
          <div className="muted">
            AI / ML insights will be generated after you click <strong>Rate Premium</strong>.
          </div>
        </div>
      )
      : null
  const wizardTitle = isPolicyTransactionMode ? `${txLabel} Wizard` : 'New Quote Wizard'
  const headerPrimaryNumberLabel = isPolicyTransactionMode ? `${txLabel} #` : 'Quote #'
  const headerPrimaryNumberValue = String(transactionNumber || (showQuoteNumber ? draft?.quoteNumber : '') || '').trim()
  const headerEffectiveValue = String(isPolicyTransactionMode ? transactionEffectiveDate : q.effectiveDate || '').trim()
  const displayEffectiveValue = headerEffectiveValue ? formatDisplayDate(headerEffectiveValue) : '-'
  return (
    <div className="card page-shell wizard-shell">
      <div className="wizard-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/search">Home</Link>
        <span className="wizard-breadcrumb-sep">/</span>
        {trackedPolicyId && policyNumber ? (
          <>
            <Link to={`/policies/${trackedPolicyId}`}>Policies</Link>
            <span className="wizard-breadcrumb-sep">/</span>
            <Link to={`/policies/${trackedPolicyId}`}>{policyNumber}</Link>
            <span className="wizard-breadcrumb-sep">/</span>
            <span>{isPolicyTransactionMode ? txLabel : 'Quote'}</span>
          </>
        ) : (
          <>
            <span>Quotes</span>
            <span className="wizard-breadcrumb-sep">/</span>
            <span>{isPolicyTransactionMode ? txLabel : 'New Quote'}</span>
          </>
        )}
      </div>
      <div className="wizard-header">
        <div className="wizard-header-main">
          <div className="wizard-title-row">
            <h2>{wizardTitle}</h2>
            <StatusBadge status={workflowStatus} className="wizard-status-chip" />
          </div>
          {(isPolicyTransactionMode || isViewOnly || boundPolicy) && policyNumber && trackedPolicyId && (
            <div className="wizard-policy-link-row">
              <Link className="wizard-policy-link" to={`/policies/${trackedPolicyId}`}>
                Policy #{policyNumber}
              </Link>
            </div>
          )}
          {linkedCustomerLookup && (
            <div className="wizard-policy-link-row">
              <Link className="wizard-policy-link" to={`/customers/${encodeURIComponent(linkedCustomerLookup)}`}>
                Customer #{linkedCustomerLabel}
              </Link>
              {linkedCustomerName && <span className="muted"> · {linkedCustomerName}</span>}
            </div>
          )}
        </div>
        <div className="wizard-meta">
          <div className="wizard-meta-cards">
            {headerPrimaryNumberValue && (
              <div className="wizard-meta-card">
                <div className="wizard-meta-card-label">{headerPrimaryNumberLabel}</div>
                <div className="wizard-meta-card-value wizard-meta-primary">{headerPrimaryNumberValue}</div>
              </div>
            )}
            <div className="wizard-meta-card">
              <div className="wizard-meta-card-label">{isPolicyTransactionMode ? 'Effective' : 'Quote Effective'}</div>
              <div className="wizard-meta-card-value wizard-meta-primary">{displayEffectiveValue}</div>
            </div>
          </div>
          {loadingDraft && <div className="muted wizard-meta-line">Loading saved quote…</div>}
        </div>
      </div>
      <div className="wizard-layout">
        <Stepper
          steps={steps}
          active={step}
          allDone={isViewOnly}
          onSelect={(nextStep) => { void attemptStepChange(nextStep) }}
        />
        <div className="wizard-content">
      <div className="wizard-stage-card">
        <div className="wizard-stage-card-body">
      {step === 1 && (
        <section>
          {isPolicyTransactionMode && (
            <div className="row row-spaced-sm transaction-effective-row">
              <div className="col transaction-effective-col">
                <label>Transaction Effective Date</label>
                <input
                  type="date"
                  className="transaction-effective-input"
                  value={transactionEffectiveDate}
                  onChange={(e) => {
                    setTransactionEffectiveDate(e.target.value)
                    setTransactionDateDirty(true)
                  }}
                  disabled={isViewOnly}
                />
                {policyNumber && (
                  <div className="muted wizard-help">
                    Applies to {txLabel.toLowerCase()} on Policy #{policyNumber}.
                  </div>
                )}
              </div>
            </div>
          )}
          {isEndorsementMode && (
            <div className="row row-spaced-sm">
              <div className="col">
                <label>Endorsement Reason</label>
                <select
                  value={endorseReason}
                  onChange={(e) => setEndorseReason(e.target.value)}
                  disabled={isViewOnly}
                >
                  <option value="">— Select a reason —</option>
                  {(ENDORSEMENT_REASONS[q.productCode as ProductCode] ?? []).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {isEndorsementMode && (
            <div className="row row-spaced-sm">
              <div className="col">
                <label>Endorsement Notes</label>
                <textarea
                  rows={3}
                  value={endorseNotes}
                  onChange={(e) => setEndorseNotes(e.target.value)}
                  disabled={isViewOnly}
                  placeholder="Additional notes or details for this endorsement…"
                />
              </div>
            </div>
          )}
          {isCancellationMode && (
            <div className="row row-spaced-sm">
              <div className="col">
                <label>Cancellation Reason Code</label>
                <select
                  value={cancelReasonCode}
                  onChange={(e) => setCancelReasonCode(e.target.value)}
                  disabled={isViewOnly || cancelReasonCodesLoading}
                >
                  <option value="">
                    {cancelReasonCodesLoading ? 'Loading…' : '— Select a reason code —'}
                  </option>
                  {cancelReasonCodes.map((rc: any) => (
                    <option key={rc.reason_code} value={rc.reason_code}>
                      {rc.reason_code} – {rc.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {isCancellationMode && (
            <div className="row row-spaced-sm">
              <div className="col">
                <label>Cancellation Notes</label>
                <textarea
                  rows={3}
                  value={cancelReasonNotes}
                  onChange={(e) => setCancelReasonNotes(e.target.value)}
                  disabled={isViewOnly}
                  placeholder="Enter cancellation notes or reason details…"
                />
              </div>
            </div>
          )}
          <div className="row">
            <div className="col uw-company-col">
              <label>Underwriting Company</label>
              <select
                value={q.underwritingCompanyName || ''}
                onChange={e => {
                  const nextName = e.target.value
                  setQ((prev) => {
                    if (companyNameKey(prev.underwritingCompanyName) === companyNameKey(nextName)) return prev
                    return {
                      ...prev,
                      underwritingCompanyId: '',
                      underwritingCompanyName: nextName,
                      country: '',
                      state: '',
                      productCode: '',
                      policyOffering: '',
                      qualificationAnswers: {},
                      risks: [],
                      coverages: []
                    }
                  })
                  setQuoteResp(null)
                  setQuoteDocumentModel(null)
                  resetBindingState()
                  setQualificationErrors({})
                }}
                disabled={isCancellationMode || loadingUnderwritingCompanies || lockCoreProductFields || isViewOnly}
              >
                <option value="">
                  {loadingUnderwritingCompanies
                    ? 'Loading companies...'
                    : underwritingCompanies.length
                      ? 'Select underwriting company'
                      : 'No underwriting company configured'}
                </option>
                {underwritingCompanies.map((company: any) => (
                  <option key={company.name} value={company.name}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="col">
              <label>Agency</label>
              <select
                value={q.agencyId || ''}
                onChange={(event) => {
                  const nextAgencyId = String(event.target.value || '')
                  const selectedAgency = agencyOptions.find((item) => item.agencyId === nextAgencyId)
                  setQ((prev) => ({
                    ...prev,
                    agencyId: nextAgencyId,
                    agencyName: selectedAgency?.legalName || '',
                    agencyContactId: '',
                    agencyContactName: ''
                  }))
                }}
                disabled={isCancellationMode || lockCoreProductFields || isViewOnly || loadingAgencyOptions}
              >
                <option value="">
                  {loadingAgencyOptions
                    ? 'Loading agencies...'
                    : agencyOptions.length
                      ? 'Select agency'
                      : 'No active agencies configured'}
                </option>
                {agencyOptions.map((agency) => {
                  const label = [agency.agencyCode, agency.legalName].filter(Boolean).join(' - ')
                  return (
                    <option key={agency.agencyId} value={agency.agencyId}>
                      {label || agency.agencyKey || agency.agencyId}
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="col">
              <label>Agency Contact</label>
              <select
                value={q.agencyContactId || ''}
                onChange={(event) => {
                  const nextContactId = String(event.target.value || '')
                  const selectedContact = agencyContacts.find((item) => item.contactId === nextContactId)
                  setQ((prev) => ({
                    ...prev,
                    agencyContactId: nextContactId,
                    agencyContactName: selectedContact?.displayName || ''
                  }))
                }}
                disabled={isCancellationMode || lockCoreProductFields || isViewOnly || !q.agencyId || loadingAgencyContacts}
              >
                <option value="">
                  {!q.agencyId
                    ? 'Select agency first'
                    : loadingAgencyContacts
                      ? 'Loading contacts...'
                      : agencyContacts.length
                        ? 'Select contact'
                        : 'No contacts found for agency'}
                </option>
                {agencyContacts.map((contact) => {
                  const contactDetails = [contact.email, contact.phoneNumber].filter(Boolean).join(' | ')
                  return (
                    <option key={contact.contactId} value={contact.contactId}>
                      {contactDetails ? `${contact.displayName} (${contactDetails})` : contact.displayName}
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="col">
              <label>Commission %</label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={q.agencyCommissionPct ?? ''}
                onChange={(event) => {
                  const raw = event.target.value
                  if (!raw.trim()) {
                    setQ((prev) => ({ ...prev, agencyCommissionPct: '' }))
                    return
                  }
                  const numeric = Number(raw)
                  if (!Number.isFinite(numeric)) return
                  if (numeric > 100) {
                    setQ((prev) => ({ ...prev, agencyCommissionPct: '100' }))
                    return
                  }
                  if (numeric < 0) {
                    setQ((prev) => ({ ...prev, agencyCommissionPct: '0' }))
                    return
                  }
                  setQ((prev) => ({ ...prev, agencyCommissionPct: raw }))
                }}
                onBlur={() => setQ((prev) => ({ ...prev, agencyCommissionPct: normalizeCommissionPercentInput(prev.agencyCommissionPct) }))}
                placeholder="0.00"
                disabled={isCancellationMode || isViewOnly}
              />
            </div>
          </div>
          <div className="row">
            <div className="col">
              <label>Effective Date</label>
              <input
                type="date"
                value={q.effectiveDate}
                onChange={e => {
                  const nextEffectiveDate = e.target.value
                  setQ({ ...q, effectiveDate: nextEffectiveDate })
                  if (!isPolicyTransactionMode) {
                    setTransactionEffectiveDate(nextEffectiveDate)
                    if (transactionDateDirty) {
                      setTransactionDateDirty(false)
                    }
                  }
                }}
                disabled={isCancellationMode || lockCoreProductFields || isViewOnly}
              />
            </div>
            <div className="col">
              <label>Country</label>
              <select
                value={q.country || ''}
                onChange={e => {
                  const nextCountry = e.target.value ? normalizeCountryCode(e.target.value) : ''
                  setQ({ ...q, country: nextCountry, state: '' })
                }}
                disabled={isCancellationMode || isViewOnly}
              >
                <option value="">{countryOptions.length ? 'Select country' : 'No country configured'}</option>
                {countryOptions.map((entry) => (
                  <option key={entry.code} value={entry.code}>{entry.label}</option>
                ))}
              </select>
            </div>
            <div className="col">
              <label>State</label>
              <select
                value={q.state || ''}
                onChange={e => setQ({ ...q, state: normalizeRegionCode(e.target.value) })}
                disabled={isCancellationMode || !q.country || isViewOnly}
              >
                <option value="">{stateOptions.length ? 'Select state/province' : 'No state/province configured'}</option>
                {stateOptions.map((state) => (
                  <option key={state.code} value={state.code}>{state.code} - {state.name}</option>
                ))}
              </select>
            </div>
            <div className="col">
              <label>Product</label>
              <select
                value={q.productCode || ''}
                onChange={e => onProductChange(e.target.value as QuoteProductCode)}
                disabled={lockCoreProductFields || !q.country || !q.state || loadingUnderwritingCompanies || isViewOnly}
              >
                <option value="">
                  {!q.country || !q.state
                    ? 'Select country and state first'
                    : availableProductCodes.length
                      ? 'Select product'
                      : 'No products configured'}
                </option>
                {q.productCode && !availableProductCodes.includes(q.productCode as ProductCode) && (
                  <option value={q.productCode}>{q.productCode}</option>
                )}
                {availableProductCodes.map((code) => (
                  <option key={code} value={code}>{productLabel(code)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="col">
              <label>Policy Offering</label>
              <select
                value={q.policyOffering || ''}
                onChange={(event) => setQ((prev) => ({ ...prev, policyOffering: event.target.value }))}
                disabled={isCancellationMode || lockCoreProductFields || isViewOnly || !q.productCode}
              >
                <option value="">{q.productCode ? 'Select policy offering' : 'Select product first'}</option>
                {policyOfferingOptions.map((offering) => (
                  <option key={offering} value={offering}>{offering}</option>
                ))}
              </select>
            </div>
            <div className="col">
              <label>Underwriter</label>
              <select
                value={q.underwriterUserId || ''}
                onChange={(event) => {
                  const nextUserId = String(event.target.value || '')
                  const selectedUnderwriter = underwriterOptions.find((item) => item.userId === nextUserId)
                  setQ((prev) => ({
                    ...prev,
                    underwriterUserId: nextUserId,
                    underwriterName: selectedUnderwriter?.displayName || ''
                  }))
                }}
                disabled={isCancellationMode || lockCoreProductFields || isViewOnly || loadingUnderwriterOptions}
              >
                <option value="">
                  {loadingUnderwriterOptions
                    ? 'Loading underwriters...'
                    : underwriterOptions.length
                      ? 'Select underwriter'
                      : 'No underwriters configured'}
                </option>
                {underwriterOptions.map((option) => (
                  <option key={option.userId} value={option.userId}>{option.displayName}</option>
                ))}
              </select>
            </div>
            <div className="col">
              <label>Term</label>
              <select value={q.termMonths} onChange={e => setQ({ ...q, termMonths: Number(e.target.value) })} disabled={isCancellationMode || isViewOnly}>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div className="col">
              <label>Prior Policy Number</label>
              <input
                value={q.priorPolicyNumber || ''}
                onChange={(event) => setQ((prev) => ({ ...prev, priorPolicyNumber: event.target.value }))}
                placeholder="Prior policy number"
                disabled={isCancellationMode || isViewOnly}
              />
            </div>
            <div className="col">
              <label>Prior Carrier</label>
              <select
                value={q.priorCarrier || ''}
                onChange={(event) => setQ((prev) => ({ ...prev, priorCarrier: event.target.value }))}
                disabled={isCancellationMode || isViewOnly || loadingPriorCarrierOptions}
              >
                <option value="">
                  {loadingPriorCarrierOptions
                    ? 'Loading carriers...'
                    : priorCarrierOptions.length
                      ? 'Select prior carrier'
                      : 'No carriers available'}
                </option>
                {q.priorCarrier && !priorCarrierOptions.includes(q.priorCarrier) && (
                  <option value={q.priorCarrier}>{q.priorCarrier}</option>
                )}
                {priorCarrierOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          {!q.productCode ? (
            <div className="muted">Select a product in Step 1 to continue.</div>
          ) : (
            qualificationQuestions.length === 0 ? (
              <div className="muted">No qualification questions configured for selected product.</div>
            ) : (
              <div className="row qualification-grid">
                {!qualificationEditable && (
                  <div className="muted">Qualification Questions are read-only for this transaction. Edit is allowed in Rewrite only.</div>
                )}
                {qualificationQuestions.map((question) => {
                  const selectedAnswer = q.qualificationAnswers?.[question.key] || ''
                  return (
                    <div
                      className={`col qualification-col ${question.showWhen ? 'is-derived' : ''}`}
                      key={question.key}
                    >
                      <div className="qualification-label">{question.label}</div>
                      <div className="qualification-radio-group" role="radiogroup" aria-label={question.label}>
                        <label className={`qualification-radio ${selectedAnswer === 'yes' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name={`qualification-${question.key}`}
                            value="yes"
                            checked={selectedAnswer === 'yes'}
                            onChange={() => {
                              setQ((prev) => ({
                                ...prev,
                                qualificationAnswers: {
                                  ...prev.qualificationAnswers,
                                  [question.key]: 'yes'
                                }
                              }))
                              setQualificationErrors((prev) => {
                                if (!prev[question.key]) return prev
                                const next = { ...prev }
                                delete next[question.key]
                                return next
                              })
                            }}
                            disabled={!qualificationEditable || isCancellationMode || isViewOnly}
                          />
                          <span>Yes</span>
                        </label>
                        <label className={`qualification-radio ${selectedAnswer === 'no' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name={`qualification-${question.key}`}
                            value="no"
                            checked={selectedAnswer === 'no'}
                            onChange={() => {
                              setQ((prev) => ({
                                ...prev,
                                qualificationAnswers: {
                                  ...prev.qualificationAnswers,
                                  [question.key]: 'no'
                                }
                              }))
                              setQualificationErrors((prev) => {
                                if (!prev[question.key]) return prev
                                const next = { ...prev }
                                delete next[question.key]
                                return next
                              })
                            }}
                            disabled={!qualificationEditable || isCancellationMode || isViewOnly}
                          />
                          <span>No</span>
                        </label>
                      </div>
                      {qualificationErrors[question.key] && <div className="error qualification-error">{qualificationErrors[question.key]}</div>}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </section>
      )}

      {step === 3 && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Primary Named Insured</h3>
          </div>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="Search customer by name, email, or phone..."
              value={primarySearchQuery}
              onChange={(e) => setPrimarySearchQuery(e.target.value)}
              disabled={isViewOnly}
              style={{ width: '100%' }}
            />
          </div>
          {primarySearchResults.length > 0 && (
            <div className="search-results" style={{ marginBottom: 16, border: '1px solid #ddd', borderRadius: 4, padding: 8 }}>
              <div className="muted" style={{ marginBottom: 8, fontSize: '0.9em' }}>Select from results:</div>
              {primarySearchResults.map((result) => (
                <div
                  key={result.id || result.customerKey}
                  className="search-result"
                  onClick={() => { void selectPrimaryInsured(result) }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderBottom: '1px solid #eee', cursor: primarySelecting ? 'wait' : 'pointer', opacity: primarySelecting ? 0.7 : 1 }}
                >
                  <div style={{ flex: 1 }}>
                    <div><strong>{result.displayName || result.name || `${result.firstName || ''} ${result.lastName || ''}`}</strong></div>
                    <div className="muted" style={{ fontSize: '0.85em' }}>{result.email || result.phone || '-'}</div>
                  </div>
                  {canViewCustomerDetails && resolveCustomerLookup(result) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        openCustomerContactView(result)
                      }}
                      disabled={primarySelecting}
                    >
                      View
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {primarySearchLoading && <div className="muted">Searching primary insureds...</div>}
          {primarySelecting && <div className="muted">Loading selected insured details...</div>}
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="table table-no-sticky-head">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>DOB</th>
                  <th>Email</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {(insureds.primary.firstName || '').trim() ? (
                      <button type="button" className="table-link-button" onClick={() => openCustomerContactView(insureds.primary)}>
                        {insureds.primary.firstName}
                      </button>
                    ) : (
                      insureds.primary.firstName || '-'
                    )}
                  </td>
                  <td>
                    {(insureds.primary.lastName || '').trim() ? (
                      <button type="button" className="table-link-button" onClick={() => openCustomerContactView(insureds.primary)}>
                        {insureds.primary.lastName}
                      </button>
                    ) : (
                      insureds.primary.lastName || '-'
                    )}
                  </td>
                  <td>{insureds.primary.dob || '-'}</td>
                  <td>{insureds.primary.email || '-'}</td>
                  <td>{insureds.primary.phone || '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Secondary Named Insured</h3>
          </div>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="Search customer by name, email, or phone..."
              value={secondarySearchQuery}
              onChange={(e) => setSecondarySearchQuery(e.target.value)}
              disabled={isViewOnly}
              style={{ width: '100%' }}
            />
          </div>
          {secondarySearchResults.length > 0 && (
            <div className="search-results" style={{ marginBottom: 16, border: '1px solid #ddd', borderRadius: 4, padding: 8 }}>
              <div className="muted" style={{ marginBottom: 8, fontSize: '0.9em' }}>Select from results:</div>
              {secondarySearchResults.map((result) => (
                <div
                  key={result.id || result.customerKey}
                  className="search-result"
                  onClick={() => { void selectSecondaryInsured(result) }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderBottom: '1px solid #eee', cursor: secondarySelecting ? 'wait' : 'pointer', opacity: secondarySelecting ? 0.7 : 1 }}
                >
                  <div style={{ flex: 1 }}>
                    <div><strong>{result.displayName || result.name || `${result.firstName || ''} ${result.lastName || ''}`}</strong></div>
                    <div className="muted" style={{ fontSize: '0.85em' }}>{result.email || result.phone || '-'}</div>
                  </div>
                  {canViewCustomerDetails && resolveCustomerLookup(result) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        openCustomerContactView(result)
                      }}
                      disabled={secondarySelecting}
                    >
                      View
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {secondarySearchLoading && <div className="muted">Searching secondary insureds...</div>}
          {secondarySelecting && <div className="muted">Loading selected insured details...</div>}
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="table table-no-sticky-head">
              <thead>
                <tr>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>DOB</th>
                  <th>Email</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {(insureds.secondary.firstName || '').trim() ? (
                      <button type="button" className="table-link-button" onClick={() => openCustomerContactView(insureds.secondary)}>
                        {insureds.secondary.firstName}
                      </button>
                    ) : (
                      insureds.secondary.firstName || '-'
                    )}
                  </td>
                  <td>
                    {(insureds.secondary.lastName || '').trim() ? (
                      <button type="button" className="table-link-button" onClick={() => openCustomerContactView(insureds.secondary)}>
                        {insureds.secondary.lastName}
                      </button>
                    ) : (
                      insureds.secondary.lastName || '-'
                    )}
                  </td>
                  <td>{insureds.secondary.dob || '-'}</td>
                  <td>{insureds.secondary.email || '-'}</td>
                  <td>{insureds.secondary.phone || '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="insureds-subsection-header">
            <h3 style={{ margin: 0 }}>Additional Named Insureds</h3>
            {!isViewOnly && (
              <button type="button" className="btn-secondary" onClick={addAdditionalInsured}>
                Add Additional Insured
              </button>
            )}
          </div>
          {!isViewOnly && (
            <div style={{ marginTop: 10, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Search customer by name, email, or phone..."
                value={additionalSearchQuery}
                onChange={(e) => setAdditionalSearchQuery(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          )}
          {additionalSearchResults.length > 0 && (
            <div className="search-results" style={{ marginBottom: 12, border: '1px solid #ddd', borderRadius: 4, padding: 8 }}>
              <div className="muted" style={{ marginBottom: 8, fontSize: '0.9em' }}>Select from results:</div>
              {additionalSearchResults.map((result) => (
                <div
                  key={result.id || result.customerKey}
                  className="search-result"
                  onClick={() => { void selectAdditionalInsured(result) }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderBottom: '1px solid #eee', cursor: additionalSelecting ? 'wait' : 'pointer', opacity: additionalSelecting ? 0.7 : 1 }}
                >
                  <div style={{ flex: 1 }}>
                    <div><strong>{result.displayName || result.name || `${result.firstName || ''} ${result.lastName || ''}`}</strong></div>
                    <div className="muted" style={{ fontSize: '0.85em' }}>{result.email || result.phone || '-'}</div>
                  </div>
                  {canViewCustomerDetails && resolveCustomerLookup(result) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        openCustomerContactView(result)
                      }}
                      disabled={additionalSelecting}
                    >
                      View
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {additionalSearchLoading && <div className="muted">Searching additional insureds...</div>}
          {additionalSelecting && <div className="muted">Loading selected insured details...</div>}
          {(Array.isArray(insureds.additional) ? insureds.additional : []).length === 0 ? (
            <div className="muted" style={{ marginTop: 8 }}>
              No additional named insureds added.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table className="table table-no-sticky-head">
                <thead>
                  <tr>
                    <th>First Name</th>
                    <th>Last Name</th>
                    <th>DOB</th>
                    <th>Email</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(insureds.additional) ? insureds.additional : []).map((item, index) => (
                    <tr key={`additional-insured-${index}`}>
                      <td>
                        {(item.firstName || '').trim() ? (
                          <button type="button" className="table-link-button" onClick={() => openCustomerContactView(item)}>
                            {item.firstName}
                          </button>
                        ) : (
                          item.firstName || '-'
                        )}
                      </td>
                      <td>
                        {(item.lastName || '').trim() ? (
                          <button type="button" className="table-link-button" onClick={() => openCustomerContactView(item)}>
                            {item.lastName}
                          </button>
                        ) : (
                          item.lastName || '-'
                        )}
                      </td>
                      <td>{item.dob || '-'}</td>
                      <td>{item.email || '-'}</td>
                      <td>{item.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {contactDetailPopupOpen && (
            <div className="modal-overlay" role="dialog" aria-modal="true" onClick={clearCustomerContactView}>
              <div className="modal-panel modal-panel-lg" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header">
                  <h3 style={{ margin: 0 }}>Contact Details: {contactDetailTitle || '-'}</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(canViewCustomerInAdmin || canViewCustomerClassic) && contactDetailLookup && (
                      <button type="button" className="btn-secondary" onClick={() => openCustomerContactInPage('view')}>
                        Open Full View
                      </button>
                    )}
                    {canEditCustomerInAdmin && contactDetailLookup && (
                      <button type="button" className="btn-secondary" onClick={() => openCustomerContactInPage('edit')}>
                        Open Edit
                      </button>
                    )}
                    <button type="button" className="btn-secondary" onClick={clearCustomerContactView}>
                      Close
                    </button>
                  </div>
                </div>
                {contactDetailLoading && <div className="muted">Loading contact details...</div>}
                {contactDetailError && !contactDetailLoading && <div className="error">{contactDetailError}</div>}
                {contactDetailRecord && !contactDetailLoading && (
                  <>
                    <div className="row">
                      <div className="col">
                        <label>First Name</label>
                        <div>{String(contactDetailRecord?.identity?.person?.firstName || contactDetailRecord?.firstName || '-')}</div>
                      </div>
                      <div className="col">
                        <label>Last Name</label>
                        <div>{String(contactDetailRecord?.identity?.person?.lastName || contactDetailRecord?.lastName || '-')}</div>
                      </div>
                      <div className="col">
                        <label>DOB</label>
                        <div>{resolveCustomerDob(contactDetailRecord) || '-'}</div>
                      </div>
                      <div className="col">
                        <label>Email</label>
                        <div>{String(preferredContactValue(Array.isArray(contactDetailRecord?.contactPoints) ? contactDetailRecord.contactPoints : [], 'EMAIL') || '-')}</div>
                      </div>
                      <div className="col">
                        <label>Phone</label>
                        <div>{String(preferredContactValue(Array.isArray(contactDetailRecord?.contactPoints) ? contactDetailRecord.contactPoints : [], 'PHONE') || '-')}</div>
                      </div>
                    </div>

                  <div className="ps-table-card" style={{ marginTop: 12 }}>
                    <h4 className="ps-content-card-title" style={{ marginBottom: 8 }}>Addresses</h4>
                    <table className="table table-no-sticky-head">
                      <thead>
                        <tr>
                          <th>Line 1</th>
                          <th>City</th>
                          <th>State</th>
                          <th>Postal</th>
                          <th>Country</th>
                          <th>Primary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(contactDetailRecord?.addresses) ? contactDetailRecord.addresses : []).length === 0 ? (
                          <tr><td colSpan={6} className="muted">No addresses available.</td></tr>
                        ) : (
                          (Array.isArray(contactDetailRecord?.addresses) ? contactDetailRecord.addresses : []).map((item: any, index: number) => (
                            <tr key={`contact-address-${index}`}>
                              <td>{String(item?.line1 || item?.street || '-')}</td>
                              <td>{String(item?.city || '-')}</td>
                              <td>{String(item?.state || '-')}</td>
                              <td>{String(item?.postalCode || item?.zip || '-')}</td>
                              <td>{String(item?.country || '-')}</td>
                              <td>{item?.primary ? 'Yes' : 'No'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            </div>
          )}
        </section>
      )}

      {step === 4 && (
        <section>
          {!q.productCode ? (
            <div className="muted">Select a product in Step 1 to continue.</div>
          ) : q.productCode === 'personal-auto' ? (
            <AutoRiskEditor
              value={q.risks}
              disabled={isCancellationMode || isViewOnly}
              errors={fieldErrors}
              onChange={(nextRisks) => {
                setQ(prev => ({ ...prev, risks: nextRisks }))
                setFieldErrors(validatePersonalAutoVehicles(nextRisks))
              }}
            />
          ) : (
            <DynamicRiskForm
              fields={riskFields}
              value={q}
              disabled={isCancellationMode || isViewOnly}
              onChange={(path, val) => {
                const next = { ...q }
                setByPath(next, path, val)
                setQ(next)
              }}
              onValidate={(errs) => setFieldErrors(errs)}
            />
          )}
        </section>
      )}

      {step === 5 && (
        <section>
          {!q.productCode ? (
            <div className="muted">Select a product in Step 1 to continue.</div>
          ) : (
            <CoverageSelector
              product={q.productCode}
              cfg={cfg}
              value={q.coverages}
              disabled={isCancellationMode || isViewOnly}
              onChange={(c) => setQ(prev => ({ ...prev, coverages: c }))} />
          )}
        </section>
      )}

      {step === 6 && (
        <section>
          <div className="summary-grid">
            <div className="card">
              <div className="card-head">
                <h3>Product & Term</h3>
                <button className="btn-secondary" onClick={() => attemptStepChange(1)} disabled={locked || isCancellationMode || isViewOnly}>Edit</button>
              </div>
              <div className="kvline"><span className="muted">Underwriting Company</span><span>{q.underwritingCompanyName || '-'}</span></div>
              <div className="kvline"><span className="muted">Agency</span><span>{q.agencyName || '-'}</span></div>
              <div className="kvline"><span className="muted">Agency Contact</span><span>{q.agencyContactName || '-'}</span></div>
              <div className="kvline"><span className="muted">Commission %</span><span>{formatCommissionPercent(q.agencyCommissionPct)}</span></div>
              <div className="kvline"><span className="muted">Product</span><span>{q.productCode && isSupportedProductCode(q.productCode) ? productLabel(q.productCode) : (q.productCode || '-')}</span></div>
              <div className="kvline"><span className="muted">Policy Offering</span><span>{q.policyOffering || '-'}</span></div>
              <div className="kvline"><span className="muted">Underwriter</span><span>{q.underwriterName || '-'}</span></div>
              <div className="kvline"><span className="muted">Effective</span><span>{formatDisplayDate(q.effectiveDate, { country: q.country, fallback: '-' })}</span></div>
              <div className="kvline"><span className="muted">Country</span><span>{q.country || '-'}</span></div>
              <div className="kvline"><span className="muted">Term</span><span>{q.termMonths} months</span></div>
              <div className="kvline"><span className="muted">State</span><span>{q.state || '-'}</span></div>
              <div className="kvline"><span className="muted">Prior Policy #</span><span>{q.priorPolicyNumber || '-'}</span></div>
              <div className="kvline"><span className="muted">Prior Carrier</span><span>{q.priorCarrier || '-'}</span></div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Applicant</h3>
                <button className="btn-secondary" onClick={() => attemptStepChange(1)} disabled={locked || isCancellationMode || isViewOnly}>Edit</button>
              </div>
              <div className="kvline"><span className="muted">Name</span><span>{q.applicant.firstName} {q.applicant.lastName}</span></div>
              {q.applicant.email && <div className="kvline"><span className="muted">Email</span><span>{q.applicant.email}</span></div>}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Qualification Questions</h3>
                <button className="btn-secondary" onClick={() => attemptStepChange(2)} disabled={locked || isCancellationMode || isViewOnly}>Edit</button>
              </div>
              {qualificationQuestions.length === 0 && <div className="muted">No qualification questions for selected product.</div>}
              {qualificationQuestions.map((question) => (
                <div className="kvline" key={question.key}>
                  <span className="muted">{question.label}</span>
                  <span>{formatQualificationAnswer(q.qualificationAnswers?.[question.key] || '')}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Insureds</h3>
                <button className="btn-secondary" onClick={() => attemptStepChange(3)} disabled={locked || isCancellationMode || isViewOnly}>Edit</button>
              </div>
              {insureds?.primary && (
                <div>
                  <div className="kvline"><span className="muted">Primary Insured</span><span>{insureds.primary.firstName} {insureds.primary.lastName}</span></div>
                  {insureds.primary.email && <div className="kvline"><span className="muted">Email</span><span>{insureds.primary.email}</span></div>}
                  {insureds.primary.phone && <div className="kvline"><span className="muted">Phone</span><span>{insureds.primary.phone}</span></div>}
                  {formatInsuredAddress(insureds.primary.address) && (
                    <div className="kvline"><span className="muted">Address</span><span>{formatInsuredAddress(insureds.primary.address)}</span></div>
                  )}
                </div>
              )}
              {insureds?.secondary && (
                <div>
                  <div className="kvline"><span className="muted">Secondary Insured</span><span>{insureds.secondary.firstName} {insureds.secondary.lastName}</span></div>
                  {insureds.secondary.email && <div className="kvline"><span className="muted">Email</span><span>{insureds.secondary.email}</span></div>}
                  {insureds.secondary.phone && <div className="kvline"><span className="muted">Phone</span><span>{insureds.secondary.phone}</span></div>}
                </div>
              )}
              {Array.isArray(insureds?.additional) && insureds.additional.length > 0 && (
                <div>
                  <div className="kvline">
                    <span className="muted">Additional Named Insureds</span>
                    <span>{insureds.additional.length}</span>
                  </div>
                  {insureds.additional.map((item, index) => (
                    <div className="kvline" key={`review-additional-insured-${index}`}>
                      <span className="muted">{`Additional ${index + 1}`}</span>
                      <span>{[item.firstName, item.lastName].filter(Boolean).join(' ').trim() || item.displayName || '-'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>{q.productCode === 'personal-auto' ? 'Vehicles' : q.productCode === 'commercial-auto' ? 'Commercial Auto Risk' : q.productCode === 'cyber' ? 'Cyber Risk' : q.productCode === 'professional-liability' ? 'Professional Risk' : 'Risk'}</h3>
                <button className="btn-secondary" onClick={() => attemptStepChange(4)} disabled={locked || isCancellationMode || isViewOnly}>Edit</button>
              </div>
              {!q.productCode ? (
                <div className="muted">No product selected.</div>
              ) : q.productCode === 'personal-auto' ? (
                <>
                  {(Array.isArray(q.risks) ? q.risks : []).length === 0 && <div className="muted">No vehicles added.</div>}
                  {(Array.isArray(q.risks) ? q.risks : []).map((risk: any, index: number) => (
                    <div key={`review-vehicle-${index}`}>
                      <div className="kvline"><span className="muted">{`Vehicle ${index + 1}`}</span><span>{[risk?.year, risk?.make, risk?.model, risk?.trim].filter(Boolean).join(' ') || '-'}</span></div>
                      <div className="kvline"><span className="muted">Body Style</span><span>{formatSelectionLabel(risk?.bodyStyle)}</span></div>
                      <div className="kvline"><span className="muted">VIN</span><span>{risk?.vin || '-'}</span></div>
                      <div className="kvline"><span className="muted">Garaging</span><span>{[risk?.garagingZip, risk?.registrationState].filter(Boolean).join(' / ') || '-'}</span></div>
                      <div className="kvline"><span className="muted">Usage</span><span>{`${formatSelectionLabel(risk?.usage)}${risk?.annualMiles ? ` | ${risk.annualMiles.toLocaleString()} mi/yr` : ''}${risk?.usage === 'commute' && risk?.commuteMiles ? ` | ${risk.commuteMiles} mi commute` : ''}`}</span></div>
                      <div className="kvline"><span className="muted">Ownership</span><span>{formatSelectionLabel(risk?.ownershipType)}</span></div>
                      <div className="kvline"><span className="muted">Principal Driver</span><span>{risk?.principalDriver || '-'}</span></div>
                      {risk?.driverAge != null && <div className="kvline"><span className="muted">Driver Age</span><span>{risk?.driverAge}</span></div>}
                      <div className="kvline"><span className="muted">Underwriting</span><span>{`Damage: ${formatSelectionLabel(risk?.existingDamage)} | Rideshare: ${formatSelectionLabel(risk?.rideshareUse)} | Anti-theft: ${formatSelectionLabel(risk?.antiTheft)}`}</span></div>
                    </div>
                  ))}
                </>
              ) : q.productCode === 'homeowners' ? (
                <>
                  <div className="kvline"><span className="muted">Address</span><span>{q.risks?.[0]?.address}</span></div>
                  <div className="kvline"><span className="muted">Construction</span><span>{q.risks?.[0]?.construction}</span></div>
                  <div className="kvline"><span className="muted">Year Built</span><span>{q.risks?.[0]?.yearBuilt}</span></div>
                  <div className="kvline"><span className="muted">Roof Age</span><span>{q.risks?.[0]?.roofAgeYears} years</span></div>
                  {q.risks?.[0]?.squareFeet != null && (
                    <div className="kvline"><span className="muted">Square Feet</span><span>{q.risks?.[0]?.squareFeet}</span></div>
                  )}
                  {q.risks?.[0]?.protectionClass != null && (
                    <div className="kvline"><span className="muted">Protection Class</span><span>{q.risks?.[0]?.protectionClass}</span></div>
                  )}
                </>
              ) : q.productCode === 'commercial-auto' ? (
                <>
                  <div className="kvline"><span className="muted">Business</span><span>{q.risks?.[0]?.businessName || `${q.applicant?.firstName || ''} ${q.applicant?.lastName || ''}`.trim() || '-'}</span></div>
                  <div className="kvline"><span className="muted">Primary Garaging ZIP</span><span>{q.risks?.[0]?.garagingZip || '-'}</span></div>
                  <div className="kvline"><span className="muted">Vehicle Count</span><span>{q.risks?.[0]?.vehicleCount ?? '-'}</span></div>
                  <div className="kvline"><span className="muted">Driver Count</span><span>{q.risks?.[0]?.driverCount ?? '-'}</span></div>
                  <div className="kvline"><span className="muted">Use Class</span><span>{q.risks?.[0]?.useClass || '-'}</span></div>
                  <div className="kvline"><span className="muted">Operating Radius</span><span>{q.risks?.[0]?.radiusClass || '-'}</span></div>
                  <div className="kvline"><span className="muted">Vehicle Type</span><span>{q.risks?.[0]?.vehicleType || '-'}</span></div>
                  <div className="kvline"><span className="muted">GVW Class</span><span>{q.risks?.[0]?.gvwClass || '-'}</span></div>
                  <div className="kvline"><span className="muted">Annual Mileage</span><span>{formatNumericValue(q.risks?.[0]?.annualMileage) || '-'}</span></div>
                  <div className="kvline"><span className="muted">Years in Business</span><span>{q.risks?.[0]?.yearsInBusiness ?? '-'}</span></div>
                  <div className="kvline"><span className="muted">Prior Losses (3 years)</span><span>{q.risks?.[0]?.priorLossesCount ?? '-'}</span></div>
                </>
              ) : (
                <>
                  <div className="kvline"><span className="muted">Industry</span><span>{q.risks?.[0]?.industry || '-'}</span></div>
                  <div className="kvline"><span className="muted">Annual Revenue</span><span>{formatNumericValue(q.risks?.[0]?.annualRevenue) || '-'}</span></div>
                  <div className="kvline"><span className="muted">Employees</span><span>{q.risks?.[0]?.employeeCount ?? '-'}</span></div>
                  <div className="kvline"><span className="muted">Sensitive Records</span><span>{q.risks?.[0]?.recordsCount ?? '-'}</span></div>
                  <div className="kvline"><span className="muted">MFA Enabled</span><span>{String(q.risks?.[0]?.mfaEnabled || '-')}</span></div>
                  <div className="kvline"><span className="muted">Endpoint Protection</span><span>{String(q.risks?.[0]?.endpointProtection || '-')}</span></div>
                  <div className="kvline"><span className="muted">Backups</span><span>{q.risks?.[0]?.backups || '-'}</span></div>
                  <div className="kvline"><span className="muted">Prior Incidents</span><span>{q.risks?.[0]?.priorIncidents ?? '-'}</span></div>
                  <div className="kvline"><span className="muted">Public-Facing Apps</span><span>{q.risks?.[0]?.publicFacingApps ?? '-'}</span></div>
                  <div className="kvline"><span className="muted">Domain</span><span>{q.risks?.[0]?.domain || '-'}</span></div>
                </>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Coverages</h3>
                <button className="btn-secondary" onClick={() => attemptStepChange(5)} disabled={locked || isCancellationMode || isViewOnly}>Edit</button>
              </div>
              {(q.coverages || []).length === 0 && <div className="muted">No optional coverages selected</div>}
              {(q.coverages || []).map((c:any) => (
                <div className="kvline" key={c.code}>
                  <span className="muted">{coverageName(c.code, cfg)}</span>
                  <span>{coverageSummary(c)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="wizard-rate-row">
            <button onClick={rateQuote} disabled={locked || isRating || wizardMode === 'reinstate' || isViewOnly}>Rate Premium</button>
            {wizardMode === 'reinstate' && <span className="muted">Reinstatement does not require rating.</span>}
            {error && <span className="error">{error}</span>}
          </div>
          {aiInsightsPanel && (
            <div className="card" style={{ marginTop: 12 }}>
              {aiInsightsPanel}
            </div>
          )}
          {aiInsightsPendingBanner}
        </section>
        )}

      {step === 7 && (
        <section>
          {!visiblePremium && wizardMode !== 'reinstate' && !isViewOnly ? (
            <div className="muted">Rate premium in the Rating step to continue.</div>
          ) : (
            <div className="card quote-decision-card">
              {(quoteResp || visibleUnderwriting || visiblePremium) && (
                <>
                  <h3>Underwriting</h3>
                  <div className="kvline"><span className="muted">Decision</span><span>{visibleUnderwriting?.decision || 'Eligible'}</span></div>
                  {Array.isArray(quoteResp?.underwriting?.reasons) && quoteResp.underwriting.reasons.length > 0 && (
                    <div className="block-spaced-sm">
                      <div className="muted">Reasons</div>
                      <ul>
                        {quoteResp.underwriting.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                  {quoteResp?.underwriting && quoteResp.underwriting.decision === 'Refer' && (
                    <div className="block-spaced">
                      {canUwOverride ? (
                        <div className="row">
                          <div className="col">
                            <label>Override Reason (required to bind)</label>
                            <input value={overrideReason} onChange={e=>setOverrideReason(e.target.value)} placeholder="Provide rationale for UW override" disabled={locked || isCancellationMode || isViewOnly} />
                          </div>
                        </div>
                      ) : (
                        <div className="muted">Refer: Contact underwriter to approve; agents cannot bind without override.</div>
                      )}
                    </div>
                  )}
                  <h3>Premium</h3>
                  {visiblePremium?.calcTrace?.source && (
                    <>
                      <div className="kvline"><span className="muted">Rater Source</span><span>{String(visiblePremium.calcTrace.source || '-')}</span></div>
                      <div className="kvline"><span className="muted">Rater Model</span><span>{String(visiblePremium?.calcTrace?.modelCode || '-')}</span></div>
                      <div className="kvline"><span className="muted">Rater Version</span><span>{String(visiblePremium?.calcTrace?.versionLabel || visiblePremium?.calcTrace?.version || '-')}</span></div>
                    </>
                  )}
                  <div className="kvline"><span className="muted">Fees</span><span>{formatMoney(visiblePremium?.fees)}</span></div>
                  <div className="kvline"><span className="muted">Taxes</span><span>{formatMoney(visiblePremium?.taxes)}</span></div>
                  <div className="kvline"><strong>Total</strong><strong>{formatMoney(visiblePremium?.total)}</strong></div>
                  <div className="kvline"><span className="muted">Commission %</span><span>{formatCommissionPercent(q.agencyCommissionPct)}</span></div>
                  <div className="kvline">
                    <span className="muted">Commission Amount</span>
                    <span>{commissionAmountValue == null ? '-' : formatCurrencyAmount(commissionAmountValue, visiblePremium?.total?.currency || 'USD')}</span>
                  </div>
                    {coveragePremiumRows.length > 0 && (
                      <div className="block-spaced-sm">
                        <div className="muted" style={{ marginBottom: 8 }}>Coverage Premium Allocation</div>
                        <table className="table">
                          <thead>
                          <tr>
                            <th>Coverage</th>
                            <th>Premium</th>
                            <th>Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {coveragePremiumRows.map((row, index) => (
                            <tr key={`premium-cov-${row.code}-${index}`}>
                              <td>{row.name && row.name !== row.code ? `${row.code} - ${row.name}` : row.code}</td>
                              <td>{row.amountFormatted}</td>
                              <td>{row.share}</td>
                            </tr>
                          ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {wizardMode === 'endorse' && (visibleRetroAdjustment || visibleTimelineImpact || visibleFullTermImpact) && (
                      <div className="block-spaced-sm">
                        <h3>Effective-Dated Impact</h3>
                        <div className="kvline">
                          <span className="muted">Transaction Effective Date</span>
                          <span>{formatDisplayDate(transactionEffectiveDate, { country: q.country, fallback: '-' })}</span>
                        </div>
                        {visibleFullTermImpact && (
                          <>
                            <div className="kvline">
                              <span className="muted">Full-Term Previous</span>
                              <span>{formatCurrencyAmount(Number(visibleFullTermImpact?.old || 0), visibleFullTermImpact?.currency || visiblePremium?.total?.currency || 'USD')}</span>
                            </div>
                            <div className="kvline">
                              <span className="muted">Full-Term New</span>
                              <span>{formatCurrencyAmount(Number(visibleFullTermImpact?.new || 0), visibleFullTermImpact?.currency || visiblePremium?.total?.currency || 'USD')}</span>
                            </div>
                            <div className="kvline">
                              <span className="muted">Full-Term Delta</span>
                              <span>{formatCurrencyAmount(Number(visibleFullTermImpact?.delta || 0), visibleFullTermImpact?.currency || visiblePremium?.total?.currency || 'USD')}</span>
                            </div>
                          </>
                        )}
                        {visibleRetroAdjustment && (
                          <>
                            <div className="kvline">
                              <span className="muted">Retro Premium Delta</span>
                              <span>{formatCurrencyAmount(Number(visibleRetroAdjustment?.totalDelta || 0), visibleRetroAdjustment?.currency || visiblePremium?.total?.currency || 'USD')}</span>
                            </div>
                            <div className="kvline">
                              <span className="muted">Retro Fees Delta</span>
                              <span>{formatCurrencyAmount(Number(visibleRetroAdjustment?.feesDelta || 0), visibleRetroAdjustment?.currency || visiblePremium?.total?.currency || 'USD')}</span>
                            </div>
                            <div className="kvline">
                              <span className="muted">Retro Taxes Delta</span>
                              <span>{formatCurrencyAmount(Number(visibleRetroAdjustment?.taxesDelta || 0), visibleRetroAdjustment?.currency || visiblePremium?.total?.currency || 'USD')}</span>
                            </div>
                          </>
                        )}
                        {Array.isArray(visibleRetroAdjustment?.impactedSegments) && visibleRetroAdjustment.impactedSegments.length > 0 && (
                          <div className="block-spaced-sm">
                            <div className="muted" style={{ marginBottom: 8 }}>Impacted Time Segments</div>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Segment</th>
                                  <th>Old Premium</th>
                                  <th>New Premium</th>
                                  <th>Pro-Rated Delta</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleRetroAdjustment.impactedSegments.map((segment: any, index: number) => (
                                  <tr key={`retro-segment-${index}`}>
                                    <td>
                                      {formatDisplayDate(segment?.startDate, { country: q.country, fallback: '-' })}
                                      {' -> '}
                                      {formatDisplayDate(segment?.endDate, { country: q.country, fallback: '-' })}
                                    </td>
                                    <td>{formatCurrencyAmount(Number(segment?.oldPremium || 0), visibleRetroAdjustment?.currency || visiblePremium?.total?.currency || 'USD')}</td>
                                    <td>{formatCurrencyAmount(Number(segment?.newPremium || 0), visibleRetroAdjustment?.currency || visiblePremium?.total?.currency || 'USD')}</td>
                                    <td>{formatCurrencyAmount(Number(segment?.proRatedDelta || 0), visibleRetroAdjustment?.currency || visiblePremium?.total?.currency || 'USD')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {Array.isArray(visibleTimelineImpact?.rebasedTransactions) && visibleTimelineImpact.rebasedTransactions.length > 0 && (
                          <div className="block-spaced-sm">
                            <div className="muted" style={{ marginBottom: 8 }}>Out-of-Sequence Rebased Transactions</div>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Transaction #</th>
                                  <th>Type</th>
                                  <th>Effective Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleTimelineImpact.rebasedTransactions.map((item: any, index: number) => (
                                  <tr key={`rebased-tx-${index}`}>
                                    <td>{item?.transactionNumber || item?.versionId || '-'}</td>
                                    <td>{String(item?.transactionType || '-')}</td>
                                    <td>{formatDisplayDate(item?.effectiveDate, { country: q.country, fallback: '-' })}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                    {aiInsightsPanel}
                    {(quoteResp?.underwriting && quoteResp.underwriting.decision === 'Refer') && !canUwOverride && (
                      <div className="block-spaced">
                        <button
                          className="btn-secondary"
                        disabled={locked || isViewOnly}
                        onClick={()=>alert('Submitted for UW review. Please follow up with underwriting.')}
                      >
                        Submit for UW
                      </button>
                    </div>
                  )}
                </>
              )}
              {!visiblePremium && wizardMode === 'reinstate' && (
                <div className="muted">Reinstatement does not require rating. You can issue directly.</div>
              )}
              {boundPolicy && (
                <div className={`issue-status-box ${issued ? 'issued' : 'bound'}`}>
                  <div>
                    Policy <strong>{boundPolicy.policyNumber}</strong> {issued ? 'is issued and locked.' : 'is bound. Click Issue to finalize.'}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {step === 8 && (
        <section>
          <div className="search-subtabs" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={`search-subtab ${formsTab === 'forms' ? 'active' : ''}`}
              onClick={() => setFormsTab('forms')}
            >
              Forms
            </button>
            <button
              type="button"
              className={`search-subtab ${formsTab === 'documents' ? 'active' : ''}`}
              onClick={() => setFormsTab('documents')}
            >
              Documents
            </button>
          </div>

          {formsLoading && <div className="muted">Loading attachment rules...</div>}
          {formsError && <div className="error">{formsError}</div>}

          {formsTab === 'forms' ? (
            <div className="card">
              <h3>Forms</h3>
              <div className="muted wizard-forms-status" style={{ marginBottom: 8 }}>
                Quote: {quoteResp ? 'evaluated' : 'pending'} · Bind: {boundPolicy ? 'evaluated' : 'pending'} · Issue: {issued ? 'evaluated' : 'pending'}
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th data-mobile-label="Stage">Stage</th>
                    <th data-mobile-label="Form #">Form #</th>
                    <th data-mobile-label="Title">Title</th>
                    <th data-mobile-label="Edition">Edition</th>
                    <th data-mobile-label="Placement">Placement</th>
                    <th data-mobile-label="Rules">Rules</th>
                    <th data-mobile-label="Document">Document</th>
                  </tr>
                </thead>
                <tbody>
                  {formsRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">No forms matched configured attachment rules.</td>
                    </tr>
                  )}
                  {formsRows.map(({ stage, item }, index) => (
                    <tr key={`${stage}-${item.formId}-${index}`}>
                      <td>{stage}</td>
                      <td>{item.formNumber || item.formId}</td>
                      <td>{item.formTitle || '-'}</td>
                      <td>{item.editionDate || '-'}</td>
                      <td>{item.packetPlacement || 'End'}</td>
                      <td>{Array.isArray(item.reasons) && item.reasons.length > 0 ? item.reasons.join(' | ') : '-'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void openFormDocument(item.formId)}
                          disabled={!item.formId || documentOpeningFormId === item.formId}
                        >
                          {documentOpeningFormId === item.formId ? 'Opening...' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card">
              <h3>Documents</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th data-mobile-label="Document">Document</th>
                    <th data-mobile-label="Stage">Stage</th>
                    <th data-mobile-label="Status">Status</th>
                    <th data-mobile-label="Action">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {documentRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">No generated documents available for this transaction yet.</td>
                    </tr>
                  )}
                  {documentRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.stage}</td>
                      <td>{row.status}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void openGeneratedDocument(row.id)}
                          disabled={!canOpenGeneratedDocument(row.id, { hasQuoteDocument: Boolean(quoteDocumentModel), hasPremiumDocument: Boolean(visiblePremium), boundPolicy, productCode: q.productCode }) || documentOpeningId === row.id}
                        >
                          {documentOpeningId === row.id ? 'Opening...' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted">Quote summary is generated when premium rating completes.</div>
            </div>
          )}
        </section>
      )}

      {step === steps.length ? (
        <ReviewFooter
          onBack={() => attemptStepChange(Math.max(1, step - 1))}
          canGoBack={isViewOnly || !locked}
          onBind={bindQuote}
          bindDisabled={isReadOnlyView || !!bindDisabledReason || isBinding}
          bindBusy={isBinding}
          bindDisabledReason={bindDisabledReason}
          boundPolicy={boundPolicy}
          onModify={wizardMode === 'quote' && !issued && !isReadOnlyView ? toggleBoundModifyMode : undefined}
          modifyMode={boundModifyMode}
          onIssue={issuePolicy}
          issueDisabled={isReadOnlyView || !!issueDisabledReason || isIssuing}
          issueBusy={isIssuing}
          issueDisabledReason={issueDisabledReason}
          issued={issued}
          onViewPolicy={boundPolicy ? () => navigate(`/policies/${boundPolicy.policyId}`) : undefined}
          onCancelTransaction={isPolicyTransactionMode && !issued && !isReadOnlyView ? cancelPendingTransaction : undefined}
          onCopy={wizardMode === 'quote' && !isReadOnlyView ? copyQuote : undefined}
          copyBusy={copying}
          copyDisabled={wizardMode !== 'quote' || !boundPolicy || copying}
          wizardMode={wizardMode}
          showBind={wizardMode === 'quote' && !isReadOnlyView}
          policyNumber={policyContext?.policyNumber || boundPolicy?.policyNumber}
          transactionLabel={isPolicyTransactionMode ? txLabel : undefined}
          transactionNumber={isPolicyTransactionMode ? transactionNumber : undefined}
          readOnly={isReadOnlyView}
        />
        ) : (
          <WizardNav
            step={step}
            max={steps.length}
            onBack={() => void attemptStepChange(Math.max(1, step - 1))}
            onNext={() => void attemptStepChange(Math.min(steps.length, step + 1))}
            onSaveDraft={!isViewOnly ? () => { void ensureDraftAtStep(step) } : undefined}
            nextDisabled={savingDraft || loadingDraft}
            saveDisabled={savingDraft || loadingDraft}
            saveBusy={savingDraft}
            nextTitle={steps.find((s) => s.id === step + 1)?.title}
          />
        )}
        </div>
      </div>
        </div>
      </div>
    </div>
  )
}

function Stepper({
  steps,
  active,
  allDone = false,
  onSelect
}: {
  steps: { id: number; title: string }[]
  active: number
  allDone?: boolean
  onSelect: (step: number) => void
}) {
  const currentStep = allDone ? steps.length : active
  const progressPct = Math.max(0, Math.min(100, (currentStep / Math.max(steps.length, 1)) * 100))
  return (
    <div className="stepper">
      <div className="stepper-panel">
        <div className="stepper-panel-head">
          <div className="stepper-panel-label">Workflow</div>
          <div className="stepper-panel-count">{currentStep} of {steps.length}</div>
        </div>
        <div className="stepper-progress" aria-hidden="true">
          <span style={{ width: `${progressPct}%` }} />
        </div>
        <div className="stepper-list">
          {steps.map(s => {
            const stepDone = allDone || active > s.id
            return (
              <button
                type="button"
                key={s.id}
                className={`step ${active === s.id ? 'active' : ''} ${stepDone ? 'done' : ''}`}
                onClick={() => onSelect(s.id)}
                aria-current={active === s.id ? 'step' : undefined}
              >
                <span className="bubble" aria-hidden="true">
                  <span className="step-icon">{stepIconForTitle(s.title)}</span>
                </span>
                <div className="step-copy">
                  <div className="step-line">
                    <span className="step-order">{String(s.id).padStart(2, '0')}</span>
                    <div className="label">{s.title}</div>
                  </div>
                  <div className="step-subtitle">{stepSubtitleForTitle(s.title)}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function stepSubtitleForTitle(title: string): string {
  const value = String(title || '').toLowerCase()
  if (value.includes('product')) return 'Transaction details'
  if (value.includes('qualification')) return 'Eligibility & pre-checks'
  if (value.includes('insured')) return 'Named insureds'
  if (value.includes('vehicle')) return 'Vehicle schedule'
  if (value.includes('risk')) return 'Risk details'
  if (value.includes('coverage')) return 'Coverage selections'
  if (value.includes('rating')) return 'Rate and validate'
  if (value.includes('premium')) return 'Premium results'
  if (value.includes('form') || value.includes('document')) return 'Forms and output'
  return 'Step details'
}

function stepIconForTitle(title: string): ReactNode {
  const value = String(title || '').toLowerCase()
  if (value.includes('product')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M2.5 4.5h11v7h-11z" />
        <path d="M5 4.5V3h6v1.5" />
      </svg>
    )
  }
  if (value.includes('qualification')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M8 3.2a3 3 0 1 1-1.3 5.7" />
        <path d="M6.7 8.9 5.2 10.4" />
        <path d="M5.2 10.4H3.8" />
        <path d="M5.2 10.4v1.4" />
      </svg>
    )
  }
  if (value.includes('insured')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M8 8.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" />
        <path d="M3.6 12.7a4.4 4.4 0 0 1 8.8 0" />
      </svg>
    )
  }
  if (value.includes('vehicle')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M3.1 9.8h9.8l-1-3.1H4.1z" />
        <path d="M4.3 11.9a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
        <path d="M11.7 11.9a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
      </svg>
    )
  }
  if (value.includes('coverage')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M8 2.5 12.7 4v3.2c0 2.5-1.6 4.7-4.7 6.3C4.9 11.9 3.3 9.7 3.3 7.2V4z" />
      </svg>
    )
  }
  if (value.includes('rating')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M3.2 10.8a4.8 4.8 0 1 1 9.6 0" />
        <path d="m8 10.8 2.2-2.2" />
      </svg>
    )
  }
  if (value.includes('premium')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M8 3v10" />
        <path d="M10.7 5.1c0-1-1.2-1.8-2.7-1.8s-2.7.8-2.7 1.8 1.2 1.8 2.7 1.8 2.7.8 2.7 1.8-1.2 1.8-2.7 1.8-2.7-.8-2.7-1.8" />
      </svg>
    )
  }
  if (value.includes('form') || value.includes('document')) {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M4 2.8h5l3 3v7.4H4z" />
        <path d="M9 2.8v3h3" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16">
      <path d="M8 8m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0" />
    </svg>
  )
}
function WizardNav({
  step,
  max,
  onBack,
  onNext,
  onSaveDraft,
  nextDisabled,
  saveDisabled,
  saveBusy,
  nextTitle
}: {
  step: number
  max: number
  onBack: () => void
  onNext: () => void
  onSaveDraft?: () => void
  nextDisabled?: boolean
  saveDisabled?: boolean
  saveBusy?: boolean
  nextTitle?: string
}) {
  const nextCta = step >= max ? 'Next' : `Continue to ${nextTitle || 'Next Step'}`
  return (
    <div className="wizard-nav">
      <button type="button" className="btn-secondary wizard-nav-back" onClick={onBack} disabled={step <= 1}>
        ← Back
      </button>
      <div className="wizard-nav-middle">
        {onSaveDraft && (
          <button
            type="button"
            className="btn-secondary wizard-nav-save"
            onClick={onSaveDraft}
            disabled={!!saveDisabled}
          >
            {saveBusy ? 'Saving…' : 'Save Draft'}
          </button>
        )}
        <div className="wizard-nav-progress-dots" aria-hidden="true">
          {Array.from({ length: max }).map((_, index) => (
            <span
              key={`wizard-dot-${index + 1}`}
              className={`wizard-nav-dot ${index + 1 <= step ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>
      <button type="button" className="wizard-nav-next" onClick={onNext} disabled={step >= max || !!nextDisabled}>
        {nextDisabled ? 'Saving…' : nextCta}
      </button>
    </div>
  )}

function ReviewFooter({
  onBack,
  canGoBack,
  onBind,
  bindDisabled,
  bindBusy,
  bindDisabledReason,
  boundPolicy,
  onModify,
  modifyMode = false,
  onIssue,
  issueDisabled,
  issueBusy,
  issueDisabledReason,
  issued,
  onViewPolicy,
  onCancelTransaction,
  onCopy,
  copyDisabled,
  copyBusy,
  wizardMode,
  showBind = true,
  policyNumber,
  transactionLabel,
  transactionNumber,
  readOnly = false
}: {
  onBack: () => void
  canGoBack: boolean
  onBind: () => void
  bindDisabled: boolean
  bindBusy: boolean
  bindDisabledReason: string | null
  boundPolicy: { policyId: string; policyNumber: string } | null
  onModify?: () => void
  modifyMode?: boolean
  onIssue: () => void
  issueDisabled: boolean
  issueBusy: boolean
  issueDisabledReason: string | null
  issued: boolean
  onViewPolicy?: () => void
  onCancelTransaction?: () => void
  onCopy?: () => void
  copyDisabled: boolean
  copyBusy: boolean
  wizardMode: WizardMode
  showBind?: boolean
  policyNumber?: string
  transactionLabel?: string
  transactionNumber?: string
  readOnly?: boolean
}) {
  return (
    <div className="review-footer">
      <button onClick={onBack} disabled={!canGoBack}>Back</button>
      <div className="review-actions">
        {!readOnly && !boundPolicy && showBind ? (
          <div className="review-bind">
            <button onClick={onBind} disabled={bindDisabled}>{bindBusy ? 'Binding…' : 'Bind'}</button>
            {bindDisabledReason && <span className="muted review-feedback">{bindDisabledReason}</span>}
          </div>
        ) : !readOnly && !boundPolicy && !showBind ? (
          <>
            <div className="muted review-feedback">
              Policy #{policyNumber || '—'} is required to issue this {transactionLabel?.toLowerCase() || wizardMode}.
            </div>
            {onCancelTransaction && (
              <button className="btn-secondary" onClick={onCancelTransaction}>
                Cancel Transaction
              </button>
            )}
          </>
        ) : readOnly ? (
          <div className="muted review-feedback">Read-only transaction view.</div>
        ) : null}
        {boundPolicy && (
          <div className="review-policy">
            <div className="review-policy-top">
              <div>
                <div className="review-policy-number">
                  Policy <strong>{boundPolicy.policyNumber}</strong>
                </div>
                <div className="muted review-policy-subtext">
                  {issued ? 'Policy is issued and locked.' : 'Policy is bound. Issue to lock it.'}
                </div>
              </div>
              <div className="review-policy-actions">
                {!issued && !readOnly && onModify && (
                  <button className="btn-secondary" onClick={onModify}>
                    {modifyMode ? 'Done Modifying' : 'Modify'}
                  </button>
                )}
                {!issued && !readOnly && (
                  <button onClick={onIssue} disabled={issueDisabled}>
                    {issueBusy ? 'Issuing…' : 'Issue'}
                  </button>
                )}
                {!issued && !readOnly && onCancelTransaction && (
                  <button className="btn-secondary" onClick={onCancelTransaction}>
                    Cancel Transaction
                  </button>
                )}
                {!readOnly && onCopy && (
                  <button className="btn-secondary" onClick={onCopy} disabled={copyDisabled}>
                    {copyBusy ? 'Copying…' : 'Copy'}
                  </button>
                )}
                {onViewPolicy && (
                  <button className="btn-secondary" onClick={onViewPolicy}>View Policy</button>
                )}
              </div>
            </div>
            {!issued && issueDisabledReason && <span className="muted review-feedback">{issueDisabledReason}</span>}
            {issued && <span className="muted review-feedback">Policy locked</span>}
            {transactionNumber && transactionLabel && (
              <span className="muted review-feedback">{transactionLabel} #{transactionNumber}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DynamicRiskForm({ fields, value, onChange, onValidate, disabled }:{ fields: Field[]; value:any; onChange:(path:string, val:any)=>void; onValidate:(errs:Record<string,string>)=>void; disabled?: boolean }) {
  useEffect(() => { onValidate(validateFields(fields, value)) }, [fields, value])
  return (
    <div className="row dynamic-grid">
      {fields.map(f => (
        <div className="col" key={f.key} style={{ minWidth: 220 }}>
          <label>{f.label}</label>
          {f.type === 'select' ? (
            <select value={String(getByPath(value, f.path) ?? f.options?.[0] ?? '')} onChange={e=>onChange(f.path, e.target.value)} disabled={disabled}>
              {f.options?.map((o:any) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
            </select>
          ) : (
            <input type={f.type === 'number' ? 'number' : 'text'} value={String(getByPath(value, f.path) ?? '')} onChange={e=>onChange(f.path, f.type==='number' ? Number(e.target.value) : e.target.value)} disabled={disabled} />
          )}
          {f.help && <div className="muted">{f.help}</div>}
        </div>
      ))}
    </div>
  )
}

function AutoRiskEditor({
  value,
  onChange,
  disabled,
  errors
}: {
  value: any
  onChange: (v:any)=>void
  disabled?: boolean
  errors?: Record<string, string>
}) {
  const vehicles = Array.isArray(value) && value.length ? value : [defaultAutoRisk()]
  const bodyStyleOptions = ['sedan', 'coupe', 'suv', 'pickup', 'van', 'wagon']
  const ownershipOptions = ['owned', 'financed', 'leased']
  const antiTheftOptions = [
    { value: 'none', label: 'None' },
    { value: 'passive-alarm', label: 'Passive alarm' },
    { value: 'active-alarm', label: 'Active alarm' },
    { value: 'tracking-device', label: 'Tracking device' }
  ]
  const yesNoOptions = [
    { value: 'no', label: 'No' },
    { value: 'yes', label: 'Yes' }
  ]

  function parseNumberInput(raw: string): number | '' {
    return raw === '' ? '' : Number(raw)
  }

  function updateVehicle(index: number, patch: Record<string, any>) {
    const next = vehicles.map((vehicle: any, i: number) => (i === index ? { ...vehicle, ...patch } : vehicle))
    onChange(next)
  }

  function addVehicle() {
    onChange([...vehicles, defaultAutoRisk()])
  }

  function removeVehicle(index: number) {
    if (vehicles.length <= 1) return
    onChange(vehicles.filter((_: any, i: number) => i !== index))
  }

  const fieldError = (index: number, key: string): string => {
    return errors?.[`risks.${index}.${key}`] || ''
  }

  return (
    <div className="auto-risk-editor">
      <div className="auto-risk-toolbar">
        <div className="muted auto-risk-toolbar-copy">
          Capture the core vehicle, garaging, ownership, and underwriting details used for personal auto quoting.
        </div>
        <button type="button" className="btn-secondary" onClick={addVehicle} disabled={disabled}>Add Vehicle</button>
      </div>
      {errors?.['risks.0.vehicle'] && <div className="error">{errors['risks.0.vehicle']}</div>}
      {vehicles.map((vehicle: any, index: number) => {
        const vehicleSummary = [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim].filter(Boolean).join(' ')
        return (
        <div key={`vehicle-${index}`} className="card auto-risk-vehicle-card">
          <div className="auto-risk-vehicle-card-head">
            <div>
              <h4 className="auto-risk-vehicle-title">{`Vehicle ${index + 1}`}</h4>
              <div className="muted auto-risk-vehicle-summary">{vehicleSummary || 'Enter vehicle details'}</div>
            </div>
            {vehicles.length > 1 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => removeVehicle(index)}
                disabled={disabled}
              >
                Remove
              </button>
            )}
          </div>

          <div className="auto-risk-vehicle-section">
            <div className="auto-risk-vehicle-section-title">Vehicle Identification</div>
            <div className="auto-risk-vehicle-grid">
              <div className="auto-risk-field">
              <label>Year</label>
              <input
                type="number"
                value={vehicle.year ?? ''}
                onChange={e=>updateVehicle(index, { year: parseNumberInput(e.target.value) })}
                disabled={disabled}
              />
              {fieldError(index, 'year') && <div className="error">{fieldError(index, 'year')}</div>}
              </div>
              <div className="auto-risk-field">
              <label>Make</label>
              <input
                value={vehicle.make ?? ''}
                onChange={e=>updateVehicle(index, { make: e.target.value })}
                disabled={disabled}
              />
              {fieldError(index, 'make') && <div className="error">{fieldError(index, 'make')}</div>}
              </div>
              <div className="auto-risk-field">
              <label>Model</label>
              <input
                value={vehicle.model ?? ''}
                onChange={e=>updateVehicle(index, { model: e.target.value })}
                disabled={disabled}
              />
              {fieldError(index, 'model') && <div className="error">{fieldError(index, 'model')}</div>}
              </div>
              <div className="auto-risk-field">
                <label>Trim / Series</label>
                <input
                  value={vehicle.trim ?? ''}
                  onChange={e=>updateVehicle(index, { trim: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="auto-risk-field">
                <label>Body Style</label>
                <select
                  value={vehicle.bodyStyle ?? ''}
                  onChange={e=>updateVehicle(index, { bodyStyle: e.target.value })}
                  disabled={disabled}
                >
                  <option value="">Select body style</option>
                  {bodyStyleOptions.map(option => (
                    <option key={`body-style-${option}`} value={option}>{formatSelectionLabel(option)}</option>
                  ))}
                </select>
                {fieldError(index, 'bodyStyle') && <div className="error">{fieldError(index, 'bodyStyle')}</div>}
              </div>
              <div className="auto-risk-field auto-risk-field--wide">
              <label>VIN</label>
              <input
                value={vehicle.vin ?? ''}
                maxLength={17}
                onChange={e=>updateVehicle(index, { vin: e.target.value.toUpperCase().slice(0, 17) })}
                disabled={disabled}
              />
              {fieldError(index, 'vin') && <div className="error">{fieldError(index, 'vin')}</div>}
              </div>
            </div>
          </div>

          <div className="auto-risk-vehicle-section">
            <div className="auto-risk-vehicle-section-title">Garaging And Use</div>
            <div className="auto-risk-vehicle-grid">
              <div className="auto-risk-field">
              <label>Garaging ZIP</label>
              <input
                value={vehicle.garagingZip ?? ''}
                onChange={e=>updateVehicle(index, { garagingZip: e.target.value })}
                disabled={disabled}
              />
              {fieldError(index, 'garagingZip') && <div className="error">{fieldError(index, 'garagingZip')}</div>}
              </div>
              <div className="auto-risk-field">
                <label>Registration State</label>
                <input
                  value={vehicle.registrationState ?? ''}
                  maxLength={2}
                  onChange={e=>updateVehicle(index, { registrationState: e.target.value.toUpperCase().slice(0, 2) })}
                  disabled={disabled}
                />
                {fieldError(index, 'registrationState') && <div className="error">{fieldError(index, 'registrationState')}</div>}
              </div>
              <div className="auto-risk-field">
              <label>Usage</label>
              <select
                value={vehicle.usage ?? 'commute'}
                onChange={e=>updateVehicle(index, {
                  usage: e.target.value,
                  ...(e.target.value === 'commute' ? {} : { commuteMiles: '' })
                })}
                disabled={disabled}
              >
                <option value="pleasure">Pleasure</option>
                <option value="commute">Commute</option>
                <option value="business">Business</option>
              </select>
              {fieldError(index, 'usage') && <div className="error">{fieldError(index, 'usage')}</div>}
              </div>
              <div className="auto-risk-field">
              <label>Annual Miles</label>
              <input
                type="number"
                value={vehicle.annualMiles ?? ''}
                onChange={e=>updateVehicle(index, { annualMiles: parseNumberInput(e.target.value) })}
                disabled={disabled}
              />
              {fieldError(index, 'annualMiles') && <div className="error">{fieldError(index, 'annualMiles')}</div>}
              </div>
              <div className="auto-risk-field">
                <label>Commute Miles (One Way)</label>
                <input
                  type="number"
                  value={vehicle.commuteMiles ?? ''}
                  onChange={e=>updateVehicle(index, { commuteMiles: parseNumberInput(e.target.value) })}
                  disabled={disabled || vehicle.usage !== 'commute'}
                />
                {fieldError(index, 'commuteMiles') && <div className="error">{fieldError(index, 'commuteMiles')}</div>}
              </div>
              <div className="auto-risk-field">
              <label>Driver Age</label>
              <input
                type="number"
                value={vehicle.driverAge ?? ''}
                onChange={e=>updateVehicle(index, { driverAge: parseNumberInput(e.target.value) })}
                disabled={disabled}
              />
              {fieldError(index, 'driverAge') && <div className="error">{fieldError(index, 'driverAge')}</div>}
              </div>
              <div className="auto-risk-field auto-risk-field--wide">
                <label>Principal Driver</label>
                <input
                  value={vehicle.principalDriver ?? ''}
                  onChange={e=>updateVehicle(index, { principalDriver: e.target.value })}
                  disabled={disabled}
                />
                {fieldError(index, 'principalDriver') && <div className="error">{fieldError(index, 'principalDriver')}</div>}
              </div>
            </div>
          </div>

          <div className="auto-risk-vehicle-section">
            <div className="auto-risk-vehicle-section-title">Ownership And Underwriting</div>
            <div className="auto-risk-vehicle-grid">
              <div className="auto-risk-field">
                <label>Ownership</label>
                <select
                  value={vehicle.ownershipType ?? ''}
                  onChange={e=>updateVehicle(index, { ownershipType: e.target.value })}
                  disabled={disabled}
                >
                  <option value="">Select ownership</option>
                  {ownershipOptions.map(option => (
                    <option key={`ownership-${option}`} value={option}>{formatSelectionLabel(option)}</option>
                  ))}
                </select>
                {fieldError(index, 'ownershipType') && <div className="error">{fieldError(index, 'ownershipType')}</div>}
              </div>
              <div className="auto-risk-field">
                <label>Purchase Date</label>
                <input
                  type="date"
                  value={vehicle.purchaseDate ?? ''}
                  onChange={e=>updateVehicle(index, { purchaseDate: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="auto-risk-field">
                <label>Anti-Theft</label>
                <select
                  value={vehicle.antiTheft ?? 'none'}
                  onChange={e=>updateVehicle(index, { antiTheft: e.target.value })}
                  disabled={disabled}
                >
                  {antiTheftOptions.map(option => (
                    <option key={`anti-theft-${option.value}`} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="auto-risk-field">
                <label>Rideshare / Delivery</label>
                <select
                  value={vehicle.rideshareUse ?? 'no'}
                  onChange={e=>updateVehicle(index, { rideshareUse: e.target.value })}
                  disabled={disabled}
                >
                  {yesNoOptions.map(option => (
                    <option key={`rideshare-${option.value}`} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="auto-risk-field">
                <label>Existing Damage</label>
                <select
                  value={vehicle.existingDamage ?? 'no'}
                  onChange={e=>updateVehicle(index, { existingDamage: e.target.value })}
                  disabled={disabled}
                >
                  {yesNoOptions.map(option => (
                    <option key={`damage-${option.value}`} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )})}
    </div>
  )
}

function DwellingRiskEditor({ value, onChange }: { value: any; onChange: (v:any)=>void }) {
  return (
    <div className="row">
      <div className="col">
        <label>Address</label>
        <input value={value.address} onChange={e=>onChange({ ...value, address: e.target.value })} />
      </div>
      <div className="col">
        <label>Construction</label>
        <select value={value.construction} onChange={e=>onChange({ ...value, construction: e.target.value })}>
          <option value="frame">Frame</option>
          <option value="masonry">Masonry</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="col">
        <label>Year Built</label>
        <input type="number" value={value.yearBuilt} onChange={e=>onChange({ ...value, yearBuilt: Number(e.target.value) })} />
      </div>
      <div className="col">
        <label>Roof Age (years)</label>
        <input type="number" value={value.roofAgeYears} onChange={e=>onChange({ ...value, roofAgeYears: Number(e.target.value) })} />
      </div>
      <div className="col">
        <label>Square Feet</label>
        <input type="number" value={value.squareFeet || 1800} onChange={e=>onChange({ ...value, squareFeet: Number(e.target.value) })} />
      </div>
    </div>
  )
}

function CoverageSelector({ product, cfg, value, onChange, disabled }: { product: ProductCode; cfg: any | null; value: any[]; onChange: (v:any[])=>void; disabled?: boolean }) {
  if (!cfg) return <div className="muted">Loading product config...</div>
  const covs = Array.isArray(cfg.coverages) ? cfg.coverages : []
  if (product === 'homeowners') {
    return <HomeownersCoverageEditor cfg={cfg} selections={value} onChange={onChange} disabled={disabled} />
  }
  return <GenericCoverageEditor coverages={covs} selections={value} onChange={onChange} disabled={disabled} />
}

function GenericCoverageEditor({ coverages, selections, onChange, disabled }: { coverages: any[]; selections: any[]; onChange: (v:any[])=>void; disabled?: boolean }) {
  function createSelection(cov: any) {
    if (!cov) return null
    const sel: any = { code: cov.code, selected: true }
    if (Array.isArray(cov.limits) && cov.limits.length > 0) sel.limit = cov.limits[0]
    if (Array.isArray(cov.deductibles) && cov.deductibles.length > 0) sel.deductible = cov.deductibles[0]
    if (Array.isArray(cov.percentOptions) && cov.percentOptions.length > 0) sel.percent = cov.percentOptions[0]
    return sel
  }

  function toggle(code: string) {
    const exists = selections.find((c: any) => c.code === code)
    if (exists) onChange(selections.filter((c: any) => c.code !== code))
    else {
      const cov = coverages.find((x: any) => x.code === code)
      const sel = createSelection(cov)
      if (sel) onChange([...selections.filter((c: any) => c.code !== code), sel])
    }
  }

  function setField(code: string, field: 'limit'|'deductible'|'percent', val: any) {
    const next = selections.map((c: any) => c.code === code ? { ...c, selected: true, [field]: val } : c)
    onChange(next)
  }

  function applyDefaults() {
    const withDefaults = coverages.map(createSelection).filter(Boolean)
    onChange(withDefaults as any[])
  }

  function currentSel(code: string) {
    return selections.find((v: any) => v.code === code) || {}
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button type="button" onClick={applyDefaults} disabled={disabled}>Apply Default Coverages</button>
      </div>
      {coverages.map((c: any) => {
        const sel = currentSel(c.code)
        const selected = sel.selected !== false && Object.keys(sel).length > 0
        return (
          <div key={c.code} className="row" style={{ alignItems: 'end' }}>
            <div className="col">
              <label>{c.name}</label>
              <div>
                <input type="checkbox" checked={selected} onChange={() => toggle(c.code)} disabled={disabled} /> Select
              </div>
            </div>
            {Array.isArray(c.limits) && c.limits.length > 0 && selected && (
              <div className="col">
                <label>Limit</label>
                <select value={String(sel.limit ?? c.limits?.[0] ?? '')} onChange={e=>setField(c.code, 'limit', e.target.value)} disabled={disabled}>
                  {c.limits.map((l: any) => <option key={String(l)} value={String(l)}>{String(l)}</option>)}
                </select>
              </div>
            )}
            {Array.isArray(c.deductibles) && c.deductibles.length > 0 && selected && (
              <div className="col">
                <label>Deductible</label>
                <select value={String(sel.deductible ?? c.deductibles?.[0] ?? '')} onChange={e=>setField(c.code, 'deductible', e.target.value)} disabled={disabled}>
                  {c.deductibles.map((d: any) => <option key={String(d)} value={String(d)}>{String(d)}</option>)}
                </select>
              </div>
            )}
            {Array.isArray(c.percentOptions) && c.percentOptions.length > 0 && selected && (
              <div className="col">
                <label>Percent</label>
                <select value={String(sel.percent ?? c.percentOptions?.[0] ?? '')} onChange={e=>setField(c.code, 'percent', Number(e.target.value))} disabled={disabled}>
                  {c.percentOptions.map((p: any) => <option key={String(p)} value={String(p)}>{String(p)}%</option>)}
                </select>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HomeownersCoverageEditor({ cfg, selections, onChange, disabled }: { cfg: any; selections: any[]; onChange: (v:any[])=>void; disabled?: boolean }) {
  const coverages = Array.isArray(cfg?.coverages) ? cfg.coverages : []
  const byCode = new Map<string, any>(coverages.map((c: any) => [c.code, c]))
  const selectionMap = new Map<string, any>(selections.map((s: any) => [s.code, s]))

  const coverageA = selectionMap.get('A') || hoDefaultSelection(cfg, 'A') || { code: 'A', selected: true, limit: 300000 }
  const baseLimit = toNumber(coverageA.limit, 300000)
  const allPerilOptions: number[] = Array.isArray(cfg?.deductibles?.allPeril) ? cfg.deductibles.allPeril : []
  const windHailOptions: number[] = Array.isArray(cfg?.deductibles?.windHailPercent) ? cfg.deductibles.windHailPercent : []
  const quickLimits = buildDwellingSuggestions(baseLimit)

  function updateCoverage(code: string, updates: Record<string, any>) {
    const existing = selectionMap.get(code)
    const nextSel = { ...(existing || { code, selected: true }), ...updates, code }
    if (updates.selected === false) {
      onChange(removeSelection(selections, code))
      return
    }
    const merged = upsertSelection(selections, { ...nextSel, selected: true })
    const nextBase = code === 'A' ? toNumber(nextSel.limit, baseLimit) : baseLimit
    const recalculated = recalcHoPercentLimits(nextBase, merged, cfg)
    onChange(recalculated)
  }

  function toggleCoverage(code: string, enabled: boolean) {
    if (!enabled) {
      onChange(removeSelection(selections, code))
      return
    }
    const defaults = hoDefaultSelection(cfg, code)
    if (!defaults) return
    const merged = upsertSelection(selections, defaults)
    const recalculated = recalcHoPercentLimits(baseLimit, merged, cfg)
    onChange(recalculated)
  }

  function renderPercentCoverage(code: string) {
    const covCfg = byCode.get(code)
    if (!covCfg) return null
    const existing = selectionMap.get(code)
    const enabled = !!existing
    const percentDefault = Array.isArray(covCfg.percentOptions) && covCfg.percentOptions.length > 0 ? covCfg.percentOptions[0] : 0
    const percent = Number(existing?.percent ?? percentDefault)
    const limitEstimate = baseLimit && percent ? recalcPercentLimit(baseLimit, percent) : null
    return (
      <div key={code} className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="col">
          <label style={{ display:'flex', alignItems:'center', gap: 8 }}>
            <input type="checkbox" checked={enabled} onChange={e => toggleCoverage(code, e.target.checked)} disabled={disabled} />
            {covCfg.name}
          </label>
          {limitEstimate ? <div className="muted">≈ {formatCurrency(limitEstimate)} ({percent}%)</div> : <div className="muted">Select percentage of Coverage A</div>}
        </div>
        {enabled && (
          <div className="col">
            <label>Percent of A</label>
            <select value={String(percent)} onChange={e => updateCoverage(code, { percent: Number(e.target.value) })} disabled={disabled}>
              {covCfg.percentOptions?.map((p: any) => (
                <option key={String(p)} value={String(p)}>{p}%</option>
              ))}
            </select>
          </div>
        )}
      </div>
    )
  }

  function renderLimitCoverage(code: string) {
    const covCfg = byCode.get(code)
    if (!covCfg) return null
    const existing = selectionMap.get(code)
    const enabled = !!existing
    const limits = Array.isArray(covCfg.limits) ? covCfg.limits : []
    const limitValue = existing?.limit ?? limits[0]
    return (
      <div key={code} className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
        <div className="col">
          <label style={{ display:'flex', alignItems:'center', gap: 8 }}>
            <input type="checkbox" checked={enabled} onChange={e => toggleCoverage(code, e.target.checked)} disabled={disabled} />
            {covCfg.name}
          </label>
          <div className="muted">{enabled ? 'Choose desired limit' : 'Optional coverage'}</div>
        </div>
        {enabled && (
          <div className="col">
            <label>Limit</label>
            <select value={String(limitValue ?? '')} onChange={e => updateCoverage(code, { limit: Number(e.target.value) })} disabled={disabled}>
              {limits.map((l: any) => (
                <option key={String(l)} value={String(l)}>{formatCurrency(Number(l))}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ paddingBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Dwelling Coverage A</h3>
        <div className="row">
          <div className="col">
            <label>Limit</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="muted">$</span>
              <input
                type="number"
                value={Math.round(baseLimit)}
                min={50000}
                step={1000}
                onChange={e => updateCoverage('A', { limit: Number(e.target.value) || 0 })}
                disabled={disabled} />
            </div>
            <div className="muted">Estimate replacement cost for the dwelling.</div>
          </div>
          {allPerilOptions.length > 0 && (
            <div className="col">
              <label>All Peril Deductible</label>
              <select
                value={String(coverageA?.deductible ?? allPerilOptions[0])}
                onChange={e => updateCoverage('A', { deductible: Number(e.target.value) })}
                disabled={disabled}>
                {allPerilOptions.map(opt => (
                  <option key={String(opt)} value={String(opt)}>{formatCurrency(opt)}</option>
                ))}
              </select>
            </div>
          )}
          {windHailOptions.length > 0 && (
            <div className="col">
              <label>Wind/Hail Deductible</label>
              <select
                value={String(coverageA?.windHailPercent ?? windHailOptions[0])}
                onChange={e => updateCoverage('A', { windHailPercent: Number(e.target.value) })}
                disabled={disabled}>
                {windHailOptions.map(opt => (
                  <option key={String(opt)} value={String(opt)}>{opt}%</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {quickLimits.map(limit => (
            <button
              type="button"
              key={limit}
              className="btn-secondary"
              style={{ borderColor: baseLimit === limit ? 'var(--accent, #0ea5e9)' : undefined, fontWeight: baseLimit === limit ? 600 : undefined }}
              onClick={() => updateCoverage('A', { limit })}
              disabled={disabled}>
              {formatCurrency(limit)}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ paddingBottom: 8 }}>
        <h3 style={{ marginTop: 0 }}>Property Extensions</h3>
        {['B', 'C', 'D'].map(renderPercentCoverage)}
      </div>

      <div className="card" style={{ paddingBottom: 8 }}>
        <h3 style={{ marginTop: 0 }}>Liability & Medical</h3>
        {['E', 'F'].map(renderLimitCoverage)}
      </div>
    </div>
  )
}
function buildHomeownerDefaults(cfg: any, current: any[]): any[] {
  if (!cfg) return Array.isArray(current) ? current : []
  const coverages = Array.isArray(cfg.coverages) ? cfg.coverages : []
  if (!coverages.length) return Array.isArray(current) ? current : []
  const validCodes = new Set(coverages.map((c: any) => c.code))
  const existing = Array.isArray(current) ? current.filter((c: any) => validCodes.has(c.code)) : []
  const map = new Map<string, any>(existing.map((c: any) => [c.code, { ...c, selected: c.selected !== false }]))
  for (const cov of coverages) {
    if (!map.has(cov.code)) {
      const def = hoDefaultSelection(cfg, cov.code)
      if (def) map.set(cov.code, def)
    }
  }
  const ordered: any[] = []
  for (const cov of coverages) {
    const sel = map.get(cov.code)
    if (sel) ordered.push(sel)
  }
  const baseLimit = toNumber(map.get('A')?.limit, 300000)
  return recalcHoPercentLimits(baseLimit, ordered, cfg)
}

function hoDefaultSelection(cfg: any, code: string): any | null {
  const coverages = Array.isArray(cfg?.coverages) ? cfg.coverages : []
  const cov = coverages.find((c: any) => c.code === code)
  if (!cov) return null
  if (code === 'A') {
    const defaultLimit = 350000
    const deductible = pickFirstNumber(cfg?.deductibles?.allPeril)
    const wind = pickFirstNumber(cfg?.deductibles?.windHailPercent)
    return {
      code,
      selected: true,
      limit: defaultLimit,
      ...(deductible != null ? { deductible } : {}),
      ...(wind != null ? { windHailPercent: wind } : {})
    }
  }
  if (cov.limitAsPercentOf === 'A') {
    const percent = pickFirstNumber(cov.percentOptions, 20) ?? 20
    return {
      code,
      selected: true,
      percent,
      limit: recalcPercentLimit(350000, percent)
    }
  }
  if (Array.isArray(cov.limits) && cov.limits.length > 0) {
    const limitValue = pickFirstNumber(cov.limits, cov.limits[0])
    return { code, selected: true, limit: limitValue }
  }
  return { code, selected: true }
}

function pickFirstNumber(list: any, fallback?: any): number | undefined {
  if (!Array.isArray(list) || list.length === 0) return fallback != null ? Number(fallback) : undefined
  const first = list[0]
  const num = Number(first)
  return Number.isFinite(num) ? num : (fallback != null ? Number(fallback) : undefined)
}

function buildDwellingSuggestions(baseLimit: number): number[] {
  const presets = [250000, 300000, 350000, 400000, 500000, 750000, 1000000]
  if (Number.isFinite(baseLimit) && baseLimit > 0) {
    const rounded = Math.round(baseLimit / 5000) * 5000
    presets.push(rounded)
  }
  const unique = Array.from(new Set(presets.filter(n => Number.isFinite(n) && n > 0))) as number[]
  return unique.sort((a, b) => a - b)
}

function toNumber(value: any, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function upsertSelection(list: any[], entry: any): any[] {
  const filtered = Array.isArray(list) ? list.filter((c: any) => c.code !== entry.code) : []
  return [...filtered, entry]
}

function removeSelection(list: any[], code: string): any[] {
  return Array.isArray(list) ? list.filter((c: any) => c.code !== code) : []
}

function recalcHoPercentLimits(baseLimit: number, selections: any[], cfg: any): any[] {
  const coverages = Array.isArray(cfg?.coverages) ? cfg.coverages : []
  const byCode = new Map<string, any>(coverages.map((c: any) => [c.code, c]))
  return selections.map((sel: any) => {
    const meta = byCode.get(sel.code)
    if (meta?.limitAsPercentOf === 'A') {
      const percent = Number(sel.percent ?? pickFirstNumber(meta.percentOptions, 0))
      const amount = recalcPercentLimit(baseLimit, percent)
      return { ...sel, percent, limit: amount }
    }
    return sel
  })
}

function recalcPercentLimit(base: number, percent: number): number {
  if (!Number.isFinite(base) || !Number.isFinite(percent)) return 0
  return Math.max(0, Math.round((base * percent) / 100))
}

function formatCurrency(amount: number, currency = 'USD'): string {
  if (!Number.isFinite(amount)) return ''
  const abs = Math.abs(amount)
  const opts: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: abs % 1 === 0 ? 0 : 2
  }
  return new Intl.NumberFormat(undefined, opts).format(amount)
}

function formatNumericValue(value: any): string {
  const num = Number(value)
  if (Number.isFinite(num)) return formatCurrency(num)
  return String(value ?? '')
}

function coverageSummary(sel: any): string {
  if (!sel) return ''
  const parts: string[] = []
  if (sel.limit != null && sel.limit !== '') {
    const limitNum = Number(sel.limit)
    const label = Number.isFinite(limitNum) ? formatCurrency(limitNum) : String(sel.limit)
    parts.push('Limit: ' + label)
  }
  if (sel.percent != null && sel.percent !== '') {
    parts.push('Percent: ' + sel.percent + '%')
  }
  if (sel.deductible != null && sel.deductible !== '') {
    parts.push('Deductible: ' + formatNumericValue(sel.deductible))
  }
  if (sel.windHailPercent != null && sel.windHailPercent !== '') {
    parts.push('Wind/Hail: ' + sel.windHailPercent + '%')
  }
  return parts.length ? parts.join(' | ') : 'Selected'
}

function validatePersonalAutoVehicles(risks: any): Record<string, string> {
  const errs: Record<string, string> = {}
  const vehicles = Array.isArray(risks) ? risks : []
  if (!vehicles.length) {
    errs['risks.0.vehicle'] = 'Add at least one vehicle'
    return errs
  }
  vehicles.forEach((risk: any, index: number) => {
    const vin = String(risk?.vin || '').trim()
    const garagingZip = String(risk?.garagingZip || '').trim()
    const registrationState = String(risk?.registrationState || '').trim()
    const requiredStringFields: Array<{ key: string; value: any; message: string }> = [
      { key: 'make', value: risk?.make, message: 'Make is required' },
      { key: 'model', value: risk?.model, message: 'Model is required' },
      { key: 'bodyStyle', value: risk?.bodyStyle, message: 'Body style is required' },
      { key: 'garagingZip', value: garagingZip, message: 'Garaging ZIP is required' },
      { key: 'registrationState', value: registrationState, message: 'Registration state is required' },
      { key: 'usage', value: risk?.usage, message: 'Usage is required' },
      { key: 'ownershipType', value: risk?.ownershipType, message: 'Ownership is required' },
      { key: 'principalDriver', value: risk?.principalDriver, message: 'Principal driver is required' }
    ]
    for (const field of requiredStringFields) {
      if (!String(field.value || '').trim()) {
        errs[`risks.${index}.${field.key}`] = field.message
      }
    }
    const year = Number(risk?.year)
    if (!Number.isFinite(year) || year < 1900 || year > new Date().getFullYear() + 1) {
      errs[`risks.${index}.year`] = 'Enter a valid vehicle year'
    }
    const annualMiles = Number(risk?.annualMiles)
    if (!Number.isFinite(annualMiles) || annualMiles <= 0) {
      errs[`risks.${index}.annualMiles`] = 'Enter annual miles'
    }
    const driverAge = Number(risk?.driverAge)
    if (!Number.isFinite(driverAge) || driverAge < 16 || driverAge > 100) {
      errs[`risks.${index}.driverAge`] = 'Enter a valid driver age'
    }
    if (!vin) {
      errs[`risks.${index}.vin`] = 'VIN is required'
    } else if (vin.length !== 17) {
      errs[`risks.${index}.vin`] = 'VIN must be 17 characters'
    }
    if (garagingZip && !/^\d{5}$/.test(garagingZip)) {
      errs[`risks.${index}.garagingZip`] = 'Enter a 5-digit ZIP'
    }
    if (registrationState && registrationState.length !== 2) {
      errs[`risks.${index}.registrationState`] = 'Use a 2-letter state code'
    }
    if (risk?.usage === 'commute') {
      const commuteMiles = Number(risk?.commuteMiles)
      if (!Number.isFinite(commuteMiles) || commuteMiles <= 0) {
        errs[`risks.${index}.commuteMiles`] = 'Enter commute miles'
      }
    }
  })
  return errs
}

function defaultAutoRisk() {
  return {
    type: 'autoVehicle',
    year: 2018,
    make: 'Toyota',
    model: 'Camry',
    trim: 'LE',
    bodyStyle: 'sedan',
    vin: '',
    garagingZip: '10001',
    registrationState: 'NY',
    usage: 'commute',
    annualMiles: 12000,
    commuteMiles: 12,
    driverAge: 30,
    principalDriver: 'Named insured',
    ownershipType: 'owned',
    purchaseDate: '',
    antiTheft: 'passive-alarm',
    rideshareUse: 'no',
    existingDamage: 'no'
  }
}
function defaultDwellingRisk() {
  return { type: 'dwelling', address: '1 Main St', construction: 'frame', yearBuilt: 2000, roofAgeYears: 10, squareFeet: 1800 }
}

function defaultCyberRisk() {
  return {
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
  }
}

function defaultCommercialAutoRisk() {
  return {
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
  }
}

function defaultProfessionalLiabilityRisk() {
  return {
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
  }
}

function deriveUwAnswers(q: QuoteState): any {
  const answers: Record<string, any> = {}
  if (q.productCode === 'personal-auto') {
    const driverAge = q.risks?.[0]?.driverAge
    if (driverAge != null && driverAge !== '') {
      answers.driverAge = driverAge
    }
  }
  if (q.productCode === 'cyber') {
    const cyberRisk = q.risks?.[0] || {}
    const priorIncidents = Number(cyberRisk?.priorIncidents)
    if (Number.isFinite(priorIncidents)) {
      answers.priorIncidents = priorIncidents
    }
    answers.mfaEnabled =
      String(cyberRisk?.mfaEnabled || '').toLowerCase() === 'true' ||
      String(cyberRisk?.mfaEnabled || '').toLowerCase() === 'yes'
    answers.endpointProtection =
      String(cyberRisk?.endpointProtection || '').toLowerCase() === 'true' ||
      String(cyberRisk?.endpointProtection || '').toLowerCase() === 'yes'
  }
  if (q.productCode === 'commercial-auto') {
    const caRisk = q.risks?.[0] || {}
    const vehicleCount = Number(caRisk?.vehicleCount)
    const driverCount = Number(caRisk?.driverCount)
    const priorLossesCount = Number(caRisk?.priorLossesCount)
    if (Number.isFinite(vehicleCount)) answers.vehicleCount = vehicleCount
    if (Number.isFinite(driverCount)) answers.driverCount = driverCount
    if (Number.isFinite(priorLossesCount)) answers.priorLossesCount = priorLossesCount
    if (caRisk?.radiusClass != null && String(caRisk.radiusClass).trim()) answers.radiusClass = String(caRisk.radiusClass)
    if (caRisk?.useClass != null && String(caRisk.useClass).trim()) answers.useClass = String(caRisk.useClass)
  }
  if (q.productCode === 'professional-liability') {
    const plRisk = q.risks?.[0] || {}
    const priorClaimsCount = Number(plRisk?.priorClaimsCount)
    if (Number.isFinite(priorClaimsCount)) {
      answers.priorClaimsCount = priorClaimsCount
    }
    answers.writtenContracts =
      String(plRisk?.writtenContracts || '').toLowerCase() === 'true' ||
      String(plRisk?.writtenContracts || '').toLowerCase() === 'yes'
    if (plRisk?.qualityControl != null && String(plRisk.qualityControl).trim()) {
      answers.qualityControl = String(plRisk.qualityControl)
    }
  }
  for (const question of qualificationQuestionsForProduct(q.productCode, q.qualificationAnswers)) {
    const response = q.qualificationAnswers?.[question.key]
    if (response === 'yes') answers[question.key] = true
    else if (response === 'no') answers[question.key] = false
  }
  return answers
}

function mergeQuoteState(payload: any, current: QuoteState): QuoteState {
  const applicant = payload?.applicant ? { ...current.applicant, ...payload.applicant } : current.applicant
  const risks = Array.isArray(payload?.risks) && payload.risks.length ? payload.risks : current.risks
  const coverages = Array.isArray(payload?.coverages) ? payload.coverages : current.coverages
  const rawProductCode = payload?.productCode || current.productCode || ''
  const productCode: QuoteProductCode = isSupportedProductCode(rawProductCode) ? rawProductCode : ''
  const rawCountry = String(payload?.country ?? current.country ?? '').trim()
  const country = rawCountry ? normalizeCountryCode(rawCountry) : ''
  const candidateState = normalizeRegionCode(payload?.state ?? current.state ?? '')
  const state = country && candidateState && isRegionInCountry(candidateState, country)
    ? candidateState
    : ''
  const qualificationAnswers = qualificationAnswersFromUw(
    productCode,
    payload?.uwAnswers,
    current.qualificationAnswers
  )
  return {
    productCode,
    effectiveDate: payload?.effectiveDate || current.effectiveDate,
    termMonths: payload?.termMonths ?? current.termMonths,
    country,
    state,
    underwritingCompanyId: payload?.underwritingCompanyId || current.underwritingCompanyId || '',
    underwritingCompanyName: payload?.underwritingCompanyName || current.underwritingCompanyName || '',
    agencyId: payload?.agencyId || current.agencyId || '',
    agencyName: payload?.agencyName || current.agencyName || '',
    agencyContactId: payload?.agencyContactId || current.agencyContactId || '',
    agencyContactName: payload?.agencyContactName || current.agencyContactName || '',
    agencyCommissionPct:
      payload?.agencyCommissionPct != null && String(payload.agencyCommissionPct).trim() !== ''
        ? String(payload.agencyCommissionPct).trim()
        : (current.agencyCommissionPct || ''),
    policyOffering: payload?.policyOffering || current.policyOffering || '',
    underwriterUserId: payload?.underwriterUserId || current.underwriterUserId || '',
    underwriterName: payload?.underwriterName || current.underwriterName || '',
    priorPolicyNumber: payload?.priorPolicyNumber || current.priorPolicyNumber || '',
    priorCarrier: payload?.priorCarrier || current.priorCarrier || '',
    qualificationAnswers,
    applicant,
    risks,
    coverages
  }
}

function mergePayloadWithFallback(primary: any, fallback: any): any {
  const first = (primary && typeof primary === 'object') ? primary : {}
  const second = (fallback && typeof fallback === 'object') ? fallback : {}
  const firstRisks = Array.isArray(first.risks) ? first.risks : []
  const secondRisks = Array.isArray(second.risks) ? second.risks : []
  const firstCoverages = Array.isArray(first.coverages) ? first.coverages : []
  const secondCoverages = Array.isArray(second.coverages) ? second.coverages : []
  return {
    ...second,
    ...first,
    applicant: { ...(second.applicant || {}), ...(first.applicant || {}) },
    uwAnswers: { ...(second.uwAnswers || {}), ...(first.uwAnswers || {}) },
    risks: firstRisks.length ? firstRisks : secondRisks,
    coverages: firstCoverages.length ? firstCoverages : secondCoverages
  }
}

function formatMoney(total: any): string {
  if (!total) return ''
  const amount = typeof total.amount === 'number' ? total.amount : Number(total.amount)
  const currency = total.currency || 'USD'
  if (!isFinite(amount)) return ''
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

function moneyAmountValue(total: any): number {
  if (!total) return 0
  const amount = typeof total.amount === 'number' ? total.amount : Number(total.amount)
  return Number.isFinite(amount) ? amount : 0
}

function parseCommissionPercent(value: any): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(100, parsed))
}

function normalizeCommissionPercentInput(value: any): string {
  const parsed = parseCommissionPercent(value)
  if (parsed == null) return ''
  const fixed = Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2)
  return trimDecimalZeros(fixed)
}

function formatCommissionPercent(value: any): string {
  const parsed = parseCommissionPercent(value)
  if (parsed == null) return '-'
  const normalized = Number.isInteger(parsed) ? String(parsed) : trimDecimalZeros(parsed.toFixed(2))
  return `${normalized}%`
}

function trimDecimalZeros(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

function formatDateForDocument(value: string, country?: string): string {
  return formatDisplayDate(value, { country, fallback: '-' })
}

function formatCurrencyAmount(amount: number, currency = 'USD'): string {
  if (!Number.isFinite(amount)) return '-'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

function formatScorePct(value: any): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return `${(num * 100).toFixed(2)}%`
}

async function loadImageAsPngDataUrl(
  src: string,
  maxWidth: number,
  maxHeight: number
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const naturalWidth = img.naturalWidth || img.width
      const naturalHeight = img.naturalHeight || img.height
      if (!naturalWidth || !naturalHeight) {
        resolve(null)
        return
      }
      const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      resolve({ dataUrl: canvas.toDataURL('image/png'), width, height })
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function coverageAmountValue(item: any): number {
  const value = item?.amount?.amount ?? item?.amount ?? item?.premium
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

import { loadJsPdf } from '../../lib/pdf'

async function buildQuoteSummaryPdf(model: QuoteSummaryDocumentModel): Promise<Blob> {
  const jsPDF = await loadJsPdf()
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginLeft = 40
  const marginRight = 40
  const top = 44
  const bottom = 44
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - marginLeft - marginRight
  const lineHeight = 16
  let y = top

  const ensureSpace = (needed: number): void => {
    if (y + needed <= pageHeight - bottom) return
    doc.addPage()
    y = top
  }

  const textLine = (value: string, size = 11, bold = false): void => {
    ensureSpace(lineHeight)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.text(value, marginLeft, y)
    y += lineHeight
  }

  const sectionTitle = (value: string): void => {
    y += 6
    textLine(value, 13, true)
    y += 2
  }

  const keyValue = (label: string, value: string): void => {
    const labelText = `${label}: `
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    const labelWidth = doc.getTextWidth(labelText)
    const valueLines = doc.splitTextToSize(value || '-', contentWidth - labelWidth - 2)
    ensureSpace(Math.max(valueLines.length * 13, lineHeight))
    doc.text(labelText, marginLeft, y)
    doc.setFont('helvetica', 'normal')
    doc.text(valueLines, marginLeft + labelWidth + 2, y)
    y += Math.max(valueLines.length * 13, lineHeight)
  }

  const table = {
    xCode: marginLeft,
    xCoverage: marginLeft + 74,
    xPremium: marginLeft + 402,
    xShare: marginLeft + 486,
    coverageWidth: 320,
    rowPad: 5
  }

  const drawCoverageHeader = (): void => {
    ensureSpace(20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Code', table.xCode, y)
    doc.text('Coverage', table.xCoverage, y)
    doc.text('Premium', table.xPremium, y)
    doc.text('Share', table.xShare, y)
    y += 6
    doc.setDrawColor(200, 208, 223)
    doc.line(marginLeft, y, pageWidth - marginRight, y)
    y += 12
  }

  const logo = await loadImageAsPngDataUrl(carrierLogo, 170, 52)
  const headerStartY = y
  let textX = marginLeft
  let headerBottomY = headerStartY
  if (logo) {
    ensureSpace(logo.height + 8)
    doc.addImage(logo.dataUrl, 'PNG', marginLeft, headerStartY, logo.width, logo.height)
    textX = marginLeft + logo.width + 14
    headerBottomY = headerStartY + logo.height
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(`${model.product || 'Policy'} Quote Document`, textX, headerStartY + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Generated: ${formatDateForDocument(model.generatedAt)}`, textX, headerStartY + 32)
  doc.text(`Quote #: ${model.quoteNumber}`, textX, headerStartY + 46)
  y = Math.max(headerBottomY, headerStartY + 46) + 14

  sectionTitle('Quote Information')
  keyValue('Insured', model.insuredName)
  keyValue('Underwriting Company', model.underwritingCompany)
  keyValue('Agency', model.agencyName)
  keyValue('Agency Contact', model.agencyContactName)
  keyValue('Product', model.product)
  keyValue('Effective Date', formatDateForDocument(model.effectiveDate, model.country))
  keyValue('Term', `${model.termMonths} months`)
  keyValue('Country', model.country)
  keyValue('State', model.state)

  sectionTitle('Premium Summary')
  keyValue('Base', model.premiumBase)
  keyValue('Fees', model.premiumFees)
  keyValue('Taxes', model.premiumTaxes)
  keyValue('Total', model.premiumTotal)
  keyValue('Commission %', model.commissionPct)
  keyValue('Commission Amount', model.commissionAmount)

  sectionTitle('Coverage Premium Distribution')
  drawCoverageHeader()

  const rows = model.coveragePremiumRows.length
    ? model.coveragePremiumRows
    : [{
      code: '-',
      name: 'No coverage premium components available',
      amount: 0,
      amountFormatted: '-',
      share: '-'
    }]

  for (const row of rows) {
    const wrappedCoverage = doc.splitTextToSize(row.name || '-', table.coverageWidth)
    const rowHeight = Math.max(15, wrappedCoverage.length * 12) + table.rowPad
    ensureSpace(rowHeight + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(row.code || '-', table.xCode, y)
    doc.text(wrappedCoverage, table.xCoverage, y)
    doc.text(row.amountFormatted || '-', table.xPremium, y)
    doc.text(row.share || '-', table.xShare, y)
    y += rowHeight
    doc.setDrawColor(234, 238, 246)
    doc.line(marginLeft, y - 4, pageWidth - marginRight, y - 4)
  }

  sectionTitle('Vehicles')
  ensureSpace(20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Vehicle', marginLeft, y)
  doc.text('VIN', marginLeft + 210, y)
  doc.text('Garaging ZIP', marginLeft + 420, y)
  y += 6
  doc.setDrawColor(200, 208, 223)
  doc.line(marginLeft, y, pageWidth - marginRight, y)
  y += 12
  const vehicleRows = model.vehicles.length ? model.vehicles : [{ vehicleLabel: 'Vehicle', vin: '-', garagingZip: '-' }]
  for (const vehicle of vehicleRows) {
    const vehicleLabelLines = doc.splitTextToSize(vehicle.vehicleLabel || '-', 190)
    const vinLines = doc.splitTextToSize(vehicle.vin || '-', 190)
    const rowHeight = Math.max(vehicleLabelLines.length, vinLines.length, 1) * 12 + 4
    ensureSpace(rowHeight + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(vehicleLabelLines, marginLeft, y)
    doc.text(vinLines, marginLeft + 210, y)
    doc.text(vehicle.garagingZip || '-', marginLeft + 420, y)
    y += rowHeight
    doc.setDrawColor(234, 238, 246)
    doc.line(marginLeft, y - 4, pageWidth - marginRight, y - 4)
  }

  return doc.output('blob')
}

async function buildRatingWorksheetPdf(model: RatingWorksheetDocumentModel): Promise<Blob> {
  const jsPDF = await loadJsPdf()
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginLeft = 40
  const marginRight = 40
  const top = 44
  const bottom = 44
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - marginLeft - marginRight
  const lineHeight = 15
  let y = top

  const ensureSpace = (needed: number): void => {
    if (y + needed <= pageHeight - bottom) return
    doc.addPage()
    y = top
  }

  const textLine = (text: string, opts?: { bold?: boolean; size?: number; x?: number }) => {
    ensureSpace(lineHeight)
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
    doc.setFontSize(opts?.size || 10)
    doc.text(text, opts?.x ?? marginLeft, y)
    y += lineHeight
  }

  const keyValue = (label: string, value: string) => {
    const labelText = `${label}: `
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    const labelWidth = doc.getTextWidth(labelText)
    const wrapped = doc.splitTextToSize(value || '-', contentWidth - labelWidth - 4)
    ensureSpace(Math.max(lineHeight, wrapped.length * 12))
    doc.text(labelText, marginLeft, y)
    doc.setFont('helvetica', 'normal')
    doc.text(wrapped, marginLeft + labelWidth + 4, y)
    y += Math.max(lineHeight, wrapped.length * 12)
  }

  const sectionTitle = (label: string) => {
    y += 6
    ensureSpace(20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(label, marginLeft, y)
    y += 8
  }

  const drawDivider = () => {
    ensureSpace(8)
    doc.setDrawColor(210, 218, 232)
    doc.line(marginLeft, y, pageWidth - marginRight, y)
    y += 10
  }

  const logo = await loadImageAsPngDataUrl(carrierLogo, 160, 48)
  const headerY = y
  let textX = marginLeft
  let headerBottom = headerY
  if (logo) {
    doc.addImage(logo.dataUrl, 'PNG', marginLeft, headerY, logo.width, logo.height)
    textX = marginLeft + logo.width + 14
    headerBottom = headerY + logo.height
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(model.documentTitle, textX, headerY + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Generated: ${formatDateForDocument(model.generatedAt)}`, textX, headerY + 31)
  doc.text(`${model.transactionType} Ref: ${model.quoteOrTransactionNumber}`, textX, headerY + 45)
  y = Math.max(headerBottom, headerY + 45) + 14

  sectionTitle('Policy / Transaction Context')
  keyValue('Policy Number', model.policyNumber || '-')
  keyValue('Product', model.product)
  keyValue('Insured', model.insuredName)
  keyValue('Underwriting Company', model.underwritingCompany)
  keyValue('State / Country', `${model.state} / ${model.country}`)
  keyValue('Policy Effective Date', formatDateForDocument(model.effectiveDate, model.country))
  keyValue('Transaction Effective Date', formatDateForDocument(model.transactionEffectiveDate, model.country))
  keyValue('Term', `${model.termMonths} months`)

  sectionTitle('Rater Metadata')
  keyValue('Rater Source', model.raterSource)
  keyValue('Rater Model', model.raterModelCode)
  keyValue('Rater Version', model.raterVersion)

  sectionTitle('Premium Summary')
  keyValue('Fees', model.premiumFees)
  keyValue('Taxes', model.premiumTaxes)
  keyValue('Total Premium', model.premiumTotal)

  if (model.globalFactorRows.length > 0) {
    sectionTitle('Global Factors')
    for (const item of model.globalFactorRows) {
      keyValue(item.label, item.value)
    }
  }

  sectionTitle('Coverage Rating Formula Worksheet')
  if (!model.coverageFormulaRows.length) {
    textLine('No coverage rating components available.', { size: 10 })
  } else {
    const coverageColumns = [
      { key: 'coverage', label: 'Coverage', width: 118 },
      { key: 'selection', label: 'Selection', width: 102 },
      { key: 'formula', label: 'Formula', width: 112 },
      { key: 'factors', label: 'Factors', width: Math.max(130, contentWidth - (118 + 102 + 112 + 76)) },
      { key: 'premium', label: 'Premium', width: 76 }
    ] as const
    const coverageLineHeight = 10
    const coverageHeaderHeight = 20

    const drawCoverageTableHeader = () => {
      ensureSpace(coverageHeaderHeight + 2)
      doc.setFillColor(243, 246, 252)
      doc.rect(marginLeft, y, contentWidth, coverageHeaderHeight, 'F')
      doc.setDrawColor(210, 218, 232)
      doc.rect(marginLeft, y, contentWidth, coverageHeaderHeight)
      let x = marginLeft
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      for (const col of coverageColumns) {
        doc.text(col.label, x + 4, y + 13)
        x += col.width
        if (x < marginLeft + contentWidth - 0.5) {
          doc.line(x, y, x, y + coverageHeaderHeight)
        }
      }
      y += coverageHeaderHeight
    }

    drawCoverageTableHeader()

    for (const row of model.coverageFormulaRows) {
      const cellValues = [
        `${row.code} - ${row.name}`,
        row.limitOrDeductible || '-',
        row.formula || '-',
        row.factorSummary || '-',
        row.amountFormatted || '-'
      ]
      const cellLines = coverageColumns.map((col, index) =>
        doc.splitTextToSize(cellValues[index], Math.max(20, col.width - 8))
      )
      const rowHeight = Math.max(...cellLines.map((lines) => Math.max(lines.length, 1))) * coverageLineHeight + 8

      if (y + rowHeight > pageHeight - bottom) {
        doc.addPage()
        y = top
        drawCoverageTableHeader()
      }

      doc.setDrawColor(226, 232, 242)
      doc.rect(marginLeft, y, contentWidth, rowHeight)
      let x = marginLeft
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      coverageColumns.forEach((col, index) => {
        const lines = cellLines[index]
        doc.text(lines, x + 4, y + 10)
        x += col.width
        if (x < marginLeft + contentWidth - 0.5) {
          doc.line(x, y, x, y + rowHeight)
        }
      })
      y += rowHeight
    }
    y += 4
  }

  if (model.calcTraceJson) {
    sectionTitle('Calculation Trace')

    type TraceTableRow = { field: string; value: string }
    const traceRows: TraceTableRow[] = []
    const maxTraceRows = 400

    const pushTraceRow = (field: string, value: any) => {
      if (traceRows.length >= maxTraceRows) return
      let text = '-'
      if (value === null || value === undefined) {
        text = '-'
      } else if (typeof value === 'string') {
        text = value || '-'
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        text = String(value)
      } else {
        try {
          text = JSON.stringify(value)
        } catch {
          text = String(value)
        }
      }
      traceRows.push({ field: field || '-', value: text })
    }

    const flattenTrace = (value: any, path: string) => {
      if (traceRows.length >= maxTraceRows) return
      if (value === null || value === undefined) {
        pushTraceRow(path, value)
        return
      }
      if (Array.isArray(value)) {
        if (!value.length) {
          pushTraceRow(path, '[]')
          return
        }
        value.forEach((item, index) => {
          const nextPath = `${path}[${index}]`
          if (item && typeof item === 'object') {
            flattenTrace(item, nextPath)
          } else {
            pushTraceRow(nextPath, item)
          }
        })
        return
      }
      if (typeof value === 'object') {
        const entries = Object.entries(value)
        if (!entries.length) {
          pushTraceRow(path, '{}')
          return
        }
        for (const [key, child] of entries) {
          const nextPath = path ? `${path}.${key}` : key
          if (child && typeof child === 'object') {
            flattenTrace(child, nextPath)
          } else {
            pushTraceRow(nextPath, child)
          }
          if (traceRows.length >= maxTraceRows) break
        }
        return
      }
      pushTraceRow(path, value)
    }

    flattenTrace(model.calcTraceJson, '')
    if (traceRows.length >= maxTraceRows) {
      traceRows.push({ field: '...', value: 'Trace rows truncated for document preview' })
    }

    const fieldColWidth = 210
    const valueColWidth = contentWidth - fieldColWidth - 12

    ensureSpace(24)
    doc.setFillColor(243, 246, 252)
    doc.rect(marginLeft, y, contentWidth, 20, 'F')
    doc.setDrawColor(210, 218, 232)
    doc.rect(marginLeft, y, contentWidth, 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('Field', marginLeft + 6, y + 13)
    doc.text('Value', marginLeft + fieldColWidth + 12, y + 13)
    y += 20

    for (const row of traceRows) {
      const fieldLines = doc.splitTextToSize(row.field || '-', fieldColWidth - 8)
      const valueLines = doc.splitTextToSize(row.value || '-', valueColWidth - 8)
      const rowHeight = Math.max(fieldLines.length, valueLines.length, 1) * 11 + 8
      ensureSpace(rowHeight)
      doc.setDrawColor(226, 232, 242)
      doc.rect(marginLeft, y, contentWidth, rowHeight)
      doc.line(marginLeft + fieldColWidth, y, marginLeft + fieldColWidth, y + rowHeight)
      doc.setFont('courier', 'normal')
      doc.setFontSize(8)
      doc.text(fieldLines, marginLeft + 4, y + 11)
      doc.text(valueLines, marginLeft + fieldColWidth + 8, y + 11)
      y += rowHeight
    }

    doc.setFont('helvetica', 'normal')
  }

  return doc.output('blob')
}

function addMonthsToIsoDate(value: string, months: number): string {
  const raw = String(value || '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return raw
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return raw
  const dt = new Date(Date.UTC(year, month - 1, day))
  dt.setUTCMonth(dt.getUTCMonth() + Math.max(1, Number(months) || 12))
  return dt.toISOString().slice(0, 10)
}

function buildVehicleCards(state: QuoteState): PolicyVehicleCard[] {
  const risks = Array.isArray(state.risks) ? state.risks : []
  const cards = risks
    .filter((risk: any) => risk && typeof risk === 'object')
    .map((risk: any) => {
      const vehicleLabel = [risk.year, risk.make, risk.model]
        .map((v: any) => String(v ?? '').trim())
        .filter(Boolean)
        .join(' ')
      const vin = String(risk.vin || risk.vehicleVin || risk.vinNumber || '-').trim() || '-'
      const garagingZip = String(risk.garagingZip || risk.zip || '-').trim() || '-'
      return {
        vehicleLabel: vehicleLabel || 'Vehicle',
        vin,
        garagingZip
      }
    })
  return cards.length ? cards : [{ vehicleLabel: 'Vehicle', vin: '-', garagingZip: '-' }]
}

function canOpenGeneratedDocument(
  documentId: string,
  context: {
    hasQuoteDocument: boolean
    hasPremiumDocument: boolean
    boundPolicy: { policyId: string; policyNumber: string } | null
    productCode: QuoteProductCode
  }
): boolean {
  if (documentId === 'rating-worksheet') return context.hasPremiumDocument
  if (documentId === 'quote-summary') return context.hasQuoteDocument
  if (documentId === 'policy-pocket' || documentId === 'id-cards') {
    return Boolean(context.boundPolicy && context.productCode === 'personal-auto')
  }
  return false
}

async function buildPolicyPacketPdf(model: PolicyPacketDocumentModel): Promise<Blob> {
  const jsPDF = await loadJsPdf()
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginLeft = 40
  const marginRight = 40
  const top = 44
  const bottom = 44
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - marginLeft - marginRight
  const lineHeight = 16
  let y = top

  const ensureSpace = (needed: number): void => {
    if (y + needed <= pageHeight - bottom) return
    doc.addPage()
    y = top
  }

  const keyValue = (label: string, value: string): void => {
    const labelText = `${label}: `
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    const labelWidth = doc.getTextWidth(labelText)
    const valueLines = doc.splitTextToSize(value || '-', contentWidth - labelWidth - 2)
    ensureSpace(Math.max(valueLines.length * 13, lineHeight))
    doc.text(labelText, marginLeft, y)
    doc.setFont('helvetica', 'normal')
    doc.text(valueLines, marginLeft + labelWidth + 2, y)
    y += Math.max(valueLines.length * 13, lineHeight)
  }

  const sectionTitle = (value: string): void => {
    y += 8
    ensureSpace(22)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(value, marginLeft, y)
    y += 8
  }

  const logo = await loadImageAsPngDataUrl(carrierLogo, 170, 52)
  const headerStartY = y
  let textX = marginLeft
  let headerBottomY = headerStartY
  if (logo) {
    ensureSpace(logo.height + 8)
    doc.addImage(logo.dataUrl, 'PNG', marginLeft, headerStartY, logo.width, logo.height)
    textX = marginLeft + logo.width + 14
    headerBottomY = headerStartY + logo.height
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Personal Auto Policy Packet', textX, headerStartY + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Generated: ${formatDateForDocument(model.generatedAt)}`, textX, headerStartY + 32)
  doc.text(`Policy #: ${model.policyNumber}`, textX, headerStartY + 46)
  y = Math.max(headerBottomY, headerStartY + 46) + 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const notice = doc.splitTextToSize(
    'ISO-style policy packet template for operational use. Official filed/approved policy language should come from your licensed form library.',
    contentWidth
  )
  ensureSpace(notice.length * 12 + 4)
  doc.text(notice, marginLeft, y)
  y += notice.length * 12 + 2

  sectionTitle('Policy Summary')
  keyValue('Insured', model.insuredName)
  keyValue('Quote Number', model.quoteNumber)
  keyValue('Underwriting Company', model.underwritingCompany)
  keyValue('Agency', model.agencyName)
  keyValue('Agency Contact', model.agencyContactName)
  keyValue('Product', model.product)
  keyValue('State/Country', `${model.state} / ${model.country}`)
  keyValue('Policy Effective', formatDateForDocument(model.effectiveDate, model.country))
  keyValue('Policy Expiration', formatDateForDocument(model.expirationDate, model.country))
  keyValue('Total Premium', model.premiumTotal)
  keyValue('Commission %', model.commissionPct)
  keyValue('Commission Amount', model.commissionAmount)

  sectionTitle('Coverage Schedule')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const covCols = { code: marginLeft, name: marginLeft + 70, details: marginLeft + 250 }
  doc.text('Code', covCols.code, y)
  doc.text('Coverage', covCols.name, y)
  doc.text('Limit / Deductible / Options', covCols.details, y)
  y += 6
  doc.setDrawColor(200, 208, 223)
  doc.line(marginLeft, y, pageWidth - marginRight, y)
  y += 12

  const coverageRows = model.coverageRows.length
    ? model.coverageRows
    : [{ code: '-', name: 'No selected coverage', details: '-' }]
  for (const row of coverageRows) {
    const nameLines = doc.splitTextToSize(row.name || '-', 165)
    const detailsLines = doc.splitTextToSize(row.details || '-', 250)
    const rowHeight = Math.max(nameLines.length, detailsLines.length, 1) * 12 + 4
    ensureSpace(rowHeight + 4)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(row.code || '-', covCols.code, y)
    doc.text(nameLines, covCols.name, y)
    doc.text(detailsLines, covCols.details, y)
    y += rowHeight
    doc.setDrawColor(234, 238, 246)
    doc.line(marginLeft, y - 4, pageWidth - marginRight, y - 4)
  }

  sectionTitle('Included ID Cards')
  for (const card of model.idCards) {
    ensureSpace(84)
    const cardTop = y
    const cardHeight = 72
    doc.setDrawColor(72, 104, 176)
    doc.roundedRect(marginLeft, cardTop, contentWidth, cardHeight, 6, 6, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('AUTO INSURANCE IDENTIFICATION CARD', marginLeft + 10, cardTop + 16)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Policy: ${model.policyNumber}`, marginLeft + 10, cardTop + 32)
    doc.text(`Vehicle: ${card.vehicleLabel}`, marginLeft + 10, cardTop + 46)
    doc.text(`VIN: ${card.vin}`, marginLeft + 10, cardTop + 60)
    doc.text(`Effective: ${formatDateForDocument(model.effectiveDate, model.country)}  Expiration: ${formatDateForDocument(model.expirationDate, model.country)}`, marginLeft + 300, cardTop + 32)
    doc.text(`State: ${model.state}  Garaging ZIP: ${card.garagingZip}`, marginLeft + 300, cardTop + 46)
    doc.text(`Company: ${model.underwritingCompany}`, marginLeft + 300, cardTop + 60)
    y += cardHeight + 12
  }

  return doc.output('blob')
}

async function buildPolicyIdCardsPdf(model: PolicyIdCardsDocumentModel): Promise<Blob> {
  const jsPDF = await loadJsPdf()
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginLeft = 40
  const marginRight = 40
  const top = 44
  const bottom = 44
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const cardWidth = pageWidth - marginLeft - marginRight
  const cardHeight = 156
  let y = top

  const ensureSpace = (needed: number): void => {
    if (y + needed <= pageHeight - bottom) return
    doc.addPage()
    y = top
  }

  const logo = await loadImageAsPngDataUrl(carrierLogo, 130, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Policy ID Cards', marginLeft, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Generated: ${formatDateForDocument(model.generatedAt)}`, pageWidth - marginRight - 170, y)
  y += 18
  doc.text(`Policy #: ${model.policyNumber}`, marginLeft, y)
  y += 20

  const vehicles = model.vehicles.length ? model.vehicles : [{ vehicleLabel: 'Vehicle', vin: '-', garagingZip: '-' }]
  for (const vehicle of vehicles) {
    ensureSpace(cardHeight + 10)
    const topY = y
    doc.setDrawColor(72, 104, 176)
    doc.roundedRect(marginLeft, topY, cardWidth, cardHeight, 8, 8, 'S')
    if (logo) {
      doc.addImage(logo.dataUrl, 'PNG', marginLeft + 10, topY + 10, logo.width, logo.height)
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('AUTO INSURANCE IDENTIFICATION CARD', marginLeft + 160, topY + 26)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Insured: ${model.insuredName}`, marginLeft + 14, topY + 58)
    doc.text(`Policy Number: ${model.policyNumber}`, marginLeft + 14, topY + 74)
    doc.text(`Vehicle: ${vehicle.vehicleLabel}`, marginLeft + 14, topY + 90)
    doc.text(`VIN: ${vehicle.vin}`, marginLeft + 14, topY + 106)
    doc.text(`Company: ${model.underwritingCompany}`, marginLeft + 14, topY + 122)
    doc.text(`Effective: ${formatDateForDocument(model.effectiveDate, model.country)}  Expiration: ${formatDateForDocument(model.expirationDate, model.country)}`, marginLeft + 300, topY + 74)
    doc.text(`State: ${model.state}`, marginLeft + 300, topY + 90)
    doc.text(`Garaging ZIP: ${vehicle.garagingZip}`, marginLeft + 300, topY + 106)
    y += cardHeight + 14
  }

  return doc.output('blob')
}

function getByPath(obj:any, path:string) {
  return path.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj)
}

function coverageName(code: string, cfg: any): string {
  const covs = Array.isArray(cfg?.coverages) ? cfg.coverages : []
  const found = covs.find((c: any) => c.code === code)
  return found?.name || code
}
