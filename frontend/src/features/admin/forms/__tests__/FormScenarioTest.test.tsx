import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormScenarioTest, parseFormScenario } from '../FormScenarioTest'

const api = vi.hoisted(() => ({ getFormAttachmentFields: vi.fn(), previewAdminForms: vi.fn() }))
vi.mock('../../../../api/client', () => ({ apiAdmin: api }))
const props = { formId: 'bff0a717-7378-44bf-a4ad-e5fca559bd1f', lineOfBusiness: 'property', products: [{ code: 'property', label: 'Property' }], states: [{ code: 'NY', label: 'New York' }], initialProduct: 'property', initialState: 'NY', revision: '1' }

describe('Synthetic form scenario validation', () => {
  it.each(['null', '[]', '"text"', '{bad}', '{"__proto__":{}}', '{"payload":{"constructor":{}}}', '{"premium":{"total":1e999}}', '{"includeDraft":false}', '{"state":"NY"}'])('rejects unsafe or invalid JSON: %s', (source) => {
    expect(() => parseFormScenario(source)).toThrow()
  })
  it('bounds size, depth and value count', () => {
    expect(() => parseFormScenario(' '.repeat(32769))).toThrow(/32,768/)
    expect(() => parseFormScenario('{"x":'.repeat(22) + '1' + '}'.repeat(22))).toThrow(/complex/)
    expect(() => parseFormScenario(JSON.stringify({ x: Array(5000).fill(0) }))).toThrow(/complex/)
  })
  it('preserves broad typed synthetic context', () => {
    const value = { payload: { applicant: { name: 'Synthetic' }, risks: [{ year: 1970 }] }, premium: { total: 100 }, policy: {}, transaction: {}, coverageCodes: ['A'] }
    expect(parseFormScenario(JSON.stringify(value))).toEqual(value)
  })
})

describe('Server attachment preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getFormAttachmentFields.mockResolvedValue({ fields: [], contextRoots: ['payload', 'policy', 'premium'] })
    api.previewAdminForms.mockResolvedValue([])
  })
  it('posts explicit saved draft selection, scope and synthetic facts; reports matching reasons', async () => {
    api.previewAdminForms.mockResolvedValue([{ formId: props.formId, formNumber: 'PR-1', reasons: ['Expression matched'], packetPlacement: 'End' }])
    render(<FormScenarioTest {...props} />)
    fireEvent.change(screen.getByLabelText('Synthetic scenario JSON'), { target: { value: '{"payload":{"building":{"yearBuilt":1970}},"premium":{"total":500},"policy":{"term":1}}' } })
    await userEvent.click(screen.getByRole('button', { name: 'Run Packet Preview' }))
    await waitFor(() => expect(api.previewAdminForms).toHaveBeenCalledWith(expect.objectContaining({ formId: props.formId, includeDraft: true, productCode: 'property', state: 'NY', transactionType: 'Quote', payload: { building: { yearBuilt: 1970 } }, premium: { total: 500 }, policy: { term: 1 } })))
    expect(await screen.findByText('Would attach')).toBeInTheDocument()
    expect(screen.getByText('Expression matched')).toBeInTheDocument()
  })
  it('reports nonmatch without inventing a local exclusion reason', async () => {
    render(<FormScenarioTest {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Run Packet Preview' }))
    expect(await screen.findByText('Would not attach')).toBeInTheDocument()
    expect(screen.getByText(/API does not return individual exclusion reasons/)).toBeInTheDocument()
  })
  it('invalidates evidence when input changes or saved configuration changes', async () => {
    const { rerender } = render(<FormScenarioTest {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Run Packet Preview' }))
    await screen.findByText('Would not attach')
    fireEvent.change(screen.getByLabelText('Test transaction'), { target: { value: 'Issue' } })
    expect(screen.queryByText('Would not attach')).not.toBeInTheDocument()
    expect(screen.getByText(/Run the preview again/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run Packet Preview' }))
    await screen.findByText('Would not attach')
    rerender(<FormScenarioTest {...props} revision="2" />)
    expect(screen.queryByText('Would not attach')).not.toBeInTheDocument()
  })
  it('shows runtime server errors, not a false successful nonmatch', async () => {
    api.previewAdminForms.mockRejectedValue(new Error('Unsafe attachment expression'))
    render(<FormScenarioTest {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Run Packet Preview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsafe attachment expression')
    expect(screen.queryByText('Would not attach')).not.toBeInTheDocument()
  })
  it('does not send invalid synthetic data', async () => {
    render(<FormScenarioTest {...props} />)
    fireEvent.change(screen.getByLabelText('Synthetic scenario JSON'), { target: { value: '{"payload":{"prototype":{}}}' } })
    await userEvent.click(screen.getByRole('button', { name: 'Run Packet Preview' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(api.previewAdminForms).not.toHaveBeenCalled()
  })
})
