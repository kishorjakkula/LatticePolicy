import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  varchar,
  uuid,
  date,
  smallint,
  char,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------
export const tenants = pgTable('tenants', {
  tenantId: text('tenant_id').primaryKey(),
  name: text('name').notNull(),
  defaultLocale: text('default_locale'),
  defaultCurrency: char('default_currency', { length: 3 }),
  mfaRequired: boolean('mfa_required').notNull().default(false),
  customerKeyPattern: text('customer_key_pattern').notNull().default('CUST-{YYYY}-{SEQ6}'),
  customerValidationConfig: jsonb('customer_validation_config').notNull().default(sql`'{}'::jsonb`),
  customerWorkflowConfig: jsonb('customer_workflow_config').notNull().default(sql`'{}'::jsonb`),
  onboardingConfig: jsonb('onboarding_config').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  userId: uuid('user_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  disabled: boolean('disabled').notNull().default(false),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecret: text('mfa_secret'),
  customerId: uuid('customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.userId, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleCode] }),
])

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------
export const parties = pgTable('parties', {
  partyId: uuid('party_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: jsonb('name'),
  org: jsonb('org'),
  status: text('status'),
  ext: jsonb('ext'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const partyContacts = pgTable('party_contacts', {
  contactId: uuid('contact_id').primaryKey().default(sql`uuid_generate_v4()`),
  partyId: uuid('party_id').notNull().references(() => parties.partyId, { onDelete: 'cascade' }),
  contactType: text('contact_type').notNull(),
  contactValue: text('contact_value').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  metadata: jsonb('metadata'),
})

export const partyLicenses = pgTable('party_licenses', {
  licenseId: uuid('license_id').primaryKey().default(sql`uuid_generate_v4()`),
  partyId: uuid('party_id').notNull().references(() => parties.partyId, { onDelete: 'cascade' }),
  licenseType: text('license_type').notNull(),
  licenseNumber: text('license_number').notNull(),
  jurisdictionCode: text('jurisdiction_code'),
  expiresOn: date('expires_on'),
  metadata: jsonb('metadata'),
})

export const partyRoles = pgTable('party_roles', {
  partyRoleId: uuid('party_role_id').primaryKey().default(sql`uuid_generate_v4()`),
  partyId: uuid('party_id').notNull().references(() => parties.partyId, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull(),
  metadata: jsonb('metadata'),
})

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------
export const policies = pgTable('policies', {
  policyId: uuid('policy_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyNumber: varchar('policy_number', { length: 40 }),
  status: text('status').notNull().default('Quote'),
  productCode: text('product_code').notNull(),
  productVersion: text('product_version'),
  jurisdictionCode: text('jurisdiction_code'),
  jurisdiction: jsonb('jurisdiction'),
  term: jsonb('term'),
  termEffectiveDate: date('term_effective_date').notNull(),
  termExpirationDate: date('term_expiration_date').notNull(),
  termType: text('term_type'),
  currencyCode: char('currency_code', { length: 3 }),
  currency: jsonb('currency'),
  lifecycle: jsonb('lifecycle'),
  externalIds: jsonb('external_ids'),
  insuredPartyId: uuid('insured_party_id').references(() => parties.partyId),
  premiumSummary: jsonb('premium_summary'),
  riskSummary: jsonb('risk_summary'),
  formsSummary: jsonb('forms_summary'),
  documentsSummary: jsonb('documents_summary'),
  auditLog: jsonb('audit_log'),
  metadata: jsonb('metadata'),
  nonRenewedAt: date('non_renewed_at'),
  nonRenewalReason: text('non_renewal_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const policyParties = pgTable('policy_parties', {
  policyPartyId: uuid('policy_party_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  partyId: uuid('party_id').notNull().references(() => parties.partyId, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull(),
  relationship: text('relationship'),
  isPrimary: boolean('is_primary').notNull().default(false),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const policyRoleAssignments = pgTable('policy_role_assignments', {
  assignmentId: uuid('assignment_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  partyId: uuid('party_id').notNull().references(() => parties.partyId, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull(),
  permissions: text('permissions').array().notNull().default(sql`ARRAY[]::text[]`),
  scope: jsonb('scope'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid('granted_by'),
  metadata: jsonb('metadata'),
})

// ---------------------------------------------------------------------------
// Policy Transactions
// ---------------------------------------------------------------------------
export const policyTransactions = pgTable('policy_transactions', {
  transactionId: uuid('transaction_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').notNull(),
  jurisdiction: jsonb('jurisdiction'),
  term: jsonb('term'),
  requestedChanges: jsonb('requested_changes').notNull().default(sql`'[]'::jsonb`),
  snapshot: jsonb('snapshot'),
  ratingId: uuid('rating_id'),
  uw: jsonb('uw'),
  notes: jsonb('notes'),
  forms: jsonb('forms'),
  documents: jsonb('documents'),
  effectiveDate: date('effective_date'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  sequenceNo: integer('sequence_no'),
  baseTimelineVersion: integer('base_timeline_version'),
  timelineVersion: integer('timeline_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
})

// ---------------------------------------------------------------------------
// Policy Versions
// ---------------------------------------------------------------------------
export const policyVersions = pgTable('policy_versions', {
  versionId: uuid('version_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').references(() => policyTransactions.transactionId, { onDelete: 'set null' }),
  effectiveDate: date('effective_date').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  transactionType: text('transaction_type').notNull(),
  premiumTotal: numeric('premium_total', { precision: 14, scale: 2 }),
  premiumFees: numeric('premium_fees', { precision: 14, scale: 2 }),
  premiumTaxes: numeric('premium_taxes', { precision: 14, scale: 2 }),
  currency: char('currency', { length: 3 }),
  uwDecision: text('uw_decision'),
  uwOverride: boolean('uw_override'),
  overrideReason: text('override_reason'),
  calcTrace: jsonb('calc_trace'),
  payload: jsonb('payload'),
  transactionNumber: text('transaction_number'),
  baseTimelineVersion: integer('base_timeline_version'),
  timelineVersion: integer('timeline_version'),
  cancellationReasonCode: text('cancellation_reason_code'),
  cancellationType: text('cancellation_type'),
  returnPremiumAmount: numeric('return_premium_amount', { precision: 14, scale: 2 }),
})

export const policyVersionChanges = pgTable('policy_version_changes', {
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => policyVersions.versionId, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  old: jsonb('old'),
  new: jsonb('new'),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.policyId, t.versionId, t.path] }),
])

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------
export const ratings = pgTable('ratings', {
  ratingId: uuid('rating_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').notNull().references(() => policyTransactions.transactionId, { onDelete: 'cascade' }),
  inputs: jsonb('inputs'),
  components: jsonb('components'),
  discounts: jsonb('discounts'),
  surcharges: jsonb('surcharges'),
  taxes: jsonb('taxes'),
  totalPremium: numeric('total_premium', { precision: 14, scale: 2 }),
  currencyCode: char('currency_code', { length: 3 }),
  calcTrace: jsonb('calc_trace'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Risk Units
// ---------------------------------------------------------------------------
export const riskUnits = pgTable('risk_units', {
  riskUnitId: uuid('risk_unit_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').references(() => policyTransactions.transactionId, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  attributes: jsonb('attributes').notNull(),
  effectiveDate: date('effective_date'),
  expirationDate: date('expiration_date'),
  metadata: jsonb('metadata'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Auto Vehicles (from migration 005)
// ---------------------------------------------------------------------------
export const autoVehicles = pgTable('auto_vehicles', {
  vehicleId: uuid('vehicle_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => policyVersions.versionId, { onDelete: 'cascade' }),
  year: smallint('year'),
  make: text('make'),
  model: text('model'),
  vin: text('vin'),
  symbol: text('symbol'),
  garagingZip: text('garaging_zip'),
  usage: text('usage'),
  annualMiles: integer('annual_miles'),
  driverAge: integer('driver_age'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Dwellings (from migration 005)
// ---------------------------------------------------------------------------
export const dwellings = pgTable('dwellings', {
  dwellingId: uuid('dwelling_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => policyVersions.versionId, { onDelete: 'cascade' }),
  address: jsonb('address'),
  construction: text('construction'),
  protectionClass: integer('protection_class'),
  yearBuilt: integer('year_built'),
  roofAgeYears: integer('roof_age_years'),
  squareFeet: integer('square_feet'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Coverages
// ---------------------------------------------------------------------------
export const coverageDefinitions = pgTable('coverage_definitions', {
  definitionId: uuid('definition_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  code: text('code').notNull(),
  product: text('product').notNull(),
  version: text('version').notNull().default('1.0.0'),
  title: text('title'),
  appliesTo: text('applies_to'),
  limitModel: jsonb('limit_model'),
  deductibleModel: jsonb('deductible_model'),
  ratingHooks: text('rating_hooks').array(),
  formHooks: text('form_hooks').array(),
  ui: jsonb('ui'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const coverages = pgTable('coverages', {
  coverageId: uuid('coverage_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').references(() => policyTransactions.transactionId, { onDelete: 'set null' }),
  riskUnitId: uuid('risk_unit_id').references(() => riskUnits.riskUnitId),
  appliesTo: text('applies_to'),
  definitionCode: text('definition_code').notNull(),
  limits: jsonb('limits'),
  deductibles: jsonb('deductibles'),
  options: jsonb('options'),
  selected: boolean('selected').notNull().default(true),
  effectiveDate: date('effective_date'),
  expirationDate: date('expiration_date'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const coverageSelections = pgTable('coverage_selections', {
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => policyVersions.versionId, { onDelete: 'cascade' }),
  coverageCode: text('coverage_code').notNull(),
  selected: boolean('selected').notNull().default(true),
  limitValue: jsonb('limit_value'),
  deductible: jsonb('deductible'),
  percent: numeric('percent'),
  metadata: jsonb('metadata'),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.policyId, t.versionId, t.coverageCode] }),
])

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export const documents = pgTable('documents', {
  documentId: uuid('document_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  policyId: uuid('policy_id').references(() => policies.policyId, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').references(() => policyTransactions.transactionId, { onDelete: 'set null' }),
  type: text('type').notNull(),
  uri: text('uri').notNull(),
  hash: text('hash'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
})

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
export const formsCatalog = pgTable('forms_catalog', {
  formId: uuid('form_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  code: text('code').notNull(),
  edition: text('edition'),
  name: text('name'),
  jurisdiction: jsonb('jurisdiction'),
  applicability: jsonb('applicability'),
  render: jsonb('render'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const policyForms = pgTable('policy_forms', {
  policyFormId: uuid('policy_form_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').references(() => policyTransactions.transactionId, { onDelete: 'set null' }),
  formId: uuid('form_id').references(() => formsCatalog.formId),
  code: text('code'),
  data: jsonb('data'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
})

// ---------------------------------------------------------------------------
// Notes & UW Decisions
// ---------------------------------------------------------------------------
export const notes = pgTable('notes', {
  noteId: uuid('note_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  transactionId: uuid('transaction_id').notNull().references(() => policyTransactions.transactionId, { onDelete: 'cascade' }),
  noteType: text('note_type').notNull(),
  noteText: text('note_text').notNull(),
  visibility: text('visibility').array().notNull().default(sql`ARRAY[]::text[]`),
  addedBy: uuid('added_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
})

export const uwDecisions = pgTable('uw_decisions', {
  decisionId: uuid('decision_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  transactionId: uuid('transaction_id').notNull().references(() => policyTransactions.transactionId, { onDelete: 'cascade' }),
  rulesTriggered: text('rules_triggered').array(),
  decision: text('decision').notNull(),
  conditions: text('conditions').array(),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
})

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
export const quotes = pgTable('quotes', {
  quoteId: uuid('quote_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  productCode: text('product_code').notNull(),
  effectiveDate: date('effective_date').notNull(),
  termMonths: integer('term_months').notNull(),
  jurisdictionCode: text('jurisdiction_code'),
  payload: jsonb('payload').notNull(),
  underwriting: jsonb('underwriting'),
  premium: jsonb('premium'),
  expiryDate: date('expiry_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Ledger Events
// ---------------------------------------------------------------------------
export const ledgerEvents = pgTable('ledger_events', {
  eventId: uuid('event_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  event: text('event').notNull(),
  fromState: text('from_state'),
  toState: text('to_state'),
  payload: jsonb('payload'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actor: uuid('actor'),
})

// ---------------------------------------------------------------------------
// Async Message Outbox (migration 015)
// ---------------------------------------------------------------------------
export const asyncMessageOutbox = pgTable('async_message_outbox', {
  messageId: uuid('message_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  sourceTable: text('source_table').notNull().default('ledger_events'),
  sourceId: uuid('source_id').notNull(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('Pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(8),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// RBAC (migration 013)
// ---------------------------------------------------------------------------
export const rbacPermissions = pgTable('rbac_permissions', {
  permissionCode: text('permission_code').primaryKey(),
  scope: text('scope').notNull(),
  resourceKey: text('resource_key').notNull(),
  actionKey: text('action_key').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rbacRoles = pgTable('rbac_roles', {
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull(),
  roleName: text('role_name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.roleCode] }),
])

export const rbacRolePermissions = pgTable('rbac_role_permissions', {
  tenantId: text('tenant_id').notNull(),
  roleCode: text('role_code').notNull(),
  permissionCode: text('permission_code').notNull().references(() => rbacPermissions.permissionCode, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.roleCode, t.permissionCode] }),
])

// ---------------------------------------------------------------------------
// Customers (migration 017)
// ---------------------------------------------------------------------------
export const customers = pgTable('customers', {
  customerId: uuid('customer_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  customerKey: text('customer_key').notNull(),
  entityType: text('entity_type').notNull(),
  status: text('status').notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  survivorCustomerId: uuid('survivor_customer_id'),
  displayName: text('display_name'),
  pendingApproval: boolean('pending_approval').notNull().default(false),
  deactivationReason: text('deactivation_reason'),
  deactivationEffectiveDate: date('deactivation_effective_date'),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
})

export const customerKeySequences = pgTable('customer_key_sequences', {
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  sequenceYear: integer('sequence_year').notNull(),
  lastValue: numeric('last_value').notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.sequenceYear] }),
])

// ---------------------------------------------------------------------------
// Policy Customer Links (migration 021)
// ---------------------------------------------------------------------------
export const policyCustomerLinks = pgTable('policy_customer_links', {
  policyCustomerLinkId: uuid('policy_customer_link_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  roleCode: text('role_code').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  source: text('source').notNull().default('quote'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Policy Additional Interests (migration 031)
// ---------------------------------------------------------------------------
export const policyAdditionalInterests = pgTable('policy_additional_interests', {
  aiId: uuid('ai_id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text('tenant_id').notNull(),
  policyId: uuid('policy_id').notNull(),
  role: text('role').notNull(),
  partyId: uuid('party_id'),
  name: text('name').notNull(),
  address: jsonb('address'),
  coverageCodes: text('coverage_codes').array(),
  aiFormCode: text('ai_form_code'),
  loanNumber: text('loan_number'),
  isaoa: boolean('isaoa').notNull().default(false),
  atima: boolean('atima').notNull().default(false),
  receiveCancelNotice: boolean('receive_cancel_notice').notNull().default(true),
  receiveNonrenewalNotice: boolean('receive_nonrenewal_notice').notNull().default(true),
  effectiveDate: date('effective_date'),
  expirationDate: date('expiration_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Rating Models (migration 029)
// ---------------------------------------------------------------------------
export const ratingModels = pgTable('rating_models', {
  modelId: uuid('model_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  modelCode: text('model_code').notNull(),
  productCode: text('product_code').notNull(),
  stateCode: text('state_code'),
  programName: text('program_name'),
  status: text('status').notNull().default('DRAFT'),
  activeVersionId: uuid('active_version_id'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
})

export const ratingModelVersions = pgTable('rating_model_versions', {
  versionId: uuid('version_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => ratingModels.modelId, { onDelete: 'cascade' }),
  versionLabel: text('version_label').notNull(),
  publishStatus: text('publish_status').notNull().default('DRAFT'),
  isActive: boolean('is_active').notNull().default(false),
  parserName: text('parser_name').notNull().default('generic-rating-workbook'),
  parserVersion: text('parser_version').notNull().default('1.0.0'),
  sourceFileName: text('source_file_name'),
  sourceMimeType: text('source_mime_type'),
  workbookSha256: text('workbook_sha256'),
  effectiveDate: date('effective_date'),
  expirationDate: date('expiration_date'),
  workbookJson: jsonb('workbook_json').notNull(),
  parserSummary: jsonb('parser_summary').notNull().default(sql`'{}'::jsonb`),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: text('published_by'),
})

// ---------------------------------------------------------------------------
// Policy Timeline (migration 028)
// ---------------------------------------------------------------------------
export const policyTimelineSegments = pgTable('policy_timeline_segments', {
  segmentId: uuid('segment_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  timelineVersion: integer('timeline_version').notNull(),
  segmentStart: date('segment_start').notNull(),
  segmentEnd: date('segment_end').notNull(),
  sourceVersionId: uuid('source_version_id').references(() => policyVersions.versionId, { onDelete: 'set null' }),
  sourceTransactionId: uuid('source_transaction_id').references(() => policyTransactions.transactionId, { onDelete: 'set null' }),
  payload: jsonb('payload'),
  premiumTotal: numeric('premium_total', { precision: 14, scale: 2 }).notNull().default('0'),
  premiumFees: numeric('premium_fees', { precision: 14, scale: 2 }).notNull().default('0'),
  premiumTaxes: numeric('premium_taxes', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const policyRetroAdjustments = pgTable('policy_retro_adjustments', {
  adjustmentId: uuid('adjustment_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  policyId: uuid('policy_id').notNull().references(() => policies.policyId, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').references(() => policyTransactions.transactionId, { onDelete: 'set null' }),
  timelineVersion: integer('timeline_version').notNull(),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  amountTotal: numeric('amount_total', { precision: 14, scale: 2 }).notNull().default('0'),
  amountFees: numeric('amount_fees', { precision: 14, scale: 2 }).notNull().default('0'),
  amountTaxes: numeric('amount_taxes', { precision: 14, scale: 2 }).notNull().default('0'),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  reason: text('reason'),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Underwriting Companies (migration 009)
// ---------------------------------------------------------------------------
export const underwritingCompanies = pgTable('underwriting_companies', {
  companyId: uuid('company_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull().references(() => tenants.tenantId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  productCode: text('product_code').notNull(),
  countryCode: text('country_code').notNull(),
  stateCode: text('state_code').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Cancellation Reason Codes (migration 031)
// ---------------------------------------------------------------------------
export const cancellationReasonCodes = pgTable('cancellation_reason_codes', {
  reasonCode: text('reason_code').primaryKey(),
  description: text('description').notNull(),
  initiator: text('initiator').notNull(),
  cancellationType: text('cancellation_type').notNull(),
  noticeDays: smallint('notice_days').notNull().default(10),
  returnPremium: text('return_premium').notNull(),
  isSystem: boolean('is_system').notNull().default(true),
})

// ---------------------------------------------------------------------------
// Short Rate Tables (migration 031)
// ---------------------------------------------------------------------------
export const shortRateTables = pgTable('short_rate_tables', {
  tableId: uuid('table_id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text('tenant_id').notNull(),
  productCode: text('product_code'),
  stateCode: char('state_code', { length: 2 }),
  tableData: jsonb('table_data').notNull(),
  effectiveDate: date('effective_date').notNull().default(sql`CURRENT_DATE`),
  active: boolean('active').notNull().default(true),
})

// ---------------------------------------------------------------------------
// Product State Eligibility (migration 031)
// ---------------------------------------------------------------------------
export const productStateEligibility = pgTable('product_state_eligibility', {
  eligibilityId: uuid('eligibility_id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text('tenant_id').notNull(),
  productCode: text('product_code').notNull(),
  stateCode: char('state_code', { length: 2 }).notNull(),
  admitted: boolean('admitted').notNull().default(true),
  surplusLines: boolean('surplus_lines').notNull().default(false),
  minPremium: numeric('min_premium', { precision: 14, scale: 2 }),
  maxTiv: numeric('max_tiv', { precision: 14, scale: 2 }),
  maxLimit: numeric('max_limit', { precision: 14, scale: 2 }),
  status: text('status').notNull().default('ACTIVE'),
  notes: text('notes'),
  effectiveDate: date('effective_date'),
  expirationDate: date('expiration_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// OFAC Screens (migration 031)
// ---------------------------------------------------------------------------
export const ofacScreens = pgTable('ofac_screens', {
  screenId: uuid('screen_id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text('tenant_id').notNull(),
  partyName: text('party_name').notNull(),
  policyId: uuid('policy_id'),
  quoteId: uuid('quote_id'),
  screenDate: timestamp('screen_date', { withTimezone: true }).notNull().defaultNow(),
  result: text('result').notNull(),
  matchDetails: jsonb('match_details'),
  disposition: text('disposition').notNull().default('PENDING'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Jurisdictions & Regulatory Rules
// ---------------------------------------------------------------------------
export const jurisdictions = pgTable('jurisdictions', {
  jurisdictionCode: text('jurisdiction_code').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  country: text('country'),
  region: text('region'),
  currency: char('currency', { length: 3 }),
  tax: jsonb('tax'),
  compliance: jsonb('compliance'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const regulatoryRules = pgTable('regulatory_rules', {
  ruleId: uuid('rule_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  jurisdictionCode: text('jurisdiction_code').notNull().references(() => jurisdictions.jurisdictionCode, { onDelete: 'cascade' }),
  ruleType: text('rule_type'),
  payload: jsonb('payload'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Field Meta
// ---------------------------------------------------------------------------
export const fieldMeta = pgTable('field_meta', {
  metaId: uuid('meta_id').primaryKey().default(sql`uuid_generate_v4()`),
  tenantId: text('tenant_id').notNull(),
  path: text('path').notNull(),
  type: text('type'),
  enumValues: text('enum_values').array(),
  required: boolean('required'),
  visibleTo: text('visible_to').array(),
  editableBy: text('editable_by').array(),
  validation: jsonb('validation'),
  i18n: jsonb('i18n'),
  ui: jsonb('ui'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
