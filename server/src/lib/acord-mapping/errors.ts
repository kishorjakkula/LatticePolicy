/** Structured mapping validation error, one per offending field. */
export interface MappingError {
  field: string
  code: 'REQUIRED' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'OUT_OF_RANGE'
  message: string
  expected?: string
  actual?: unknown
}

export type MappingResult<T> =
  | { ok: true; data: T; errors: [] }
  | { ok: false; data: null; errors: MappingError[] }

export function mappingOk<T>(data: T): MappingResult<T> {
  return { ok: true, data, errors: [] }
}

export function mappingFail<T>(errors: MappingError[]): MappingResult<T> {
  return { ok: false, data: null, errors }
}

export function requireField(
  errors: MappingError[],
  value: unknown,
  field: string,
  expected: string
): boolean {
  if (value === undefined || value === null || value === '') {
    errors.push({ field, code: 'REQUIRED', message: `${field} is required`, expected })
    return false
  }
  return true
}

export function requireString(
  errors: MappingError[],
  value: unknown,
  field: string
): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({
      field,
      code: value === undefined || value === null || value === '' ? 'REQUIRED' : 'INVALID_TYPE',
      message: `${field} must be a non-empty string`,
      expected: 'string',
      actual: value,
    })
    return false
  }
  return true
}

export function requirePercent(
  errors: MappingError[],
  value: unknown,
  field: string
): value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    errors.push({
      field,
      code: 'INVALID_TYPE',
      message: `${field} must be a number`,
      expected: 'number',
      actual: value,
    })
    return false
  }
  if (value < 0 || value > 100) {
    errors.push({
      field,
      code: 'OUT_OF_RANGE',
      message: `${field} must be between 0 and 100`,
      expected: '0-100',
      actual: value,
    })
    return false
  }
  return true
}
