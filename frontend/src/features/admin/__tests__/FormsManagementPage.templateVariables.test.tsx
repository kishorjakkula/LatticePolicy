import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom'
import { FormsManagementPage } from '../FormsManagementPage'

const useFormTemplateVariablesMock = vi.fn()
const getFormAuditMock = vi.fn()
const getFormTemplateAssetMock = vi.fn()
const uploadFormTemplateAssetMock = vi.fn()
const deleteFormTemplateAssetMock = vi.fn()

// Fixtures are created via vi.hoisted + referenced by stable identity from the mocked
// hooks below. useForm/useForms results must stay referentially stable across renders
// (exactly like react-query's real cached `data`) or the component's
// useEffect([selectedFormId, detail]) re-hydration effect will see a "new" detail object
// on every render and loop forever.
const { sampleFormSummary, sampleFormDetail } = vi.hoisted(() => ({
  sampleFormSummary: {
    formId: 'form-1',
    formNumber: 'PA-100',
    formTitle: 'Personal Auto Coverage Form',
    editionDate: '2026-01-01',
    workflowStatus: 'Draft',
    active: true,
    jurisdictionCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  sampleFormDetail: {
    form: {
      formId: 'form-1',
      formNumber: 'PA-100',
      formTitle: 'Personal Auto Coverage Form',
      workflowStatus: 'Draft',
      active: true,
      editLock: false,
    },
    jurisdictions: [],
    applicability: [],
    output: { templateSource: 'Static PDF', templateUri: '', outputFormat: 'PDF', mergeScope: 'policy', packetPlacement: 'End', sortOrder: 100, active: true },
    templateAsset: null,
    delivery: { deliveryMethods: ['Portal'], visibility: ['Insured'], acknowledgementRequired: false, esignRequired: false, active: true },
    security: { allowedRoles: [], editRoles: [], viewRoles: [] },
  },
}))

vi.mock('../../../api/hooks', () => ({
  useForms: () => ({
    data: [sampleFormSummary],
    isLoading: false,
    refetch: vi.fn(),
  }),
  useForm: () => ({
    data: sampleFormDetail,
    refetch: vi.fn(),
  }),
  useFormTemplateVariables: () => useFormTemplateVariablesMock(),
}))

vi.mock('../../../api/client', () => ({
  apiAdmin: {
    getFormAudit: (...args: any[]) => getFormAuditMock(...args),
    getFormTemplateAsset: (...args: any[]) => getFormTemplateAssetMock(...args),
    uploadFormTemplateAsset: (...args: any[]) => uploadFormTemplateAssetMock(...args),
    deleteFormTemplateAsset: (...args: any[]) => deleteFormTemplateAssetMock(...args),
  },
}))

const sampleVariables = [
  { token: 'insuredName', label: 'Insured Name', description: 'The primary named insured on the policy.', group: 'Insured' },
  { token: 'premiumTotal', label: 'Premium Total', description: 'The total premium for the term.', group: 'Premium' },
  { token: 'agentCommissionPercent', label: 'Agent Commission %', description: 'The commission rate paid to the agent.', group: 'Agent' },
]

async function openOutputSection() {
  render(<FormsManagementPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Edit PA-100' }))
  await userEvent.click(screen.getByRole('button', { name: 'Output + Delivery' }))
}

function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]')
  if (!input) throw new Error('template file input not found')
  return input as HTMLInputElement
}

describe('FormsManagementPage template variable catalog + docx validation feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getFormAuditMock.mockResolvedValue([])
    getFormTemplateAssetMock.mockResolvedValue(null)
    useFormTemplateVariablesMock.mockReturnValue({ data: { variables: sampleVariables }, isLoading: false })
  })

  it('renders the grouped variable catalog reference panel with {{token}} placeholders', async () => {
    await openOutputSection()

    expect(screen.getByText(/Template Variable Reference/)).toBeInTheDocument()
    await userEvent.click(screen.getByText(/Template Variable Reference/))

    expect(screen.getByText('Insured')).toBeInTheDocument()
    expect(screen.getByText('Premium')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('{{insuredName}}')).toBeInTheDocument()
    expect(screen.getByText('{{premiumTotal}}')).toBeInTheDocument()
    expect(screen.getByText('{{agentCommissionPercent}}')).toBeInTheDocument()
    expect(screen.getByText('Insured Name')).toBeInTheDocument()
  })

  it('shows a loading state for the catalog while it is being fetched', async () => {
    useFormTemplateVariablesMock.mockReturnValue({ data: undefined, isLoading: true })
    await openOutputSection()
    await userEvent.click(screen.getByText(/Template Variable Reference/))
    expect(screen.getByText('Loading variable catalog...')).toBeInTheDocument()
  })

  it('shows recognized tokens on a successful .docx upload', async () => {
    uploadFormTemplateAssetMock.mockResolvedValue({ ok: true, recognizedTokens: ['insuredName', 'premiumTotal'] })
    await openOutputSection()

    const file = new File(['dummy'], 'policy-template.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await userEvent.upload(getFileInput(), file)
    await userEvent.click(screen.getByRole('button', { name: 'Upload Template' }))

    await waitFor(() => {
      expect(uploadFormTemplateAssetMock).toHaveBeenCalledWith('form-1', file, undefined)
    })
    expect(await screen.findByText(/uploaded\./)).toBeInTheDocument()
    expect(screen.getByText(/\{\{insuredName\}\}, \{\{premiumTotal\}\}/)).toBeInTheDocument()
  })

  it('shows the specific unrecognized placeholder tokens when a .docx upload is rejected', async () => {
    uploadFormTemplateAssetMock.mockRejectedValue(
      new Error(
        'API POST /v1/admin/forms/form-1/output/template failed 400: ' +
          JSON.stringify({
            code: 'UNRECOGNIZED_TEMPLATE_TOKENS',
            message: 'Template contains unrecognized placeholder tokens.',
            badTokens: ['fooBar', 'totallyMadeUp'],
          })
      )
    )
    await openOutputSection()

    const file = new File(['dummy'], 'bad-template.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await userEvent.upload(getFileInput(), file)
    await userEvent.click(screen.getByRole('button', { name: 'Upload Template' }))

    expect(await screen.findByText(/Template contains unrecognized placeholder tokens\./)).toBeInTheDocument()
    expect(screen.getByText(/\{\{fooBar\}\}, \{\{totallyMadeUp\}\}/)).toBeInTheDocument()
  })

  it('leaves PDF upload behavior unchanged (no validation-result banners)', async () => {
    uploadFormTemplateAssetMock.mockResolvedValue({ ok: true })
    await openOutputSection()

    const file = new File(['dummy'], 'policy-template.pdf', { type: 'application/pdf' })
    await userEvent.upload(getFileInput(), file)
    await userEvent.click(screen.getByRole('button', { name: 'Upload Template' }))

    await waitFor(() => {
      expect(uploadFormTemplateAssetMock).toHaveBeenCalledWith('form-1', file, undefined)
    })
    expect(screen.queryByText(/uploaded\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/was rejected/)).not.toBeInTheDocument()
  })
})
