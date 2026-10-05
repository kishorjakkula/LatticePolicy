import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import type { RequestHandler } from 'express'
import { ValidationError } from './errors/domain.errors.js'

export type ContractName = 'quote.request' | 'data-import-batch.request' | 'reinsurance-treaty.request'

export type ContractValidationError = {
  path: string
  keyword: string
  message: string
  schema: string
  params: Record<string, unknown>
}

export type ContractValidationResult = {
  valid: boolean
  errors: ContractValidationError[]
}

const CONTRACT_FILES: Record<ContractName, string> = {
  'quote.request': 'quote.request.schema.json',
  'data-import-batch.request': 'data-import-batch.request.schema.json',
  'reinsurance-treaty.request': 'reinsurance-treaty.request.schema.json',
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
})

const validators = new Map<ContractName, ValidateFunction>()

function contractRootCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return [
    path.resolve(process.cwd(), 'contracts'),
    path.resolve(process.cwd(), '..', 'contracts'),
    path.resolve(here, '..', '..', 'contracts'),
    path.resolve(here, '..', '..', '..', 'contracts'),
  ]
}

function readContractSchema(fileName: string): any {
  for (const root of contractRootCandidates()) {
    const candidate = path.join(root, fileName)
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'))
    }
  }
  throw new Error(`Contract schema not found: ${fileName}`)
}

function getValidator(name: ContractName): ValidateFunction {
  const existing = validators.get(name)
  if (existing) return existing

  const schema = readContractSchema(CONTRACT_FILES[name])
  const validator = ajv.compile(schema)
  validators.set(name, validator)
  return validator
}

function normalizeErrors(schema: string, errors: ErrorObject[] | null | undefined): ContractValidationError[] {
  return (errors || []).map((error) => ({
    path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message || 'Invalid value',
    schema,
    params: error.params as Record<string, unknown>,
  }))
}

export function validateContract(name: ContractName, obj: unknown): ContractValidationResult {
  const validator = getValidator(name)
  const valid = validator(obj)
  return {
    valid,
    errors: valid ? [] : normalizeErrors(CONTRACT_FILES[name], validator.errors),
  }
}

export function validateQuoteDetailed(obj: unknown): ContractValidationResult {
  return validateContract('quote.request', obj)
}

export function validateQuote(obj: unknown): boolean {
  return validateQuoteDetailed(obj).valid
}

export function validateContractBody(name: ContractName): RequestHandler {
  return (req, _res, next) => {
    const result = validateContract(name, req.body)
    if (!result.valid) return next(new ValidationError('CONTRACT_VALIDATION_FAILED', result.errors))
    next()
  }
}

export const validateMutationEnvelope: RequestHandler = (req, _res, next) => {
  if (!['POST', 'PATCH', 'PUT'].includes(req.method) || req.body === undefined) return next()
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return next(new ValidationError('CONTRACT_VALIDATION_FAILED', [{
      path: '/', keyword: 'type', message: 'Request body must be a JSON object',
      schema: 'generic-json-object', params: { type: 'object' },
    }]))
  }
  next()
}
