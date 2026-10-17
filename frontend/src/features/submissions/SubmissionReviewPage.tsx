import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { RadioGroup } from '../../components/RadioGroup'
import { setSubmissionField, useIntakeSettings, useSubmission, useSubmissionAction, useSubmissionChecks } from '../../api/hooks'
import { queryKeys } from '../../api/queryKeys'
import {
  apiErrorMessage,
  apiSubmissions,
  openSubmissionDocument,
  type IntakeSettings,
  type SubmissionChecks,
  type SubmissionDetail,
  type SubmissionDocument,
  type SubmissionField,
} from '../../api/submissions.api'
import { formatDisplayDateTime } from '../../shared/dateDisplay'
import {
  AiTag,
  CONFIDENCE_LABEL,
  Check,
  ScoreMeter,
  Sparkle,
  STATUS_META,
  actorText,
  describeEvent,
  displayValue,
  needsAttention,
  productLabel,
} from './submissionUi'
import './submissions.css'

// ── Steps ─────────────────────────────────────────────────────────────────────

function Steps({ submission }: { submission: SubmissionDetail }) {
  const status = submission.status
  const read = status === 'READING' ? 'current' : status === 'READ_FAILED' ? 'failed' : status === 'RECEIVED' ? 'todo' : 'done'
  const review = status === 'READY_FOR_REVIEW' || status === 'IN_REVIEW' ? 'current' : status === 'COMPLETED' ? 'done' : 'todo'
  const done = status === 'COMPLETED' ? 'done' : 'todo'
  const items: Array<[string, string]> = [
    ['Received', 'done'],
    [read === 'failed' ? 'Reading failed' : read === 'current' ? 'AI reading…' : `Read ${submission.documents.length} document${submission.documents.length === 1 ? '' : 's'}`, read],
    ['You review the data', review],
    ['You approve', done],
    [submission.quoteNumber ? `Quote ${submission.quoteNumber} created` : 'Quote created', done],
  ]
  return (
    <ol className="si-steps" aria-label="Submission progress">
      {items.map(([label, state]) => (
        <li key={label} className={state === 'done' ? 'is-done' : state === 'current' ? 'is-current' : state === 'failed' ? 'is-failed' : ''} aria-current={state === 'current' ? 'step' : undefined}>
          {state === 'done' && <Check />}
          {label}
        </li>
      ))}
    </ol>
  )
}

// ── Source documents ──────────────────────────────────────────────────────────

function DocumentViewer({ submission, selected, docId, onDoc }: { submission: SubmissionDetail; selected: SubmissionField | null; docId: string | null; onDoc: (id: string) => void }) {
  const evidence = selected ? (selected.confidence === 'conflict' ? selected.alternatives : selected.evidence) : []
  const fallbackDoc = evidence[0]?.documentId || submission.documents[0]?.documentId || null
  const current = submission.documents.find((document) => document.documentId === (docId || fallbackDoc)) || submission.documents[0]
  const [openError, setOpenError] = useState<string | null>(null)
  const paper = useRef<HTMLDivElement>(null)
  // Bring the source line into view inside the document pane (not the page) when the selection changes.
  useEffect(() => {
    const container = paper.current
    const line = container?.querySelector<HTMLElement>('.is-source')
    if (container && line) container.scrollTop = Math.max(0, line.offsetTop - container.offsetTop - 40)
  }, [selected?.key, current?.documentId])
  if (!current) return null
  const sourceLines = new Set(evidence.filter((item) => item.documentId === current.documentId && item.line != null).map((item) => item.line as number))
  const otherEvidence = evidence.filter((item) => item.documentId === current.documentId && item.line == null)
  const docsWithEvidence = new Set(evidence.map((item) => item.documentId))

  const open = async (document: SubmissionDocument) => {
    setOpenError(null)
    try { await openSubmissionDocument(submission.submissionId, document.documentId) } catch (err) { setOpenError(apiErrorMessage(err)) }
  }

  return (
    <section className="si-card si-col-docs" aria-label="Source documents">
      <div className="si-card-pad" style={{ paddingBottom: 10 }}>
        <h2>Source documents</h2>
        <div className="si-muted si-small">{selected ? <>Highlighted: where <b>{selected.label}</b> came from.</> : 'Select a value to see where it came from.'}</div>
        <div className="si-doc-tabs">
          {submission.documents.map((document) => (
            <button key={document.documentId} type="button" className="si-doc-tab" aria-pressed={document.documentId === current.documentId} onClick={() => onDoc(document.documentId)} title={document.fileName}>
              {docsWithEvidence.has(document.documentId) && <span aria-hidden="true" style={{ color: 'var(--si-ai)' }}>● </span>}
              {document.fileName}
              {docsWithEvidence.has(document.documentId) && <span className="sr-only"> (has the source)</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="si-paper-wrap">
        {current.lines.length ? (
          <div className="si-paper" role="document" aria-label={current.fileName} ref={paper}>
            {current.lines.map((line, index) => {
              const isSource = sourceLines.has(index)
              return (
                <div key={index} className={`si-line${isSource ? ' is-source' : ''}`}>
                  <span className="si-line-no">{index + 1}</span>
                  <span>
                    {isSource && <span className="si-source-label">Source for {selected?.label}</span>}
                    {line}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="si-paper" style={{ fontFamily: 'inherit' }}>
            <p style={{ marginTop: 0 }}>
              {current.contentType === 'application/pdf' ? 'PDF' : 'Image'} document. {submission.aiRun?.provider === 'anthropic' ? 'The AI model read it directly.' : 'The built-in reader cannot read this format.'}
            </p>
            {otherEvidence.map((item, index) => (
              <blockquote key={index} style={{ margin: '8px 0', padding: '8px 12px', borderLeft: '3px solid var(--si-ai)', background: 'var(--si-highlight)' }}>
                <span className="si-source-label">Quoted by the AI{item.page ? `, page ${item.page}` : ''}</span>
                “{item.quote}”
              </blockquote>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }} className="si-small si-muted">
          <span>{current.contentType} · {Math.max(1, Math.round(current.sizeBytes / 1024))} KB</span>
          <button type="button" className="si-link" onClick={() => void open(current)}>Open original</button>
        </div>
        {openError && <div className="si-small" role="alert" style={{ color: 'var(--si-low-fg)' }}>{openError}</div>}
      </div>
    </section>
  )
}

// ── One drafted value ─────────────────────────────────────────────────────────

function evidenceNote(field: SubmissionField, documents: SubmissionDocument[]): string {
  const items = field.confidence === 'conflict' ? field.alternatives : field.evidence
  if (!items.length) return ''
  const first = items[0]
  const name = documents.find((document) => document.documentId === first.documentId)?.fileName || 'document'
  const where = first.line != null ? `line ${first.line + 1}` : first.page ? `page ${first.page}` : ''
  const check = first.verified ? 'Quote checked against the document.' : first.line == null && first.page ? 'Quote from a PDF; check it in the original.' : 'The quoted text was not found in the document.'
  return `${name}${where ? `, ${where}` : ''}. ${check}`
}

function FieldRow({ submission, field, selected, onSelect, canEdit, settings }: {
  submission: SubmissionDetail
  field: SubmissionField
  selected: boolean
  onSelect: () => void
  canEdit: boolean
  settings?: IntakeSettings
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(field.value ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft(field.value ?? '') }, [field.value])

  const inputId = `si-field-${field.key.replace(/[^\w-]/g, '-')}`
  const accepted = field.status === 'accepted'
  const sourceDoc = (field.confidence === 'conflict' ? field.alternatives[0] : field.evidence[0])
  const sourceName = sourceDoc ? submission.documents.find((document) => document.documentId === sourceDoc.documentId)?.fileName : null

  const send = async (action: 'set' | 'accept' | 'undo', value?: string) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await apiSubmissions.updateField(submission.submissionId, field.key, value === undefined ? { action } : { action, value })
      if (field.key === 'productCode') await qc.invalidateQueries({ queryKey: queryKeys.submissions.detail(submission.submissionId) })
      else setSubmissionField(qc, submission.submissionId, updated)
    } catch (err) {
      setError(apiErrorMessage(err))
      setDraft(field.value ?? '')
    } finally {
      setBusy(false)
    }
  }

  const changed = draft !== (field.value ?? '')
  const needsValue = (field.required || field.confidence === 'conflict') && !draft.trim()
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !needsValue) { event.preventDefault(); void send('accept', draft) }
  }
  const acceptLabel = changed || field.confidence === 'missing' || field.confidence === 'conflict' ? 'Confirm' : 'Accept'
  const badge = accepted
    ? { text: !field.value ? 'Left blank' : !field.aiValue ? 'Entered by you' : field.edited ? 'Changed by you' : 'Confirmed', tone: 'neutral' }
    : { text: CONFIDENCE_LABEL[field.confidence], tone: field.confidence }

  return (
    <div className={`si-field${selected ? ' is-selected' : ''}`}>
      <div className="si-field-row">
        <label htmlFor={inputId} className="si-field-label">
          {field.label}{field.required && <span aria-hidden="true" style={{ color: 'var(--si-low-fg)' }}> *</span>}
          {field.required && <span className="sr-only"> (required)</span>}
        </label>
        {field.confidence === 'conflict' && !accepted ? (
          <div className="si-choices" role="group" aria-label={`${field.label}: the documents disagree, choose one`}>
            {field.alternatives.map((option, index) => {
              const name = submission.documents.find((document) => document.documentId === option.documentId)?.fileName || 'document'
              return (
                <button key={`${option.value}-${index}`} type="button" className="si-choice" aria-pressed={draft === option.value} disabled={!canEdit || busy}
                  onClick={() => { onSelect(); setDraft(option.value); void send('set', option.value) }}>
                  {option.value} · {name}
                </button>
              )
            })}
            <input id={inputId} className="si-input" style={{ flex: '1 1 140px' }} placeholder="Or enter a value" value={field.alternatives.some((option) => option.value === draft) ? '' : draft}
              disabled={!canEdit || busy} onFocus={onSelect} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (changed && draft) void send('set', draft) }} onKeyDown={onKeyDown} />
          </div>
        ) : field.type === 'select' ? (
          <div className="si-field-input">
            <select id={inputId} className={`si-input${changed || field.edited ? ' is-edited' : ''}${!draft ? ' is-empty' : ''}`} value={draft} disabled={!canEdit || busy || accepted}
              onFocus={onSelect} onChange={(event) => { setDraft(event.target.value); void send('set', event.target.value) }}>
              <option value="">{field.confidence === 'missing' ? 'Not in the documents. Choose…' : 'Choose…'}</option>
              {field.options.map((option) => <option key={option} value={option}>{displayValue(field, option, settings)}</option>)}
              {draft && !field.options.includes(draft) && <option value={draft}>{draft}</option>}
            </select>
          </div>
        ) : (
          <div className="si-field-input">
            <input id={inputId} className={`si-input${changed || field.edited ? ' is-edited' : ''}${!draft ? ' is-empty' : ''}`} value={draft}
              type={field.type === 'date' ? 'date' : 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined}
              placeholder={field.confidence === 'missing' ? 'Not in the documents. Enter a value' : ''} disabled={!canEdit || busy || accepted}
              onFocus={onSelect} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (changed) void send('set', draft) }} onKeyDown={onKeyDown} />
          </div>
        )}
        <span className={`si-pill si-tone-${badge.tone}`}>{badge.text}</span>
        {typeof field.confidenceScore === 'number' && (
          <ScoreMeter score={field.confidenceScore} tone={accepted ? 'neutral' : field.confidence} />
        )}
        {sourceName && (
          <button type="button" className="si-btn si-btn-sm" onClick={onSelect} aria-label={`Show where ${field.label} came from`}>
            {sourceName.length > 18 ? `${sourceName.slice(0, 16)}…` : sourceName}
            {sourceDoc?.line != null ? ` · ${sourceDoc.line + 1}` : sourceDoc?.page ? ` · p${sourceDoc.page}` : ''}
          </button>
        )}
        {canEdit && (accepted ? (
          <>
            <span className="si-done"><Check />{!field.value ? 'Left blank' : !field.aiValue ? 'You entered it' : field.edited ? 'You changed it' : 'Accepted'}</span>
            <button type="button" className="si-link" disabled={busy} onClick={() => void send('undo')} aria-label={`Undo ${field.label}`}>Undo</button>
          </>
        ) : (
          <button type="button" className="si-btn si-btn-sm" style={{ minWidth: 104, color: needsValue ? undefined : 'var(--accent-strong)', borderColor: needsValue ? undefined : 'var(--accent)' }}
            disabled={busy || needsValue} onClick={() => { onSelect(); void send('accept', draft) }}
            aria-label={`${acceptLabel} ${field.label}`}>
            {acceptLabel}
          </button>
        ))}
        {error && <div className="si-field-error" role="alert">{error}</div>}
      </div>
      {selected && (field.reason || field.aiValue) && (
        <div className="si-why">
          <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <span style={{ marginTop: 3, color: 'var(--si-ai)' }}><Sparkle /></span>
            <span><b>Why this was suggested:</b> {field.reason || 'Found in the documents.'}</span>
          </span>
          {typeof field.confidenceScore === 'number' && (
            <span>
              <b>Confidence {field.confidenceScore}%</b>
              {' '}({field.confidenceScore >= 85 ? 'high: 85% or more' : field.confidenceScore >= 60 ? 'medium: 60 to 84%, check it' : 'low: below 60%, check it'}).
              {' '}{submission.aiRun?.provider === 'anthropic' ? 'Reported by the AI model, lowered by LatticePolicy if its checks fail.' : 'Set by the built-in reader from how the value was matched.'}
            </span>
          )}
          {field.aiValue && field.edited && <span>AI value: <b>{displayValue(field, field.aiValue, settings)}</b></span>}
          {evidenceNote(field, submission.documents) && <span className="si-muted" style={{ color: 'inherit', opacity: 0.85 }}>{evidenceNote(field, submission.documents)}</span>}
        </div>
      )}
    </div>
  )
}

// ── Side panel ────────────────────────────────────────────────────────────────

function SidePanel({ submission, checks, settings }: { submission: SubmissionDetail; checks?: SubmissionChecks; settings?: IntakeSettings }) {
  const run = submission.aiRun || {}
  const appetite = checks?.appetite
  const appetiteMark = appetite?.decision === 'Eligible' ? 'is-ok' : appetite?.decision === 'Refer' ? 'is-warn' : appetite?.decision === 'Decline' ? 'is-bad' : ''
  return (
    <aside className="si-col-side" aria-label="Summary and checks">
      {run.summary && (
        <div className="si-card si-card-pad" style={{ borderColor: 'var(--si-ai-border)' }}>
          <div style={{ marginBottom: 8 }}><AiTag>{run.provider === 'anthropic' ? 'AI summary' : 'Reader summary'}</AiTag></div>
          <p style={{ margin: '0 0 10px' }}>{run.summary}</p>
          {run.productReason && <p className="si-small" style={{ margin: '0 0 10px' }}><b>Product:</b> {productLabel(settings, submission.productCode)}. {run.productReason}</p>}
          <div className="si-small si-muted" style={{ borderTop: '1px solid var(--si-ai-border)', paddingTop: 8 }}>
            {typeof run.counts?.averageScore === 'number' && <><b>Average confidence {run.counts.averageScore}%</b> across {run.counts.drafted} drafted values. </>}
            {run.label || 'Reader'} · read {run.documentsRead ?? '?'} of {run.documentsTotal ?? submission.documents.length} documents{run.finishedAt ? ` · ${formatDisplayDateTime(run.finishedAt)}` : ''}.
            {' '}The reader can be wrong; you approve the final data.
          </div>
          {Array.isArray(run.warnings) && run.warnings.length > 0 && (
            <ul className="si-small" style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--si-medium-fg)' }}>
              {run.warnings.map((warning: string) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </div>
      )}

      {(submission.status === 'READY_FOR_REVIEW' || submission.status === 'IN_REVIEW') && (
      <div className="si-card si-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0 }}>Checks</h2>
        {!checks ? <div className="si-muted si-small">Running checks…</div> : (
          <>
            <div className="si-check">
              <span className={`si-check-mark ${checks.clearance.customerMatches.length || checks.clearance.openSubmissions.length ? 'is-warn' : 'is-ok'}`} aria-hidden="true">{checks.clearance.customerMatches.length || checks.clearance.openSubmissions.length ? '!' : '✓'}</span>
              <span>
                <b>Clearance:</b>{' '}
                {checks.clearance.customerMatches.length
                  ? `${checks.clearance.customerMatches.length} possible existing customer${checks.clearance.customerMatches.length > 1 ? 's' : ''} (${checks.clearance.customerMatches.map((match) => match.displayName).join(', ')}). You choose at approval.`
                  : 'no existing customer matches the name, FEIN, or contact details.'}
                {checks.clearance.openSubmissions.length > 0 && (
                  <> Also open: {checks.clearance.openSubmissions.map((item) => <Link key={item.submissionId} to={`/submissions/${item.submissionId}`} style={{ marginRight: 6 }}>{item.submissionNumber}</Link>)}</>
                )}
              </span>
            </div>
            <div className="si-check">
              <span className={`si-check-mark ${appetiteMark}`} aria-hidden="true">{appetite?.decision === 'Eligible' ? '✓' : appetite?.decision === 'Decline' ? '✕' : appetite?.evaluated ? '!' : '·'}</span>
              <span>
                <b>Appetite:</b>{' '}
                {appetite?.evaluated
                  ? appetite.decision === 'Eligible' ? 'meets the underwriting rules.' : appetite.decision === 'Refer' ? 'the quote will be referred to an underwriter.' : 'outside appetite under the underwriting rules.'
                  : appetite?.note || 'not checked yet.'}
                {appetite?.reasons?.length ? <ul className="si-small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{appetite.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
              </span>
            </div>
            {submission.customerChoice?.mode !== 'existing' && (checks.clearance.newCustomerProblems || []).length > 0 && (
              <div className="si-check">
                <span className="si-check-mark is-bad" aria-hidden="true">✕</span>
                <span><b>New customer:</b> {checks.clearance.newCustomerProblems.join('; ')}. Add the missing details, or link an existing customer.</span>
              </div>
            )}
            <div className="si-check">
              <span className={`si-check-mark ${checks.missingRequired.length ? 'is-warn' : 'is-ok'}`} aria-hidden="true">{checks.missingRequired.length ? '!' : '✓'}</span>
              <span><b>Required values:</b> {checks.missingRequired.length ? `missing ${checks.missingRequired.map((item) => item.label).join(', ')}.` : 'all present.'}</span>
            </div>
            <div className="si-small si-muted">These checks use your carrier's own rules and customer records, not the AI.</div>
          </>
        )}
      </div>
      )}

      <CollapsibleSection className="si-card si-card-pad" title="Activity" defaultOpen={false}>
        <ol className="si-activity">
          {submission.events.map((event, index) => (
            <li key={index}>
              <time dateTime={event.createdAt}>{formatDisplayDateTime(event.createdAt)}</time>
              <span className={`si-pill si-tone-${event.actorType === 'ai' ? 'ai' : event.actorType === 'system' ? 'info' : 'neutral'}`} style={{ marginRight: 6 }}>{actorText(event)}</span>
              {describeEvent(event)}
            </li>
          ))}
        </ol>
      </CollapsibleSection>
    </aside>
  )
}

// ── Approval ──────────────────────────────────────────────────────────────────

function ApprovalDialog({ submission, checks, settings, canApprove, onClose }: {
  submission: SubmissionDetail
  checks?: SubmissionChecks
  settings?: IntakeSettings
  canApprove: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [attested, setAttested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = checks?.clearance.customerMatches || []
  // With possible matches, the reviewer must pick the existing customer: creating a
  // duplicate anyway is an administrator decision, so "new" is not offered then.
  const [pickedCustomer, setPickedCustomer] = useState<string | null>(null)
  const companies = checks?.underwritingCompanies || []
  const [companyId, setCompanyId] = useState('')
  useEffect(() => { if (companies.length === 1) setCompanyId(companies[0].companyId) }, [companies.length, companies[0]?.companyId])
  const savedExisting = submission.customerChoice?.mode === 'existing' && submission.customerChoice.customerId ? submission.customerChoice.customerId : null
  const chosenExisting = pickedCustomer && pickedCustomer !== 'new' ? pickedCustomer : pickedCustomer === 'new' ? null : savedExisting
  const choice = matches.length ? chosenExisting : chosenExisting || 'new'
  const needsCustomerChoice = matches.length > 0 && !chosenExisting

  const asDrafted = submission.fields.filter((field) => field.aiValue && !field.edited).length
  const changed = submission.fields.filter((field) => field.aiValue && field.edited)
  const entered = submission.fields.filter((field) => !field.aiValue && field.value)
  const insured = submission.fields.find((field) => field.key === 'insuredName')?.value
  const product = productLabel(settings, submission.fields.find((field) => field.key === 'productCode')?.value)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const chooseCustomer = async (value: string) => {
    setError(null)
    setPickedCustomer(value)
    try {
      await apiSubmissions.setCustomer(submission.submissionId, value === 'new' ? { mode: 'new' } : { mode: 'existing', customerId: value })
      await qc.invalidateQueries({ queryKey: queryKeys.submissions.detail(submission.submissionId) })
    } catch (err) {
      setPickedCustomer(null)
      setError(apiErrorMessage(err))
    }
  }

  const approve = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiSubmissions.approve(submission.submissionId, companyId || undefined)
      await qc.invalidateQueries({ queryKey: queryKeys.submissions.all() })
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="si-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="si-dialog" role="dialog" aria-modal="true" aria-labelledby="si-approve-title">
        <div className="si-dialog-head">
          <h2 id="si-approve-title">Approve {insured || 'this submission'}</h2>
          <div className="si-muted si-small">{product}{submission.submissionNumber ? ` · ${submission.submissionNumber}` : ''}</div>
        </div>
        <div className="si-dialog-body">
          <div className="si-stats">
            <div className="si-stat"><b>{asDrafted}</b>confirmed as drafted</div>
            <div className="si-stat"><b>{changed.length}</b>changed by you</div>
            <div className="si-stat"><b>{entered.length}</b>entered by you</div>
          </div>

          {changed.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Your changes to the AI draft</h3>
              <table className="si-diff">
                <thead><tr><th>Field</th><th>AI drafted</th><th>You approved</th></tr></thead>
                <tbody>
                  {changed.map((field) => (
                    <tr key={field.key}>
                      <td>{field.label}</td>
                      <td><del>{displayValue(field, field.aiValue, settings)}</del></td>
                      <td><b>{displayValue(field, field.value, settings)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 id="si-customer-title" style={{ margin: '0 0 6px', fontSize: 15 }}>Customer</h3>
            {matches.length ? (
              <>
                <p className="si-small" style={{ margin: '0 0 8px' }}>This insured may already be a customer. Choose the matching customer to link the quote to.</p>
                <RadioGroup
                  name="si-customer-choice"
                  labelledBy="si-customer-title"
                  value={choice}
                  required
                  invalid={needsCustomerChoice}
                  onChange={(value: string) => void chooseCustomer(value)}
                  options={matches.map((match) => ({ value: match.customerId, label: `${match.displayName} (${match.customerKey}) · ${match.reasons.join(', ') || `match ${match.matchScore}`}` }))}
                />
                <p className="si-small si-muted" style={{ margin: '8px 0 0' }}>If none of these is the insured, an administrator must create the new customer, because it looks like a duplicate.</p>
              </>
            ) : (
              <p className="si-small" style={{ margin: 0 }}>No existing customer matches. A new customer <b>{insured}</b> will be created.</p>
            )}
          </div>

          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}><label htmlFor="si-company">Underwriting company</label></h3>
            {companies.length ? (
              <>
                <select id="si-company" className="si-input" style={{ maxWidth: 420 }} value={companyId} onChange={(event) => setCompanyId(event.target.value)} required aria-invalid={!companyId || undefined}>
                  <option value="">Choose the company that will write this quote…</option>
                  {companies.map((company) => <option key={company.companyId} value={company.companyId}>{company.name}</option>)}
                </select>
                <p className="si-small si-muted" style={{ margin: '6px 0 0' }}>Companies that write {product || 'this product'} in {submission.fields.find((field) => field.key === 'state')?.value || 'this state'}.</p>
              </>
            ) : (
              <div className="si-banner is-error" role="alert"><p>No active underwriting company writes {product || 'this product'} in {submission.fields.find((field) => field.key === 'state')?.value || 'this state'}. An administrator must set one up before this can be approved.</p></div>
            )}
          </div>

          {choice === 'new' && (checks?.clearance.newCustomerProblems || []).length > 0 && (
            <div className="si-banner is-error" role="alert">
              <p><b>A new customer cannot be created yet:</b> {checks!.clearance.newCustomerProblems.join('; ')}. Go back and add these details, or choose an existing customer.</p>
            </div>
          )}

          {checks?.appetite?.evaluated && checks.appetite.decision !== 'Eligible' && (
            <div className={`si-banner ${checks.appetite.decision === 'Decline' ? 'is-error' : 'is-info'}`}>
              <p><b>Underwriting rules: {checks.appetite.decision === 'Refer' ? 'referral' : 'outside appetite'}.</b> {checks.appetite.reasons.join(' ')} The quote is still created; the rules apply again when it is rated.</p>
            </div>
          )}

          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>When you approve, LatticePolicy will</h3>
            <ol className="si-plan">
              <li>{choice === 'new' ? 'Create the customer with the approved insured details.' : 'Link the quote to the chosen existing customer.'}</li>
              <li>Create a draft {product} quote{companies.find((company) => company.companyId === companyId) ? ` with ${companies.find((company) => company.companyId === companyId)!.name}` : ''} from the approved values, including the qualification answers, linked to this submission.</li>
              <li>Open the quote at the risk step, so you can choose coverages and rate it. Rating and underwriting rules run as usual.</li>
            </ol>
            <p className="si-small si-muted" style={{ margin: '8px 0 0' }}>All of this happens in one step. If any part fails, nothing is created and the submission stays open.</p>
          </div>

          <label className="si-attest">
            <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} disabled={!canApprove} />
            <span>{settings?.attestation || 'I checked the values against the source documents and approve creating the customer and draft quote.'}</span>
          </label>
          {needsCustomerChoice && <div className="si-banner is-info"><p>Choose the customer above before approving.</p></div>}
          {!canApprove && <div className="si-banner is-info"><p>Your role can review but not approve. An underwriter with approval permission must approve this submission.</p></div>}
          {error && <div className="si-banner is-error" role="alert"><p>{error}</p></div>}
        </div>
        <div className="si-dialog-foot">
          <button type="button" className="si-btn" onClick={onClose} disabled={busy}>Back to review</button>
          <button type="button" className="si-btn si-btn-primary si-btn-lg" disabled={!canApprove || !attested || busy || needsCustomerChoice || !companyId || (choice === 'new' && (checks?.clearance.newCustomerProblems || []).length > 0)} onClick={() => void approve()}>
            {busy ? 'Approving…' : 'Approve and create quote'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SubmissionReviewPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const qc = useQueryClient()
  const canManage = hasPermission(user, 'submissions.manage')
  const canApprove = hasPermission(user, 'submissions.approve')
  const canSeeCustomer = hasPermission(user, 'admin.customers.read')
  const { data: submission, isLoading, error } = useSubmission(id)
  const { data: settings } = useIntakeSettings()
  const reviewable = submission?.status === 'READY_FOR_REVIEW' || submission?.status === 'IN_REVIEW'
  const checksVersion = useMemo(() => (submission ? submission.fields.map((field) => `${field.key}=${field.value ?? ''}`).join('|') + `|${submission.customerChoice?.customerId || ''}` : ''), [submission])
  // Checks guide the review; after approval they would only find the customer the approval created.
  const { data: checks } = useSubmissionChecks(id, !!submission && reviewable, checksVersion)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'attention'>('all')
  const [approving, setApproving] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [rereadArmed, setRereadArmed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const read = useSubmissionAction(id, (productCode: string | null) => apiSubmissions.read(id, productCode))
  const acceptHigh = useSubmissionAction(id, () => apiSubmissions.acceptHighConfidence(id))
  const decline = useSubmissionAction(id, (reason: string) => apiSubmissions.decline(id, reason))

  const fields = submission?.fields || []
  const confirmed = fields.filter((field) => field.status === 'accepted').length
  const highLeft = fields.filter((field) => field.status !== 'accepted' && field.confidence === 'high' && field.value && field.value === field.aiValue).length
  const attentionLeft = fields.filter(needsAttention).length
  const ready = fields.length > 0 && confirmed === fields.length
  const selected = fields.find((field) => field.key === selectedKey) || null
  const productField = fields.find((field) => field.key === 'productCode')
  const productChanged = !!productField && !!productField.value && productField.value !== submission?.productCode
  const riskFieldsEmpty = fields.some((field) => field.key.startsWith('risk.')) && fields.filter((field) => field.key.startsWith('risk.')).every((field) => !field.aiValue)

  useEffect(() => {
    if (!selectedKey && fields.length) {
      const first = fields.find(needsAttention) || fields[0]
      setSelectedKey(first.key)
    }
  }, [fields, selectedKey])

  const sections = useMemo(() => {
    const out: Array<{ title: string; fields: SubmissionField[]; total: number; done: number }> = []
    for (const field of fields) {
      let section = out.find((item) => item.title === field.section)
      if (!section) { section = { title: field.section, fields: [], total: 0, done: 0 }; out.push(section) }
      section.total++
      if (field.status === 'accepted') section.done++
      if (filter === 'all' || needsAttention(field)) section.fields.push(field)
    }
    return out.filter((section) => section.fields.length)
  }, [fields, filter])

  const run = async <T,>(promise: Promise<T>) => {
    setActionError(null)
    try { return await promise } catch (err) { setActionError(apiErrorMessage(err)); return undefined }
  }

  if (isLoading) return <div className="si-page"><div className="si-empty">Loading submission…</div></div>
  if (error || !submission) return <div className="si-page"><div className="si-banner is-error" role="alert"><p>{error ? apiErrorMessage(error) : 'Submission not found.'}</p><Link to="/submissions" className="si-btn">Back to submissions</Link></div></div>

  const meta = STATUS_META[submission.status]
  const insuredName = fields.find((field) => field.key === 'insuredName')?.value || submission.insuredName || submission.subject || submission.submissionNumber
  const open = ['RECEIVED', 'READING', 'READ_FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW'].includes(submission.status)

  return (
    <div className="si-page">
      <div className="si-head">
        <div className="si-grow">
          <div className="si-small si-muted"><Link to="/submissions">Submissions</Link> / {submission.submissionNumber}</div>
          <h1>{insuredName}</h1>
          <div className="si-actions si-small" style={{ marginTop: 6 }}>
            <span className={`si-pill si-tone-${meta.tone}`}>{meta.label}</span>
            {submission.productCode && <span className="si-pill si-tone-ai"><Sparkle />{productLabel(settings, submission.productCode)}{submission.aiRun?.counts ? ' · detected' : ''}</span>}
            {submission.brokerName && <span className="si-muted">{submission.brokerName}</span>}
            <span className="si-muted">Received {formatDisplayDateTime(submission.receivedAt)}</span>
            {submission.assignedTo && <span className="si-muted">Reviewer: {submission.assignedTo}</span>}
          </div>
        </div>
        <div className="si-actions">
          {canManage && (reviewable || submission.status === 'READ_FAILED') && (
            rereadArmed ? (
              <>
                <span className="si-small">{confirmed ? `Reading again discards ${confirmed} confirmation${confirmed > 1 ? 's' : ''}.` : 'Read the documents again?'}</span>
                <button type="button" className="si-btn" onClick={() => { setRereadArmed(false); void run(read.mutateAsync(productField?.value || null)) }}>Read again</button>
                <button type="button" className="si-link" onClick={() => setRereadArmed(false)}>Cancel</button>
              </>
            ) : (
              <button type="button" className="si-btn" disabled={read.isPending} onClick={() => setRereadArmed(true)}>Read again</button>
            )
          )}
          {canApprove && open && !declining && <button type="button" className="si-btn si-btn-danger" onClick={() => setDeclining(true)}>Decline</button>}
        </div>
      </div>

      {declining && (
        <div className="si-card si-card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600 }}>
            Reason for declining
            <input className="si-input" value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} autoFocus />
          </label>
          <button type="button" className="si-btn si-btn-danger" disabled={!declineReason.trim() || decline.isPending} onClick={() => void run(decline.mutateAsync(declineReason.trim())).then(() => setDeclining(false))}>Decline submission</button>
          <button type="button" className="si-link" onClick={() => setDeclining(false)}>Cancel</button>
        </div>
      )}

      <Steps submission={submission} />
      {actionError && <div className="si-banner is-error" role="alert"><p>{actionError}</p></div>}

      {submission.status === 'READING' && (
        <div className="si-ai-note" role="status">
          <AiTag>Reading</AiTag>
          <p><b>{submission.aiRun?.label || 'The reader'} is reading {submission.documents.length} document{submission.documents.length === 1 ? '' : 's'}.</b> Values appear here for your review when it finishes. Nothing is created from them until you approve.</p>
          <div className="si-bar" aria-hidden="true"><span /></div>
        </div>
      )}
      {submission.status === 'READ_FAILED' && (
        <div className="si-banner is-error" role="alert">
          <p><b>The documents could not be read.</b> {submission.readError}</p>
          {canManage && <button type="button" className="si-btn" onClick={() => void run(read.mutateAsync(null))}>Try again</button>}
        </div>
      )}
      {submission.status === 'COMPLETED' && (
        <div className="si-banner is-success" role="status">
          <p><b>Approved by {submission.approvedBy}{submission.approvedAt ? ` on ${formatDisplayDateTime(submission.approvedAt)}` : ''}.</b> Draft quote {submission.quoteNumber} was created{submission.customerId ? ' for the customer' : ''}.</p>
          {submission.quoteId && <Link className="si-btn si-btn-primary" to={`/wizard?quoteId=${submission.quoteId}`}>Open quote {submission.quoteNumber}</Link>}
          {submission.customerId && canSeeCustomer && <Link className="si-btn" to={`/customers/${submission.customerId}`}>Open customer</Link>}
        </div>
      )}
      {submission.status === 'DECLINED' && (
        <div className="si-banner is-info" role="status"><p><b>Declined by {submission.declinedBy}.</b> {submission.declineReason}</p></div>
      )}

      {reviewable && (
        <section className="si-ai-note" aria-label="How to review">
          <AiTag>{submission.aiRun?.provider === 'anthropic' ? 'AI draft' : 'Reader draft'}</AiTag>
          <p>
            <b>Check each value against its source, then accept it.</b> Values marked <i>check</i>, <i>not found</i>, or <i>documents disagree</i> need you.
            {submission.aiRun?.provider === 'anthropic' ? ' Drafted by ' + (submission.aiRun?.label || 'the AI model') + '.' : ' Drafted by the built-in reader, which matches labels and does not understand free text.'}
          </p>
        </section>
      )}
      {reviewable && productChanged && riskFieldsEmpty && canManage && (
        <div className="si-banner is-info">
          <p>You changed the product to <b>{productLabel(settings, productField?.value)}</b>. Its fields are empty: read the documents again for this product, or fill them in.</p>
          <button type="button" className="si-btn" onClick={() => void run(read.mutateAsync(productField?.value || null))}>Read again as {productLabel(settings, productField?.value)}</button>
        </div>
      )}

      {fields.length > 0 && (
        <div className="si-columns">
          <DocumentViewer submission={submission} selected={selected} docId={docId} onDoc={setDocId} />

          <section className="si-col-fields" aria-label="Drafted data">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <div className="si-grow">
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{submission.status === 'COMPLETED' ? 'Approved data' : 'Drafted data'}</h2>
                <div className="si-muted si-small">Laid out like the {productLabel(settings, submission.productCode) || 'product'} quote screen.</div>
              </div>
              {reviewable && (
                <div className="si-segment" role="group" aria-label="Show">
                  <button type="button" aria-pressed={filter === 'attention'} onClick={() => setFilter('attention')}>Needs attention ({attentionLeft})</button>
                  <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All values ({fields.length})</button>
                </div>
              )}
            </div>
            {sections.map((section) => (
              <CollapsibleSection key={section.title} as="section" className="si-card si-section" title={<span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}><span>{section.title}</span><span className="si-muted si-small" style={{ fontWeight: 500 }}>{section.done} of {section.total} confirmed</span></span>}>
                {section.fields.map((field) => (
                  <FieldRow key={field.key} submission={submission} field={field} selected={field.key === selectedKey} onSelect={() => { setSelectedKey(field.key); setDocId(null) }} canEdit={canManage && reviewable} settings={settings} />
                ))}
              </CollapsibleSection>
            ))}
            {!sections.length && <div className="si-banner is-success"><p>Nothing needs attention. Switch to All values to see everything you confirmed.</p></div>}
          </section>

          <SidePanel submission={submission} checks={checks} settings={settings} />
        </div>
      )}

      {reviewable && (
        <div className="si-dock">
          <div className="si-dock-inner">
            <div className="si-grow">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>{confirmed} of {fields.length} values confirmed</span>
                <span className="si-muted" style={{ fontWeight: 500 }}>{ready ? 'Ready to approve' : `${fields.length - confirmed} to go`}</span>
              </div>
              <div className={`si-progress${ready ? ' is-complete' : ''}`} role="progressbar" aria-label="Values confirmed" aria-valuemin={0} aria-valuemax={fields.length} aria-valuenow={confirmed}>
                <span style={{ width: `${fields.length ? Math.round((confirmed / fields.length) * 100) : 0}%` }} />
              </div>
              <div className="si-small si-muted" style={{ marginTop: 4 }}>Nothing is created until a person approves. The AI never approves on its own.</div>
            </div>
            {canManage && (
              <button type="button" className="si-btn si-btn-lg" disabled={!highLeft || acceptHigh.isPending} onClick={() => void run(acceptHigh.mutateAsync(undefined))}>
                Accept all high confidence ({highLeft})
              </button>
            )}
            <button type="button" className="si-btn si-btn-primary si-btn-lg" disabled={!ready} onClick={() => setApproving(true)} aria-describedby={ready ? undefined : 'si-approve-hint'}>
              Continue to approval
            </button>
            {!ready && <span id="si-approve-hint" className="sr-only">Confirm every value first.</span>}
          </div>
        </div>
      )}

      {approving && <ApprovalDialog submission={submission} checks={checks} settings={settings} canApprove={canApprove} onClose={() => { setApproving(false); void qc.invalidateQueries({ queryKey: queryKeys.submissions.detail(id) }) }} />}
    </div>
  )
}
