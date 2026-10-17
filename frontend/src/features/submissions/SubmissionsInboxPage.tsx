import { useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { useCreateSubmission, useIntakeSettings, useSubmissions } from '../../api/hooks'
import { apiErrorMessage, fileToBase64, type SubmissionSummary } from '../../api/submissions.api'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { AiTag, STATUS_META, productLabel } from './submissionUi'
import './submissions.css'

const STAGES: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'READING', label: 'AI reading' },
  { value: 'READY_FOR_REVIEW', label: 'Ready for review' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'READ_FAILED', label: 'Could not read' },
  { value: 'COMPLETED', label: 'Approved' },
  { value: 'DECLINED', label: 'Declined' },
]

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.eml,.txt,.csv,.json,.md,.html,.htm,.xml,.xlsx,.docx'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function DataCell({ item }: { item: SubmissionSummary }) {
  if (item.status === 'READING' || item.status === 'RECEIVED') return <span className="si-muted">Not ready</span>
  if (item.status === 'READ_FAILED') return <span className="si-muted">Nothing drafted</span>
  if (!item.fieldTotal) return <span className="si-muted">No values</span>
  if (item.status === 'COMPLETED') return <div><b>{item.fieldConfirmed}</b> values approved</div>
  return (
    <div>
      <div><b>{item.fieldConfirmed}</b> of {item.fieldTotal} confirmed</div>
      {typeof item.aiRun?.counts?.averageScore === 'number' && <div className="si-small si-muted">Average confidence {item.aiRun.counts.averageScore}%</div>}
      {(item.fieldAttention || 0) > 0 && (
        <div className="si-small" style={{ color: 'var(--si-medium-fg)', fontWeight: 600 }}>
          {item.fieldAttention} need attention{item.fieldConflicts ? ` · ${item.fieldConflicts} conflict${item.fieldConflicts > 1 ? 's' : ''}` : ''}
        </div>
      )}
    </div>
  )
}

export function SubmissionsInboxPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const canManage = hasPermission(user, 'submissions.manage')
  const [stage, setStage] = useState('')
  const { data, isLoading, error } = useSubmissions(stage || undefined)
  const { data: settings } = useIntakeSettings()
  const create = useCreateSubmission()
  const fileInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [form, setForm] = useState({ brokerName: '', brokerEmail: '', productCode: '', notes: '' })
  const [uploadError, setUploadError] = useState<string | null>(null)

  const items = data?.items || []
  const counts = data?.statusCounts || {}
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const maxBytes = settings?.maxDocumentBytes || 10 * 1024 * 1024
  const maxDocuments = settings?.maxDocuments || 10

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return
    setUploadError(null)
    const next = [...files]
    for (const file of Array.from(incoming)) {
      if (file.size > maxBytes) { setUploadError(`${file.name} is larger than ${formatSize(maxBytes)}.`); continue }
      if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file)
    }
    if (next.length > maxDocuments) setUploadError(`A submission can have at most ${maxDocuments} documents.`)
    setFiles(next.slice(0, maxDocuments))
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    addFiles(event.dataTransfer.files)
  }

  const submit = async () => {
    if (!files.length) return
    setUploadError(null)
    try {
      const documents = await Promise.all(files.map(async (file) => ({ fileName: file.name, contentType: file.type, dataBase64: await fileToBase64(file) })))
      const created = await create.mutateAsync({
        channel: 'upload',
        brokerName: form.brokerName || undefined,
        brokerEmail: form.brokerEmail || undefined,
        productCode: form.productCode || undefined,
        notes: form.notes || undefined,
        subject: files[0]?.name,
        documents,
      })
      setFiles([])
      setForm({ brokerName: '', brokerEmail: '', productCode: '', notes: '' })
      navigate(`/submissions/${created.submissionId}`)
    } catch (err) {
      setUploadError(apiErrorMessage(err))
    }
  }

  return (
    <div className="si-page">
      <div className="si-head">
        <div className="si-grow">
          <h1>Submissions</h1>
          <p>Broker submissions read by AI and confirmed by your team before anything is quoted.</p>
        </div>
      </div>

      <section className="si-ai-note" aria-label="How AI is used">
        <AiTag>AI assisted</AiTag>
        <p>
          <b>AI reads each submission and drafts the data.</b> Every value shows where it came from and how sure the reader is.
          Nothing becomes a customer or quote until a person approves it.
          {settings && <> Reader: <b>{settings.label}</b>{settings.sendsDocumentsOffStack ? ' (documents are sent to the AI provider)' : ' (documents stay in this system)'}.</>}
        </p>
      </section>
      {settings?.problem && <div className="si-banner is-error" role="alert"><p>{settings.problem}</p></div>}

      {canManage && (
        <CollapsibleSection as="section" className="si-card si-card-pad" title="New submission" aria-label="New submission">
          <div className="si-columns">
            <div
              className={`si-drop${dragOver ? ' is-over' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none', fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
              <div className="si-drop-body">
                <div style={{ fontWeight: 700 }}>Drop a broker email or documents here</div>
                <div className="si-muted si-small">
                  Email (.eml), ACORD applications, schedules, loss runs: PDF, images, Word, Excel, CSV, or text. Up to {maxDocuments} files, {formatSize(maxBytes)} each.
                  {settings && !settings.readsPdfAndImages && ' PDFs and images are kept but need an AI model to be read.'}
                </div>
                {files.length > 0 && (
                  <ul className="si-filelist" aria-label="Files to upload">
                    {files.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
                        <span className="si-muted">{formatSize(file.size)}</span>
                        <button type="button" className="si-link" onClick={() => setFiles(files.filter((item) => item !== file))} aria-label={`Remove ${file.name}`}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
              <button type="button" className="si-btn" onClick={() => fileInput.current?.click()}>Choose files</button>
            </div>
          </div>
          <div className="si-form-grid">
            <label>Broker or agency<input className="si-input" value={form.brokerName} onChange={(event) => setForm({ ...form, brokerName: event.target.value })} /></label>
            <label>Broker email<input className="si-input" type="email" value={form.brokerEmail} onChange={(event) => setForm({ ...form, brokerEmail: event.target.value })} /></label>
            <label>
              Product (optional)
              <select className="si-input" value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value })}>
                <option value="">Let the reader detect it</option>
                {(settings?.products || []).map((product) => <option key={product.code} value={product.code}>{product.label}</option>)}
              </select>
            </label>
            <label className="si-span">Notes for the reader and reviewer (optional)<textarea className="si-input" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          </div>
          {uploadError && <div className="si-banner is-error" role="alert" style={{ marginTop: 12 }}><p>{uploadError}</p></div>}
          <div className="si-actions" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="si-btn si-btn-primary si-btn-lg" disabled={!files.length || create.isPending} onClick={() => void submit()}>
              {create.isPending ? 'Uploading…' : `Upload and read ${files.length || ''} ${files.length === 1 ? 'file' : 'files'}`.replace(/\s+/g, ' ')}
            </button>
          </div>
        </CollapsibleSection>
      )}

      <nav className="si-stages" aria-label="Submission stages">
        {STAGES.map((item) => (
          <button key={item.value || 'all'} type="button" className="si-stage" aria-pressed={stage === item.value} onClick={() => setStage(item.value)}>
            {item.label} <b>{item.value ? counts[item.value] || 0 : total}</b>
          </button>
        ))}
      </nav>

      <CollapsibleSection as="section" className="si-card" title="Submission queue" aria-label="Submission queue">
        {error ? (
          <div className="si-banner is-error" role="alert"><p>{apiErrorMessage(error)}</p></div>
        ) : isLoading ? (
          <div className="si-empty">Loading submissions…</div>
        ) : !items.length ? (
          <div className="si-empty">No submissions {stage ? 'in this stage' : 'yet'}. {canManage && !stage ? 'Upload a broker email or documents to start.' : ''}</div>
        ) : (
          <div className="si-table-wrap">
            <table className="si-table">
              <thead>
                <tr>
                  <th>Insured and broker</th>
                  <th>Product</th>
                  <th>Stage</th>
                  <th>Data</th>
                  <th>Received</th>
                  <th><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const meta = STATUS_META[item.status]
                  const reviewable = item.status === 'READY_FOR_REVIEW' || item.status === 'IN_REVIEW'
                  return (
                    <tr key={item.submissionId}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{item.insuredName || item.subject || item.submissionNumber}</div>
                        <div className="si-muted si-small">{[item.submissionNumber, item.brokerName, item.channel, `${item.documentCount || 0} document${item.documentCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>
                        {item.productCode ? (
                          <>
                            <div>{productLabel(settings, item.productCode)}</div>
                            {item.aiRun?.counts && <div className="si-small" style={{ color: 'var(--si-ai-text)', fontWeight: 600 }}>Detected by {item.aiRun?.provider === 'anthropic' ? 'AI' : 'reader'}</div>}
                          </>
                        ) : <span className="si-muted">Not known yet</span>}
                      </td>
                      <td>
                        <span className={`si-pill si-tone-${meta.tone}`}>{meta.label}</span>
                        {item.status === 'READING' && <div className="si-bar" aria-hidden="true"><span /></div>}
                        {item.status === 'IN_REVIEW' && item.assignedTo && <div className="si-muted si-small" style={{ marginTop: 4 }}>{item.assignedTo}</div>}
                        {item.status === 'COMPLETED' && item.quoteNumber && <div className="si-muted si-small" style={{ marginTop: 4 }}>Quote {item.quoteNumber}</div>}
                      </td>
                      <td><DataCell item={item} /></td>
                      <td className="si-small">{formatDisplayDate(item.receivedAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Link className={`si-btn${reviewable ? ' si-btn-primary' : ''}`} to={`/submissions/${item.submissionId}`}
                          aria-label={`${reviewable ? 'Review' : 'Open'} ${item.insuredName || item.subject || item.submissionNumber}`}>
                          {reviewable ? 'Review' : 'Open'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}
