import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'

const getProductConfig = vi.fn()
const getProductForm = vi.fn()
vi.mock('../../../api/client', () => ({
  api: {
    getProductConfig: (...args: unknown[]) => getProductConfig(...args),
    getProductForm: (...args: unknown[]) => getProductForm(...args),
  },
}))

import { useHomeownersAutoDefaults, useProductConfiguration } from '../useProductConfiguration'

// WP-0002: rendered with real React effects and controlled API timing.
const autoConfig = { product: 'personal-auto', coverages: [{ code: 'BI' }, { code: 'PD' }] }
const homeConfig = { product: 'homeowners', coverages: [{ code: 'A' }, { code: 'B' }] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

afterEach(() => {
  getProductConfig.mockReset()
  getProductForm.mockReset()
})

describe('useProductConfiguration', () => {
  it('ignores the homeowners configuration when it arrives after personal auto was selected', async () => {
    const home = deferred<any>()
    const auto = deferred<any>()
    getProductConfig.mockImplementation((code: string) => (code === 'homeowners' ? home.promise : auto.promise))
    getProductForm.mockResolvedValue({ fields: [] })
    const { result, rerender } = renderHook(({ code }) => useProductConfiguration(code), { initialProps: { code: 'homeowners' } })
    rerender({ code: 'personal-auto' })
    await act(async () => auto.resolve(autoConfig))
    await act(async () => home.resolve(homeConfig))
    expect(result.current.cfg).toEqual(autoConfig)
  })

  it('ignores a late response for the first of two loads of the same product after a switch away and back', async () => {
    const first = deferred<any>()
    const latest = deferred<any>()
    const stale = { product: 'personal-auto', coverages: [{ code: 'STALE' }] }
    getProductConfig
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => Promise.resolve(homeConfig))
      .mockImplementationOnce(() => latest.promise)
    getProductForm.mockResolvedValue({ fields: [] })
    const { result, rerender } = renderHook(({ code }) => useProductConfiguration(code), { initialProps: { code: 'personal-auto' } })
    rerender({ code: 'homeowners' })
    rerender({ code: 'personal-auto' })
    await act(async () => latest.resolve(autoConfig))
    await act(async () => first.resolve(stale))
    expect(result.current.cfg).toEqual(autoConfig)
  })

  it('still loads when the same product is chosen again while its configuration is loading', async () => {
    // The regression the browser smoke test found: re-choosing the current
    // product must not orphan the load in flight.
    const auto = deferred<any>()
    getProductConfig.mockReturnValue(auto.promise)
    getProductForm.mockResolvedValue({ fields: [] })
    const { result, rerender } = renderHook(({ code }) => useProductConfiguration(code), { initialProps: { code: 'personal-auto' } })
    rerender({ code: 'personal-auto' })
    await act(async () => auto.resolve(autoConfig))
    await waitFor(() => expect(result.current.cfg).toEqual(autoConfig))
    expect(getProductConfig).toHaveBeenCalledTimes(1)
  })

  it("clears the previous product's configuration and risk form as soon as the product changes", async () => {
    getProductConfig.mockImplementation((code: string) => (code === 'homeowners' ? new Promise(() => {}) : Promise.resolve(autoConfig)))
    getProductForm.mockImplementation((code: string) => (code === 'homeowners' ? new Promise(() => {}) : Promise.resolve({ fields: [{ path: 'vin' }], screen: { id: 'auto' } })))
    const { result, rerender } = renderHook(({ code }) => useProductConfiguration(code), { initialProps: { code: 'personal-auto' } })
    await waitFor(() => expect(result.current.riskFields).toHaveLength(1))
    rerender({ code: 'homeowners' })
    expect(result.current.cfg).toBeNull()
    expect(result.current.riskFields).toEqual([])
    expect(result.current.riskScreen).toBeNull()
  })
})

describe('useHomeownersAutoDefaults', () => {
  const buildDefaults = (cfg: any, current: any[]) =>
    current.length ? current : cfg.coverages.map((coverage: any) => ({ code: coverage.code, selected: true }))

  function useHarness(productCode: string, cfg: any, initial: any[] = []) {
    const [coverages, setCoverages] = useState<any[]>(initial)
    const appliedRef = useRef(false)
    const autoDefaultsRef = useRef('')
    useHomeownersAutoDefaults({ productCode, cfg, coverages, setCoverages, buildDefaults, appliedRef, autoDefaultsRef })
    return { coverages, auto: autoDefaultsRef.current }
  }

  it('never builds homeowners defaults from the personal auto configuration', () => {
    const { result } = renderHook(() => useHarness('homeowners', autoConfig))
    expect(result.current.coverages).toEqual([])
  })

  it("builds them from homeowners' own configuration and records them as auto-applied", async () => {
    const { result } = renderHook(() => useHarness('homeowners', homeConfig))
    await waitFor(() => expect(result.current.coverages.map((c) => c.code)).toEqual(['A', 'B']))
    expect(result.current.auto).toBe(JSON.stringify([{ code: 'A', selected: true }, { code: 'B', selected: true }]))
  })

  it("does not record a reopened quote's saved coverages as auto-applied", async () => {
    const saved = [{ code: 'A', selected: true, limit: 500000 }]
    const { result } = renderHook(() => useHarness('homeowners', homeConfig, saved))
    await waitFor(() => expect(result.current.coverages).toEqual(saved))
    expect(result.current.auto).toBe('')
  })
})
