export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = this.constructor.name
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor)
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message = 'Not found') { super(404, code, message) }
}

export class ValidationError extends AppError {
  constructor(code: string, details?: unknown) { super(422, code, 'Validation failed', details) }
}

export class ForbiddenError extends AppError {
  constructor(code = 'FORBIDDEN') { super(403, code, 'Forbidden') }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) { super(409, code, message) }
}

export class BadRequestError extends AppError {
  constructor(code: string, message: string) { super(400, code, message) }
}
