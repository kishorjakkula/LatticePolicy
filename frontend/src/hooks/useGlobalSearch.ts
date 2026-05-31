import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { inferSmartSearchMode, fallbackSearchModeHint, type SmartSearchMode } from '../utils/smartSearch'

interface UseGlobalSearchOptions {
  token: string | null
  isLoginRoute: boolean
  canUseGlobalSearch: boolean
  canSearchCustomers: boolean
}

export function useGlobalSearch({ token, isLoginRoute, canUseGlobalSearch, canSearchCustomers }: UseGlobalSearchOptions) {
  const location = useLocation()
  const navigate = useNavigate()
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearching, setGlobalSearching] = useState(false)
  const [globalFocused, setGlobalFocused] = useState(false)
  const autoSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextAutoSearchRef = useRef(0)

  // Sync query from URL params when on /search
  useEffect(() => {
    if (location.pathname !== '/search') return
    const params = new URLSearchParams(location.search)
    const nextQuery = params.get('q') || ''
    setGlobalSearchQuery((prev) => (prev === nextQuery ? prev : nextQuery))
  }, [location.pathname, location.search])

  const cancelPendingGlobalAutoSearch = () => {
    if (autoSearchTimerRef.current) {
      clearTimeout(autoSearchTimerRef.current)
      autoSearchTimerRef.current = null
    }
    skipNextAutoSearchRef.current += 1
    setGlobalSearching(false)
  }

  // Cancel on route change when input not focused
  useEffect(() => {
    if (globalFocused) return
    cancelPendingGlobalAutoSearch()
  }, [location.pathname, location.search, globalFocused])

  const runGlobalSearch = async (rawQuery: string, source: 'submit' | 'auto') => {
    if (!canUseGlobalSearch) return
    const trimmedQuery = String(rawQuery || '').trim()
    if (!trimmedQuery) {
      if (source === 'submit') navigate('/search?mode=policies&page=1&pageSize=20')
      return
    }
    const runSeq = ++skipNextAutoSearchRef.current
    setGlobalSearching(true)
    let mode: SmartSearchMode = 'policies'
    try {
      mode = await inferSmartSearchMode(trimmedQuery, { canSearchCustomers })
    } catch {
      mode = fallbackSearchModeHint(trimmedQuery, canSearchCustomers)
    }
    if (runSeq !== skipNextAutoSearchRef.current) return
    const params = new URLSearchParams()
    params.set('mode', mode)
    params.set('page', '1')
    params.set('pageSize', '20')
    params.set('q', trimmedQuery)
    const target = `/search?${params.toString()}`
    const current = `${location.pathname}${location.search}`
    if (current !== target) navigate(target)
    if (runSeq === skipNextAutoSearchRef.current) {
      setGlobalSearching(false)
    }
  }

  const onGlobalSearchSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (autoSearchTimerRef.current) {
      clearTimeout(autoSearchTimerRef.current)
      autoSearchTimerRef.current = null
    }
    await runGlobalSearch(globalSearchQuery, 'submit')
  }

  // Auto-search debounce (450ms timer)
  useEffect(() => {
    if (!token || isLoginRoute || !canUseGlobalSearch || !globalFocused) return
    const trimmed = globalSearchQuery.trim()
    if (!trimmed || trimmed.length < 2) {
      if (autoSearchTimerRef.current) {
        clearTimeout(autoSearchTimerRef.current)
        autoSearchTimerRef.current = null
      }
      if (!trimmed) {
        skipNextAutoSearchRef.current += 1
        setGlobalSearching(false)
      }
      return
    }
    if (autoSearchTimerRef.current) clearTimeout(autoSearchTimerRef.current)
    autoSearchTimerRef.current = setTimeout(() => {
      autoSearchTimerRef.current = null
      void runGlobalSearch(globalSearchQuery, 'auto')
    }, 450)
    return () => {
      if (autoSearchTimerRef.current) {
        clearTimeout(autoSearchTimerRef.current)
        autoSearchTimerRef.current = null
      }
    }
  }, [globalSearchQuery, canUseGlobalSearch, canSearchCustomers, token, isLoginRoute, globalFocused])

  return {
    globalSearchQuery,
    setGlobalSearchQuery,
    globalSearching,
    globalFocused,
    setGlobalFocused,
    cancelPendingGlobalAutoSearch,
    onGlobalSearchSubmit
  }
}
