import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

type ContractName = 'quote.request'

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
