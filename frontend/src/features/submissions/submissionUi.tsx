import type { ReactNode } from 'react'
import type { FieldConfidence, IntakeSettings, SubmissionEvent, SubmissionField, SubmissionStatus } from '../../api/submissions.api'

export const STATUS_META: Record<SubmissionStatus, { label: string; tone: string }> = {
  RECEIVED: { label: 'Received', tone: 'neutral' },
  READING: { label: 'AI reading', tone: 'ai' },
  READ_FAILED: { label: 'Could not read', tone: 'low' },
  READY_FOR_REVIEW: { label: 'Ready for review', tone: 'info' },
  IN_REVIEW: { label: 'In review', tone: 'neutral' },
  COMPLETED: { label: 'Approved · quote created', tone: 'high' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
}

export const CONFIDENCE_LABEL: Record<FieldConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium · check',
  low: 'Low · check',
  missing: 'Not found',
  conflict: 'Documents disagree',
}

export function Sparkle({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'currentColor', flex: 'none' }}>
      <path d="M12 2l2.1 6.4L20.5 10.5l-6.4 2.1L12 19l-2.1-6.4L3.5 10.5l6.4-2.1z" />
    </svg>
  )
}

export function AiTag({ children }: { children: ReactNode }) {
  return <span className="si-ai-tag"><Sparkle />{children}</span>
}

export function Check({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 3, flex: 'none' }}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  )
}

export function productLabel(settings: IntakeSettings | undefined, code: string | null | undefined): string {
  if (!code) return ''
  return settings?.products.find((product) => product.code === code)?.label || code
}

/** Display text for a field value: product codes as product names. */
export function displayValue(field: Pick<SubmissionField, 'key'>, value: string | null | undefined, settings?: IntakeSettings): string {
  if (!value) return ''
  if (field.key === 'productCode') return productLabel(settings, value)
  return value
}

/** Needs a person's attention: not confirmed and not a high-confidence draft. */
export function needsAttention(field: SubmissionField): boolean {
  return field.status !== 'accepted' && field.confidence !== 'high'
}

const ACTION_TEXT: Record<string, (event: SubmissionEvent) => string> = {
  received: (event) => `Received ${event.detail.documents?.length || 0} document(s)`,
  reading_requested: (event) => `Asked ${event.detail.reader || 'the reader'} to read the documents${event.detail.productHint ? ` as ${event.detail.productHint}` : ''}`,
  drafted: (event) => `Drafted ${event.detail.drafted ?? 0} of ${event.detail.fields ?? 0} values; ${event.detail.needsAttention ?? 0} need attention`,
  reading_failed: (event) => `Could not read the documents: ${event.detail.error || 'unknown error'}`,
  value_confirmed: (event) => `Confirmed ${event.detail.field}${event.detail.changedFromAi ? ' (changed from the AI value)' : ''}`,
  value_edited: (event) => `Edited ${event.detail.field}`,
  value_unconfirmed: (event) => `Took back confirmation of ${event.detail.field}`,
  high_confidence_confirmed: (event) => `Confirmed ${event.detail.count} high-confidence values`,
  customer_choice: (event) => (event.detail.mode === 'existing' ? `Chose existing customer ${event.detail.displayName || ''}` : 'Chose to create a new customer'),
  approved: (event) => `Approved ${event.detail.values} values`,
  customer_created: () => 'Created the customer',
  customer_linked: () => 'Linked the existing customer',
  quote_created: (event) => `Created draft quote ${event.detail.quoteNumber || ''}`,
  declined: (event) => `Declined: ${event.detail.reason || ''}`,
}

export function describeEvent(event: SubmissionEvent): string {
  const describe = ACTION_TEXT[event.action]
  return describe ? describe(event) : event.action.replace(/_/g, ' ')
}

export function actorText(event: SubmissionEvent): string {
  if (event.actorType === 'ai') return event.actor || 'AI'
  if (event.actorType === 'system') return 'LatticePolicy'
  return event.actor || 'User'
}
