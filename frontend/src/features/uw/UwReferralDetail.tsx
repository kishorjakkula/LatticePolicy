import { FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { ReasonDialog } from '../../components/Dialog'
import { PageHeader } from '../../components/PageHeader'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import {
  useAddReferralCommentMutation,
  useAssignReferralMutation,
  useDecideReferralMutation,
  useUnderwriters,
  useUwReferral,
} from '../../api/hooks'
import type { UwReferral, UwReferralDecision } from '../../api/uw.api'
import { formatDisplayDate, formatDisplayDateTime } from '../../shared/dateDisplay'
import { productLabel, transactionTypeLabel } from '../../shared/displayLabels'
import {
  AUTHORITY_LIMIT_MESSAGE,
  REFERRAL_STATUS_BADGE,
  assigneeLabel,
  insuredDisplay,
  isAuthorityReferral,
  isDecidable,
  premiumLabel,
  reasonLabel,
  referralAge,
  referralErrorMessage,
  referralStatusLabel,
} from './referralDisplay'
import './uw.css'

type DecisionAction = {
  decision: UwReferralDecision
  button: string
  /** Dialog title, completed with " for <insured>". */
  title: string
  done: string
  optional?: boolean
  danger?: boolean
}

const DECISIONS: Record<UwReferralDecision, DecisionAction> = {
  Approved: { decision: 'Approved', button: 'Approve', title: 'Approve referral', done: 'Referral approved' },
  Declined: { decision: 'Declined', button: 'Decline', title: 'Decline referral', done: 'Referral declined', danger: true },
  InfoRequested: { decision: 'InfoRequested', button: 'Request info', title: 'Request information on referral', done: 'Information requested', optional: true },
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="uw-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function businessFieldLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Preserve arbitrary carrier fields and array order without making JSON the review experience. */
function MaterialFacts({ value }: { value: unknown }) {
  if (value == null) return <span>Unknown (not recorded)</span>
  if (Array.isArray(value)) {
    return value.length ? (
      <ol className="uw-material-list">
        {value.map((item, index) => <li key={index}><MaterialFacts value={item} /></li>)}
      </ol>
    ) : <span>None recorded</span>
  }
  if (isRecord(value)) {
    if (Object.keys(value).length === 1 && typeof value.redactedSha256 === 'string'
      && /^[0-9a-f]{64}$/.test(value.redactedSha256)) return <span>Redacted (sensitive value)</span>
    const fields = Object.entries(value)
    return fields.length ? (
      <dl className="uw-material-facts">
        {fields.map(([key, field]) => (
          <Fact key={key} label={businessFieldLabel(key)}><MaterialFacts value={field} /></Fact>
        ))}
      </dl>
    ) : <span>No fields recorded</span>
  }
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>
  return <span>{value === '' ? 'Empty (recorded)' : String(value)}</span>
}

function reviewedPremiumLabel(value: unknown): string {
  const total = isRecord(value) ? value.total : null
  if (!isRecord(total) || typeof total.amount !== 'number' || !Number.isFinite(total.amount)
    || typeof total.currency !== 'string' || !total.currency.trim()) return 'Unknown (not recorded)'
  try {
    return `${premiumLabel({ amount: total.amount, currency: total.currency })} ${total.currency}`
  } catch {
    return `${total.amount} ${total.currency}`
  }
}

/**
 * Referral detail (WP-0004 REQ-1): why it was referred first, then the key
 * facts, then the decision panel. Every decision goes through ReasonDialog;
 * Approve and Decline need a reason (the server enforces it too), and server
 * refusals such as an authority limit stay in the dialog.
 */
export function UwReferralDetail() {
  const { referralId = '' } = useParams<{ referralId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const canDecide = hasPermission(user, 'uw.referrals.decide')
  const canOverride = hasPermission(user, 'uw.authority.override')
  const currentUserId = user?.id ? String(user.id) : null

  const { data, isLoading, error } = useUwReferral(referralId || null)
  const referral = data as UwReferral | undefined
  const decideMutation = useDecideReferralMutation()
  const assignMutation = useAssignReferralMutation()
  const commentMutation = useAddReferralCommentMutation()
  const underwriters = useUnderwriters()
  const underwriterNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const item of (underwriters.data as any)?.items ?? []) {
      if (item?.userId) names.set(String(item.userId), String(item.displayName || item.username || ''))
    }
    return names
  }, [underwriters.data])

  const [pendingDecision, setPendingDecision] = useState<DecisionAction | null>(null)
  const [commentText, setCommentText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const breadcrumbs = (
    <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
      <Link to="/dashboard" className="ps-breadcrumb-link">Home</Link>
      <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
      <Link to="/uw/queue" className="ps-breadcrumb-link">UW Referrals</Link>
      <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
      <span className="ps-breadcrumb-current">{referral ? insuredDisplay(referral) : 'Referral'}</span>
    </nav>
  )

  if (isLoading) {
    return <div className="ps-page-shell">{breadcrumbs}<div className="muted">Loading…</div></div>
  }
  if (error || !referral) {
    return (
      <div className="ps-page-shell">
        {breadcrumbs}
        <p className="error" role="alert">{error ? referralErrorMessage(error) : 'Referral not found.'}</p>
        <Link to="/uw/queue">Back to UW Referrals</Link>
      </div>
    )
  }

  const insured = insuredDisplay(referral)
  const authorLabel = (by: string | null | undefined) =>
    by && by === currentUserId ? 'You' : (by && underwriterNames.get(by)) || by || 'Unknown user'
  const decidable = isDecidable(referral)
  const authorityBlocked = isAuthorityReferral(referral) && !canOverride
  const mine = !!currentUserId && referral.assignedTo === currentUserId
  const proposal = referral.proposalSnapshot
  const evidenceUnknown = !proposal || !referral.proposalHash
  const approvalDescriptions = [authorityBlocked && 'uw-authority-note', evidenceUnknown && 'uw-proposal-note'].filter(Boolean).join(' ') || undefined

  const submitDecision = async (action: DecisionAction, reason: string) => {
    try {
      await decideMutation.mutateAsync({ referralId: referral.referralId, decision: action.decision, reason: reason || undefined })
    } catch (e) {
      // Thrown back to ReasonDialog, which shows it and stays open.
      throw new Error(referralErrorMessage(e))
    }
    setPendingDecision(null)
    toast.success(action.done, insured)
    navigate('/uw/queue')
  }

  const assignToMe = async () => {
    if (!currentUserId) return
    setActionError(null)
    try {
      await assignMutation.mutateAsync({ referralId: referral.referralId, assignedTo: currentUserId })
      toast.success('Referral assigned to you', insured)
    } catch (e) {
      setActionError(referralErrorMessage(e))
    }
  }

  const onAddComment = async (event: FormEvent) => {
    event.preventDefault()
    const text = commentText.trim()
    if (!text) return
    setActionError(null)
    try {
      await commentMutation.mutateAsync({ referralId: referral.referralId, text })
      setCommentText('')
    } catch (e) {
      setActionError(referralErrorMessage(e))
    }
  }

  return (
    <div className="ps-page-shell uw-referral-detail">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={`Referral: ${insured}`}
        status={
          <span className={`badge ${REFERRAL_STATUS_BADGE[referral.status] || 'gray'}`}>
            {referralStatusLabel(referral.status)}
          </span>
        }
      />

      {actionError && <p className="error" role="alert">{actionError}</p>}

      <CollapsibleSection as="section" title="Why this was referred" className="ps-content-card" aria-label="Why this was referred">
        {(referral.reasons || []).length === 0 ? (
          <p className="muted">No reasons were recorded.</p>
        ) : (
          <ul className="uw-reason-list">
            {referral.reasons.map((reason, index) => (
              <li key={`${reason}-${index}`}>{reasonLabel(reason)}</li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection as="section" title="Key facts" className="ps-content-card" aria-label="Key facts">
        <h4 className="uw-context-title">{referral.policyId ? 'Current policy context' : 'Current quote context'}</h4>
        <dl className="uw-facts">
          <Fact label="Insured">{insured}</Fact>
          <Fact label="Product">{productLabel(referral.productCode)}</Fact>
          <Fact label={referral.policyId ? 'Current policy premium' : 'Current quote premium'}>{premiumLabel(referral.premium)}</Fact>
          <Fact label="Referral effective date">{formatDisplayDate(referral.effectiveDate, { fallback: '-' })}</Fact>
          <Fact label="Referral transaction">{transactionTypeLabel(referral.transactionType)}</Fact>
          <Fact label="Policy">
            {referral.policyId
              ? <Link to={`/policies/${referral.policyId}`}>{referral.policyNumber || 'View policy'}</Link>
              : 'Not yet bound (quote)'}
          </Fact>
          <Fact label="Referred">{referralAge(referral.createdAt)} ago</Fact>
          <Fact label="Assigned">
            <span className="uw-assignee">
              {assigneeLabel(referral.assignedTo, currentUserId, underwriterNames)}
              {canDecide && decidable && currentUserId && !mine && (
                <ActionButton variant="ghost" size="sm" onClick={() => void assignToMe()} disabled={assignMutation.isPending}>
                  {assignMutation.isPending ? 'Assigning…' : 'Assign to me'}
                </ActionButton>
              )}
            </span>
          </Fact>
        </dl>
      </CollapsibleSection>

      <CollapsibleSection as="section" title="Reviewed proposal (immutable)" className="ps-content-card" aria-label="Reviewed proposal (immutable)">
        {evidenceUnknown && (
          <p id="uw-proposal-note" role="note" className="uw-proposal-warning">
            Proposal evidence is unknown or incomplete. A fresh proposal review is required; this referral cannot authorize a new proposal.
          </p>
        )}
        {proposal && (
          <>
            <dl className="uw-facts">
              <Fact label="Reviewed proposed premium">{reviewedPremiumLabel(proposal.premium)}</Fact>
              <Fact label="Proposed effective date">{formatDisplayDate(proposal.effectiveDate, { fallback: 'Unknown (not recorded)' })}</Fact>
              <Fact label="Proposed transaction">{transactionTypeLabel(proposal.transactionType)}</Fact>
              <Fact label="Proposal hash">{referral.proposalHash || 'Unknown (not recorded)'}</Fact>
              <Fact label="Snapshot schema version">{proposal.schemaVersion}</Fact>
              <Fact label="Tenant">{proposal.tenantId}</Fact>
              <Fact label="Proposal quote ID">{proposal.quoteId || 'Not applicable'}</Fact>
              <Fact label="Proposal policy ID">{proposal.policyId || 'Not applicable'}</Fact>
              <Fact label="Proposal reasons"><MaterialFacts value={proposal.reasons.map(reasonLabel)} /></Fact>
            </dl>
            <div className="uw-proposal-group">
              <h4>Proposed business facts (including coverages and risks)</h4>
              <MaterialFacts value={proposal.payload} />
            </div>
            <div className="uw-proposal-group">
              <h4>Base policy version at review</h4>
              <MaterialFacts value={proposal.baseVersion} />
            </div>
            <div className="uw-proposal-group">
              <h4>Reviewed premium details</h4>
              <MaterialFacts value={proposal.premium} />
            </div>
            <div className="uw-proposal-group">
              <h4>Reviewed underwriting evaluation</h4>
              <MaterialFacts value={proposal.underwriting} />
            </div>
            <div className="uw-proposal-group">
              <h4>Reviewed authority evaluation</h4>
              <MaterialFacts value={proposal.authority} />
            </div>
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection as="section" title="Decision" className="ps-content-card" aria-label="Decision">
        {!decidable ? (
          <dl className="uw-facts">
            <Fact label="Outcome">{referralStatusLabel(referral.decision || referral.status)}</Fact>
            <Fact label="Reason">{referral.decisionReason || '-'}</Fact>
            <Fact label="Decided">{formatDisplayDateTime(referral.decidedAt, { fallback: '-', includeTime: true })}</Fact>
            <Fact label="Decided by">{referral.decidedBy ? authorLabel(referral.decidedBy) : '-'}</Fact>
          </dl>
        ) : !canDecide ? (
          <p className="muted">You can view this referral. An underwriter makes the decision.</p>
        ) : (
          <>
            <div className="uw-decision-actions">
              <ActionButton
                variant="primary"
                onClick={() => setPendingDecision(DECISIONS.Approved)}
                disabled={authorityBlocked || evidenceUnknown}
                aria-describedby={approvalDescriptions}
              >
                Approve
              </ActionButton>
              <ActionButton variant="secondary" onClick={() => setPendingDecision(DECISIONS.InfoRequested)}>
                Request info
              </ActionButton>
              <ActionButton variant="danger" onClick={() => setPendingDecision(DECISIONS.Declined)}>
                Decline
              </ActionButton>
            </div>
            {authorityBlocked
              ? <p id="uw-authority-note" className="uw-authority-note">{AUTHORITY_LIMIT_MESSAGE}</p>
              : <p className="muted uw-authority-note">Authority: within your limit.</p>}
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection as="section" title="History" className="ps-content-card" aria-label="History">
        {(referral.comments || []).length === 0 ? (
          <p className="muted">No comments yet.</p>
        ) : (
          <ul className="uw-history">
            {(referral.comments || []).map((comment, index) => (
              <li key={`${comment.at || 'comment'}-${index}`}>
                <div>{comment.text}</div>
                <div className="muted uw-history-meta">
                  {comment.decision ? `${referralStatusLabel(comment.decision)} · ` : ''}
                  {authorLabel(comment.by)}
                  {comment.at ? ` · ${formatDisplayDateTime(comment.at, { fallback: '', includeTime: true })}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={onAddComment} className="uw-comment-form">
          <label htmlFor="referral-comment">Add comment</label>
          <textarea
            id="referral-comment"
            rows={3}
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder="Add underwriting context"
            disabled={commentMutation.isPending}
          />
          <div className="uw-comment-actions">
            <ActionButton type="submit" variant="secondary" size="sm" disabled={!commentText.trim() || commentMutation.isPending}>
              {commentMutation.isPending ? 'Adding…' : 'Add comment'}
            </ActionButton>
          </div>
        </form>
      </CollapsibleSection>

      {pendingDecision && (
        <ReasonDialog
          title={`${pendingDecision.title} for ${insured}`}
          label={pendingDecision.optional ? 'Comment' : 'Reason'}
          help="Shown in the referral history."
          confirmLabel={pendingDecision.button}
          danger={pendingDecision.danger}
          optional={pendingDecision.optional}
          onConfirm={(reason) => submitDecision(pendingDecision, reason)}
          onCancel={() => setPendingDecision(null)}
        />
      )}
    </div>
  )
}
