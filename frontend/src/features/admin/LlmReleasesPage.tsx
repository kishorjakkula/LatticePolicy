import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  llmReleasesApi,
  reportDigest,
  type LlmRelease,
  type LlmReleasePolicy,
  type AutomationCredential,
} from '../../api/llm-releases.api'
import { tenantId } from '../../api/request'
import { RadioGroup } from '../../components/RadioGroup'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import './llm-releases.css'

const label = (status: string) => status.toLowerCase().replace(/_/g, ' ')
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const when = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—')
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function LlmReleasesPage() {
  const [params, setParams] = useSearchParams()
  const query = useQuery({
    queryKey: ['llm-releases', tenantId(), params.get('release')],
    queryFn: () => llmReleasesApi.list(params.get('release')),
    refetchInterval: 15000,
  })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = query.data?.items.find(
    (item) => item.release_id === params.get('release'),
  )
  async function run(operation: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await operation()
      await query.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Release action failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ps-admin-page llm-releases">
      <div className="ps-page-header">
        <h2 className="ps-page-title">LLM Releases</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {query.data?.canReview && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  download(await llmReleasesApi.revocations(), 'revocations.json'),
                )
              }
            >
              Download Revocation List
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void query.refetch()}
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="llm-releases__lede">
        Release automation registers evaluated candidates. Only people approve: one technical
        administrator records the lower-environment test, and a different one authorizes
        production. Every step is in the <Link to="/admin/ai-audit">AI audit trail</Link>.
      </p>
      {(error || query.error) && (
        <p role="alert">{error || String(query.error)}</p>
      )}
      {query.isPending && <p role="status">Loading releases...</p>}
      {query.data?.emailEnabled === false && (
        <p role="status">Release email disabled.</p>
      )}
      {query.data?.canReview && query.data.emailEnabled !== false && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => llmReleasesApi.contact(email))
          }}
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'end',
            marginBottom: 24,
          }}
        >
          <label style={{ display: 'grid', gap: 6 }}>
            Technical-admin email
            <input
              type="email"
              aria-label="Technical-admin email"
              value={email}
              placeholder={query.data.contactEmail || ''}
              required
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-secondary" disabled={busy}>
            Save Email
          </button>
          {query.data.contactEmail && (
            <span>Current: {query.data.contactEmail}</span>
          )}
        </form>
      )}
      <CollapsibleSection title="Releases" className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-no-sticky-head">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Model</th>
                <th>Profile</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((item) => (
                <tr key={item.release_id}>
                  <td>
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-pressed={selected?.release_id === item.release_id}
                      onClick={() => setParams({ release: item.release_id })}
                    >
                      {item.version_label}
                    </button>
                  </td>
                  <td>{label(item.status)}</td>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    {item.artifacts.model}
                  </td>
                  <td>
                    {item.artifacts.profileId} {item.artifacts.profileVersion}
                  </td>
                  <td>
                    {item.notifications
                      .map((notice) => `${notice.email}: ${notice.status}`)
                      .join('; ') ||
                      (query.data?.emailEnabled === false
                        ? 'Disabled'
                        : 'Not queued')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
      {query.data && !query.data.items.length && <p>No release candidates.</p>}
      {query.data && params.get('release') && !selected && (
        <p role="alert">Release not found.</p>
      )}
      {selected && (
        <ReleaseReview
          key={selected.release_id}
          release={selected}
          canReview={!!query.data?.canReview}
          currentUserId={query.data?.currentUserId}
          busy={busy}
          run={run}
        />
      )}
      {query.data?.canReview && query.data.policy && (
        <GatePolicy
          policy={query.data.policy}
          floor={query.data.platformPolicy}
          busy={busy}
          run={run}
        />
      )}
      {query.data?.canManageCredentials && <AutomationCredentials />}
    </div>
  )
}

function ReleaseReview({
  release,
  canReview,
  currentUserId,
  busy,
  run,
}: {
  release: LlmRelease
  canReview: boolean
  currentUserId?: string
  busy: boolean
  run: (operation: () => Promise<unknown>) => Promise<void>
}) {
  const [environment, setEnvironment] = useState('test')
  const [runId, setRunId] = useState('')
  const [hash, setHash] = useState('')
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [reportError, setReportError] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('')
  const [tested, setTested] = useState(false)
  const [approved, setApproved] = useState(false)
  const [renewed, setRenewed] = useState(false)
  const [reason, setReason] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeConfirmed, setRevokeConfirmed] = useState(false)
  const act = (action: string, body: unknown = {}) =>
    run(() => llmReleasesApi.transition(release.release_id, action, body))
  const who = (id?: string | null) =>
    !id ? '—' : id === currentUserId ? 'You' : `Technical admin ${id.slice(0, 8)}`
  const isValidator = !!release.validated_by && release.validated_by === currentUserId
  const receipt =
    release.status === 'PRODUCTION_AUTHORIZED'
      ? release.production_authorization
      : release.status === 'IN_VALIDATION'
        ? release.validation_authorization
        : null
  const expiresAt = receipt?.payload?.expiresAt
  const expiringSoon = !!expiresAt && Date.parse(expiresAt) - Date.now() < 2 * 86400000
  const quality = release.production_quality

  async function loadReport(file: File | undefined) {
    setReport(null)
    setHash('')
    setReportError('')
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('The report must be a JSON object')
      setReport(parsed)
      setHash(await reportDigest(parsed))
      if (typeof parsed.runId === 'string') setRunId(parsed.runId)
      if (['test', 'qa', 'staging'].includes(parsed.environment)) setEnvironment(parsed.environment)
      if (typeof parsed.passed === 'boolean') setResult(parsed.passed ? 'pass' : 'fail')
    } catch (cause) {
      setReportError(cause instanceof Error ? cause.message : 'Unreadable report')
    }
  }

  return (
    <CollapsibleSection
      title={`Release ${release.version_label}`}
      style={{ marginTop: 24 }}
    >
      <dl>
        <dt>Status</dt>
        <dd>{label(release.status)}</dd>
        <dt>Evaluation samples</dt>
        <dd>{release.evaluation.sampleCount}</dd>
        <dt>Field accuracy</dt>
        <dd>{percent(release.evaluation.fieldAccuracy)}</dd>
        <dt>Evidence accuracy</dt>
        <dd>{percent(release.evaluation.evidenceAccuracy)}</dd>
        {release.has_evaluation_report && (
          <>
            <dt>Evaluation report</dt>
            <dd>Stored; hash and metrics re-checked by LatticePolicy at registration</dd>
          </>
        )}
        <dt>Artifact digest</dt>
        <dd style={{ overflowWrap: 'anywhere' }}>{release.artifact_digest}</dd>
        {release.validated_by && (
          <>
            <dt>Validated by</dt>
            <dd>{who(release.validated_by)}</dd>
          </>
        )}
        {release.approved_by && (
          <>
            <dt>Production approved by</dt>
            <dd>
              {who(release.approved_by)}
              {release.approver_active === false && ' (no longer a technical administrator — renew or revoke)'}
            </dd>
          </>
        )}
        {expiresAt && (
          <>
            <dt>Authorization expires</dt>
            <dd>
              {when(expiresAt)}
              {expiringSoon && ' — renew soon'}
            </dd>
          </>
        )}
        {quality && (
          <>
            <dt>Production correction rate</dt>
            <dd>
              {quality.correctionRate === null
                ? 'No drafted values yet'
                : `${percent(quality.correctionRate)} of ${quality.drafted} AI-drafted values corrected by reviewers across ${quality.submissions} approved submissions`}
            </dd>
          </>
        )}
        {release.status === 'REVOKED' && (
          <>
            <dt>Revoked</dt>
            <dd>
              {when(release.revoked_at)} by {who(release.revoked_by)}: {release.revocation_reason}
            </dd>
          </>
        )}
      </dl>
      {release.notifications.some(
        (notice) => notice.error && notice.status !== 'Suppressed',
      ) && <p role="alert">Email delivery needs attention.</p>}
      <div
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}
      >
        {!!release.validation_authorization && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              download(
                release.validation_authorization,
                `${release.version_label}-validation.json`,
              )
            }
          >
            Download Validation Authorization
          </button>
        )}
        {!!release.production_authorization && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              download(
                release.production_authorization,
                `${release.version_label}-production.json`,
              )
            }
          >
            Download Production Authorization
          </button>
        )}
        {canReview && release.status === 'READY_FOR_VALIDATION' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('start-validation')}
          >
            Authorize Lower-Environment Test
          </button>
        )}
      </div>
      {canReview &&
        ['IN_VALIDATION', 'PRODUCTION_AUTHORIZED'].includes(release.status) &&
        !(release.status === 'PRODUCTION_AUTHORIZED' && isValidator) && (
          <div
            style={{
              display: 'grid',
              gap: 12,
              marginBottom: 20,
              maxWidth: 680,
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={renewed}
                disabled={busy}
                onChange={(event) => setRenewed(event.target.checked)}
              />{' '}
              I authorize renewal for these exact artifacts in the current
              environment.
            </label>
            <button
              type="button"
              disabled={busy || !renewed}
              onClick={() =>
                void run(async () => {
                  await llmReleasesApi.transition(
                    release.release_id,
                    'renew-authorization',
                    { attestation: true },
                  )
                  setRenewed(false)
                })
              }
            >
              Renew Authorization
            </button>
          </div>
        )}
      {canReview && release.status === 'IN_VALIDATION' && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void act('record-validation', {
              environment,
              runId,
              reportSha256: hash,
              artifactDigest: release.artifact_digest,
              passed: result === 'pass',
              attestation: tested,
              notes,
              report,
            })
          }}
          style={{ display: 'grid', gap: 12, maxWidth: 680 }}
        >
          <label>
            Test report (JSON){' '}
            <input
              type="file"
              aria-label="Test report (JSON)"
              accept="application/json,.json"
              onChange={(event) => void loadReport(event.target.files?.[0])}
            />
          </label>
          <p className="llm-releases__hint">
            The report must include schemaVersion 1, runId, environment, passed and this
            release&apos;s artifactDigest. LatticePolicy stores it and checks its SHA-256.
          </p>
          {reportError && <p role="alert">{reportError}</p>}
          <label>
            Lower environment{' '}
            <select
              aria-label="Lower environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
            >
              <option value="test">Test</option>
              <option value="qa">QA</option>
              <option value="staging">Staging</option>
            </select>
          </label>
          <label>
            Test run ID{' '}
            <input
              aria-label="Test run ID"
              required
              maxLength={120}
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
            />
          </label>
          <label>
            Test report SHA-256{' '}
            <input
              aria-label="Test report SHA-256"
              required
              readOnly
              pattern="[a-f0-9]{64}"
              value={hash}
              placeholder="Calculated from the uploaded report"
            />
          </label>
          <label>
            Validation notes{' '}
            <textarea
              aria-label="Validation notes"
              required
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <RadioGroup
            name="llm-validation-result"
            ariaLabel="Validation result"
            value={result}
            onChange={setResult}
            required
            disabled={busy}
            layout="binary"
            options={[
              { value: 'pass', label: 'Passed' },
              { value: 'fail', label: 'Failed' },
            ]}
          />
          <label>
            <input
              type="checkbox"
              checked={tested}
              onChange={(event) => setTested(event.target.checked)}
            />{' '}
            I tested these exact artifacts in the selected lower environment.
          </label>
          <button type="submit" disabled={busy || !tested || !result || !report}>
            Record Validation
          </button>
        </form>
      )}
      {release.validation && (
        <p>
          Validation: {release.validation.environment}{' '}
          {release.validation.runId}{' '}
          {release.validation.notes || release.validation.reason}
        </p>
      )}
      {canReview && release.status === 'VALIDATED' && isValidator && (
        <p role="status">
          You recorded this validation. A different carrier technical administrator must
          authorize production.
        </p>
      )}
      {canReview && release.status === 'VALIDATED' && !isValidator && (
        <div style={{ display: 'grid', gap: 12, maxWidth: 680 }}>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />{' '}
            I authorize these tested artifacts for production.
          </label>
          <button
            type="button"
            disabled={busy || !approved}
            onClick={() =>
              void act('authorize-production', { attestation: approved })
            }
          >
            Authorize Production Publication
          </button>
        </div>
      )}
      {canReview &&
        ['READY_FOR_VALIDATION', 'IN_VALIDATION', 'VALIDATED'].includes(
          release.status,
        ) && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void act('reject', { reason })
            }}
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              marginTop: 24,
            }}
          >
            <label>
              Rejection reason{' '}
              <input
                aria-label="Rejection reason"
                value={reason}
                maxLength={2000}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              className="btn-secondary"
              type="submit"
              disabled={busy || !reason.trim()}
            >
              Reject Release
            </button>
          </form>
        )}
      {canReview &&
        ['IN_VALIDATION', 'VALIDATED', 'PRODUCTION_AUTHORIZED'].includes(release.status) && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void act('revoke', { reason: revokeReason, attestation: true })
            }}
            className="llm-releases__danger"
          >
            <label>
              Revocation reason{' '}
              <input
                aria-label="Revocation reason"
                value={revokeReason}
                maxLength={2000}
                required
                onChange={(event) => setRevokeReason(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={revokeConfirmed}
                onChange={(event) => setRevokeConfirmed(event.target.checked)}
              />{' '}
              Stop this release everywhere. I will publish the new revocation list to the
              processors.
            </label>
            <button
              className="btn-secondary"
              type="submit"
              disabled={busy || !revokeReason.trim() || !revokeConfirmed}
            >
              Revoke Release
            </button>
          </form>
        )}
    </CollapsibleSection>
  )
}

function GatePolicy({
  policy,
  floor,
  busy,
  run,
}: {
  policy: LlmReleasePolicy
  floor: LlmReleasePolicy
  busy: boolean
  run: (operation: () => Promise<unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState(policy)
  const field = (key: keyof LlmReleasePolicy, text: string, step: number, min: number, max: number) => (
    <label>
      {text}
      <input
        type="number"
        aria-label={text}
        step={step}
        min={min}
        max={max}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
      />
    </label>
  )
  return (
    <CollapsibleSection title="Release Gates" className="card" style={{ marginTop: 24 }}>
      <p className="llm-releases__hint">
        Carrier gates can be raised above the platform floor, never lowered below it. Changes are
        recorded in the audit trail.
      </p>
      <form
        className="llm-releases__grid"
        onSubmit={(event) => {
          event.preventDefault()
          void run(() => llmReleasesApi.savePolicy(draft))
        }}
      >
        {field('minSampleCount', 'Minimum held-out samples', 1, floor.minSampleCount, 100000)}
        {field('minFieldAccuracy', 'Minimum field accuracy', 0.001, floor.minFieldAccuracy, 1)}
        {field('minEvidenceAccuracy', 'Minimum evidence accuracy', 0.001, floor.minEvidenceAccuracy, 1)}
        {field('authorizationDays', 'Authorization lifetime (days)', 1, 1, 30)}
        {field('roleCooldownHours', 'New approver cooldown (hours)', 1, floor.roleCooldownHours, 720)}
        <button type="submit" disabled={busy}>
          Save Gates
        </button>
      </form>
    </CollapsibleSection>
  )
}

function AutomationCredentials() {
  const credentials = useQuery({
    queryKey: ['llm-credentials', tenantId()],
    queryFn: () => llmReleasesApi.credentials(),
  })
  const [userId, setUserId] = useState('')
  const [credentialLabel, setCredentialLabel] = useState('')
  const [days, setDays] = useState(30)
  const [cidrs, setCidrs] = useState('')
  const [issued, setIssued] = useState<AutomationCredential | null>(null)
  const [error, setError] = useState('')
  async function act(operation: () => Promise<unknown>) {
    setError('')
    try {
      await operation()
      await credentials.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Credential action failed')
    }
  }
  const users = credentials.data?.automationUsers || []
  return (
    <CollapsibleSection title="Release Automation Credentials" className="card" style={{ marginTop: 24 }}>
      <p className="llm-releases__hint">
        The training pipeline registers candidates with a scoped credential, never a person&apos;s
        login. Credentials expire within 90 days and can be limited to network ranges.
      </p>
      {error && <p role="alert">{error}</p>}
      {issued?.token && (
        <div role="status" className="llm-releases__token">
          <strong>Copy this credential now; it will not be shown again.</strong>
          <code>{issued.token}</code>
        </div>
      )}
      <form
        className="llm-releases__grid"
        onSubmit={(event) => {
          event.preventDefault()
          void act(async () => {
            setIssued(
              await llmReleasesApi.issueCredential({
                userId,
                label: credentialLabel,
                expiresInDays: days,
                allowedCidrs: cidrs.split(/[\s,]+/).filter(Boolean),
              }),
            )
            setCredentialLabel('')
          })
        }}
      >
        <label>
          Automation identity
          <select aria-label="Automation identity" required value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Select</option>
            {users.map((user) => (
              <option key={user.userId} value={user.userId}>
                {user.username}
              </option>
            ))}
          </select>
        </label>
        <label>
          Credential label
          <input aria-label="Credential label" required maxLength={120} value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} />
        </label>
        <label>
          Expires in (days)
          <input aria-label="Expires in (days)" type="number" min={1} max={90} value={days} onChange={(event) => setDays(Number(event.target.value))} />
        </label>
        <label>
          Allowed networks (optional)
          <input aria-label="Allowed networks" placeholder="10.20.0.0/16" value={cidrs} onChange={(event) => setCidrs(event.target.value)} />
        </label>
        <button type="submit">Issue Credential</button>
      </form>
      <div style={{ overflowX: 'auto' }}>
        <table className="table table-no-sticky-head">
          <thead>
            <tr>
              <th>Label</th>
              <th>Identity</th>
              <th>Expires</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {credentials.data?.items.map((item) => {
              const expired = Date.parse(item.expiresAt) <= Date.now()
              return (
                <tr key={item.credentialId}>
                  <td>{item.label}</td>
                  <td>{item.username}</td>
                  <td>{when(item.expiresAt)}</td>
                  <td>{when(item.lastUsedAt)}</td>
                  <td>{item.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active'}</td>
                  <td>
                    {!item.revokedAt && !expired && (
                      <button type="button" className="btn-secondary" onClick={() => void act(() => llmReleasesApi.revokeCredential(item.credentialId))}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  )
}
