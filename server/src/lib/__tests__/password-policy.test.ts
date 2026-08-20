import { describe, expect, it } from 'vitest'
import {
  clearLockoutState,
  isLockedOut,
  MAX_FAILED_LOGIN_ATTEMPTS,
  recordFailedAttempt,
  validatePasswordPolicy
} from '../password-policy.js'

describe('validatePasswordPolicy', () => {
  it('accepts a password meeting length/complexity requirements', () => {
    expect(validatePasswordPolicy('Str0ng!Passw0rd')).toEqual({ ok: true, errors: [] })
  })

  it('rejects passwords that are too short', () => {
    const result = validatePasswordPolicy('Sh0rt!')
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('at least'))).toBe(true)
  })

  it('requires upper, lower, digit, and symbol characters', () => {
    const result = validatePasswordPolicy('alllowercaseandlong')
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('uppercase'),
      expect.stringContaining('digit'),
      expect.stringContaining('symbol')
    ]))
  })

  it('rejects common weak passwords even if they pass complexity rules', () => {
    const result = validatePasswordPolicy('Password123!')
    expect(result.ok).toBe(false)
  })

  it('handles long symbol padding around weak passwords without regex backtracking risk', () => {
    const result = validatePasswordPolicy(`${'!'.repeat(10_000)}Welcome2026!${'`'.repeat(10_000)}`)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Password is too common; choose a less predictable value')
  })
})

describe('lockout state machine', () => {
  it('is not locked out with no prior failures', () => {
    expect(isLockedOut({ lockedUntil: null })).toBe(false)
  })

  it('locks the account once MAX_FAILED_LOGIN_ATTEMPTS is reached', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    let state = { failedLoginAttempts: 0, lockedUntil: null as Date | null }
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i += 1) {
      state = recordFailedAttempt(state, now)
      expect(state.lockedUntil).toBeNull()
    }
    state = recordFailedAttempt(state, now)
    expect(state.lockedUntil).not.toBeNull()
    expect(isLockedOut(state, now)).toBe(true)
  })

  it('is no longer locked out once lockedUntil has passed', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const later = new Date(now.getTime() + 20 * 60_000)
    let state = { failedLoginAttempts: 0, lockedUntil: null as Date | null }
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i += 1) state = recordFailedAttempt(state, now)
    expect(isLockedOut(state, later)).toBe(false)
  })

  it('clears failure state on successful login', () => {
    expect(clearLockoutState()).toEqual({ failedLoginAttempts: 0, lockedUntil: null })
  })
})
