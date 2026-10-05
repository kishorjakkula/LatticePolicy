import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Ajv2020Module from 'ajv/dist/2020.js'
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv'
import type { Options } from 'ajv/dist/core.js'

export type ContractName = 'quote.request' | 'endorsement.request' | 'policy'

export type ContractValidationError = {
  path: string
  keyword: string
  message: string
  schemaSource: string
  params?: Record<string, unknown>
}

export type ContractValidationResult = {
  valid: boolean
  errors: ContractValidationError[]
}

const schemaFiles: Record<ContractName, string> = {
  'quote.request': 'quote.request.schema.json',
  'endorsement.request': 'endorsement.request.schema.json',
  policy: 'policy.schema.json',
}

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../contracts')
const Ajv2020 = Ajv2020Module.default as unknown as { new(opts?: Options): Ajv2020Module.Ajv2020 }
const ajv = new Ajv2020({ allErrors: true, strict: false })
const validators = new Map<ContractName, ValidateFunction>()

ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/)
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T.+$/)
ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/)

function loadSchema(name: ContractName): AnySchema {
  const filePath = resolve(contractsDir, schemaFiles[name])
  return JSON.parse(readFileSync(filePath, 'utf8')) as AnySchema
}

function getValidator(name: ContractName): ValidateFunction {
  const cached = validators.get(name)
  if (cached) return cached

  const validator = ajv.compile(loadSchema(name))
  validators.set(name, validator)
  return validator
}

function formatError(schemaFile: string, error: ErrorObject): ContractValidationError {
  return {
    path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message || 'Validation failed',
    schemaSource: `${schemaFile}${error.schemaPath}`,
    params: error.params as Record<string, unknown>,
  }
}

export function validateContract(name: ContractName, obj: unknown): ContractValidationResult {
  const validator = getValidator(name)
  const valid = validator(obj)
  return {
    valid,
    errors: valid ? [] : (validator.errors || []).map((error) => formatError(schemaFiles[name], error)),
  }
}

export function validateQuoteContract(obj: unknown): ContractValidationResult {
  return validateContract('quote.request', obj)
}

// API quote routes resolve tenant from X-Tenant, while the portable contract
// keeps tenantId required for import/export payloads. Preserve route behavior by
// validating an augmented copy when callers have already enforced tenancy.
export function validateQuote(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false
  return validateQuoteContract({ tenantId: obj.tenantId || '__api_tenant__', ...obj }).valid
}
