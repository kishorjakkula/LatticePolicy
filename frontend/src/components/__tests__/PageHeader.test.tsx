import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import fs from 'node:fs'
import path from 'node:path'
import { PageHeader, PageHeaderFact } from '../PageHeader'

describe('PageHeader', () => {
  it('renders title, breadcrumbs, facts, status and actions in their slots', () => {
    render(
      <PageHeader
        title="Policy PC-1"
        breadcrumbs={<nav aria-label="Breadcrumb">Policies / PC-1</nav>}
        status={<span>In Force</span>}
        facts={
          <>
            <PageHeaderFact label="Product">Personal Auto</PageHeaderFact>
            <PageHeaderFact label="Premium this term">$542.82</PageHeaderFact>
          </>
        }
        actions={<button type="button">Endorse</button>}
        className="card"
        data-testid="header"
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Policy PC-1' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    const header = screen.getByTestId('header')
    expect(header).toHaveClass('card')
    expect(within(header).getByText('In Force')).toBeInTheDocument()
    expect(within(header).getByText('Product').tagName).toBe('DT')
    expect(within(header).getByText('Personal Auto').tagName).toBe('DD')
    expect(within(header).getByRole('button', { name: 'Endorse' })).toBeInTheDocument()
  })

  it('omits empty slots', () => {
    const { container } = render(<PageHeader title="Only a title" />)
    expect(container.querySelector('dl')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses design tokens rather than colour literals', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../PageHeader.tsx'), 'utf8')
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    expect(source).toMatch(/var\(--ps-/)
  })
})
