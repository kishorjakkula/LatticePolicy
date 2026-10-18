import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LlmReleasesPage } from '../LlmReleasesPage'
import { llmReleasesApi, reportDigest } from '../../../api/llm-releases.api'

const query = vi.hoisted(() => ({
  data: null as any,
  isPending: false,
  error: null,
  refetch: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => query }))
vi.mock('../../../api/llm-releases.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/llm-releases.api')>()),
  llmReleasesApi: { list: vi.fn(), transition: vi.fn(), contact: vi.fn(), revocations: vi.fn() },
}))
function show(
  status: string,
  canReview = true,
  emailEnabled = true,
  overrides: Record<string, unknown> = {},
) {
  query.data = {
    canReview,
    currentUserId: 'current-admin',
    emailEnabled,
    contactEmail: 'technical@example.test',
    items: [
      {
        release_id: 'r1',
        version_label: 'v1',
        status,
        artifact_digest: 'a'.repeat(64),
        artifacts: {
          model: 'private-v1',
          profileId: 'submission',
          profileVersion: '1.0.0',
        },
        evaluation: {
          sampleCount: 50,
          fieldAccuracy: 0.98,
          evidenceAccuracy: 0.99,
        },
        notifications: emailEnabled
          ? [{ email: 'technical@example.test', status: 'Queued', attempts: 0 }]
          : [],
        ...overrides,
      },
    ],
  }
  render(
    <MemoryRouter initialEntries={['/admin/llm-releases?release=r1']}>
      <LlmReleasesPage />
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  query.refetch.mockResolvedValue({})
  vi.mocked(llmReleasesApi.transition).mockResolvedValue({} as any)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('carrier technical-admin LLM releases', () => {
  it.each([
    ['IN_VALIDATION', 'validation_authorization', 'Validation'],
    ['PRODUCTION_AUTHORIZED', 'production_authorization', 'Production'],
  ])(
    'requires separate renewal attestation and downloads the refreshed receipt for %s',
    async (status, column, environment) => {
      const createObjectURL = vi.fn((_blob: Blob) => 'blob:renewed-receipt')
      vi.stubGlobal(
        'URL',
        class extends URL {
          static createObjectURL = createObjectURL
          static revokeObjectURL = vi.fn()
        },
      )
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {})
      const currentReceipt = {
        payload: { approvedAt: '2026-10-17T00:00:00.000Z' },
        signature: 'renewed-signature',
      }
      show(status, true, false, { [column]: { signature: 'old-signature' } })
      query.refetch.mockImplementation(async () => {
        query.data = {
          ...query.data,
          items: [{ ...query.data.items[0], [column]: currentReceipt }],
        }
        return {}
      })
      const renew = screen.getByRole('button', { name: 'Renew Authorization' })
      expect(renew).toBeDisabled()
      fireEvent.click(renew)
      expect(llmReleasesApi.transition).not.toHaveBeenCalled()
      fireEvent.click(
        screen.getByLabelText(
          'I authorize renewal for these exact artifacts in the current environment.',
        ),
      )
      fireEvent.click(renew)
      await waitFor(() =>
        expect(llmReleasesApi.transition).toHaveBeenCalledWith(
          'r1',
          'renew-authorization',
          { attestation: true },
        ),
      )
      await waitFor(() => expect(query.refetch).toHaveBeenCalled())
      await waitFor(() => expect(renew).toBeDisabled())
      expect(
        screen.getByLabelText(
          'I authorize renewal for these exact artifacts in the current environment.',
        ),
      ).not.toBeChecked()
      fireEvent.click(
        screen.getByRole('button', {
          name: `Download ${environment} Authorization`,
        }),
      )
      expect(click).toHaveBeenCalledTimes(1)
      const downloaded = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(createObjectURL.mock.calls[0][0])
      })
      expect(JSON.parse(downloaded)).toEqual(currentReceipt)
    },
  )
  it.each(['READY_FOR_VALIDATION', 'VALIDATED', 'REJECTED'])(
    'does not offer renewal for %s',
    (status) => {
      show(status)
      expect(
        screen.queryByRole('button', { name: 'Renew Authorization' }),
      ).not.toBeInTheDocument()
    },
  )
  it.each(['IN_VALIDATION', 'PRODUCTION_AUTHORIZED'])(
    'does not offer renewal to read-only administrators for %s',
    (status) => {
      show(status, false)
      expect(
        screen.queryByRole('button', { name: 'Renew Authorization' }),
      ).not.toBeInTheDocument()
    },
  )
  it('shows disabled email without requiring a contact and keeps admin review available', async () => {
    show('READY_FOR_VALIDATION', true, false)
    expect(screen.getByText('Release email disabled.')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Disabled' })).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Technical-admin email'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Sent/)).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Authorize Lower-Environment Test' }),
    )
    await waitFor(() =>
      expect(llmReleasesApi.transition).toHaveBeenCalledWith(
        'r1',
        'start-validation',
        {},
      ),
    )
  })
  it('retains contact configuration when email is enabled', () => {
    show('READY_FOR_VALIDATION')
    expect(screen.getByLabelText('Technical-admin email')).toBeRequired()
    expect(
      screen.getByRole('cell', { name: 'technical@example.test: Queued' }),
    ).toBeInTheDocument()
  })
  it('does not offer production publication before lower-environment validation', () => {
    show('READY_FOR_VALIDATION')
    expect(
      screen.getByRole('button', { name: 'Authorize Lower-Environment Test' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'Authorize Production Publication',
      }),
    ).not.toBeInTheDocument()
  })
  it('requires exact-artifact attestation and a shared pass/fail choice for test evidence', async () => {
    show('IN_VALIDATION')
    const record = screen.getByRole('button', { name: 'Record Validation' })
    expect(record).toBeDisabled()
    const report = { schemaVersion: 1, runId: 'test-42', environment: 'test', artifactDigest: 'a'.repeat(64), passed: true }
    fireEvent.change(screen.getByLabelText('Test report (JSON)'), {
      target: { files: [new File([JSON.stringify(report)], 'report.json', { type: 'application/json' })] },
    })
    const expectedHash = await reportDigest(report)
    // The SHA-256 is calculated from the uploaded report, not typed in.
    await waitFor(() => expect(screen.getByLabelText('Test report SHA-256')).toHaveValue(expectedHash))
    expect(screen.getByLabelText('Test report SHA-256')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Test run ID')).toHaveValue('test-42')
    fireEvent.change(screen.getByLabelText('Validation notes'), {
      target: { value: 'Synthetic corpus passed' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Passed' }))
    fireEvent.click(
      screen.getByLabelText(
        'I tested these exact artifacts in the selected lower environment.',
      ),
    )
    fireEvent.click(record)
    await waitFor(() =>
      expect(llmReleasesApi.transition).toHaveBeenCalledWith(
        'r1',
        'record-validation',
        expect.objectContaining({
          passed: true,
          attestation: true,
          environment: 'test',
          artifactDigest: 'a'.repeat(64),
          reportSha256: expectedHash,
          report,
        }),
      ),
    )
  })
  it('requires a separate production approval and keeps ordinary administrators read-only', async () => {
    show('VALIDATED')
    const publish = screen.getByRole('button', {
      name: 'Authorize Production Publication',
    })
    expect(publish).toBeDisabled()
    fireEvent.click(
      screen.getByLabelText(
        'I authorize these tested artifacts for production.',
      ),
    )
    fireEvent.click(publish)
    await waitFor(() =>
      expect(llmReleasesApi.transition).toHaveBeenCalledWith(
        'r1',
        'authorize-production',
        { attestation: true },
      ),
    )
  })
  it('does not expose approval controls to read-only administrators', () => {
    show('VALIDATED', false)
    expect(
      screen.queryByRole('button', {
        name: 'Authorize Production Publication',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Save Email' }),
    ).not.toBeInTheDocument()
  })
  it('tells the validator that a different technical admin must authorize production', () => {
    show('VALIDATED', true, true, { validated_by: 'current-admin' })
    expect(screen.getByText(/A different carrier technical administrator must authorize production/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Authorize Production Publication' })).not.toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })
  it('revokes only with a reason and an explicit confirmation', async () => {
    show('PRODUCTION_AUTHORIZED', true, false, {
      approved_by: 'other-admin-id',
      approver_active: false,
      production_authorization: { payload: { approvedAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-24T00:00:00.000Z' }, signature: 's' },
      production_quality: { submissions: 4, drafted: 40, corrected: 2, correctionRate: 0.05 },
    })
    expect(screen.getByText(/no longer a technical administrator/)).toBeInTheDocument()
    expect(screen.getByText(/5.0% of 40 AI-drafted values corrected/)).toBeInTheDocument()
    const revoke = screen.getByRole('button', { name: 'Revoke Release' })
    fireEvent.change(screen.getByLabelText('Revocation reason'), { target: { value: 'Accuracy drift' } })
    expect(revoke).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Stop this release everywhere/))
    fireEvent.click(revoke)
    await waitFor(() =>
      expect(llmReleasesApi.transition).toHaveBeenCalledWith('r1', 'revoke', { reason: 'Accuracy drift', attestation: true }),
    )
  })
  it('shows revocation details for a revoked release without approval controls', () => {
    show('REVOKED', true, false, { revoked_by: 'current-admin', revoked_at: '2026-10-17T00:00:00.000Z', revocation_reason: 'Drift' })
    expect(screen.getByText(/by You: Drift/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke Release' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Renew Authorization' })).not.toBeInTheDocument()
  })
})
