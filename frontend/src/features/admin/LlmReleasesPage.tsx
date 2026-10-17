import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { llmReleasesApi, type LlmRelease } from '../../api/llm-releases.api'
import { tenantId } from '../../api/request'
import { RadioGroup } from '../../components/RadioGroup'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import './llm-releases.css'

const label = (status: string) => status.toLowerCase().replace(/_/g, ' ')
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
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void query.refetch()}
        >
          Refresh
        </button>
      </div>
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
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
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
      {query.data && !query.data.items.length && <p>No release candidates.</p>}
      {query.data && params.get('release') && !selected && (
        <p role="alert">Release not found.</p>
      )}
      {selected && (
        <ReleaseReview
          key={selected.release_id}
          release={selected}
          canReview={!!query.data?.canReview}
          busy={busy}
          run={run}
        />
      )}
    </div>
  )
}

function ReleaseReview({
  release,
  canReview,
  busy,
  run,
}: {
  release: LlmRelease
  canReview: boolean
  busy: boolean
  run: (operation: () => Promise<unknown>) => Promise<void>
}) {
  const [environment, setEnvironment] = useState('test')
  const [runId, setRunId] = useState('')
  const [hash, setHash] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState('')
  const [tested, setTested] = useState(false)
  const [approved, setApproved] = useState(false)
  const [renewed, setRenewed] = useState(false)
  const [reason, setReason] = useState('')
  const act = (action: string, body: unknown = {}) =>
    run(() => llmReleasesApi.transition(release.release_id, action, body))
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
        <dd>{(release.evaluation.fieldAccuracy * 100).toFixed(1)}%</dd>
        <dt>Evidence accuracy</dt>
        <dd>{(release.evaluation.evidenceAccuracy * 100).toFixed(1)}%</dd>
        <dt>Artifact digest</dt>
        <dd style={{ overflowWrap: 'anywhere' }}>{release.artifact_digest}</dd>
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
        ['IN_VALIDATION', 'PRODUCTION_AUTHORIZED'].includes(release.status) && (
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
            })
          }}
          style={{ display: 'grid', gap: 12, maxWidth: 680 }}
        >
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
              pattern="[a-f0-9]{64}"
              value={hash}
              onChange={(event) => setHash(event.target.value)}
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
          <button type="submit" disabled={busy || !tested || !result}>
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
      {canReview && release.status === 'VALIDATED' && (
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
    </CollapsibleSection>
  )
}
