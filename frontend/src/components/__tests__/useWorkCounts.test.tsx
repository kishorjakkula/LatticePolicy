import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkCounts, WORK_COUNT_POLL_MS } from '../useWorkCounts'
import { apiUw } from '../../api/client'
import { apiSubmissions } from '../../api/submissions.api'
import { useAuthStore, type AuthUser } from '../../store/auth.store'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

let listReferrals: ReturnType<typeof vi.spyOn>
let listSubmissions: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'user-a', username: 'reader', tenantId: 'tenant-a', roles: ['admin'] } })
  listReferrals = vi.spyOn(apiUw, 'listReferrals').mockResolvedValue({ items: [], total: 4 })
  listSubmissions = vi.spyOn(apiSubmissions, 'list').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1, statusCounts: {} })
})

afterEach(() => {
  useAuthStore.setState({ user: null, token: null })
  vi.useRealTimers()
  focusManager.setFocused(undefined)
  vi.restoreAllMocks()
})

describe('useWorkCounts', () => {
  it.each(['tenant', 'user'])('never shows the previous %s counts while the new principal is loading', async (change) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
    const provider = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useWorkCounts({ referrals: true, submissions: true }), { wrapper: provider })
    await waitFor(() => expect(result.current).toEqual({ referrals: 4, submissions: 0 }))
    let finish: (value: { items: never[]; total: number }) => void = () => {}
    listReferrals.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    listSubmissions.mockResolvedValueOnce({ items: [], total: 8, page: 1, pageSize: 1, statusCounts: {} })
    act(() => useAuthStore.setState({ user: {
      ...useAuthStore.getState().user!,
      ...(change === 'tenant' ? { tenantId: 'tenant-b' } : { id: 'user-b', username: 'other-reader' }),
    } as AuthUser }))
    expect(result.current.referrals).toBeUndefined()
    await waitFor(() => expect(listReferrals).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.submissions).toBe(8))
    await act(async () => { finish({ items: [], total: 9 }) })
    await waitFor(() => expect(result.current.referrals).toBe(9))
    client.clear()
  })

  it('does not expose cached counts or make requests after logout', async () => {
    const { result } = renderHook(() => useWorkCounts({ referrals: true, submissions: true }), { wrapper })
    await waitFor(() => expect(result.current.referrals).toBe(4))
    act(() => useAuthStore.getState().logout())
    expect(result.current).toEqual({ referrals: undefined, submissions: undefined })
    expect(listReferrals).toHaveBeenCalledTimes(1)
  })
  it('reads total from one-row requests, including a real zero', async () => {
    const { result } = renderHook(() => useWorkCounts({ referrals: true, submissions: true }), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ referrals: 4, submissions: 0 }))
    expect(listReferrals).toHaveBeenCalledWith(1, 1, 'Open')
    expect(listSubmissions).toHaveBeenCalledWith('READY_FOR_REVIEW', 1, 1)
  })

  it('makes no request without permission', async () => {
    const { result } = renderHook(() => useWorkCounts({ referrals: false, submissions: false }), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current).toEqual({ referrals: undefined, submissions: undefined })
    expect(listReferrals).not.toHaveBeenCalled()
    expect(listSubmissions).not.toHaveBeenCalled()
  })

  it('returns undefined for a failed count', async () => {
    listReferrals.mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useWorkCounts({ referrals: true, submissions: true }), { wrapper })
    await waitFor(() => expect(result.current.submissions).toBe(0))
    await waitFor(() => expect(listReferrals).toHaveBeenCalled())
    expect(result.current.referrals).toBeUndefined()
  })

  it('polls every 60 seconds while visible and pauses while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    focusManager.setFocused(true)
    renderHook(() => useWorkCounts({ referrals: true, submissions: false }), { wrapper })
    await waitFor(() => expect(listReferrals).toHaveBeenCalledTimes(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORK_COUNT_POLL_MS)
    })
    await waitFor(() => expect(listReferrals).toHaveBeenCalledTimes(2))

    act(() => focusManager.setFocused(false))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORK_COUNT_POLL_MS * 3)
    })
    expect(listReferrals).toHaveBeenCalledTimes(2)
  })
})
