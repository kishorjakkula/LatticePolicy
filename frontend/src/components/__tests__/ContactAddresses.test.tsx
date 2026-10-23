import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactAddresses, ContactCommunication } from '../ContactAddresses'
import { AddressFields } from '../AddressFields'
import { contactAddresses, legacyAddress, postalAddress, ratingZip } from '../../shared/postalAddress'
import { request } from '../../api/request'
vi.mock('../../api/request', () => ({ request: vi.fn(), tenantId: () => 'demo' }))
const first = { ...postalAddress(), line1: '10 Test St', line2: 'APT 4B', city: 'Boston', state: 'MA', postalCode: '02108-1234', primary: true }
beforeEach(() => { vi.mocked(request).mockReset(); vi.mocked(request).mockResolvedValue({ enabled: false }) })
function Harness() {
  const [addresses, setAddresses] = useState([first])
  const [contact, setContact] = useState({ email: 'contact@example.com', phone: '2025550123' })
  return <><ContactCommunication {...contact} onChange={patch => setContact(prev => ({ ...prev, ...patch }))} /><ContactAddresses value={addresses} onChange={setAddresses as any} /><output data-testid="saved">{JSON.stringify({ ...contact, addresses })}</output></>
}
describe('embedded contact address collection', () => {
  it('adds independent addresses and keeps communication outside postal objects', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Address' }))
    fireEvent.change(screen.getByLabelText('Address line 1'), { target: { value: '20 Example Ave' } })
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '2025550199' } })
    const saved = JSON.parse(screen.getByTestId('saved').textContent || '{}')
    expect(saved.phone).toBe('2025550199')
    expect(saved.addresses[0]).not.toHaveProperty('phone')
    expect(saved.addresses[1]).not.toHaveProperty('email')
    expect(screen.getByText(/10 Test St, APT 4B/)).toBeInTheDocument()
    expect(screen.getByLabelText('Mobile number')).toHaveValue('2025550199')
    expect(screen.getByRole('button', { name: 'Remove address 2' })).toBeInTheDocument()
  })
  it('switches primary and removes without losing the other unit or ZIP+4', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Address' }))
    fireEvent.click(screen.getByRole('button', { name: 'Set address 2 primary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove address 2' }))
    expect(screen.getByLabelText('Apartment, suite or unit')).toHaveValue('APT 4B')
    expect(screen.getByLabelText('ZIP Code')).toHaveValue('02108-1234')
    expect(screen.getByRole('checkbox', { name: 'Primary address' })).toBeChecked()
  })
  it('read-only contacts cannot add/remove/check or edit communication', () => {
    render(<ContactAddresses value={[first]} disabled onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Add Address' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Address line 1')).toBeDisabled()
    expect(request).not.toHaveBeenCalled()
  })
  it('preserves explicit empty collections and legacy units', () => {
    expect(contactAddresses([], { street: 'old' })).toEqual([])
    const addresses = contactAddresses(undefined, { street: 'legacy', line2: 'STE 9', zip: '00123' })
    expect(legacyAddress(addresses[0])).toMatchObject({ street: 'legacy', line2: 'STE 9', zip: '00123' })
  })
  it('keeps ZIP+4 in postal data and projects five digits for US rating only', () => {
    expect(ratingZip(first)).toBe('02108')
    expect(first.postalCode).toBe('02108-1234')
    expect(ratingZip(postalAddress({ country: 'CA', postalCode: 'K1A 0B1' }))).toBe('K1A 0B1')
    expect(ratingZip(postalAddress({ postalCode: 'bad' }))).toBe('bad')
  })
  it('single risk editor has no address list and preserves international input', () => {
    render(<AddressFields value={postalAddress({ country: 'CA', postalCode: 'K1A 0B1' })} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Postal Code')).toHaveValue('K1A 0B1')
    expect(screen.queryByRole('button', { name: 'Add Address' })).not.toBeInTheDocument()
  })
  it('drops late matching responses after edits', async () => {
    let resolve!: (value: any) => void
    vi.mocked(request).mockImplementation(async method => method === 'GET' ? { enabled: true } as any : new Promise(r => { resolve = r }))
    function Editor() { const [value, setValue] = useState(first); return <AddressFields value={value} onChange={setValue as any} /> }
    render(<Editor />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check Address' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check Address' }))
    fireEvent.change(screen.getByLabelText('Address line 1'), { target: { value: 'new address' } })
    resolve({ outcome: 'matched', candidates: [{ address: first }] })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Use suggested address' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Address line 1')).toHaveValue('new address')
  })
})
