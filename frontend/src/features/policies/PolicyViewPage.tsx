import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, apiDetails } from '../../api/client'
import {
  usePolicy,
  usePolicyVersions,
  useFullPolicy,
  usePolicyTimeline,
  usePolicyAiInsights,
  useIssuePolicyMutation,
  useReinstatePolicyMutation,
  useNonRenewPolicyMutation,
  useReserveTransactionNumberMutation,
} from '../../api/hooks'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import { normalizePayloadCoverages } from '../wizard/coverageUtils'
import {
  clearPendingTransaction,
  readPendingTransactions,
  savePendingTransaction,
} from '../wizard/pendingEndorsement'
import { derivePolicyWorkflowStatus, policyStatusBadgeColor } from './statusModel'
import { formatDisplayDate, formatDisplayDateTime } from '../../shared/dateDisplay'
import { TransactionAuditPanel } from './TransactionAuditPanel'
import { PolicyAsOfPanel } from './PolicyAsOfPanel'
import { PolicyDocumentsPanel } from './PolicyDocumentsPanel'

type JsonRecord = Record<string, any>
type TransactionMode = 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'
type PendingTransactionByMode = Record<TransactionMode, JsonRecord | null>
type VersionSortKey =
  | 'transactionNumber'
  | 'policyEffectiveDate'
  | 'effectiveDate'
  | 'expirationDate'
  | 'createdDate'
  | 'updatedDate'
  | 'updatedUser'
  | 'transactionType'
  | 'amount'

const EMPTY_PENDING_BY_MODE: PendingTransactionByMode = {
  endorse: null,
  cancel: null,
  reinstate: null,
  rewrite: null,
  renew: null,
}

// ---------------------------------------------------------------------------
// Small formatting / classification helpers
// ---------------------------------------------------------------------------

// Converts an arbitrary date-ish value to a YYYY-MM-DD string using the
// value's own timezone offset (via Date -> ISO -> slice). Falls back to
// pulling a leading YYYY-MM-DD prefix out of the raw string if the value
// doesn't parse as a Date at all.
function toIsoDateOnly(value: unknown): string {
  if (!value) return ''
  const parsed = new Date(String(value))
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  const raw = String(value)
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
  return match ? match[1] : ''
}

// Same idea as toIsoDateOnly, but reads the *local* date components instead
// of normalizing through toISOString (which is always UTC). Used only for
// matching a version's dates against the policy term, where we want the
// calendar date as entered rather than a UTC-shifted one.
function toLocalDateOnlyKey(value: unknown): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = String(parsed.getFullYear())
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isCancelTransactionType(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'cancel' || normalized === 'cancelled' || normalized === 'cancellation'
}

function isReinstateTransactionType(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'reinstate' || normalized === 'reinstated' || normalized === 'reinstatement'
}

// Maps a raw transactionType string (as stored on a version) to the mode
// used to drive the wizard's read-only view of that version.
function mapTransactionTypeToMode(value: unknown): TransactionMode | 'quote' {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'endorse' || normalized === 'endorsement') return 'endorse'
  if (normalized === 'cancel' || normalized === 'cancellation' || normalized === 'cancelled') return 'cancel'
  if (normalized === 'reinstate' || normalized === 'reinstatement' || normalized === 'reinstated') return 'reinstate'
  if (normalized === 'rewrite' || normalized === 'rewritten') return 'rewrite'
  if (normalized === 'renew' || normalized === 'renewal' || normalized === 'renewed') return 'renew'
  return 'quote'
}

function findAuditTransaction(timeline: JsonRecord | null | undefined, version: JsonRecord | null | undefined) {
  const transactions = Array.isArray(timeline?.transactions) ? timeline.transactions : []
  if (version?.transactionId) {
    const byId = transactions.find((tx: JsonRecord) => tx?.transactionId === version.transactionId)
    if (byId) return byId
  }
  const num = String(version?.transactionNumber || '').trim()
  if (num) {
    const byNumber = transactions.find(
      (tx: JsonRecord) => String(tx?.metadata?.transactionNumber || '').trim() === num,
    )
    if (byNumber) return byNumber
  }
  return null
}

function findAuditLedgerEvents(timeline: JsonRecord | null | undefined, version: JsonRecord | null | undefined) {
  const ledger = Array.isArray(timeline?.ledger) ? timeline.ledger : []
  const num = String(version?.transactionNumber || '').trim()
  return ledger.filter((ev: JsonRecord) => String(ev?.payload?.transactionNumber || '').trim() === num)
}

function formatDate(value: unknown): string {
  return formatDisplayDate(value, { fallback: '' })
}

function formatDateTime(value: unknown): string {
  return formatDisplayDateTime(value, { fallback: '' })
}

// Formats a raw ledger timestamp as "MM-DD-YYYY HH:MM" in the viewer's local
// time. This is intentionally its own (simpler) formatter rather than
// formatDateTime, matching the original ledger table's display.
function formatLedgerTimestamp(value: unknown, fallback = '-'): string {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return fallback
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const year = String(parsed.getFullYear())
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${month}-${day}-${year} ${hours}:${minutes}`
}

function formatCurrencyAmount(value: unknown, currency = 'USD'): string {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
    : String(value || '')
}

// Formats a { amount, currency } premium total, or '' if missing/invalid.
function formatMoney(value: JsonRecord | null | undefined): string {
  if (!value) return ''
  const amount = typeof value.amount === 'number' ? value.amount : Number(value.amount)
  const currency = value.currency || 'USD'
  return isFinite(amount) ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount) : ''
}

function isNegativeAmount(value: JsonRecord | null | undefined): boolean {
  if (!value) return false
  const amount = typeof value.amount === 'number' ? value.amount : Number(value.amount)
  return Number.isFinite(amount) && amount < 0
}

function formatPercent(value: unknown): string {
  const num = Number(value)
  return Number.isFinite(num) ? `${Math.round(num * 100)}%` : '-'
}

// Formats a bare numeric amount as currency, or '-' if missing/invalid.
// Used by the AI insights panel, which deals in raw numbers rather than
// { amount, currency } objects.
function formatCurrencyOrDash(value: unknown, currency = 'USD'): string {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
    : '-'
}

function formatLedgerEventLabel(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const upper = raw.toUpperCase()
  const knownLabels: Record<string, string> = {
    STATUS_CHANGE: 'Status Change',
    ENDORSE_ISSUED: 'Endorsement Issued',
    CANCELLED: 'Cancellation Issued',
    REINSTATED: 'Reinstated',
    REWRITTEN: 'Rewritten',
    RENEWED: 'Renewed',
  }
  if (knownLabels[upper]) return knownLabels[upper]
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

// Humanizes a JSON-patch-style path (e.g. "/coverages/0/limit") into a
// short, readable change description for the ledger summary line.
function humanizeChangePath(value: unknown): string {
  const path = String(value || '')
  if (!path) return ''
  if (path.startsWith('/coverages')) return 'coverages'
  if (path.startsWith('/risks')) return 'risk details'
  if (path.startsWith('/uwAnswers')) return 'underwriting answers'
  if (path.startsWith('/applicant')) return 'applicant details'
  return (
    path
      .replace(/^\//, '')
      .replace(/\//g, ' ')
      .replace(/\b\d+\b/g, '')
      .replace(/\s+/g, ' ')
      .trim() || ''
  )
}

// Builds a human-readable one-line summary for a single ledger event, used
// under the event label in the policy history table.
function summarizeLedgerEvent(event: JsonRecord): string {
  const payload = event?.payload as JsonRecord | undefined
  if (!payload || typeof payload !== 'object') return 'Recorded by system'

  const parts: string[] = []
  const transactionNumber = String(payload.transactionNumber || '').trim()
  if (transactionNumber) parts.push(`Transaction # ${transactionNumber}`)

  const delta = Number(payload.delta)
  if (Number.isFinite(delta)) {
    if (delta > 0) parts.push(`Additional premium ${formatCurrencyAmount(delta)}`)
    else if (delta < 0) parts.push(`Return premium ${formatCurrencyAmount(Math.abs(delta))}`)
    else parts.push('No premium change')
  }

  const refund = Number(payload.refund)
  if (Number.isFinite(refund)) parts.push(`Refund ${formatCurrencyAmount(refund)}`)

  if (Array.isArray(payload.changes) && payload.changes.length > 0) {
    const humanized = payload.changes
      .map((change: unknown) => humanizeChangePath(change))
      .filter(Boolean)
      .slice(0, 2)
    const remainder = payload.changes.length > 2 ? ` +${payload.changes.length - 2} more` : ''
    if (humanized.length) parts.push(`Updated ${humanized.join(', ')}${remainder}`)
    else parts.push(`${payload.changes.length} fields updated`)
  }

  const reason = String(payload.reason || '').trim()
  if (reason) parts.push(`Reason: ${reason}`)
  if (payload.effectiveDate) parts.push(`Effective ${formatDate(payload.effectiveDate)}`)
  if (payload.nextEffective) parts.push(`Next term starts ${formatDate(payload.nextEffective)}`)
  if (payload.issuedAt) parts.push(`Issued ${formatDateTime(payload.issuedAt)}`)
  if (payload.quoteId) parts.push('Converted from quote')

  return parts.length ? parts.join(' | ') : 'Recorded by system'
}

// Policy "Term" number shown in the summary card: term 1 plus one for every
// renewal transaction recorded against the policy.
function countPolicyTermNumber(versions: JsonRecord[]): number {
  if (!Array.isArray(versions) || versions.length === 0) return 1
  return (
    1 +
    versions.reduce((count, version) => {
      const type = String(version?.transactionType || '').trim().toUpperCase()
      return type === 'RENEW' || type === 'RENEWAL' ? count + 1 : count
    }, 0)
  )
}

function sortVersionsForDisplayOrder(versions: JsonRecord[]): Array<{ version: JsonRecord; index: number }> {
  return [...versions.map((version, index) => ({ version, index }))].sort((left, right) => {
    const leftProcessed = Date.parse(
      String(left.version?.processedDate || left.version?.updatedDate || left.version?.createdDate || ''),
    )
    const rightProcessed = Date.parse(
      String(right.version?.processedDate || right.version?.updatedDate || right.version?.createdDate || ''),
    )
    const leftProcessedSafe = Number.isFinite(leftProcessed) ? leftProcessed : 0
    const rightProcessedSafe = Number.isFinite(rightProcessed) ? rightProcessed : 0
    if (leftProcessedSafe !== rightProcessedSafe) return leftProcessedSafe - rightProcessedSafe

    const leftEffective = Date.parse(String(left.version?.effectiveDate || ''))
    const rightEffective = Date.parse(String(right.version?.effectiveDate || ''))
    const leftEffectiveSafe = Number.isFinite(leftEffective) ? leftEffective : 0
    const rightEffectiveSafe = Number.isFinite(rightEffective) ? rightEffective : 0
    if (leftEffectiveSafe !== rightEffectiveSafe) return leftEffectiveSafe - rightEffectiveSafe

    return String(left.version?.transactionNumber || '').localeCompare(String(right.version?.transactionNumber || ''))
  })
}

// A reinstatement that nets to (near) zero premium change is, from the
// ledger's point of view, correct: cancelling then reinstating with no
// changes shouldn't move the balance. But showing "$0.00" next to a
// "Reinstated" row reads as if nothing happened, which is confusing — the
// user wants to see the premium that was reinstated. So for display
// purposes only, when we see a near-zero-premium reinstatement immediately
// "paired" with a preceding cancellation, we substitute the magnitude of
// that cancellation's premium back in.
//
// NOTE: any other transaction type with a finite premium amount in between
// clears this "pending cancellation" memory — e.g. Cancel, Endorse, Reinstate
// (not paired) would reset it, but a transaction with no parseable premium at
// all leaves the memory intact. This asymmetry is preserved exactly as found
// in the original (compiled) version of this file; it was not an obviously
// unintentional bug, so it was not "fixed" as part of de-minifying.
function reconcileReinstatementPremiums(versions: JsonRecord[]): JsonRecord[] {
  if (!Array.isArray(versions) || versions.length === 0) return Array.isArray(versions) ? versions : []

  const ordered = sortVersionsForDisplayOrder(versions)
  const displayAmountByIndex = new Map<number, number>()
  let pendingCancelMagnitude = 0

  for (const { version, index } of ordered) {
    const total = version?.premium?.total
    const amount = typeof total?.amount === 'number' ? total.amount : Number(total?.amount)
    if (!Number.isFinite(amount)) continue

    if (isCancelTransactionType(version?.transactionType) && amount < 0) {
      pendingCancelMagnitude = Math.abs(amount)
      continue
    }
    if (isReinstateTransactionType(version?.transactionType)) {
      if (Math.abs(amount) < 0.01 && pendingCancelMagnitude > 0) {
        displayAmountByIndex.set(index, pendingCancelMagnitude)
      }
      pendingCancelMagnitude = 0
      continue
    }
    pendingCancelMagnitude = 0
  }

  if (displayAmountByIndex.size === 0) return versions
  return versions.map((version, index) => {
    const displayAmount = displayAmountByIndex.get(index)
    if (displayAmount === undefined) return version
    const premium = version?.premium && typeof version.premium === 'object' ? version.premium : {}
    const total = premium?.total && typeof premium.total === 'object' ? premium.total : {}
    return {
      ...version,
      premium: {
        ...premium,
        total: {
          ...total,
          amount: displayAmount,
          currency: typeof total.currency === 'string' && total.currency.trim() ? total.currency : 'USD',
        },
      },
    }
  })
}

// Computes the policy's current total premium by summing the (reinstatement
// -adjusted-in-spirit) premium deltas of the versions belonging to the
// policy's current term. See reconcileReinstatementPremiums for the
// cancel/reinstate pairing idea; this function re-implements a variant of
// that logic independently (as found in the original), with one notable
// difference: here, the "pending cancellation" memory is cleared ONLY by a
// reinstatement, not by any other intervening transaction type. That
// asymmetry versus reconcileReinstatementPremiums is preserved intentionally
// rather than unified, since unifying it would change displayed totals.
function computeCurrentPolicyPremium(versions: JsonRecord[], term: JsonRecord | null | undefined): JsonRecord | null {
  if (!Array.isArray(versions) || versions.length === 0) return null

  const termEffective = toLocalDateOnlyKey(term?.effectiveDate)
  const termExpiration = toLocalDateOnlyKey(term?.expirationDate)

  const inCurrentTerm = versions.filter((version) => {
    if (!termEffective && !termExpiration) return true
    const versionEffective = toLocalDateOnlyKey(version?.policyEffectiveDate)
    const versionExpiration = toLocalDateOnlyKey(version?.expirationDate)
    return !(
      (termEffective && versionEffective && versionEffective !== termEffective) ||
      (termExpiration && versionExpiration && versionExpiration !== termExpiration)
    )
  })

  const ordered = [...(inCurrentTerm.length > 0 ? inCurrentTerm : versions)].sort((left, right) => {
    const leftProcessed = Date.parse(String(left?.processedDate || left?.updatedDate || left?.createdDate || ''))
    const rightProcessed = Date.parse(String(right?.processedDate || right?.updatedDate || right?.createdDate || ''))
    const leftProcessedSafe = Number.isFinite(leftProcessed) ? leftProcessed : 0
    const rightProcessedSafe = Number.isFinite(rightProcessed) ? rightProcessed : 0
    if (leftProcessedSafe !== rightProcessedSafe) return leftProcessedSafe - rightProcessedSafe

    const leftEffective = Date.parse(String(left?.effectiveDate || ''))
    const rightEffective = Date.parse(String(right?.effectiveDate || ''))
    const leftEffectiveSafe = Number.isFinite(leftEffective) ? leftEffective : 0
    const rightEffectiveSafe = Number.isFinite(rightEffective) ? rightEffective : 0
    if (leftEffectiveSafe !== rightEffectiveSafe) return leftEffectiveSafe - rightEffectiveSafe

    return String(left?.transactionNumber || '').localeCompare(String(right?.transactionNumber || ''))
  })

  let cumulative = 0
  let sawAnyAmount = false
  let currency = 'USD'
  let pendingCancelMagnitude = 0

  for (const version of ordered) {
    const total = version?.premium?.total
    const amount = typeof total?.amount === 'number' ? total.amount : Number(total?.amount)
    if (!Number.isFinite(amount)) continue

    let delta = amount
    if (isCancelTransactionType(version?.transactionType) && amount < 0) {
      pendingCancelMagnitude = Math.abs(amount)
    } else if (isReinstateTransactionType(version?.transactionType)) {
      if (Math.abs(amount) < 0.01 && pendingCancelMagnitude > 0) delta = pendingCancelMagnitude
      pendingCancelMagnitude = 0
    }

    sawAnyAmount = true
    cumulative += delta
    if (typeof total?.currency === 'string' && total.currency.trim()) currency = total.currency.trim()
  }

  return sawAnyAmount ? { amount: cumulative, currency } : null
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function PolicyViewPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<VersionSortKey>('updatedDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [pendingByMode, setPendingByMode] = useState<PendingTransactionByMode>(EMPTY_PENDING_BY_MODE)
  const [nonRenewModalOpen, setNonRenewModalOpen] = useState(false)
  const [nonRenewBusy, setNonRenewBusy] = useState(false)

  const { data: policy, refetch: refetchPolicy } = usePolicy(id ?? '')
  const { data: versionsData, refetch: refetchVersions } = usePolicyVersions(id ?? '')
  const { data: fullPolicy, refetch: refetchFullPolicy } = useFullPolicy(id ?? '')
  const {
    data: timelineData,
    isLoading: timelineLoading,
    error: timelineQueryError,
    refetch: refetchTimeline,
  } = usePolicyTimeline(id ?? '')
  const { data: aiInsightsData, error: aiInsightsQueryError, refetch: refetchAiInsights } = usePolicyAiInsights(id ?? '')

  const issueMutation = useIssuePolicyMutation()
  const reinstateMutation = useReinstatePolicyMutation()
  const nonRenewMutation = useNonRenewPolicyMutation()
  const reserveTransactionNumberMutation = useReserveTransactionNumberMutation()

  const versionsList: JsonRecord[] = versionsData ?? []
  const timeline: JsonRecord | null = timelineData ?? null
  const timelineErrorMessage = timelineQueryError ? String((timelineQueryError as any).message || timelineQueryError) : null
  const aiInsights = aiInsightsData?.aiInsights ?? null
  const aiInsightsErrorMessage = aiInsightsQueryError
    ? String((aiInsightsQueryError as any).message || aiInsightsQueryError)
    : null
  const issuePending = issueMutation.isPending

  // The most up-to-date policy payload, preferring the "full policy" view
  // (which includes computed/derived fields) over the raw bind-time payload.
  const currentPayload: JsonRecord | undefined = fullPolicy || policy?.payload
  // Versions as returned by the API, used verbatim (not display-reconciled)
  // wherever we need the *actual* latest version for payload lookups.
  const rawVersions: JsonRecord[] = versionsList.length ? versionsList : policy?.versions || []

  const adjustedVersions = useMemo(() => reconcileReinstatementPremiums(rawVersions), [rawVersions])

  const sortedVersions = useMemo(() => {
    const rows = Array.isArray(adjustedVersions) ? [...adjustedVersions] : []
    const dirMultiplier = sortDir === 'asc' ? 1 : -1

    const compareStrings = (a: unknown, b: unknown) => {
      const left = String(a || '').trim().toUpperCase()
      const right = String(b || '').trim().toUpperCase()
      return left === right ? 0 : left > right ? 1 : -1
    }
    const compareDates = (a: unknown, b: unknown) => {
      const left = Number.isFinite(Date.parse(String(a || ''))) ? Date.parse(String(a || '')) : 0
      const right = Number.isFinite(Date.parse(String(b || ''))) ? Date.parse(String(b || '')) : 0
      return left === right ? 0 : left > right ? 1 : -1
    }
    const compareNumbers = (a: unknown, b: unknown) => {
      const left = Number(a || 0)
      const right = Number(b || 0)
      return left === right ? 0 : left > right ? 1 : -1
    }

    rows.sort((left: JsonRecord, right: JsonRecord) => {
      let result = 0
      if (sortKey === 'transactionNumber') result = compareStrings(left?.transactionNumber, right?.transactionNumber)
      else if (sortKey === 'policyEffectiveDate') result = compareDates(left?.policyEffectiveDate, right?.policyEffectiveDate)
      else if (sortKey === 'effectiveDate') result = compareDates(left?.effectiveDate, right?.effectiveDate)
      else if (sortKey === 'expirationDate') result = compareDates(left?.expirationDate, right?.expirationDate)
      else if (sortKey === 'createdDate')
        result = compareDates(left?.createdDate || left?.processedDate, right?.createdDate || right?.processedDate)
      else if (sortKey === 'updatedDate')
        result = compareDates(left?.updatedDate || left?.processedDate, right?.updatedDate || right?.processedDate)
      else if (sortKey === 'updatedUser') result = compareStrings(left?.updatedUser, right?.updatedUser)
      else if (sortKey === 'transactionType') result = compareStrings(left?.transactionType, right?.transactionType)
      else if (sortKey === 'amount') result = compareNumbers(left?.premium?.total?.amount, right?.premium?.total?.amount)
      return result * dirMultiplier
    })

    return rows
  }, [adjustedVersions, sortKey, sortDir])

  const versionsPagination = useClientPagination(sortedVersions, 10)

  useEffect(() => {
    if (location.hash === '#edit' && policy) {
      const target = document.getElementById('policy-edit')
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [location.hash, policy])

  useEffect(() => {
    if (!policy?.policyId) {
      setPendingByMode(EMPTY_PENDING_BY_MODE)
      return
    }
    setPendingByMode(readPendingTransactions(policy.policyId))
  }, [policy?.policyId])

  function refetchAll() {
    refetchPolicy()
    refetchVersions()
    refetchFullPolicy()
    refetchTimeline()
    refetchAiInsights()
  }

  async function handleIssuePolicy() {
    if (!policy) return
    setError(null)
    try {
      await issueMutation.mutateAsync(policy.policyId)
      refetchAll()
    } catch (err: any) {
      setError(err.message || String(err))
    }
  }

  async function handleReinstate() {
    if (!policy) return
    const payload = normalizePayloadCoverages(currentPayload || policy.payload || {})
    setBusy(true)
    setError(null)
    try {
      const reserved = await reserveTransactionNumberMutation.mutateAsync({ id: policy.policyId, mode: 'reinstate' })
      const transactionNumber = reserved?.transactionNumber || ''
      await reinstateMutation.mutateAsync({
        id: policy.policyId,
        payload: {
          effectiveDate: new Date().toISOString().slice(0, 10),
          payload,
          transactionNumber: transactionNumber || undefined,
        },
      })
      clearPendingTransaction(policy.policyId, 'reinstate')
      clearPendingTransaction(policy.policyId, 'rewrite')
      setPendingByMode((prev) => ({ ...prev, reinstate: null, rewrite: null }))
      refetchAll()
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleNonRenewSubmit(noticeDate: string, reasonCode: string, reason: string) {
    if (!policy) return
    setNonRenewBusy(true)
    setError(null)
    try {
      await nonRenewMutation.mutateAsync({ id: policy.policyId, payload: { noticeDate, reasonCode, reason } })
      setNonRenewModalOpen(false)
      refetchAll()
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setNonRenewBusy(false)
    }
  }

  function handleClearPendingTransaction(mode: TransactionMode) {
    if (!policy?.policyId) return
    clearPendingTransaction(policy.policyId, mode)
    setPendingByMode((prev) => ({ ...prev, [mode]: null }))
  }

  async function handleStartTransaction(mode: TransactionMode) {
    if (!policy) return
    const pending = pendingByMode[mode]
    const hasPendingQuote = !!pending?.quoteId
    if (!currentPayload && !hasPendingQuote) {
      setError('Policy payload missing')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const effectiveDate =
        mode === 'renew'
          ? toIsoDateOnly(policy.term?.expirationDate) || new Date().toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10)

      if (hasPendingQuote && pending) {
        const params = new URLSearchParams()
        params.set('quoteId', pending.quoteId)
        params.set('mode', mode)
        params.set('policyId', policy.policyId)
        if (policy.policyNumber) params.set('policyNumber', policy.policyNumber)
        if (pending.transactionNumber) params.set('transactionNumber', pending.transactionNumber)
        params.set('effectiveDate', pending.effectiveDate || effectiveDate)
        navigate(`/wizard?${params.toString()}`)
        return
      }

      const reserved = await reserveTransactionNumberMutation.mutateAsync({ id: policy.policyId, mode })
      const transactionNumber = reserved?.transactionNumber || ''

      let payloadForDraft = currentPayload
      const lastVersionId = rawVersions.length ? rawVersions[rawVersions.length - 1]?.versionId : ''
      if (lastVersionId) {
        try {
          const versionDetails = await apiDetails.getVersionDetails(policy.policyId, lastVersionId)
          if (versionDetails?.payload && typeof versionDetails.payload === 'object') {
            payloadForDraft = versionDetails.payload
          }
        } catch {
          // Fall back to currentPayload if version details can't be loaded.
        }
      }
      if (!payloadForDraft) throw new Error('Policy payload missing')

      const normalizedPayload = normalizePayloadCoverages(payloadForDraft)
      const draft = await api.createQuoteDraft(normalizedPayload, { status: 'Draft', progressStep: 1 })

      const params = new URLSearchParams()
      params.set('quoteId', draft.quoteId)
      params.set('mode', mode)
      params.set('policyId', policy.policyId)
      if (policy.policyNumber) params.set('policyNumber', policy.policyNumber)
      if (transactionNumber) params.set('transactionNumber', transactionNumber)
      params.set('effectiveDate', effectiveDate)

      const savedDraft = savePendingTransaction({
        policyId: policy.policyId,
        policyNumber: policy.policyNumber,
        mode,
        quoteId: draft.quoteId,
        transactionNumber: transactionNumber || undefined,
        effectiveDate,
      })
      setPendingByMode((prev) => ({
        ...prev,
        [mode]: savedDraft || {
          policyId: policy.policyId,
          policyNumber: policy.policyNumber,
          mode,
          quoteId: draft.quoteId,
          transactionNumber: transactionNumber || undefined,
          effectiveDate,
        },
      }))
      navigate(`/wizard?${params.toString()}`)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  function handleOpenVersion(version: JsonRecord) {
    const policyId = policy?.policyId || id
    if (!policyId || !version?.versionId) return
    const params = new URLSearchParams()
    params.set('readonly', '1')
    params.set('policyId', policyId)
    if (policy?.policyNumber) params.set('policyNumber', policy.policyNumber)
    params.set('versionId', String(version.versionId))
    params.set('mode', mapTransactionTypeToMode(version.transactionType))
    if (version.transactionNumber) params.set('transactionNumber', String(version.transactionNumber))
    const effectiveDate = toIsoDateOnly(version.effectiveDate)
    if (effectiveDate) params.set('effectiveDate', effectiveDate)
    navigate(`/wizard?${params.toString()}`)
  }

  function defaultSortDirectionFor(key: VersionSortKey): 'asc' | 'desc' {
    if (
      key === 'policyEffectiveDate' ||
      key === 'effectiveDate' ||
      key === 'expirationDate' ||
      key === 'createdDate' ||
      key === 'updatedDate' ||
      key === 'amount'
    ) {
      return 'desc'
    }
    return 'asc'
  }

  function handleSort(key: VersionSortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(key)
    setSortDir(defaultSortDirectionFor(key))
  }

  function sortLabel(key: VersionSortKey, label: string): string {
    if (sortKey !== key) return label
    return `${label} ${sortDir === 'asc' ? '^' : 'v'}`
  }

  function sortArrow(key: VersionSortKey): string {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? '^' : 'v'
  }

  if (error) {
    return (
      <div className="card">
        <p className="error">{error}</p>
      </div>
    )
  }
  if (!policy) {
    return <div className="card">Loading policy...</div>
  }

  const rawStatus = String(policy.internalStatus || policy.status || '')
  const statusLower = rawStatus.toLowerCase()
  const lastVersion = adjustedVersions.length ? adjustedVersions[adjustedVersions.length - 1] : null
  const canReinstate = isCancelTransactionType(lastVersion?.transactionType) || (!lastVersion && statusLower === 'cancelled')
  const workflowStatus = derivePolicyWorkflowStatus(rawStatus, policy.term)
  const termNumber = countPolicyTermNumber(adjustedVersions)
  const policyPremiumTotal =
    computeCurrentPolicyPremium(adjustedVersions, policy?.term) ||
    lastVersion?.premium?.total ||
    policy?.premium?.total ||
    null

  const customer = policy.customer && typeof policy.customer === 'object' ? policy.customer : null
  const customerId = String(customer?.customerId || customer?.customerKey || '').trim()
  const customerFirstName = String(customer?.firstName || '').trim()
  const customerLastName = String(customer?.lastName || '').trim()
  const customerName = String(
    customer?.name || [customerFirstName, customerLastName].filter(Boolean).join(' ').trim(),
  ).trim()
  const customerLinkLabel = [
    String(customer?.customerKey || '').trim() || String(customer?.customerId || '').trim(),
    customerName,
  ]
    .filter(Boolean)
    .join(' - ')

  return (
    <>
      <div className="ps-page-shell policy-shell">
        <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
          <Link to="/dashboard" className="ps-breadcrumb-link">
            Home
          </Link>
          <span className="ps-breadcrumb-sep" aria-hidden="true">
            /
          </span>
          <Link to="/search" className="ps-breadcrumb-link">
            Policies
          </Link>
          <span className="ps-breadcrumb-sep" aria-hidden="true">
            /
          </span>
          <span className="ps-breadcrumb-current">{policy.policyNumber}</span>
        </nav>

        <div className="card page-shell policy-hero">
          <div className="policy-hero-kicker">Policy workflow</div>
          <div className="ps-page-header policy-page-header">
            <div className="policy-hero-main">
              <h1 className="ps-page-title">
                Policy <span className="id-mono">{policy.policyNumber}</span>
              </h1>
            </div>
            <div className="ps-page-header-actions">
              <span className={`badge ${policyStatusBadgeColor(workflowStatus)}`}>{workflowStatus}</span>
            </div>
          </div>
          <div className="policy-hero-meta">
            <div className="policy-hero-meta-card">
              <div className="policy-hero-meta-label">Customer</div>
              <div className="policy-hero-meta-value">
                {customerId ? (
                  <Link to={`/customers/${encodeURIComponent(customerId)}`}>{customerLinkLabel || customerId}</Link>
                ) : (
                  <span>{customerName || '-'}</span>
                )}
              </div>
            </div>
            <div className="policy-hero-meta-card">
              <div className="policy-hero-meta-label">Policy Premium</div>
              <div className={`policy-hero-meta-value ${isNegativeAmount(policyPremiumTotal) ? 'amount-negative' : ''}`}>
                {formatMoney(policyPremiumTotal) || '-'}
              </div>
            </div>
          </div>
        </div>

        <div id="policy-edit" className="card policy-actions-card policy-section-card">
          <div className="policy-actions-header">
            <h3>Policy Actions</h3>
            <div className="policy-action-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleStartTransaction('endorse')}
                disabled={(!currentPayload && !pendingByMode.endorse) || busy || statusLower === 'cancelled'}
              >
                {pendingByMode.endorse ? 'Continue Endorsement' : 'Endorse'}
              </button>
              {pendingByMode.endorse && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleClearPendingTransaction('endorse')}
                  disabled={busy}
                >
                  Cancel Pending Endorsement
                </button>
              )}

              <button
                type="button"
                className="btn-danger"
                onClick={() => handleStartTransaction('cancel')}
                disabled={(!currentPayload && !pendingByMode.cancel) || busy || statusLower === 'cancelled'}
              >
                {pendingByMode.cancel ? 'Continue Cancellation' : 'Cancel'}
              </button>
              {pendingByMode.cancel && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => handleClearPendingTransaction('cancel')}
                  disabled={busy}
                >
                  Cancel Pending Cancellation
                </button>
              )}

              <button type="button" className="btn-secondary" onClick={() => handleReinstate()} disabled={busy || !canReinstate}>
                Reinstate
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleStartTransaction('rewrite')}
                disabled={(!currentPayload && !pendingByMode.rewrite) || busy || !canReinstate}
              >
                {pendingByMode.rewrite ? 'Continue Rewrite' : 'Rewrite'}
              </button>
              {pendingByMode.rewrite && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleClearPendingTransaction('rewrite')}
                  disabled={busy}
                >
                  Cancel Pending Rewrite
                </button>
              )}

              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleStartTransaction('renew')}
                disabled={(!currentPayload && !pendingByMode.renew) || busy || statusLower === 'cancelled'}
              >
                {pendingByMode.renew ? 'Continue Renewal' : 'Renew'}
              </button>
              {pendingByMode.renew && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleClearPendingTransaction('renew')}
                  disabled={busy}
                >
                  Cancel Pending Renewal
                </button>
              )}

              <button
                type="button"
                className="btn-secondary"
                onClick={() => setNonRenewModalOpen(true)}
                disabled={busy || statusLower === 'cancelled' || !!policy.nonRenewedAt}
                title={policy.nonRenewedAt ? 'Non-renewal already issued' : 'Issue non-renewal notice'}
              >
                Non-Renew
              </button>
            </div>
          </div>
        </div>

        <div className="card policy-summary-card policy-section-card">
          <div className="policy-summary-grid">
            <div className="policy-summary-item">
              <div className="policy-summary-label">Product</div>
              <div className="policy-summary-value">{policy.productCode}</div>
            </div>
            {policy.productVersion && (
              <div className="policy-summary-item">
                <div className="policy-summary-label">Governed Product Version</div>
                <div className="policy-summary-value">{policy.productVersion}</div>
              </div>
            )}
            <div className="policy-summary-item">
              <div className="policy-summary-label">Term</div>
              <div className="policy-summary-value">{termNumber}</div>
            </div>
            <div className="policy-summary-item">
              <div className="policy-summary-label">Policy Effective Date</div>
              <div className="policy-summary-value">{formatDate(policy.term.effectiveDate)}</div>
            </div>
            <div className="policy-summary-item">
              <div className="policy-summary-label">Policy Expiration Date</div>
              <div className="policy-summary-value">{formatDate(policy.term.expirationDate)}</div>
            </div>
          </div>
        </div>

        {rawStatus === 'Bound' && (
          <div className="card policy-bound-alert">
            <div className="policy-bound-alert-row">
              <div>
                <strong>Policy is bound but not issued.</strong>
                <div className="muted">Review/edit details below, then issue to lock the policy.</div>
              </div>
              <button onClick={handleIssuePolicy} disabled={issuePending}>
                {issuePending ? 'Issuing...' : 'Issue Policy'}
              </button>
            </div>
          </div>
        )}

        <PolicyAsOfPanel policyId={policy.policyId} />

        <div className="card policy-section-card policy-versions-card">
          <table className="table table-sticky-header">
            <thead>
              <tr>
                <th data-mobile-label="Transaction #">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('transactionNumber')}>
                    {sortLabel('transactionNumber', 'Transaction #')}
                  </button>
                </th>
                <th data-mobile-label="Effective Date">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('policyEffectiveDate')}>
                    {sortLabel('policyEffectiveDate', 'Effective Date')}
                  </button>
                </th>
                <th data-mobile-label="Transaction Effective Date">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('effectiveDate')}>
                    Transaction
                    <br />
                    {`Effective Date${sortArrow('effectiveDate') ? ` ${sortArrow('effectiveDate')}` : ''}`}
                  </button>
                </th>
                <th data-mobile-label="Expiration">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('expirationDate')}>
                    {sortLabel('expirationDate', 'Expiration')}
                  </button>
                </th>
                <th data-mobile-label="Created Date">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('createdDate')}>
                    {sortLabel('createdDate', 'Created Date')}
                  </button>
                </th>
                <th data-mobile-label="Updated Date">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('updatedDate')}>
                    {sortLabel('updatedDate', 'Updated Date')}
                  </button>
                </th>
                <th data-mobile-label="Updated User">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('updatedUser')}>
                    Updated
                    <br />
                    {`User${sortArrow('updatedUser') ? ` ${sortArrow('updatedUser')}` : ''}`}
                  </button>
                </th>
                <th data-mobile-label="Type">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('transactionType')}>
                    {sortLabel('transactionType', 'Type')}
                  </button>
                </th>
                <th data-mobile-label="Amount">
                  <button type="button" className="table-sort-button" onClick={() => handleSort('amount')}>
                    {sortLabel('amount', 'Amount')}
                  </button>
                </th>
                <th data-mobile-label="Audit">Audit</th>
              </tr>
            </thead>
            <tbody>
              {sortedVersions.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    No versions
                  </td>
                </tr>
              )}
              {versionsPagination.rows.flatMap((version) => {
                const isExpanded = expandedVersionId === version.versionId
                const row = (
                  <tr key={version.versionId}>
                    <td className="muted">
                      <button
                        type="button"
                        className="table-link-button id-mono"
                        onClick={() => handleOpenVersion(version)}
                      >
                        {version.transactionNumber || 'Open'}
                      </button>
                    </td>
                    <td>{formatDate(version.policyEffectiveDate || policy.term?.effectiveDate)}</td>
                    <td>{formatDate(version.effectiveDate)}</td>
                    <td>{formatDate(version.expirationDate || policy.term?.expirationDate)}</td>
                    <td>{formatLedgerTimestamp(version.createdDate || version.processedDate)}</td>
                    <td>{formatLedgerTimestamp(version.updatedDate || version.processedDate)}</td>
                    <td>{version.updatedUser || 'system'}</td>
                    <td>{version.transactionType}</td>
                    <td className={isNegativeAmount(version.premium?.total) ? 'amount-negative' : undefined}>
                      {formatMoney(version.premium?.total)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="table-link-button"
                        onClick={() => setExpandedVersionId(isExpanded ? null : version.versionId)}
                      >
                        {isExpanded ? 'Hide' : 'Audit'}
                      </button>
                    </td>
                  </tr>
                )
                if (!isExpanded) return [row]
                return [
                  row,
                  <tr key={`${version.versionId}-audit`}>
                    <td colSpan={10}>
                      <TransactionAuditPanel
                        policyId={policy.policyId}
                        version={version as JsonRecord & { versionId: string }}
                        timelineTransaction={findAuditTransaction(timeline, version)}
                        ledgerEvents={findAuditLedgerEvents(timeline, version)}
                      />
                    </td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
          {sortedVersions.length > 0 && (
            <TablePagination
              page={versionsPagination.page}
              pageSize={versionsPagination.pageSize}
              totalItems={versionsPagination.totalItems}
              onPageChange={versionsPagination.setPage}
              onPageSizeChange={versionsPagination.setPageSize}
            />
          )}
        </div>

        <PolicyDocumentsPanel policyId={policy.policyId} />

        {(aiInsights || aiInsightsErrorMessage) && (
          <div className="card stack-card policy-section-card policy-ai-card">
            <details className="policy-collapsible" open={!!aiInsightsErrorMessage}>
              <summary className="policy-collapsible-summary">AI / ML Insights</summary>
              <div className="policy-collapsible-body">
                {aiInsightsErrorMessage && <div className="error">{aiInsightsErrorMessage}</div>}
                {aiInsights && <AiInsightsPanel insights={aiInsights} />}
              </div>
            </details>
          </div>
        )}

        {timelineLoading && <div className="card stack-card policy-section-card">Loading history...</div>}
        {timelineErrorMessage && (
          <div className="card stack-card policy-section-card">
            <p className="error">{timelineErrorMessage}</p>
          </div>
        )}
        {timeline && <PolicyTimelineLedgerCard timeline={timeline} />}
      </div>

      {nonRenewModalOpen && (
        <NonRenewModal
          policy={policy}
          busy={nonRenewBusy}
          onClose={() => setNonRenewModalOpen(false)}
          onSubmit={handleNonRenewSubmit}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Policy history (ledger) card
// ---------------------------------------------------------------------------

function PolicyTimelineLedgerCard({ timeline }: { timeline: JsonRecord }) {
  const ledger: JsonRecord[] = Array.isArray(timeline?.ledger) ? timeline.ledger : []
  const ledgerPagination = useClientPagination(ledger, 10)

  return (
    <div className="card stack-card timeline-card">
      <details className="timeline-ledger-collapsible">
        <summary className="timeline-ledger-toggle">History ({ledger.length})</summary>
        {ledger.length === 0 ? (
          <div className="muted">No history recorded.</div>
        ) : (
          <>
            <table className="table timeline-ledger-table">
              <thead>
                <tr>
                  <th data-mobile-label="Event">Event</th>
                  <th data-mobile-label="State">State</th>
                  <th data-mobile-label="Occurred">Occurred</th>
                  <th data-mobile-label="Actor">Actor</th>
                </tr>
              </thead>
              <tbody>
                {ledgerPagination.rows.map((event) => (
                  <tr key={event.eventId}>
                    <td>
                      {formatLedgerEventLabel(event.event)}
                      <div className="muted timeline-ledger-summary">{summarizeLedgerEvent(event)}</div>
                    </td>
                    <td>{[event.fromState, event.toState].filter(Boolean).join(' -> ') || '-'}</td>
                    <td>{formatDateTime(event.occurredAt) || '-'}</td>
                    <td>{event.actor || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={ledgerPagination.page}
              pageSize={ledgerPagination.pageSize}
              totalItems={ledgerPagination.totalItems}
              onPageChange={ledgerPagination.setPage}
              onPageSizeChange={ledgerPagination.setPageSize}
            />
          </>
        )}
      </details>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI / ML insights panel
// ---------------------------------------------------------------------------

function AiInsightsPanel({ insights }: { insights: JsonRecord }) {
  const scores = insights?.scores || {}
  const summary = insights?.summary || {}
  const alerts: string[] = Array.isArray(insights?.alerts) ? insights.alerts : []
  const recommendations: string[] = Array.isArray(insights?.recommendations) ? insights.recommendations : []
  const premiumTimeline: JsonRecord[] = Array.isArray(insights?.premiumTimeline) ? insights.premiumTimeline : []

  return (
    <>
      <div className="row">
        <div className="col">
          <label>Policy Health Score</label>
          <div>{Math.round(Number(insights?.policyHealthScore || 0))}</div>
        </div>
        <div className="col">
          <label>Retention Risk</label>
          <div>{formatPercent(scores.retentionRisk)}</div>
        </div>
        <div className="col">
          <label>Premium Adequacy</label>
          <div>{formatPercent(scores.premiumAdequacy)}</div>
        </div>
        <div className="col">
          <label>Endorsement Complexity</label>
          <div>{formatPercent(scores.endorsementComplexity)}</div>
        </div>
      </div>

      <div className="row row-spaced">
        <div className="col">
          <label>Current Policy Premium</label>
          <div className={Number(summary.currentPolicyPremium) < 0 ? 'amount-negative' : undefined}>
            {formatCurrencyOrDash(summary.currentPolicyPremium)}
          </div>
        </div>
        <div className="col">
          <label>NB Premium</label>
          <div>{formatCurrencyOrDash(summary.nbPremium)}</div>
        </div>
        <div className="col">
          <label>Net Change</label>
          <div className={Number(summary.netChangeAmount) < 0 ? 'amount-negative' : undefined}>
            {formatCurrencyOrDash(summary.netChangeAmount)}
          </div>
        </div>
        <div className="col">
          <label>Out-of-Sequence</label>
          <div>{Number(summary.outOfSequenceTransactions || 0)}</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted">Alerts</div>
          <ul className="dashboard-ai-list">
            {alerts.map((alert, index) => (
              <li key={index}>{alert}</li>
            ))}
          </ul>
        </div>
      )}

      {recommendations.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Recommendations</div>
          <ul className="dashboard-ai-list">
            {recommendations.map((recommendation, index) => (
              <li key={index}>{recommendation}</li>
            ))}
          </ul>
        </div>
      )}

      {premiumTimeline.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Premium Trajectory</div>
          <table className="table">
            <thead>
              <tr>
                <th>Transaction #</th>
                <th>Type</th>
                <th>Transaction Effective Date</th>
                <th>Amount</th>
                <th>Cumulative Policy Premium</th>
              </tr>
            </thead>
            <tbody>
              {premiumTimeline
                .slice(-6)
                .reverse()
                .map((entry, index) => (
                  <tr key={`${entry.transactionNumber || entry.transactionType || 'tx'}-${index}`}>
                    <td>{entry.transactionNumber || '-'}</td>
                    <td>{entry.transactionType || '-'}</td>
                    <td>{formatDate(entry.effectiveDate)}</td>
                    <td className={Number(entry.amount) < 0 ? 'amount-negative' : undefined}>
                      {formatCurrencyOrDash(entry.amount)}
                    </td>
                    <td className={Number(entry.cumulativePolicyPremium) < 0 ? 'amount-negative' : undefined}>
                      {formatCurrencyOrDash(entry.cumulativePolicyPremium)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Non-renew modal
// ---------------------------------------------------------------------------

interface NonRenewModalProps {
  policy: JsonRecord
  busy: boolean
  onClose: () => void
  onSubmit: (noticeDate: string, reasonCode: string, reason: string) => void
}

function NonRenewModal({ policy, busy, onClose, onSubmit }: NonRenewModalProps) {
  const today = new Date().toISOString().slice(0, 10)
  const [noticeDate, setNoticeDate] = useState(today)
  const [reasonCode, setReasonCode] = useState('')
  const [reason, setReason] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(noticeDate, reasonCode, reason)
  }

  const termEndLabel = policy.term?.expirationDate ? new Date(policy.term.expirationDate).toLocaleDateString() : 'term end'

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="modal-header">
          <h3>Non-Renew Policy {policy.policyNumber}</h3>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="muted" style={{ marginBottom: 12 }}>
            This policy will not be renewed at expiration ({termEndLabel}). It remains active until then.
          </div>
          <div className="row">
            <div className="col">
              <label>Notice Date *</label>
              <input
                type="date"
                value={noticeDate}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setNoticeDate(event.target.value)}
                required
              />
              <div className="muted" style={{ fontSize: '0.85em' }}>
                Date notice is sent to insured
              </div>
            </div>
            <div className="col">
              <label>Reason Code</label>
              <select value={reasonCode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setReasonCode(event.target.value)}>
                <option value="">- Select -</option>
                <option value="UW_CHANGE">Underwriting Change</option>
                <option value="CAPACITY">Capacity / Market Exit</option>
                <option value="LOSS_HISTORY">Adverse Loss History</option>
                <option value="RISK_CHANGE">Unacceptable Change in Risk</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label>Reason / Notes</label>
            <textarea
              value={reason}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
              rows={3}
              placeholder="Reason for non-renewal"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button type="submit" disabled={busy}>
              {busy ? 'Processing...' : 'Issue Non-Renewal Notice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
