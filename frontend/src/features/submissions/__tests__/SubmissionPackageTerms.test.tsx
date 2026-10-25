import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client'
import { SubmissionPackageTerms } from '../SubmissionPackageTerms'
import type { SubmissionField } from '../../../api/submissions.api'

vi.mock('../../../api/client', () => ({ api: { getProductConfig: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())
function show(fields: SubmissionField[] = []) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SubmissionPackageTerms product="businessowners" fields={fields} />
  </QueryClientProvider>)
}
describe('submission package terms', () => {
  it('derives aggregates only from the reviewed limit, without inventing absent limit values or confirming fields', async () => {
    vi.mocked(api.getProductConfig).mockResolvedValue({ coverages: [{
      code: 'BOP_LIAB', name: 'Business liability', required: true, defaultLimit: 1000000,
      aggregateMultiplier: 2, personalAdvertisingInjuryMultiplier: 1,
      packageTerms: { basis: 'occurrence', damageToRentedPremisesLimit: 100000 }
    }] })
    const empty = show()
    expect(await screen.findByText('Occurrence basis')).toBeInTheDocument()
    expect(screen.queryByText(/General aggregate/)).not.toBeInTheDocument()
    empty.unmount()
    show([{ key: 'cov.BOP_LIAB.limit', value: '2000000' } as SubmissionField])
    expect(await screen.findByText('General aggregate: $4,000,000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve|confirm/i })).not.toBeInTheDocument()
  })
  it('keeps load failure separate from empty terms and does not reveal upstream details', async () => {
    vi.mocked(api.getProductConfig).mockRejectedValue(new Error('private upstream body'))
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('Package terms could not be loaded.')
    expect(screen.queryByText('private upstream body')).not.toBeInTheDocument()
  })
})
