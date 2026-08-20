export const MAX_FAILED_LOGIN_ATTEMPTS = 5
export const LOCKOUT_DURATION_MINUTES = 15
export const MIN_PASSWORD_LENGTH = 12

const COMMON_WEAK_PASSWORD_ROOTS = new Set([
  'password', 'letmein', 'qwerty', 'welcome', 'admin', 'changeme', 'iloveyou', '12345678', '123456789'
])

/** Strips common leading/trailing digits and symbols so "Password123!" still matches "password". */
function toWeakPasswordRoot(value: string): string {
  return value.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '')
}

export type PasswordPolicyResult = {
  ok: boolean
  errors: string[]
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = []
  const value = String(password || '')
  if (value.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (!/[a-z]/.test(value)) errors.push('Password must include a lowercase letter')
  if (!/[A-Z]/.test(value)) errors.push('Password must include an uppercase letter')
  if (!/[0-9]/.test(value)) errors.push('Password must include a digit')
  if (!/[^a-zA-Z0-9]/.test(value)) errors.push('Password must include a symbol')
  if (COMMON_WEAK_PASSWORD_ROOTS.has(toWeakPasswordRoot(value))) {
    errors.push('Password is too common; choose a less predictable value')
  }
  return { ok: errors.length === 0, errors }
}

export type LockoutState = {
  failedLoginAttempts: number
  lockedUntil: Date | null
}

export function isLockedOut(state: Pick<LockoutState, 'lockedUntil'>, now: Date = new Date()): boolean {
  return Boolean(state.lockedUntil && state.lockedUntil.getTime() > now.getTime())
}

/**
 * Pure state transition for a failed login attempt. Locks the account once
 * MAX_FAILED_LOGIN_ATTEMPTS is reached and resets the counter on lock so a
 * subsequent lockout requires another full run of attempts.
 */
export function recordFailedAttempt(current: LockoutState, now: Date = new Date()): LockoutState {
  const attempts = current.failedLoginAttempts + 1
  if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    return {
      failedLoginAttempts: 0,
      lockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MINUTES * 60_000)
    }
  }
  return { failedLoginAttempts: attempts, lockedUntil: current.lockedUntil }
}

export function clearLockoutState(): LockoutState {
  return { failedLoginAttempts: 0, lockedUntil: null }
}
