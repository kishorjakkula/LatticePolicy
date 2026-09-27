import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RatingWorkbenchPage } from '../RatingWorkbenchPage'

vi.mock('../../../api/hooks', () => ({
  useRatingModels: () => ({
    data: [
      {
        modelId: 'model-1',
        modelCode: 'PA-BASE',
        productCode: 'personal-auto',
        stateCode: 'PA',
        programName: 'Personal Auto',
        status: 'ACTIVE',
        activeVersionId: 'version-1',
        versions: [
          {
            versionId: 'version-1',
            modelId: 'model-1',
            versionLabel: 'v1',
            publishStatus: 'PUBLISHED',
            isActive: true,
            parserName: 'test',
            parserVersion: '1',
            sourceFileName: 'rates.xlsx',
          },
        ],
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
  }),
  useRatingModelVersion: () => ({ data: undefined, isLoading: false }),
  useImportRatingWorkbookMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePublishRatingModelVersionMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('../../../api/client', () => ({
  api: { getPublishedRatingModel: vi.fn() },
}))

describe('RatingWorkbenchPage accessibility', () => {
  it('does not render unnamed controls when auditing icon-only actions', async () => {
    render(
      <MemoryRouter>
        <RatingWorkbenchPage />
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Rating Workbench' })).toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName()
    }
  })
})
