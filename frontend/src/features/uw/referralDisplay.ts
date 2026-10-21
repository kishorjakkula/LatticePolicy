import { formatCurrency } from '../../shared/displayLabels'
import type { UwReferral } from '../../api/uw.api'

/** Referral statuses an underwriter can still decide. */
export const DECIDABLE_STATUSES = ['Open', 'InfoRequested']

export const REFERRAL_STATUS_LABELS: Record<string, string> = {
  Open: 'Open',
  InfoRequested: 'Info requested',
  Approved: 'Approved',
  Declined: 'Declined',
  Withdrawn: 'Withdrawn',
}

export const REFERRAL_STATUS_BADGE: Record<string, string> = {
  Open: 'yellow',
  InfoRequested: 'yellow',
  Approved: 'green',
  Declined: 'red',
  Withdrawn: 'gray',
}

export const AUTHORITY_LIMIT_MESSAGE = 'Above your authority limit. Request an override.'

export function isDecidable(referral: Pick<UwReferral, 'status'> | null | undefined): boolean {
  return !!referral && DECIDABLE_STATUSES.includes(referral.status)
}

/** Authority referrals (reason codes starting AUTHORITY_) need uw.authority.override to approve. */
export function isAuthorityReferral(referral: Pick<UwReferral, 'reasons'> | null | undefined): boolean {
  return (referral?.reasons || []).some((reason) => String(reason).startsWith('AUTHORITY_'))
}

/**
 * Time since the referral was raised, compact for a table column:
 * "<1h", "5h", "3d". Unknown or future dates read "-".
 */
export function referralAge(createdAt: string | null | undefined, now: Date = new Date()): string {
  if (!createdAt) return '-'
  const created = new Date(createdAt)
  const ms = now.getTime() - created.getTime()
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return '<1h'
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Machine reason codes (AUTHORITY_LIMIT_EXCEEDED) read as sentences; free text is kept as written. */
export function reasonLabel(reason: string): string {
  const text = String(reason || '').trim()
  if (!/^[A-Z0-9_]+$/.test(text)) return text
  const words = text.replace(/^AUTHORITY_/, '').toLowerCase().split('_').filter(Boolean).join(' ')
  const sentence = words.charAt(0).toUpperCase() + words.slice(1)
  return text.startsWith('AUTHORITY_') ? `Authority: ${sentence.toLowerCase()}` : sentence
}

export function premiumLabel(premium: UwReferral['premium']): string {
  if (!premium || !Number.isFinite(Number(premium.amount))) return 'Not rated'
  return formatCurrency(premium.amount, premium.currency || 'USD')
}

export function referralStatusLabel(status: string | null | undefined): string {
  return REFERRAL_STATUS_LABELS[String(status || '')] || String(status || '-')
}

export function insuredDisplay(referral: Pick<UwReferral, 'insuredName'>): string {
  return referral.insuredName?.trim() || 'No insured name'
}

/** Assignee as a person reads it: "You", an underwriter's name, or a neutral fallback. */
export function assigneeLabel(
  assignedTo: string | null | undefined,
  currentUserId: string | null | undefined,
  names: Map<string, string>,
): string {
  if (!assignedTo) return 'Unassigned'
  if (currentUserId && assignedTo === currentUserId) return 'You'
  return names.get(assignedTo) || 'Another underwriter'
}

const DECISION_ERROR_MESSAGES: Record<string, string> = {
  AUTHORITY_OVERRIDE_REQUIRED: AUTHORITY_LIMIT_MESSAGE,
  REASON_REQUIRED: 'Enter a reason.',
  FORBIDDEN: 'You do not have permission to decide referrals.',
  REFERRAL_DECISION_FORBIDDEN: 'You do not have permission to decide referrals.',
  REFERRAL_NOT_FOUND: 'This referral no longer exists.',
}

/** Readable message for an error thrown by request() ("API PATCH … failed 403: {json}"). */
export function referralErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(text.slice(jsonStart))
      const code = String(body?.code || '')
      if (DECISION_ERROR_MESSAGES[code]) return DECISION_ERROR_MESSAGES[code]
      if (body?.message) return String(body.message)
    } catch {
      // not JSON; fall through
    }
  }
  return text || 'Something went wrong. Try again.'
}
